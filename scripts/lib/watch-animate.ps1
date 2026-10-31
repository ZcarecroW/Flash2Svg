# Watches a running Animate process for the test scripts (see animate.mjs) and prints one JSON
# line every 2 s: CPU seconds used, dialog windows (title and texts), crash reporters started
# since the watch began. A dialog that stays open is closed with WM_CLOSE (like Esc / Cancel,
# never OK); one that survives that is reported as "stuck". Windows shown while Animate works
# (progress) are left alone. Adobe's dialogs don't expose their
# message (neither as window text nor through UI Automation): a picture of each one is saved.
param([int]$AnimatePid)
$ErrorActionPreference = "SilentlyContinue"
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class F2sWin {
	delegate bool EnumProc(IntPtr h, IntPtr l);
	[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
	[DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
	[DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
	// does not send WM_GETTEXT, so it never blocks on a busy or hung window
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int InternalGetWindowText(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
	// the window's own pixels (never what lies behind or above it on the screen)
	[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
	static string Text(IntPtr h) { var s = new StringBuilder(2048); InternalGetWindowText(h, s, 2048); return s.ToString(); }
	static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
	/** Visible top-level windows of the process that are dialogs: the standard dialog class, or owned windows while the main window is disabled (modal). */
	public static List<object[]> Dialogs(uint pid, IntPtr main) {
		var list = new List<object[]>();
		// before the main window exists only the splash screen shows
		if (main == IntPtr.Zero) return list;
		bool modal = !IsWindowEnabled(main);
		EnumWindows((h, l) => {
			uint p; GetWindowThreadProcessId(h, out p);
			// the splash screen (shown on for a moment after the main window) has no title; some
			// of Animate's error dialogs ("An error occurred opening file") have none either, but
			// they disable the main window
			if (p != pid || h == main || !IsWindowVisible(h) || (Text(h).Length == 0 && !modal)) return true;
			string cls = Cls(h);
			if (cls != "#32770" && !(modal && GetWindow(h, 4) != IntPtr.Zero && IsWindowEnabled(h))) return true;
			var texts = new List<string>();
			EnumChildWindows(h, (c, l2) => { if (IsWindowVisible(c)) { string t = Text(c); if (t.Length > 0) texts.Add(t); } return true; }, IntPtr.Zero);
			list.Add(new object[] { h.ToInt64(), Text(h), string.Join(" | ", texts) });
			return true;
		}, IntPtr.Zero);
		return list;
	}
}
"@
$started = Get-Date
$seen = @{}
$texts = @{}
$p = Get-Process -Id $AnimatePid
$lastCpu = -1.0
while ($p -and -not $p.HasExited) {
	$p.Refresh()
	$cpu = $p.TotalProcessorTime.TotalSeconds
	# a dialog that waits for the user leaves Animate idle; progress windows ("Exporting Image
	# Sequence") show while it works: only windows of an idle Animate count as dialogs
	# (measured: about 2 s of CPU per 2 s while exporting, under 0.2 s with a dialog open)
	$idle = $lastCpu -ge 0 -and ($cpu - $lastCpu) -lt 0.5
	$lastCpu = $cpu
	$dialogs = @()
	foreach ($d in [F2sWin]::Dialogs([uint32]$AnimatePid, $p.MainWindowHandle)) {
		if (-not $idle) { continue }
		$h = [long]$d[0]
		$seen[$h] = 1 + [int]$seen[$h]
		$state = "open"
		if ($seen[$h] -eq 2) { [void][F2sWin]::PostMessage([IntPtr]$h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero); $state = "closed" }
		elseif ($seen[$h] -ge 5) { $state = "stuck" }
		$text = $d[2]
		if ($seen[$h] -eq 1) {
			try {
				Add-Type -AssemblyName System.Drawing
				$r = New-Object F2sWin+RECT
				[void][F2sWin]::GetWindowRect([IntPtr]$h, [ref]$r)
				$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
				if ($w -gt 0 -and $hh -gt 0) {
					$dir = Join-Path $env:TEMP "flash2svg-dialogs"
					[void](New-Item -ItemType Directory -Force $dir)
					$file = Join-Path $dir ("dialog-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + $h + ".png")
					$bmp = New-Object System.Drawing.Bitmap $w, $hh
					$g = [System.Drawing.Graphics]::FromImage($bmp)
					$hdc = $g.GetHdc()
					$ok = [F2sWin]::PrintWindow([IntPtr]$h, $hdc, 2)
					$g.ReleaseHdc($hdc)
					if ($ok) { $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png) } else { $file = "" }
					$g.Dispose(); $bmp.Dispose()
					if ($file) { $text = ($text, "picture: $file" | Where-Object { $_ }) -join " | " }
				}
			} catch {}
			$texts[$h] = $text
		}
		$dialogs += @{ title = $d[1]; text = $texts[$h]; state = $state }
	}
	$crash = @(Get-Process | Where-Object { $_.ProcessName -match "crash|WerFault" -and $_.StartTime -gt $started } | ForEach-Object { $_.ProcessName })
	@{ cpu = $cpu; dialogs = $dialogs; crash = $crash } | ConvertTo-Json -Compress -Depth 4
	Start-Sleep -Seconds 2
}
