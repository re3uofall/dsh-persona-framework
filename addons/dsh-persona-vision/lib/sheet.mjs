/**
 * sheet.mjs —— 拼图：把几帧拼成一张，省 token 也省得来回翻。
 *
 * 契约（SPEC.md）：
 *   buildSheet(frames, { outDir }) → { path, cols, rows, width, height }
 *   frames: [{ path, label }]，label 画在每格左上角。
 *   cols = ceil(sqrt(n))，每格等比缩到同一宽度，格间留 8px 白边。
 *   空 frames 必须 throw；只有 1 帧也要能出图（1×1）。
 *
 * 同样零第三方依赖：图像全部交给 PowerShell + System.Drawing。
 * 路径与标签走一份 UTF-8 的 JSON 清单递进去——中文不进命令行、不进脚本本体，
 * 这样引号、反斜杠、盘符都不用自己转义，少一处炸点。
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** 每格的目标宽度、格间距、label 字号下限。 */
const DEFAULT_CELL_WIDTH = 480
const DEFAULT_GAP = 8
const MIN_LABEL_PX = 12
/** 字号跟格宽走：约 width/28。 */
const LABEL_DIVISOR = 28

const SHEET_CS = String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;

public static class DshPersonaVisionSheet
{
    private static Font PickFont(float pixelSize)
    {
        string[] wanted = new string[] {
            "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", "SimSun"
        };
        var installed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (FontFamily family in FontFamily.Families) installed.Add(family.Name);
        foreach (string name in wanted)
        {
            if (installed.Contains(name)) return new Font(name, pixelSize, GraphicsUnit.Pixel);
        }
        return new Font(FontFamily.GenericSansSerif, pixelSize, GraphicsUnit.Pixel);
    }

    // 返回 [宽, 高]。图落盘在 outPath。
    public static int[] Build(
        string[] paths,
        string[] labels,
        string outPath,
        int cols,
        int rows,
        int cellWidth,
        int gap,
        int minLabelPx)
    {
        int count = paths.Length;
        if (count == 0) throw new ArgumentException("没有帧可拼。");
        if (cols <= 0 || rows <= 0) throw new ArgumentException("网格行列数必须大于 0。");
        if (cellWidth <= 0) throw new ArgumentException("每格宽度必须大于 0。");
        if (gap < 0) gap = 0;

        var streams = new List<MemoryStream>(count);
        var images = new Image[count];
        var scaled = new int[count];
        int cellHeight = 0;

        try
        {
            for (int i = 0; i < count; i++)
            {
                if (String.IsNullOrEmpty(paths[i]))
                    throw new ArgumentException("第 " + (i + 1) + " 帧没有给路径。");

                // 用内存流而不是 Image.FromFile：GDI+ 按文件名缓存，
                // 同一个文件第二次加载会直接抛异常；而且 FromFile 会锁文件。
                byte[] data = File.ReadAllBytes(paths[i]);
                var stream = new MemoryStream(data);
                streams.Add(stream);
                Image image = Image.FromStream(stream);
                images[i] = image;

                if (image.Width <= 0 || image.Height <= 0)
                    throw new ArgumentException("第 " + (i + 1) + " 帧的图没有尺寸：" + paths[i]);

                int h = (int)Math.Floor((double)image.Height * cellWidth / (double)image.Width + 0.5);
                if (h < 1) h = 1;
                scaled[i] = h;
                if (h > cellHeight) cellHeight = h;
            }

            int width = cols * cellWidth + (cols + 1) * gap;
            int height = rows * cellHeight + (rows + 1) * gap;

            using (var sheet = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                using (Graphics canvas = Graphics.FromImage(sheet))
                {
                    canvas.Clear(Color.White);
                    canvas.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    canvas.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    canvas.SmoothingMode = SmoothingMode.HighQuality;
                    canvas.CompositingQuality = CompositingQuality.HighQuality;
                    canvas.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

                    float fontSize = (float)Math.Max((double)minLabelPx, Math.Round(cellWidth / 28.0));
                    using (Font font = PickFont(fontSize))
                    using (var textBrush = new SolidBrush(Color.White))
                    using (var plateBrush = new SolidBrush(Color.FromArgb(170, 0, 0, 0)))
                    {
                        for (int i = 0; i < count; i++)
                        {
                            int col = i % cols;
                            int row = i / cols;
                            int x = gap + col * (cellWidth + gap);
                            int y = gap + row * (cellHeight + gap);

                            canvas.DrawImage(images[i], new Rectangle(x, y, cellWidth, scaled[i]));

                            string label = (labels != null && i < labels.Length) ? labels[i] : null;
                            if (String.IsNullOrEmpty(label)) continue;

                            SizeF measured = canvas.MeasureString(label, font);
                            float plateWidth = measured.Width + 8f;
                            float plateHeight = measured.Height + 4f;
                            float plateX = x;
                            float plateY = y;
                            if (plateX + plateWidth > x + cellWidth) plateWidth = cellWidth;
                            if (plateY + plateHeight > y + scaled[i]) plateHeight = Math.Max(scaled[i], 1);

                            canvas.FillRectangle(plateBrush, plateX, plateY, plateWidth, plateHeight);
                            canvas.DrawString(label, font, textBrush, plateX + 4f, plateY + 2f);
                        }
                    }
                }

                sheet.Save(outPath, ImageFormat.Png);
            }

            return new int[] { width, height };
        }
        finally
        {
            for (int i = 0; i < images.Length; i++)
            {
                if (images[i] != null) images[i].Dispose();
            }
            for (int i = 0; i < streams.Count; i++)
            {
                streams[i].Dispose();
            }
        }
    }
}
`

const SHEET_PS = String.raw`
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

