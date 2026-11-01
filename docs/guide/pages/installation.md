---
title: Installation
description: Install the Flash2SVG panel in Adobe Animate 2022 or later (signed ZXP or zip), open it, update it and remove it safely; install the command line compiler.
---

# Installation

Flash2SVG is a panel (a CEP extension) for **Adobe Animate 2022 or later** on Windows and macOS. It is tested with Animate 2024 (24.0.x) on Windows. Animate 2024 is the current version: Adobe keeps it in maintenance, with security and bug fixes.

Download the latest release from the [releases page](https://github.com/ZcarecroW/Flash2Svg/releases). It has three files:

| File | What it is |
|---|---|
| `Flash2SVG-<version>.zxp` | The panel, signed. Install it with an extension manager (below). |
| `Flash2SVG-<version>.zip` | The same panel unpacked, for a manual install. |
| `flash2svg-cli.zip` | The [command line compiler](command-line.md), for re-exporting without Animate. |

## Install the signed ZXP

Pick one of these tools:

- **Anastasiy's Extension Manager** ([install.anastasiy.com](https://install.anastasiy.com/)), free for Windows and macOS: open it, choose *Animate*, click *Install* and pick the `.zxp`.
- **Adobe's own installer** (Unified Plugin Installer Agent), which comes with the Creative Cloud app. On Windows, in a terminal:

```powershell
& "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "$HOME\Downloads\Flash2SVG-4.3.0.zxp"
```

  On macOS:

```bash
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install ~/Downloads/Flash2SVG-4.3.0.zxp
```

- **ZXPInstaller**, an open-source alternative.

Then **restart Animate** and open the panel: **Window › Extensions › Flash2SVG (SVG Animation)**. It opens as a floating window; drag its tab into any dock, and Animate remembers the place.

![Adobe Animate 2024 with the hero demo open: the stage with a blue circle, the tools on the left, the library on the right.](images/animate.webp "Animate 2024 with the hero demo, the document most screenshots in this guide come from.")

## Install the zip by hand

Unzip the archive into Adobe's extension folder, as a folder called `org.flash2svg`:

| System | Folder |
|---|---|
| Windows | `%APPDATA%\Adobe\CEP\extensions\org.flash2svg` |
| macOS | `~/Library/Application Support/Adobe/CEP/extensions/org.flash2svg` |

A panel installed this way is not signed, so Animate loads it only when CEP's debug mode is on — once per machine:

```powershell
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

On macOS: `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`. Animate 2022 and 2023 use `CSXS.11` instead of `CSXS.12`.

> [!TIP]
> Prefer the signed ZXP: debug mode lets Animate load *any* unsigned extension, not only this one.

## Update

Install the new ZXP over the old one (the extension manager replaces it) and restart Animate. Your settings stay: they are kept per user, and optionally inside each FLA ([*Remember settings in the FLA*](panel.md#advanced)).

## Remove it safely

**Close the Flash2SVG panel and quit Animate before you remove the extension.**

> [!WARNING]
> Animate 2024 remembers which panels were open in its workspace. If the extension of a remembered panel is gone, Animate quits as soon as a document window opens. If that happened to you: install the extension again, start Animate, close the panel, quit Animate, and only then remove it.

## The command line compiler

The panel's compiler also runs in Node.js (version 24 or later) on any system: it re-exports a scene the panel extracted, with other settings, without Animate. Unpack `flash2svg-cli.zip` anywhere and run `node flash2svg.js --help`. See [Command line](command-line.md).
