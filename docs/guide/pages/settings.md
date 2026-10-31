---
title: Settings reference
description: Every Flash2SVG setting in one table — where it is in the panel, its command line option, its default, and which formats it affects.
---

# Settings reference

| Setting (panel) | Command line | Default | Formats |
|---|---|---|---|
| **Output** | | | |
| Format | `--format` | SMIL | – |
| File | `-o` | next to the FLA | all |
| Source | – (the scene data says) | Current timeline | all |
| Frames | `--frames a-b` | All | all |
| **Animation** | | | |
| Smooth tweens | `--steps` turns it off | on | animated |
| Loop | `--loop auto\|always\|never` | Follow timeline | animated |
| Start | `--begin` | Automatically | SVG, .lottie |
| Scroll range | `--scroll-range` | While fully visible | SVG with *On scroll* |
| Delay | `--delay` | 0 | SVG |
| Poster | `--poster first\|last` | First frame | SVG, .lottie |
| Still poster for "reduce motion" | `--ignore-reduced-motion` turns it off | on | SVG |
| **Graphics & text** | | | |
| Include stage colour | `--background` | off | all |
| Embed images and sounds | `--link-images` turns it off | on | SVG, Lottie |
| Dynamic text as outlines | `--text-outlines` | off | SVG |
| Embed fonts | `--no-embed-fonts` turns it off | on | SVG |
| Include hidden layers | `--no-hidden-layers` turns it off | on | all |
| Include guide layers | `--guides` | off | all |
| **Images** | | | |
| Lossy format | `--image-lossy jpeg\|webp\|avif` | JPEG | all with bitmaps |
| Lossless format | `--image-lossless png\|webp` | PNG | all with bitmaps |
| Quality | `--image-quality` | 0 (each bitmap's own) | lossy bitmaps |
| Resolution | `--image-resolution` | 2× | all with bitmaps |
| Per bitmap: Lossy / Lossless | `--image-mode name=lossy` | Animate's setting | |
| Per bitmap: Full | `--image-full name` | off | |
| **Sounds** | | | |
| Compressed format | `--sound-format mp3\|opus` | MP3 | JS player |
| Bit rate | `--sound-bitrate` | 0 (each sound's own) | JS player |
| Per sound: Compressed / WAV | `--sound-mode name=lossless` | Animate's setting | |
| **Advanced** | | | |
| Size | `--scale fixed\|fit\|fill\|stretch` | Stage size | SVG |
| Decimals | `--digits` | 2 | SVG, Lottie |
| Indent output | `--pretty` | off | SVG, Lottie |
| Compressed .svgz | `--svgz` | off | SVG |
| Shape tweens as morphs | `--no-morph` turns it off | on | SMIL, JS player |
| Ids | `--id-prefix` | a short hash per export | SVG |
| Remember settings in the FLA | – | off | |
| Open in browser after export | – | off | |
| Keep the scene data | – (it *is* the command line's input) | off | |

## Presets

| Preset | Sets |
|---|---|
| Web animation (SMIL) | SMIL, smooth, follow timeline, embed images |
| CSS animation | CSS, smooth, follow timeline, embed images |
| Interactive (JS player) | JS player, smooth, follow timeline, embed images |
| Still frames | Frames, stage colour |
| Smallest file | SMIL, 1 decimal, images linked, resolution 1× |
| Inkscape / Illustrator (static) | Frames, text as outlines, images embedded, 3 decimals |

Your own presets are saved per user; *Remember settings in the FLA* stores the settings in the document for everyone who opens it.
