---
title: Overview
description: Flash2SVG exports Adobe Animate timelines as animated SVG (SMIL, CSS or a small JS player), Lottie and dotLottie, with Animate's easing, nested symbols, shape tweens, masks, filters, buttons and sounds.
---

# Animated SVG and Lottie from Adobe Animate

<p class="lead">Flash2SVG is a panel for Adobe Animate. It turns your timelines into animated SVG files that play in every browser — also as a plain <code>&lt;img&gt;</code> — and into Lottie files for apps. Tweens keep Animate's exact easing; symbols, shape tweens, masks, filters, buttons and sounds come along.</p>

::: demo hero smil,css,player,lottie,gif,webp Made in Animate, exported with Flash2SVG: a shape tween, a movie clip turning inside it and a title fading in with a glow. Switch the formats below — the numbers are the file sizes after gzip.

## What it does

<ul class="cards">
<li><strong>Every way to animate SVG</strong>SMIL for anywhere (even <code>&lt;img&gt;</code> and e-mail clients that show SVG), CSS for pages you style, a 15 KB JS player with Flash's own behaviour, still frames, GIF and WebP fallbacks.</li>
<li><strong>Lottie and dotLottie</strong>The same timeline for lottie-web, the dotLottie players, Skottie and the iOS, Android, Flutter and React Native players.</li>
<li><strong>Exactly like Animate</strong>Every tween is checked against Animate's own frames. Classic and custom eases, motion tweens and guides, shape tweens as real morphs.</li>
<li><strong>Interactive</strong>Buttons, frame scripts (<code>stop()</code>, <code>gotoAndPlay()</code>), the Code Snippets panel's mouse handlers, start on click, hover, scroll or when visible.</li>
<li><strong>Small files</strong>One drawing per symbol, curves instead of frames, images in WebP or AVIF and scaled to what is shown, sounds as MP3 or Opus — and a size overview after every export.</li>
<li><strong>Your FLA stays untouched</strong>The export works on a temporary copy. HTML5 Canvas documents work as well as ActionScript 3.</li>
</ul>

## Start here

1. [Install the panel](installation.md) in Animate 2022 or later.
2. [Export your first animation](quick-start.md) — it takes a minute.
3. [Choose a format](formats.md) for where the animation will play.

Already exporting? Look up a setting in the [settings reference](settings.md), see [what is exported](animation.md), or put the result [on a web page](embedding.md).

> [!NOTE]
> Every animation in this guide was made in Animate and exported with Flash2SVG: what you see is what the panel writes. Each demo has tabs for the formats and a download button for the file.

## A few numbers

| | |
|---|---|
| A 119-frame shape tween | 12.7 KB as SMIL instead of 75.5 KB frame by frame |
| The JS player's runtime | 15.1 KB (with sounds 18.7 KB), only in files that need it |
| A 12-megapixel photo shown at 20 % | 1042 KB → 100 KB as JPEG, 13 KB as AVIF |
| 150 tweened symbols | about 110 frames a second in the JS player |
| Export of a typical scene | well under a second after Animate hands over the drawing |

Flash2SVG is open source (MIT). Version 4 is a ground-up rewrite of [Tom Byrne's Flash2Svg](https://github.com/TomByrne/Flash2Svg) for current Animate versions.
