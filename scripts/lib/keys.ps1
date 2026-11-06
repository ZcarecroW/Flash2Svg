# Types into a Flash Player window: the keys are posted to that window, so they can't go anywhere else.
# Usage: keys.ps1 <player.exe> <file.swf> <steps file>; each line of the steps file is a key name
# (F2, Enter, Back, Shift+A), or text to type after "t ", or "click x y" for a mouse click in the window.
param([string]$Player, [string]$Swf, [string]$Steps, [int]$Wait = 1500, [int]$Gap = 60)
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Win {
	public delegate bool Each(IntPtr h, IntPtr l);
	[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
	[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, Each f, IntPtr l);
	[DllImport("user32.dll")] public static extern bool EnumWindows(Each f, IntPtr l);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll")] public static extern short VkKeyScan(char c);
	[DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint t);
	public static List<IntPtr> Of(uint pid) {
		var o = new List<IntPtr>();
		EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) o.Add(h); return true; }, IntPtr.Zero);
		return o;
	}
	public static List<IntPtr> Kids(IntPtr h) {
		var o = new List<IntPtr>();
		EnumChildWindows(h, (k, l) => { o.Add(k); return true; }, IntPtr.Zero);
		return o;
	}
	public static string Name(IntPtr h) { var s = new StringBuilder(128); GetClassName(h, s, 128); return s.ToString(); }
}
"@
$p = [System.Diagnostics.Process]::Start($Player, "`"$Swf`"")
try {
	$h = [IntPtr]::Zero
	for ($i = 0; $i -lt 100 -and $h -eq [IntPtr]::Zero; $i++) {
		Start-Sleep -Milliseconds 100
		foreach ($w in [Win]::Of($p.Id)) { if ([Win]::Name($w) -like "ShockwaveFlash*") { $h = $w } }
	}
	if ($h -eq [IntPtr]::Zero) { throw "no player window" }
	Start-Sleep -Milliseconds $Wait
	$target = $h
	Write-Output ("window " + [Win]::Name($h))
	$kids = [Win]::Kids($h)
	foreach ($k in $kids) { Write-Output ("child " + [Win]::Name($k)) }
	if ($kids.Count) { $target = $kids[0] }
	# the player takes keys when it thinks it has the keyboard
	[void][Win]::PostMessage($h, 0x06, [IntPtr]1, [IntPtr]0)
	[void][Win]::PostMessage($h, 0x07, [IntPtr]0, [IntPtr]0)
	Start-Sleep -Milliseconds 200
	$WM_KEYDOWN = 0x100; $WM_KEYUP = 0x101; $WM_CHAR = 0x102; $WM_MOVE = 0x200; $WM_DOWN = 0x201; $WM_UP = 0x202
	function Lparam([int]$vk, [int]$up) {
		$scan = [Win]::MapVirtualKey($vk, 0)
		$v = 1 -bor ($scan -shl 16)
		if ($up) { $v = $v -bor 0xC0000000L }
		return [IntPtr][long]$v
	}
	function Key([int]$vk) {
		# (the player's message loop turns the key into its character)
		[void][Win]::PostMessage($target, $WM_KEYDOWN, [IntPtr]$vk, (Lparam $vk 0))
		Start-Sleep -Milliseconds 30
		[void][Win]::PostMessage($target, $WM_KEYUP, [IntPtr]$vk, (Lparam $vk 1))
		Start-Sleep -Milliseconds $Gap
	}
	$named = @{ F2 = 0x71; F3 = 0x72; Enter = 0x0D; Back = 0x08; Tab = 0x09; Left = 0x25; Right = 0x27; Up = 0x26; Down = 0x28; Home = 0x24; End = 0x23; Delete = 0x2E; Space = 0x20 }
	foreach ($line in (Get-Content $Steps)) {
		# (a step for one side: what the same thing takes there)
		if (-not $line -or $line.StartsWith("p ")) { continue }
		if ($line.StartsWith("f ")) { $line = $line.Substring(2) }
		if ($line.StartsWith("t ")) {
			foreach ($c in $line.Substring(2).ToCharArray()) {
				$vk = [Win]::VkKeyScan($c) -band 0xFF
				Key $vk
			}
		} elseif ($line.StartsWith("click ")) {
			$xy = $line.Split(" ")
			$l = [IntPtr](([int]$xy[2] -shl 16) -bor [int]$xy[1])
			[void][Win]::PostMessage($target, $WM_MOVE, [IntPtr]0, $l)
			Start-Sleep -Milliseconds $Gap
			[void][Win]::PostMessage($target, $WM_DOWN, [IntPtr]1, $l)
			Start-Sleep -Milliseconds $Gap
			[void][Win]::PostMessage($target, $WM_UP, [IntPtr]0, $l)
			Start-Sleep -Milliseconds $Gap
		} elseif ($line.StartsWith("drag ")) {
			$xy = $line.Split(" ")
			$from = [IntPtr](([int]$xy[2] -shl 16) -bor [int]$xy[1])
			[void][Win]::PostMessage($target, $WM_MOVE, [IntPtr]0, $from)
			Start-Sleep -Milliseconds $Gap
			[void][Win]::PostMessage($target, $WM_DOWN, [IntPtr]1, $from)
			Start-Sleep -Milliseconds $Gap
			for ($i = 1; $i -le 4; $i++) {
				$x = [int]$xy[1] + ([int]$xy[3] - [int]$xy[1]) * $i / 4
				$y = [int]$xy[2] + ([int]$xy[4] - [int]$xy[2]) * $i / 4
				[void][Win]::PostMessage($target, $WM_MOVE, [IntPtr]1, [IntPtr]((([int]$y) -shl 16) -bor ([int]$x)))
				Start-Sleep -Milliseconds $Gap
			}
			[void][Win]::PostMessage($target, $WM_UP, [IntPtr]0, [IntPtr]((([int]$xy[4]) -shl 16) -bor [int]$xy[3]))
			Start-Sleep -Milliseconds $Gap
		} else {
			Key $named[$line]
		}
	}
	Start-Sleep -Milliseconds 800
	# (closed, not killed: the log is written on the way out)
	[void][Win]::PostMessage($h, 0x10, [IntPtr]0, [IntPtr]0)
	[void]$p.WaitForExit(3000)
} finally {
	if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
}