# PowerShell 5.1 的 ConvertFrom-Json 会把单元素 JSON 数组拆成标量，
# 一律用 @() 兜回数组，不然「只有一帧」这种正当情形会当场崩。
$paths = [string[]]@($config.paths)
$labels = [string[]]@($config.labels)
$outPath = [string]$config.out
$cols = [int]$config.cols
$rows = [int]$config.rows
$cellWidth = [int]$config.cellWidth
$gap = [int]$config.gap
$minLabelPx = [int]$config.minLabelPx

$source = @'
__SHEET_CS__
'@

try {
    Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms.dll', 'System.Drawing.dll' -ErrorAction Stop
} catch {
    throw ('vision_sheet: 编不出拼图助手：' + $_.Exception.Message)
}

try {
    $size = [DshPersonaVisionSheet]::Build($paths, $labels, $outPath, $cols, $rows, $cellWidth, $gap, $minLabelPx)
} catch {
    $inner = $_.Exception
    while ($inner.InnerException -ne $null) { $inner = $inner.InnerException }
    throw ('vision_sheet: 拼接失败：' + $inner.Message)
}

Write-Output ('WIDTH=' + $size[0])
Write-Output ('HEIGHT=' + $size[1])
`

function isAsciiPath(value) {
  return typeof value === 'string' && value !== '' && /^[\x20-\x7e]+$/.test(value)
}

/** Add-Type 走 CodeDom 编译，TEMP 落在非 ASCII 路径上就编不出来。挑一个纯 ASCII 的。 */
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
      return await mkdtemp(path.win32.join(root, 'dsh-persona-vision-sheet-'))
    } catch (error) {
      failures.push(`${root}: ${error && error.message ? error.message : String(error)}`)
    }
  }

  throw new Error(
    'vision_sheet: 找不到一个「路径全 ASCII 且可写」的临时目录，'
      + 'PowerShell 编不出拼图助手（TEMP 里带中文就会这样）。'
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
  const detail = String(stderr || '').trim() || String(stdout || '').trim() || '（PowerShell 没给任何输出）'
  return new Error(`vision_sheet: ${context}。PowerShell 原话：${detail}`)
}

/**
 * 把几帧拼成一张网格图。
 *
 * @param {Array<{ path: string, label?: string }>} frames
 * @param {{ outDir?: string, cellWidth?: number, gap?: number }} [opts]
 * @returns {Promise<{ path: string, cols: number, rows: number, width: number, height: number }>}
 */
export async function buildSheet(frames, opts = {}) {
  if (!Array.isArray(frames)) {
    throw new Error('vision_sheet: frames 必须是数组（[{ path, label }]），拿到的是 '
      + `${frames === null ? 'null' : typeof frames}。`)
  }
  if (frames.length === 0) {
    throw new Error('vision_sheet: 一帧都没有，不拼空图。要拼至少给一帧。')
  }

  const options = opts && typeof opts === 'object' ? opts : {}
  const cellWidth = Number.isFinite(options.cellWidth) && options.cellWidth > 0
    ? Math.round(options.cellWidth)
    : DEFAULT_CELL_WIDTH
  const gap = Number.isFinite(options.gap) && options.gap >= 0 ? Math.round(options.gap) : DEFAULT_GAP

  const paths = []
  const labels = []
  frames.forEach((frame, index) => {
    if (!frame || typeof frame !== 'object' || typeof frame.path !== 'string' || frame.path.trim() === '') {
      throw new Error(`vision_sheet: 第 ${index + 1} 帧没有 path，拼不出来。`)
    }
    paths.push(path.resolve(frame.path))
    labels.push(typeof frame.label === 'string' ? frame.label : '')
  })

  const count = paths.length
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)

  const outDir = path.resolve(
    typeof options.outDir === 'string' && options.outDir.trim() !== ''
      ? options.outDir
      : path.join(os.tmpdir(), 'dsh-persona-vision', 'sheets'),
  )

  let scratchDir
  try {
    await mkdir(outDir, { recursive: true }).catch((error) => {
      throw new Error(
        `vision_sheet: 建不出输出目录 ${outDir}：${error && error.message ? error.message : String(error)}`,
      )
    })

    const outPath = path.join(outDir, `sheet-${stampNow()}.png`)

    scratchDir = await makeAsciiScratchDir()
    const scriptPath = path.join(scratchDir, 'sheet.ps1')
    const configPath = path.join(scratchDir, 'sheet.json')

    const script = SHEET_PS.replace('__SHEET_CS__', () => SHEET_CS)

    // 带 BOM 的 UTF-8：PowerShell 5.1 认 BOM；不带 BOM 会按 ANSI 读，中文全成乱码。
    await writeFile(scriptPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(script, 'utf8')]))
    await writeFile(
      configPath,
      JSON.stringify({
        out: outPath,
        cols,
        rows,
        cellWidth,
        gap,
        minLabelPx: Math.max(MIN_LABEL_PX, Math.round(cellWidth / LABEL_DIVISOR)),
        paths,
        labels,
      }),
      'utf8',
    )

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
          timeout: 120_000,
          env: {
            ...process.env,
            TEMP: scratchDir,
            TMP: scratchDir,
          },
        },
      )
      stdout = run.stdout
      stderr = run.stderr
    } catch (error) {
      if (error && (error.code === 'ETIMEDOUT' || error.killed)) {
        throw new Error('vision_sheet: 拼图超时（120 秒没回来），帧太多或者某张图太大。')
      }
      throw failWith('拼图失败', error && error.stderr, error && error.stdout)
    }

    const fields = parseKeyValues(stdout)
    const width = Number.parseInt(fields.WIDTH, 10)
    const height = Number.parseInt(fields.HEIGHT, 10)
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw failWith('没拿到拼图的宽高', stderr, stdout)
    }

    let bytes
    try {
      bytes = (await stat(outPath)).size
    } catch (error) {
      throw new Error(
        `vision_sheet: PowerShell 说拼好了，但盘上没有 ${outPath}：`
          + `${error && error.message ? error.message : String(error)}`,
      )
    }
    if (!Number.isFinite(bytes) || bytes <= 0) {
      throw new Error(`vision_sheet: 落盘的拼图是空的（${bytes} 字节）：${outPath}`)
    }

    return { path: outPath, cols, rows, width, height }
  } finally {
    if (scratchDir) {
      try {
        await rm(scratchDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
      } catch {
        // 清理是尽力而为，不能因此把一张拼好的图判成失败。
      }
    }
  }
}

export default buildSheet
