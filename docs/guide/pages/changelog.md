---
title: What's new
description: The main changes in each Flash2SVG version since the version 4 rewrite, with links to the full changelog and the releases.
---

# What's new

The full list is in the [changelog](https://github.com/ZcarecroW/Flash2Svg/blob/main/CHANGELOG.md); downloads are on the [releases page](https://github.com/ZcarecroW/Flash2Svg/releases).

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
