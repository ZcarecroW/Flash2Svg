---
title: Limits and troubleshooting
description: What Flash2SVG can't reproduce exactly, and answers to common problems — the panel doesn't show, Animate quits on open, the animation doesn't play, fonts, sounds, sizes.
---

# Limits and troubleshooting

## Common problems

### The panel isn't in Window › Extensions

Restart Animate after installing. With the zip install, CEP's debug mode must be on ([Installation](installation.md#install-the-zip-by-hand)); the signed ZXP doesn't need it. Animate 2022 or later is required.

### Animate quits as soon as a document opens

The Flash2SVG panel was saved as open in your workspace and then the extension was removed. Install it again, start Animate, close the panel, quit Animate — then remove it. See [Remove it safely](installation.md#remove-it-safely).

### The animation doesn't move

- In an `<img>`, a **JS player** export shows only its first frame: use `<object>`, inline it or use `<flash2svg-player>` ([Embedding](embedding.md)).
- *Start* is *On click*, *On hover* or *From script*: it waits.
- The visitor's system asks for **reduced motion**: they see the poster on purpose.
- A `stop()` on frame 1 — the export follows your frame scripts. *Loop: Always loop* ignores them.
- Opened from disk as `.svgz`: browsers show `.svgz` only when a server sends it with `Content-Encoding: gzip`.

### Scroll-driven CSS doesn't follow the scroll

It follows the page inline, in an `<object>` or `<iframe>` of the same site and in `<flash2svg-player>` — also inside boxes with `overflow: hidden` and in browsers without scroll-driven animations (a script takes over). Opened by itself, in an `<img>` or in a frame of another site it just plays: scripts can't see the page from there.

### No sound

Only the JS player plays sounds, and browsers allow sound only after the visitor clicked or pressed a key on the page.

### The text uses another font

The font isn't installed on the machine that exported, or its licence forbids embedding — the warnings say which. Install it, or tick *Dynamic text as outlines*.

### The file is big

Read the size overview — [Small and fast](performance.md) goes through each part.

### An export takes long

Most of the time is Animate handing over the drawings (the progress bar says "Exporting artwork through Animate"); compiling takes milliseconds. Many frame-by-frame drawings, stroke styles like *stipple* and big shape tweens take longest. AVIF encoding of large photos takes a second or two each.

## Known limits

- **Frame scripts** are not run: `stop()`, `play()`, `gotoAndPlay()` / `gotoAndStop()` with frame numbers or labels are followed; of conditions only pass counters (`if (n < 3) gotoAndPlay(1); else stop();`). Other conditional actions always run (warned). Mouse handlers from code snippets: see [Interactivity](interactivity.md#code-snippets); keyboard, `ENTER_FRAME` and timer handlers aren't run (warned).
- **Movie clips with loops of very different lengths** (say 7, 11 and 13 frames in a 600-frame scene) can't all come round within one SMIL/CSS loop: SMIL and CSS repeat after the common period they find, so some clips jump when the animation repeats (warned). The JS player is exact.
- **Shape tweens** in CSS output are drawn frame by frame. Animate draws a shape tween's keyframe a little differently from the start of its morph; where they differ by more than a quarter pixel, the keyframe stays a drawing of its own. A shape that splits into several looks different in Animate's preview than in its SVG export; the export follows the SVG export.
- **Strokes:** *Horizontal* and *Vertical* scale options are drawn like *Normal* (warned). Animate never draws a stroke thinner than one pixel; SVG does.
- **Alpha** on a symbol applies to each shape inside, as in Flash; inside such a symbol, alpha on nested symbols applies to them as a whole.
- **Groups** that hold symbol instances are split: the group's drawing first, its instances above it.
- **9-slice:** an animated scale is sliced frame by frame for symbols that only hold drawings; named instances and symbols with nested symbols keep normal scaling then (warned).
- **3D transforms** export as their 2D projection. **IK armatures** and components other than video aren't exported. **Video embedded in the timeline** (FLV) isn't exported.
- **The camera's** colour effects (tint, colour filter) aren't exported.
- **Lottie:** sounds, button states and editable text are left out; *subtract* and *add* are approximated. lottie-web draws an *inner gradient bevel* only faintly (Skottie and dotLottie draw it right). See [Lottie](lottie.md#what-is-not-in-lottie).
- Animate adds the temporary copy each export works on to its *Recent files* list (JSFL can't open a document without that).

## Reporting a problem

[Open an issue](https://github.com/ZcarecroW/Flash2Svg/issues) with what you expected and what you got, the panel's warnings, and — if you can — the FLA or a small one that shows it. With *Keep the scene data* ticked, the `.scene` folder is often all that's needed to reproduce it.
