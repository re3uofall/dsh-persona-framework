/**
 * capture.mjs —— 眼睛：截一屏，并在同一趟 PowerShell 里把 32×18 灰度指纹算出来。
 *
 * 契约（SPEC.md）：
 *   captureFrame({ outDir, monitor }) → { path, width, height, fp, bytes }
 *   fp 长度必须是 576，整数 0..255。
 *
 * 硬约束：
 *   - Node 侧零第三方依赖，不碰任何图像库；
 *   - 图像全部交给 PowerShell + System.Drawing；
 *   - DPI 必须处理，否则拿到的图会被系统缩放，坐标全歪。
 *
 * 做法上的三个要点：
 *   1. 脚本写到临时目录里用 -File 跑，不塞进 -Command（中文与引号会被转义搞坏）。
 *   2. 临时目录挑一个**纯 ASCII** 的：Add-Type 走 CodeDom 编译，TEMP 里有非 ASCII
 *      字符时编译会当场失败。这一点是照 dsh-vision-router 的教训抄的。
 *   3. 指纹在同一趟里算完：先把整屏缩到 32×18，再遍历那 576 个像素取平均灰度。
 *      逐格 GetPixel 去凑均值，几百次跨托管边界，慢到不能用。
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** 指纹网格：32×18 = 576。 */
const FP_W = 32
const FP_H = 18
const FP_LEN = FP_W * FP_H

/** 截屏助手：PerMonitorV2 → PerMonitorV1 → 抛错，绝不退回逻辑坐标。 */
const CAPTURE_CS = String.raw`
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class DshPersonaVisionCapture
{
    private static readonly IntPtr PER_MONITOR_V2 = new IntPtr(-4);
    private static readonly IntPtr PER_MONITOR_V1 = new IntPtr(-3);

    [DllImport("user32.dll")]
    private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);

    private static IntPtr TrySet(IntPtr context)
    {
        try { return SetThreadDpiAwarenessContext(context); }
        catch (EntryPointNotFoundException) { return IntPtr.Zero; }
        catch (DllNotFoundException) { return IntPtr.Zero; }
    }

    private static IntPtr EnterPerMonitor()
    {
        IntPtr previous = TrySet(PER_MONITOR_V2);
        if (previous == IntPtr.Zero) previous = TrySet(PER_MONITOR_V1);
        if (previous == IntPtr.Zero)
        {
            throw new InvalidOperationException(
                "进不去 per-monitor DPI 上下文（PerMonitorV2 / V1 都没成），"
                + "这时候截出来的图会被系统缩放，坐标全歪，所以不交这张图。");
        }
        return previous;
    }

    private static void Restore(IntPtr previous)
    {
        try { SetThreadDpiAwarenessContext(previous); }
        catch { /* 进程马上就要退出，尽力还原即可 */ }
    }

    private static int GrayAt(Bitmap bitmap, int x, int y)
    {
        Color c = bitmap.GetPixel(x, y);
        int gray = (int)Math.Floor((c.R + c.G + c.B) / 3.0 + 0.5);
        if (gray < 0) return 0;
        if (gray > 255) return 255;
        return gray;
    }

    // 返回 [宽度, 高度, 指纹]；指纹是 576 个 0..255 的整数，逗号分隔。
    public static string[] CaptureAndFingerprint(string outPath, int gridW, int gridH)
    {
        if (gridW <= 0 || gridH <= 0) throw new ArgumentException("指纹网格尺寸必须大于 0");
        if (String.IsNullOrEmpty(outPath)) throw new ArgumentException("输出路径是空的");

        IntPtr previous = EnterPerMonitor();
        try
        {
            Screen screen = Screen.PrimaryScreen;
            if (screen == null) throw new InvalidOperationException("系统报不出主屏，截不了。");

            Rectangle bounds = screen.Bounds;
            if (bounds.Width <= 0 || bounds.Height <= 0)
            {
                throw new InvalidOperationException("主屏的可截取区域是空的，截不了。");
            }

            using (var full = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
            {
                using (var canvas = Graphics.FromImage(full))
                {
                    canvas.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                }

                using (var small = new Bitmap(gridW, gridH, PixelFormat.Format24bppRgb))
                {
                    using (var shrink = Graphics.FromImage(small))
                    {
                        shrink.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        shrink.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        shrink.SmoothingMode = SmoothingMode.HighQuality;
                        shrink.CompositingQuality = CompositingQuality.HighQuality;
                        using (var attrs = new ImageAttributes())
                        {
                            attrs.SetWrapMode(WrapMode.TileFlipXY);
                            shrink.DrawImage(
                                full,
                                new Rectangle(0, 0, gridW, gridH),
                                0, 0, full.Width, full.Height,
                                GraphicsUnit.Pixel,
                                attrs);
                        }
                    }

                    var builder = new System.Text.StringBuilder(gridW * gridH * 4);
                    for (int y = 0; y < gridH; y++)
                    {
                        for (int x = 0; x < gridW; x++)
                        {
                            if (builder.Length > 0) builder.Append(',');
                            builder.Append(GrayAt(small, x, y));
                        }
                    }

                    full.Save(outPath, ImageFormat.Png);
                    return new string[] {
                        bounds.Width.ToString(),
                        bounds.Height.ToString(),
                        builder.ToString()
                    };
                }
            }
        }
        finally
        {
            Restore(previous);
        }
    }
}
`

