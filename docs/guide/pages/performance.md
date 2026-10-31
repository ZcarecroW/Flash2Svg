---
title: Small and fast
description: Make exported animations smaller and smoother — read the size overview, pick the right format, simplify heavy drawings, compress images and sounds, set decimals, and let the server compress.
---

# Small and fast

## Read the size overview

After every export, the **Result** splits the file into its parts and names the heaviest drawings. Start there:

| Part | What it is | What makes it smaller |
|---|---|---|
| **drawing** | the shapes of every symbol and frame | fewer points (Animate's *Optimize curves*), symbols instead of copies, fewer frame-by-frame drawings |
| **animation** | tweens and their timing | *Smooth tweens* with simple eases; fewer keyframes |
| **images** | embedded bitmaps | WebP or AVIF, lower quality, *Resolution* 1× |
| **sounds** | embedded sounds | Opus, a lower bit rate, mono |
| **fonts** | embedded font subsets | fewer fonts and styles, or *Embed fonts* off |
| **runtime** | the JS player's script (6.2 KB gzipped) | SMIL or CSS when you don't need the player |
| **linked** | files next to the SVG | — |

*Biggest drawings* lists the symbols and layers whose shapes take the most, for example "Scene 1 › fbf: 38.5 KB (150 drawings)" — frame-by-frame animation is usually the first thing to look at.

## Pick the format

For tweens and shape tweens, **SMIL** is usually the smallest: an eased tween is one short animation, a shape tween one morphing drawing. **CSS** comes close for transforms and runs on the compositor (smooth on busy pages), but draws shape tweens frame by frame. **Automatic** takes CSS unless SMIL is more than 15 % smaller. See [Sizes compared](formats.md#sizes-compared).

Animations that repeat inside a longer loop — a spinner turning every 8 frames in a 120-frame scene — are written once with their own repeat, not unrolled.

## Simplify what Animate hands over

- Reuse **symbols**: a symbol is written once, however often it appears.
- Prefer **tweens** to frame-by-frame drawing; prefer **shape tweens** to drawn in-betweens.
- Run **Modify › Shape › Optimize** on heavy imported artwork.
- Keep text that doesn't change as **static text**; avoid many fonts in dynamic text.
- *Stipple*, *hatched* and *ragged* stroke styles turn into many small shapes in Animate's own export — use solid strokes where you can.

## Images and sounds

Bitmaps shown smaller than their pixels are already written smaller (*Resolution*). Beyond that, **AVIF** gives the same look as JPEG at a quarter to nine tenths of its size (measured; AVIF's quality is scaled so the same number looks alike), **WebP** looks better than JPEG at the same quality number but isn't always smaller on noisy photos, and tiny or flat pictures are often smallest lossless. The Result lists every bitmap's format and size — compare. For sounds, **Opus** sounds as good as MP3 at half the bit rate. See [Images and sounds](images-sounds.md).

## Decimals

*Advanced › Decimals* (default 2) is the precision **on screen**: a part shown at a tenth of its size gets one decimal less, one shown at 8× one more; angles and scale factors get what the size of what they turn needs. One decimal is often enough for large, simple shapes; the *Smallest file* preset uses it.

## Compression

Let the server compress SVG — it shrinks to about a third. The 59 test documents as SMIL: 1310 KB, **391 KB gzipped**, **357 KB with Brotli**.

**`.svgz`** (*Compressed .svgz*, `--svgz`) writes the SVG gzipped, for design tools and for servers that send `.svgz` files with `Content-Encoding: gzip` (Apache: `AddEncoding gzip .svgz`). Browsers show it only then — not from disk, not from a server that sends just the type. For the web, keep plain `.svg` and let the server compress it.

## Smooth playback

- **CSS** and the **JS player** move tweened symbols on the compositor; the artwork is rastered once and only moved. SMIL is smooth too in current browsers.
- **Blur and glow** are the most expensive things to draw, especially animated and large. A cached copy — Animate's *Cache as bitmap* — doesn't exist in SVG.
- **Hairlines** (strokes that keep their width) must be redrawn at every scale: avoid them in symbols that scale.
- The JS player rests while it is out of view or in a background tab.

The JS player draws 150 tweened instances of a detailed drawing at about 110 frames a second, and 2,560 at 59 (measured in Edge).
