---
title: What's new
description: The main changes in each Flash2SVG version since the version 4 rewrite, with links to the full changelog and the releases.
---

# What's new

The full list is in the [changelog](https://github.com/ZcarecroW/Flash2Svg/blob/main/CHANGELOG.md); downloads are on the [releases page](https://github.com/ZcarecroW/Flash2Svg/releases).

## 5.2.2

**A review of the whole project for bugs.** In SMIL, CSS and Lottie a wait between two tweens stays a wait, and a movie clip that ends in `stop()` on a one-frame main timeline plays (it was a still picture of its first frame) — once, as in Flash, also when the timeline around it loops. Sounds in SMIL and CSS files are compressed like the player's (the test document: 1163 → 92 KB). The JS player's *Play once* ends when the last frame jumps back to the first, *Always loop* overrides the timeline's `stop()`, and sounds no longer pile up before the start. Frame scripts take more of what AS3 code is written like; Lottie keeps shape tweens with bitmap fills; GIF frames no longer show through each other. Bitmaps and sounds whose names differ only in non-Latin characters each keep their own file. SMIL and CSS files with clips drawn frame by frame are smaller (a stress document: 151 → 95 KB as SMIL). [Limits](limits.md#known-limits) lists what stays open.

## 5.2

**Colour grading with LUTs.** Give a whole export one look: every colour goes through LUTs from colour grading tools — `.cube` (as Resolve, Premiere, After Effects and Photoshop write them), `.3dl` and Hald CLUT images — each with a strength, in an order you choose. Shapes, gradients, text, filters, colour effects, the stage colour and every pixel of the bitmaps change; GIF, WebP, APNG and video grade each finished picture. [Colour grading](appearance.md#colour-grading). **A wider panel:** make it wider and the sections stand side by side in two or three columns instead of one long list. [The panel](panel.md). **Smaller shape tweens** whose colours don't blend in a straight line (the morph test −23 % as Lottie, −3 % as SMIL). In this guide, the dart of the [motion guide demo](animation.md#motion-guides) now points along its path.

## 5.1

**Classes, XML and every UI component.** The document class and classes in `.as` files run in the JS player, with XML and E4X, the last UI components (TileList, ScrollPane, UIScrollBar and Canvas documents' jQuery UI ones) and `BitmapData.draw()`. [Interactivity](interactivity.md). **Motion as curves:** motion tweens, bones, the camera and Motion Editor curves are smooth curves through Animate's frames instead of a key per frame — up to 63 % smaller. **9-slice** symbols scaled over time, **vector warps** and **brushes** export; MP4 and WebM from the [command line](command-line.md).

## 5.0

**Frame scripts run.** AS3 and HTML5 Canvas frame scripts run in the JS player, checked line by line against Flash Player and Animate's own Canvas output. **Forms:** UI components and input text are real HTML controls. **Video files:** MP4 and WebM from the panel, APNG anywhere. Also sounds in SMIL and CSS, 3D in perspective, the camera's colour effects, armatures, Asset Warp, layer depth and button hit areas. [Formats](formats.md)

## 4.3

**Motion along guides.** A classic tween on a motion guide now moves along the guide's curve itself in SMIL, CSS and Lottie, instead of from one frame's position to the next: smooth at any screen refresh rate, turned along the curve with *Orient to path*, at Animate's own pace, and about half the size (the path demo on [Animation](animation.md#motion-guides): SMIL −56 %, CSS −59 %). **JS player:** with *Play once* and a one-frame main timeline, movie clips no longer move one frame on before they hold.

## 4.2.2

**CSS fixed in Chrome and Edge.** While a CSS export ran, Chrome and Edge drew some objects in the wrong place — an object that moves and scales at once, whose transformation point also shifts (the banner's button on [Animation](animation.md#frame-scripts) sat in the top-left corner). Every CSS export is now also checked running, not only paused. **On scroll** now also works inside boxes with `overflow: hidden`, in an `<object>` and in browsers without scroll-driven animations ([Interactivity](interactivity.md#on-scroll)). In this guide: the scroll demo really follows the scroll, the filters demo shows all seven filters clearly, the banner's button is a clickable link, and a new demo shows [motion guides](animation.md#motion-guides).

## 4.2.1

**GIF and WebP fixed.** Movie clips that keep running — on a one-frame main timeline, or after a `stop()` — now play in GIF and WebP as they do in the SVG formats (the gears demo on [Formats](formats.md) was a still picture). Above 50 frames a second they keep their speed (browsers slowed very short frames down to a tenth of a second). Animated WebP is lossless where that is smaller: flat drawings come out exact and smaller than the GIF. Long full-HD exports need a few pictures of memory instead of all of them (2.1 GB → 0.2 GB).

## 4.2

Smaller, safer, easier.

- **Smaller files** — every path in its shortest form, losslessly: about 30 % less for SMIL and CSS after server compression, 38 % for still frames. [Performance](performance.md)
- **CSS for older browsers** — Safari before 17.2 (e.g. iPhones on iOS 16), Chrome before 113 and Firefox before 112 now run every CSS animation. [Formats](formats.md#css)
- **Help in the panel** — an *i* next to every setting explains it, with a link into this guide; icons throughout; the format buttons work with the arrow keys. [The panel](panel.md)
- **Fixes from a full review** — GIF and WebP of several symbols and frame ranges, output names (relative, folders, other extensions), safer writing, Cancel while encoding, the same file twice in a page with `<flash2svg-player>`, names like `toString` in labels, presets, bitmaps and sounds. Details in the changelog.

## 4.1

The biggest update since the rewrite.

- **Lottie and dotLottie export** — with filters as effects (and the others built from mattes), state machines in `.lottie` files, and a preview in the panel. [Lottie](lottie.md)
- **Interactive output** — Animate's Code Snippets mouse handlers in the JS player, start *when visible* and *on scroll*, buttons as dotLottie state machines. [Interactivity](interactivity.md)
- **Shape tweens as morphs** in SMIL and the JS player: one drawing that changes instead of a drawing per frame. [Animation](animation.md#shape-tweens)
- **Images and sounds your way** — JPEG, WebP, AVIF, PNG or lossless WebP per bitmap, automatic downscaling, MP3, Opus or WAV per sound. [Images and sounds](images-sounds.md)
- **Fonts** for dynamic text, embedded as small WOFF2 subsets; text field borders, filters, links and password fields. [Text and fonts](text.md)
- **Accessibility** from Animate's Accessibility panel. [Accessibility](accessibility.md)
- **GIF and WebP** fallbacks, **all scenes in a row**, **scale modes**, an **Automatic** format, the `<flash2svg-player>` web component, `.svgz`, video components.
- **Smaller and steadier output** — leaner CSS (individual transform properties, `linear()`), loops written once, decimals that follow the size on screen, loops that stay in step for days.
- **Tested much harder** — a fuzzer that mutates the test documents in every way Animate allows and checks every format, browser checks an hour ahead, and many fixes it found. Details in the changelog.

## 4.0

The ground-up rewrite for current Animate versions: exact easing (classic, custom, per property), every tween checked against Animate's frames, motion tweens and guides, HTML5 Canvas documents, frame scripts (`stop()`, `gotoAndPlay()`, pass counters), the camera, buttons, sounds in the JS player, 9-slice scaling, layer effects, all filters and blend modes, a new panel with presets and preview, and the command line compiler. Your document is never modified.
