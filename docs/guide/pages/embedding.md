---
title: Embedding on a web page
description: Put an exported SVG on a page as img, object, inline markup or with the flash2svg-player element; sizes that follow the page; reduced motion; several exports on one page; fallbacks and server compression.
---

# Embedding on a web page

## Four ways

| | SMIL / CSS | JS player | Scripts run | Scroll-driven CSS |
|---|---|---|---|---|
| `<img src="hero.svg">` | ✓ | first frame only | – | – |
| `<object data="hero.svg">` | ✓ | ✓ | ✓ | – |
| inline `<svg>…</svg>` in the page | ✓ | ✓ | ✓ | ✓ |
| `<flash2svg-player src="hero.svg">` | ✓ | ✓ | ✓ | ✓ |

**As an image** — the simplest, and enough for SMIL and CSS exports that just play:

```html
<img src="hero.svg" alt="Our product in motion" width="640" height="360">
```

An image is sandboxed: no scripts, no links, no loading of linked files, no clicks. *When visible* and *On scroll* simply play there.

**As an object** — for the JS player, links and buttons:

```html
<object data="hero.svg" type="image/svg+xml" width="640" height="360" aria-label="Our product in motion"></object>
```

**Inline** — paste the file's markup into your HTML, or insert it with a script. Every export has its own id prefix, so several exports can sit in one page without their ids clashing. Scroll-driven CSS needs this (or the web component).

**The web component** does the inlining for you, lazily — see [Player API](player-api.md#the-web-component).

## Size on the page

By default (*Size: Stage size*) the SVG has the stage's width and height, and scales like any image when you give it another size in CSS — it's vector art.

To make the animation **fill whatever space the page gives it**, choose one of Flash's scale modes in *Advanced › Size*:

| Size | Like Flash's | |
|---|---|---|
| *Fill the space, show all* | `showAll` | the whole stage, letterboxed (in the stage colour when *Include stage colour* is on) |
| *Fill the space, no border* | `noBorder` | covers the space, cropping what sticks out |
| *Stretch to the space* | `exactFit` | distorted to fit exactly |

```html
<object data="banner.svg" type="image/svg+xml" style="width:100%;height:60vh"></object>
```

## Reduced motion

Visitors who turned animations off in their system settings (`prefers-reduced-motion`) see the **poster frame, still** — in SMIL and CSS output, and in the JS player until they click it. This is on by default (*Still poster for "reduce motion"*; `--ignore-reduced-motion` on the command line). For SMIL it adds a still copy of the poster frame that shares the drawings: a few percent of the file.

Browsers apply the setting to images too. To be sure, offer a still picture:

```html
<picture>
  <source media="(prefers-reduced-motion: no-preference)" srcset="hero.svg">
  <img src="hero-still.svg" alt="Our product">
</picture>
```

## Fallbacks

For places where SVG animation doesn't run — e-mail clients above all — export **GIF** or **WebP** as well and serve those there. Renderers without CSS (design tools, image viewers) show the poster frame of CSS exports from their `transform` attributes.

## Pausing and styling CSS exports

A CSS export's animations are ordinary CSS animations, so your page can control them:

```css
/* pause every animation in the export until the user hovers */
.hero svg *, .hero svg { animation-play-state: paused; }
.hero:hover svg *, .hero:hover svg { animation-play-state: running; }
```

## Serving it

Let the server **compress** SVG, JSON and the player's script — preferably with Brotli — and cache it:

| Server | |
|---|---|
| nginx | `brotli on; brotli_types image/svg+xml application/json;` or `gzip_types image/svg+xml application/json;` |
| Apache | `AddOutputFilterByType BROTLI_COMPRESS image/svg+xml application/json` (mod_brotli) or `DEFLATE` (mod_deflate) |
| GitHub Pages, Netlify, Cloudflare | compress SVG automatically |

The 59 test documents as SMIL: 1313 KB, 402 KB gzipped, 360 KB with Brotli. See [Performance](performance.md#compression) for `.svgz`.
