---
title: Filters, blends and colour
description: How Animate's filters, blend modes, colour effects, gradients, bitmap fills and strokes come out in SVG and Lottie, and where they differ.
---

# Filters, blends and colour

## Filters

All of Animate's filters export, also tweened: **blur**, **drop shadow**, **glow**, **bevel**, **gradient glow**, **gradient bevel** and **adjust colour** — with *inner*, *knockout* and *hide object*, any quality, any strength. They are checked against Animate's own rendering and match within a fraction of a percent of the pixels.

::: demo filters smil,css,player,lottie All seven of Animate's filters, each tweened from a light setting up to a strong one and back.

Two things work as in Animate, which can surprise:

- Filters follow the **stage's orientation**: the shadow of a rotated symbol doesn't turn with it, and blur sizes don't scale with it. Inside a rotated parent symbol they turn with the parent.
- A **low-quality blur** (one pass) is a box in Animate, with straight edge ramps; SVG and Lottie blur with a Gaussian of the same spread, so strong one-pass gradient glows look a little softer.

In Lottie, blur, drop shadow and glow become effects; the others are built from mattes and blend modes — see [Lottie](lottie.md#what-carries-over).

A tweened filter changes with the frames, as in Animate. The **JS player** writes it as one filter whose numbers it sets frame by frame (the filters demo: 61 KB instead of 297 KB). SMIL and CSS switch between a filter per frame: CSS can't change a filter's numbers, and while SMIL changes them, Chrome and Edge draw the filter again at every refresh of the screen — about three times the drawing work in the demo. The filters per frame are much alike and compress well: the demo's SMIL is 284 KB, 19 KB with gzip.

## Blend modes

*Normal*, *layer*, *multiply*, *screen*, *overlay*, *hard light*, *lighten*, *darken*, *difference*, *add*, *subtract*, *invert*, *alpha* and *erase*.

::: demo blend smil,css,lottie Three circles with *screen*: where they overlap, red, green and blue add up to white.

*Alpha* and *erase* act inside a symbol placed with the *layer* blend, as in Animate: they cut into what lies below them in that symbol. In Lottie, *subtract* and *add* are approximated (warned).

## 3D

Movie clips turned or moved with Animate's 3D tools keep their perspective, with the document's view angle and vanishing point.

::: demo depth css,player A movie clip turned with the 3D rotation tool, frame by frame. SVG itself is flat: the turn is CSS 3D on the clip, so Chromium browsers and Firefox show it, elsewhere it comes out as close as flat can be.

## Colour effects

*Brightness*, *tint*, *alpha* and *advanced* colour effects, tweened or not. The camera's *tint* and *Adjust Color* work in every format.

> [!NOTE]
> Alpha on a symbol applies to **each shape inside**, as in Flash: where shapes overlap — the inner half of a stroke over its fill — they show through each other. Flash2SVG does the same. Inside such a symbol, alpha on nested symbols applies to them as a whole (SVG can't multiply inherited alpha per shape).

## Colour grading

A **LUT** (lookup table) gives the whole export one look: every colour goes through it on the way out. Colour grading tools write them — DaVinci Resolve, Premiere and After Effects, Photoshop (*File › Export › Color Lookup Tables*), film emulation packs. Flash2SVG reads `.cube` files (1D, 3D, or both, as Resolve writes them), `.3dl` files and **Hald CLUT** images (`.png`).

In the panel, *Colour grading* lists the LUTs: **Add LUT…** picks files, the slider sets each one's **strength** (100 %: all of it, 50 %: halfway between the colour and the LUT's), the checkbox turns one off, the arrows change the order — they apply from top to bottom. A strip shows sample colours before and after. On the command line: `--lut look.cube`, or `--lut look.cube=60` for 60 %; repeat it for several.

What changes:

- **Drawings:** every fill and stroke. **Gradients** get the colour the LUT gives at every point, not only at their stops: where the LUT bends the colours between two stops, stops are added (within one level of 255) — *Linear RGB* gradients included.
- **Bitmaps**, pixel by pixel, at the size they are written. Animate's own JPEG of a *Photo* bitmap has the old colours, so it is compressed anew.
- **Text** colours, the border of text fields, the **stage colour**, the colours of **filters** (shadow, glow, bevel; gradient glows and bevels along their whole ramp).
- **Colour effects** — *tint*, *brightness*, *advanced* — are worked out for the graded colours: a full tint shows the LUT's colour for the tint, a half one comes as close as one effect can; tweens of them stay tweens. *Alpha* is not a colour and stays as it is. The camera's tint too.
- **GIF, WebP, APNG, MP4 and WebM** grade each finished picture instead, so they are exact: also where see-through shapes, blends and filters mix colours.

In SVG and Lottie, colours that mix on the screen — see-through shapes over each other, blurs, blend modes, *Adjust Color* — mix the graded colours, which is close to grading the mixture but not the same. Measured on the guide's demos against grading Animate's finished pictures: 0.1–0.7 levels of 255 off on average (the edges of shapes), 2 with filters, 3.3 with blend modes. Not graded: colours scripts make while the JS player runs (drawing with `graphics`, `BitmapData`, `textColor`), linked videos, and UI components (they are the browser's own controls). A LUT for camera footage in log colours expects other input and looks wrong on Animate's colours, as it would in an editor.

What it costs, with a strong look: solid colours nothing, gradients 0–3 % (their added stops), shape tweens whose colours change 4–22 % in SMIL and up to a third in Lottie — their in-between colours are no longer a straight line, so they get keys of their own (only where a straight line would be more than a level off). Grading takes 4–8 ns a pixel (a 1920×1080 picture in 8–16 ms); a GIF of a moving photo takes about 12 % longer.

## Fills and strokes

- **Solid** fills, **linear** and **radial gradients** (focal point, *repeat* and *reflect*, *Linear RGB* interpolation — also on strokes and in shape tweens), **bitmap fills** repeated or clipped (Animate stretches the edge pixels of a clipped fill; so does the export).
- **Strokes** with every cap and join, **gradient strokes**, and Animate's stroke styles (dashed, dotted, ragged, stipple, hatched — Animate's own SVG export turns the last three into many small shapes, so they get big).
- **Hairlines** and strokes with scale *None* keep their width when the symbol is scaled.

Animate never draws a stroke thinner than one pixel; SVG does. A stroked symbol scaled far down — a card flipping through scale 0 — shows thinner outlines than in Animate. Strokes that scale only *horizontally* or *vertically* are drawn like *Normal* (warned).

## Bitmaps

Bitmaps — on stage, in symbols, as fills — export with their smoothing setting (pixel art stays crisp). How they are compressed is up to you: [Images and sounds](images-sounds.md).
