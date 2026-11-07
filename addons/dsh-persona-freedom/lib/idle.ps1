# idle.ps1 - report how many milliseconds since the last keyboard/mouse input.
# ASCII only on purpose: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI,
# and a stray Chinese character makes the whole script fail to parse.
# Prints one line: {"idleMs": 12345, "ok": true}

$ErrorActionPreference = 'Stop'

$sig = @"
using System;
using System.Runtime.InteropServices;

public class IdleProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    public static long IdleMs() {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(lii);
        if (!GetLastInputInfo(ref lii)) return -1;
        return (long)(unchecked((uint)(Environment.TickCount - (int)lii.dwTime)));
    }
}
"@

try {
    if (-not ("IdleProbe" -as [type])) {
        Add-Type -TypeDefinition $sig
    }
    $ms = [IdleProbe]::IdleMs()
    if ($ms -lt 0) {
        Write-Output '{"idleMs":-1,"ok":false}'
    } else {
        Write-Output ('{"idleMs":' + $ms + ',"ok":true}')
    }
} catch {
    Write-Output '{"idleMs":-1,"ok":false}'
}
