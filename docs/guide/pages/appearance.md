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

## Blend modes

*Normal*, *layer*, *multiply*, *screen*, *overlay*, *hard light*, *lighten*, *darken*, *difference*, *add*, *subtract*, *invert*, *alpha* and *erase*.

::: demo blend smil,css,lottie Three circles with *screen*: where they overlap, red, green and blue add up to white.

*Alpha* and *erase* act inside a symbol placed with the *layer* blend, as in Animate: they cut into what lies below them in that symbol. In Lottie, *subtract* and *add* are approximated (warned).

## Colour effects

*Brightness*, *tint*, *alpha* and *advanced* colour effects, tweened or not.

> [!NOTE]
> Alpha on a symbol applies to **each shape inside**, as in Flash: where shapes overlap — the inner half of a stroke over its fill — they show through each other. Flash2SVG does the same. Inside such a symbol, alpha on nested symbols applies to them as a whole (SVG can't multiply inherited alpha per shape).

## Fills and strokes

- **Solid** fills, **linear** and **radial gradients** (focal point, *repeat* and *reflect*, *Linear RGB* interpolation — also on strokes and in shape tweens), **bitmap fills** repeated or clipped (Animate stretches the edge pixels of a clipped fill; so does the export).
- **Strokes** with every cap and join, **gradient strokes**, and Animate's stroke styles (dashed, dotted, ragged, stipple, hatched — Animate's own SVG export turns the last three into many small shapes, so they get big).
- **Hairlines** and strokes with scale *None* keep their width when the symbol is scaled.

Animate never draws a stroke thinner than one pixel; SVG does. A stroked symbol scaled far down — a card flipping through scale 0 — shows thinner outlines than in Animate. Strokes that scale only *horizontally* or *vertically* are drawn like *Normal* (warned).

## Bitmaps

Bitmaps — on stage, in symbols, as fills — export with their smoothing setting (pixel art stays crisp). How they are compressed is up to you: [Images and sounds](images-sounds.md).