/** 真正的 PowerShell 脚本。只经 -File 跑，参数只有配置文件路径（纯 ASCII）。 */
const CAPTURE_PS = String.raw`
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$outPath = [string]$config.out

$source = @'
__CAPTURE_CS__
'@

try {
    Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms.dll', 'System.Drawing.dll' -ErrorAction Stop
} catch {
    throw ('vision_capture: 编不出 DPI 截屏助手：' + $_.Exception.Message)
}

$result = [DshPersonaVisionCapture]::CaptureAndFingerprint($outPath, $GridW, $GridH)
Write-Output ('WIDTH=' + $result[0])
Write-Output ('HEIGHT=' + $result[1])
Write-Output ('FP=' + $result[2])
`

function isAsciiPath(value) {
  return typeof value === 'string' && value !== '' && /^[\x20-\x7e]+$/.test(value)
}

/**
 * 挑一个可写的、路径全 ASCII 的临时目录。
 * Add-Type 用 CodeDom 编译临时程序集，TEMP/TMP 落在非 ASCII 路径上会编不出来。
 */
async function makeAsciiScratchDir() {
  const candidates = []
  const push = (value) => {
    if (isAsciiPath(value) && !candidates.includes(value)) candidates.push(value)
  }
  push(os.tmpdir())
  push(process.env.TEMP)
  push(process.env.TMP)
  if (isAsciiPath(process.env.SystemRoot)) push(path.win32.join(process.env.SystemRoot, 'Temp'))
  if (isAsciiPath(process.env.WINDIR)) push(path.win32.join(process.env.WINDIR, 'Temp'))

  const failures = []
  for (const root of candidates) {
    try {
      return await mkdtemp(path.win32.join(root, 'dsh-persona-vision-'))
    } catch (error) {
      failures.push(`${root}: ${error && error.message ? error.message : String(error)}`)
    }
  }

  throw new Error(
    'vision_capture: 找不到一个「路径全 ASCII 且可写」的临时目录，'
      + 'PowerShell 编不出截屏助手（TEMP 里带中文就会这样）。'
      + (failures.length > 0 ? `试过：${failures.join(' | ')}` : ''),
  )
}

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function stampNow() {
  const d = new Date()
  const two = (n) => String(n).padStart(2, '0')
  const three = (n) => String(n).padStart(3, '0')
  const date = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`
  const time = `${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  const ms = three(d.getMilliseconds())
  const salt = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${date}-${time}-${ms}-${salt}`
}

function parseKeyValues(stdout) {
  const found = {}
  for (const rawLine of String(stdout).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    found[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return found
}

function failWith(context, stderr, stdout) {
  const stderrText = String(stderr || '').trim()
  const stdoutText = String(stdout || '').trim()
  const detail = stderrText || stdoutText || '（PowerShell 没给任何输出）'
  return new Error(`vision_capture: ${context}。PowerShell 原话：${detail}`)
}

/**
 * 截一帧主屏。
 *
 * @param {{ outDir?: string, monitor?: number }} [opts]
 * @returns {Promise<{ path: string, width: number, height: number, fp: number[], bytes: number }>}
 */
export async function captureFrame(opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {}

  const monitor = options.monitor === undefined || options.monitor === null ? 0 : options.monitor
  if (monitor !== 0) {
    throw new Error(`vision_capture: monitor 目前只支持 0（主屏），拿到的是 ${JSON.stringify(options.monitor)}。`)
  }

  const outDir = path.resolve(
    typeof options.outDir === 'string' && options.outDir.trim() !== ''
      ? options.outDir
      : path.join(os.tmpdir(), 'dsh-persona-vision', 'frames'),
  )

  let scratchDir
  try {
    await mkdir(outDir, { recursive: true }).catch((error) => {
      throw new Error(
        `vision_capture: 建不出输出目录 ${outDir}：${error && error.message ? error.message : String(error)}`,
      )
    })

    const outPath = path.join(outDir, `frame-${stampNow()}.png`)

    scratchDir = await makeAsciiScratchDir()
    const scriptPath = path.join(scratchDir, 'capture.ps1')
    const configPath = path.join(scratchDir, 'capture.json')

    const script = CAPTURE_PS
      .replace('__CAPTURE_CS__', () => CAPTURE_CS)
      .replace(/\$GridW\b/g, String(FP_W))
      .replace(/\$GridH\b/g, String(FP_H))

    // 带 BOM 的 UTF-8：Windows PowerShell 5.1 认 BOM；不带 BOM 会按 ANSI 读，中文全成乱码。
    await writeFile(scriptPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(script, 'utf8')]))
    await writeFile(configPath, JSON.stringify({ out: outPath }), 'utf8')

    let stdout = ''
    let stderr = ''
    try {
      const run = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', scriptPath, configPath],
        {
          windowsHide: true,
          cwd: scratchDir,
          maxBuffer: 8 * 1024 * 1024,
          timeout: 60_000,
          env: {
            ...process.env,
            // 编译 CodeDom 用的临时目录也一起指到 ASCII 路径上。
            TEMP: scratchDir,
            TMP: scratchDir,
          },
        },
      )
      stdout = run.stdout
      stderr = run.stderr
    } catch (error) {
      if (error && (error.code === 'ETIMEDOUT' || error.killed)) {
        throw new Error('vision_capture: 截屏超时（60 秒没回来），这通常是 PowerShell 卡在授权或弹窗上。')
      }
      throw failWith('截屏失败', error && error.stderr, error && error.stdout)
    }

    const fields = parseKeyValues(stdout)
    const width = Number.parseInt(fields.WIDTH, 10)
    const height = Number.parseInt(fields.HEIGHT, 10)
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw failWith('没拿到截图的宽高', stderr, stdout)
    }

    const rawFp = String(fields.FP || '').trim()
    if (rawFp === '') throw failWith('没拿到指纹', stderr, stdout)

    const fp = rawFp.split(',').map((piece) => Number.parseInt(piece.trim(), 10))
    if (fp.length !== FP_LEN) {
      throw new Error(`vision_capture: 指纹长度是 ${fp.length}，契约要求 ${FP_LEN}（${FP_W}×${FP_H}）。`)
    }
    for (let i = 0; i < fp.length; i += 1) {
      if (!Number.isInteger(fp[i]) || fp[i] < 0 || fp[i] > 255) {
        throw new Error(`vision_capture: 指纹第 ${i} 格是 ${rawFp.split(',')[i]}，不是 0..255 的整数。`)
      }
    }

    let bytes
    try {
      const info = await stat(outPath)
      bytes = info.size
    } catch (error) {
      throw new Error(
        `vision_capture: PowerShell 说截好了，但盘上没有 ${outPath}：`
          + `${error && error.message ? error.message : String(error)}`,
      )
    }
    if (!Number.isFinite(bytes) || bytes <= 0) {
      throw new Error(`vision_capture: 落盘的 PNG 是空的（${bytes} 字节）：${outPath}`)
    }

    return { path: outPath, width, height, fp, bytes }
  } finally {
    if (scratchDir) {
      try {
        await rm(scratchDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // 杀毒 / 索引偶尔会扣住 CodeDom 的文件，清理是尽力而为，不能因此把一张好图判成失败。
      }
    }
  }
}

export default captureFrame
