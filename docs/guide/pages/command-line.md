---
title: Command line
description: Re-export a scene with other settings without Animate — the flash2svg command line compiler, its options, and how to get the scene data from the panel.
---

# Command line

The panel's compiler also runs in **Node.js 24 or later**, on any system. It turns the scene data the panel reads from Animate into SVG, Lottie, GIF or WebP — so you can export the same scene again with other settings, in a build script, or on a machine without Animate.

## Get the scene data

1. In the panel, tick **Advanced › Keep the scene data (for the command line)**.
2. Export once. Next to the output you'll find a folder `<name>.scene/` with `scene.json`, the drawings Animate exported (`atlas/`) and the document's bitmaps and sounds.

Copy that folder anywhere; it is everything the compiler needs.

## Run it

Unpack `flash2svg-cli.zip` from the [releases](https://github.com/ZcarecroW/Flash2Svg/releases) and run:

```bash
node flash2svg.js hero.scene/scene.json                      # SMIL → hero.svg next to the folder
node flash2svg.js hero.scene/scene.json -o out/hero.svg --format css --loop always
node flash2svg.js hero.scene/scene.json --format player --sound-format opus
node flash2svg.js hero.scene/scene.json --format lottie        # → hero.json
node flash2svg.js hero.scene/scene.json --format dotlottie -o hero.lottie --begin click --poster last
node flash2svg.js hero.scene/scene.json --format webp --background
node flash2svg.js hero.scene/scene.json --format static --frames 1-12 --svgz
node flash2svg.js hero.scene/scene.json --image-lossy avif --image-lossless webp --image-mode "logo.png=lossless"
```

After the export it prints what the size is made of:

```text
1 file(s), 23.4 KB, 3.00s -> C:\work\hero.svg
  drawing 8.1 KB, animation 14.9 KB, fonts 0.4 KB
```

Wrong options get a message, not a stack trace, and the exit code is 1 — handy in scripts.

## Options

`--name=value` works as well as `--name value`.

| Option | |
|---|---|
| `-o`, `--out <file>` | output file, or a folder (existing, or ending in `/`) to write the default name into (default: `<document>.svg`, `.json` or `.lottie` next to the scene folder). A scene of several library symbols gives one file each, `<name>_<symbol>`. |
| `--format <f>` | `smil` (default), `css`, `player`, `static`, `lottie`, `dotlottie`, `auto`, `gif`, `webp` |
| `--frames <a-b>` | frame range, 1-based, inclusive (`1-24`, or one frame: `5`) |
| `--loop <m>` | `auto` (follow `stop()` scripts), `always`, `never` |
| `--begin <m>` | `auto`, `click`, `hover`, `manual` (from script), `visible`, `scroll` |
| `--scroll-range <r>` | with `--begin scroll`: `visible` (default), `crossing`, `page` |
| `--delay <s>` | start delay in seconds |
| `--steps` | no interpolation between frames (one step per frame, like the SWF) |
| `--scale <m>` | `fixed` (default), `fit` (show all), `fill` (no border), `stretch` (exact fit) |
| `--background` | include the stage colour |
| `--link-images` | write images and sounds as files next to the output instead of embedding |
| `--image-lossy <f>` | bitmaps set to *Photo* in Animate: `jpeg` (default), `webp`, `avif` |
| `--image-lossless <f>` | bitmaps kept exactly: `png` (default), `webp` |
| `--image-quality <q>` | quality of lossy bitmaps, 1–100 (default: each bitmap's own from Animate) |
| `--image-mode <name=m>` | per bitmap (library name): `lossy` or `lossless`; repeatable |
| `--image-resolution <x>` | write bitmaps shown smaller down to x times their largest size on stage (default 2; 0 = every pixel) |
| `--image-full <name>` | keep every pixel of this bitmap; repeatable |
| `--sound-format <f>` | compressed sounds (JS player): `mp3` (default), `opus` |
| `--sound-bitrate <kbps>` | on MP3's scale (Opus uses half); default: each sound's own |
| `--sound-mode <name=m>` | per sound: `lossy` or `lossless` (WAV); repeatable |
| `--text-outlines` | draw dynamic text as outlines |
| `--no-embed-fonts` | leave fonts to the viewer |
| `--no-hidden-layers` | skip hidden layers |
| `--guides` | include guide layers |
| `--poster <first\|last>` | the still frame for reduced motion and places without animation |
| `--ignore-reduced-motion` | animate also when the system asks for reduced motion |
| `--no-morph` | shape tweens frame by frame |
| `--digits <n>` | decimals on screen, 0–6 (default 2) |
| `--id-prefix <p>` | start of every id (default: a short hash) |
| `--pretty` | indented output |
| `--svgz` | gzip-compressed SVG |
| `-h`, `--help` | the list above |

The compiler loads its WebAssembly codecs (images, sounds, fonts, the GIF/WebP renderer) from the `wasm` folder next to `flash2svg.js`, only when a scene needs them. Fonts for dynamic text are looked up in the system's font folders.
