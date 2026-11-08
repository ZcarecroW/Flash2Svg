# Drives Animate's window for documents that only its tools can make (armatures, Asset Warp):
# finds the stage, and sends the mouse and keyboard to it. Used by scripts/animate-session.mjs.
#   -Do stage -Marker RRGGBB   the stage's box on the screen: the largest area of that colour
#   -Do mouse -Path "x,y x,y"  press at the first point, move along the others, release (screen px)
#   -Do click -Path "x,y"      one click
#   -Do key -Keys w            keys (SendKeys syntax) to Animate
#   -Do dialogs                open dialogs (text by OCR), as JSON
#   -Do shot                   a picture of the main window
#   -Do find -Keys "text"      where words are in the main window (OCR): their lines' boxes on the screen, as JSON
# Real input: the mouse really moves for a moment, Animate comes to the front.
param([int]$AnimatePid, [string]$Do, [string]$Marker = "FF00FF", [string]$Path = "", [string]$Keys = "", [switch]$Post)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class F2sUi {
	public delegate bool EnumProc(IntPtr h, IntPtr l);
	[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int InternalGetWindowText(IntPtr h, StringBuilder s, int n);
	[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
	[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
	[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
	[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
	[DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
	[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
	[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
	[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
	public static List<IntPtr> Windows(uint pid) {
		var list = new List<IntPtr>();
		EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
		return list;
	}
	/** The box of the widest run of a colour (a marked stage), not of every speck of it in the window. */
	public static int[] Box(System.Drawing.Bitmap b, int r, int g, int bl) {
		int w = b.Width, h = b.Height;
		var d = b.LockBits(new System.Drawing.Rectangle(0, 0, w, h), System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
		var row = new byte[w * 4];
		Func<int, int, bool> marked = (x, y) => Math.Abs(row[x * 4 + 2] - r) < 8 && Math.Abs(row[x * 4 + 1] - g) < 8 && Math.Abs(row[x * 4] - bl) < 8;
		int best = 0, bx = 0, by = 0;
		for (int y = 0; y < h; y++) {
			Marshal.Copy(IntPtr.Add(d.Scan0, y * d.Stride), row, 0, w * 4);
			int run = 0;
			for (int x = 0; x < w; x++) {
				run = marked(x, y) ? run + 1 : 0;
				if (run > best) { best = run; bx = x - run + 1; by = y; }
			}
		}
		int y0 = by, y1 = by;
		for (int y = by; y >= 0; y--) { Marshal.Copy(IntPtr.Add(d.Scan0, y * d.Stride), row, 0, w * 4); if (!marked(bx + 1, y)) break; y0 = y; }
		for (int y = by; y < h; y++) { Marshal.Copy(IntPtr.Add(d.Scan0, y * d.Stride), row, 0, w * 4); if (!marked(bx + 1, y)) break; y1 = y; }
		b.UnlockBits(d);
		return new[] { bx, y0, bx + best - 1, y1 };
	}
}
"@
[void][F2sUi]::SetProcessDPIAware()
$p = Get-Process -Id $AnimatePid
$main = $p.MainWindowHandle

function Save-Window([IntPtr]$h, [string]$kind) {
	$r = New-Object F2sUi+RECT
	[void][F2sUi]::GetWindowRect($h, [ref]$r)
	$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
	$dir = Join-Path $env:TEMP "flash2svg-dialogs"
	[void](New-Item -ItemType Directory -Force $dir)
	$file = Join-Path $dir ($kind + "-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + $h.ToInt64() + ".png")
	$bmp = New-Object System.Drawing.Bitmap $w, $hh
	$g = [System.Drawing.Graphics]::FromImage($bmp)
	$hdc = $g.GetHdc()
	[void][F2sUi]::PrintWindow($h, $hdc, 2)
	$g.ReleaseHdc($hdc)
	$g.Dispose()
	return @{ bitmap = $bmp; file = $file; left = $r.Left; top = $r.Top }
}

function Read-Picture([string]$file) {
	try {
		Add-Type -AssemblyName System.Runtime.WindowsRuntime
		[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
		[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
		[void][Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
		$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
		function Wait-Op($op, [type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(5000); $task.Result }
		$sf = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
		$stream = Wait-Op ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
		$decoder = Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
		$bitmap = Wait-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
		$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
		$result = Wait-Op ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
		$stream.Dispose()
		return $result.Text
	} catch { return "" }
}

# The lines of text OCR finds in a picture, with their boxes (picture pixels)
function Read-Lines([string]$file) {
	try {
		Add-Type -AssemblyName System.Runtime.WindowsRuntime
		[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
		[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
		[void][Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
		$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
		function Wait-Op($op, [type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(5000); $task.Result }
		$sf = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
		$stream = Wait-Op ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
		$decoder = Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
		$bitmap = Wait-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
		$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
		$result = Wait-Op ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
		$stream.Dispose()
		$lines = @()
		foreach ($l in $result.Lines) {
			$x0 = 1e9; $y0 = 1e9; $x1 = -1; $y1 = -1
			foreach ($w in $l.Words) {
				$r = $w.BoundingRect
				$x0 = [Math]::Min($x0, $r.X); $y0 = [Math]::Min($y0, $r.Y); $x1 = [Math]::Max($x1, $r.X + $r.Width); $y1 = [Math]::Max($y1, $r.Y + $r.Height)
			}
			$lines += @{ text = $l.Text; left = [int]$x0; top = [int]$y0; right = [int]$x1; bottom = [int]$y1 }
		}
		return $lines
	} catch { return @() }
}

function Points() { return $Path.Trim() -split "\s+" | ForEach-Object { $a = $_ -split ","; , @([int]$a[0], [int]$a[1]) } }
function Front() { [void][F2sUi]::ShowWindow($main, 9); [void][F2sUi]::SetForegroundWindow($main); Start-Sleep -Milliseconds 250 }

function Mouse-Post($pts) {
	# messages to the window under the first point: nothing else on the computer notices
	$first = New-Object F2sUi+POINT; $first.X = $pts[0][0]; $first.Y = $pts[0][1]
	$hw = [F2sUi]::WindowFromPoint($first)
	$send = {
		param($msg, $wp, $x, $y)
		$c = New-Object F2sUi+POINT; $c.X = $x; $c.Y = $y
		[void][F2sUi]::ScreenToClient($hw, [ref]$c)
		$lp = [IntPtr](($c.Y -shl 16) -bor ($c.X -band 0xFFFF))
		[void][F2sUi]::PostMessage($hw, $msg, [IntPtr]$wp, $lp)
	}
	& $send 0x200 0 $pts[0][0] $pts[0][1]
	Start-Sleep -Milliseconds 60
	& $send 0x201 1 $pts[0][0] $pts[0][1]
	Start-Sleep -Milliseconds 120
	foreach ($q in $pts) { & $send 0x200 1 $q[0] $q[1]; Start-Sleep -Milliseconds 90 }
	$l = $pts[$pts.Count - 1]
	& $send 0x202 0 $l[0] $l[1]
	Start-Sleep -Milliseconds 200
}

function Mouse-Real($pts) {
	Front
	$saved = New-Object F2sUi+POINT
	[void][F2sUi]::GetCursorPos([ref]$saved)
	[void][F2sUi]::SetCursorPos($pts[0][0], $pts[0][1])
	Start-Sleep -Milliseconds 120
	[F2sUi]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
	Start-Sleep -Milliseconds 150
	foreach ($q in $pts) { [void][F2sUi]::SetCursorPos($q[0], $q[1]); Start-Sleep -Milliseconds 110 }
	[F2sUi]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
	Start-Sleep -Milliseconds 250
	[void][F2sUi]::SetCursorPos($saved.X, $saved.Y)
}

switch ($Do) {
	"stage" {
		$s = Save-Window $main "main"
		$r = [Convert]::ToInt32($Marker.Substring(0, 2), 16); $g = [Convert]::ToInt32($Marker.Substring(2, 2), 16); $b = [Convert]::ToInt32($Marker.Substring(4, 2), 16)
		$box = [F2sUi]::Box($s.bitmap, $r, $g, $b)
		$s.bitmap.Save($s.file, [System.Drawing.Imaging.ImageFormat]::Png)
		$s.bitmap.Dispose()
		@{ left = $s.left + $box[0]; top = $s.top + $box[1]; right = $s.left + $box[2]; bottom = $s.top + $box[3]; picture = $s.file } | ConvertTo-Json -Compress
	}
	"mouse" { $pts = @(Points); if ($Post) { Mouse-Post $pts } else { Mouse-Real $pts } }
	"click" { $pts = @(Points); if ($Post) { Mouse-Post $pts } else { Mouse-Real $pts } }
	"key" {
		if ($Post) {
			# a tool's shortcut, as messages to the window under the point (-Path)
			$q = @(Points)[0]
			$pt = New-Object F2sUi+POINT; $pt.X = $q[0]; $pt.Y = $q[1]
			$hw = [F2sUi]::WindowFromPoint($pt)
			foreach ($ch in $Keys.ToCharArray()) {
				$vk = [int][char]::ToUpper($ch)
				[void][F2sUi]::PostMessage($hw, 0x100, [IntPtr]$vk, [IntPtr]1)
				[void][F2sUi]::PostMessage($hw, 0x102, [IntPtr][int]$ch, [IntPtr]1)
				[void][F2sUi]::PostMessage($hw, 0x101, [IntPtr]$vk, [IntPtr]0xC0000001L)
				Start-Sleep -Milliseconds 150
			}
		} else { Front; [System.Windows.Forms.SendKeys]::SendWait($Keys); Start-Sleep -Milliseconds 300 }
	}
	"dialogs" {
		$out = @()
		foreach ($h in [F2sUi]::Windows([uint32]$AnimatePid)) {
			if ($h -eq $main) { continue }
			$s = Save-Window $h "dialog"
			$s.bitmap.Save($s.file, [System.Drawing.Imaging.ImageFormat]::Png)
			$s.bitmap.Dispose()
			$t = New-Object System.Text.StringBuilder 512
			[void][F2sUi]::InternalGetWindowText($h, $t, 512)
			$out += @{ title = $t.ToString(); text = (Read-Picture $s.file); picture = $s.file; handle = $h.ToInt64() }
		}
		ConvertTo-Json -Compress -Depth 3 @($out)
	}
	"find" {
		$s = Save-Window $main "main"
		$s.bitmap.Save($s.file, [System.Drawing.Imaging.ImageFormat]::Png)
		$s.bitmap.Dispose()
		$hits = @()
		foreach ($l in (Read-Lines $s.file)) {
			if ($Keys -and $l.text -notlike "*$Keys*") { continue }
			$hits += @{ text = $l.text; left = $s.left + $l.left; top = $s.top + $l.top; right = $s.left + $l.right; bottom = $s.top + $l.bottom }
		}
		ConvertTo-Json -Compress -Depth 3 @($hits)
	}
	"shot" {
		$s = Save-Window $main "main"
		$s.bitmap.Save($s.file, [System.Drawing.Imaging.ImageFormat]::Png)
		$s.bitmap.Dispose()
		$s.file
	}
}
