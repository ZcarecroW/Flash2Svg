---
title: Player API
description: Control a JS player export from your page — play, stop, gotoAndPlay with labels, deterministic seek, speed, mute, named movie clips, frame and end events — and the flash2svg-player web component.
---

# Player API

A **JS player** export plays by itself; your page can also control it. The API sits on the `<svg>` element as `svg.flash2svg`, and the element dispatches a `flash2svg:ready` event when it is set up.

## Getting hold of the player

```js
// inline SVG
const anim = document.querySelector("#hero svg").flash2svg;

// in an <object>: once it has loaded
const obj = document.querySelector("object#hero");
obj.addEventListener("load", () => {
  const anim = obj.contentDocument.documentElement.flash2svg;
  anim.gotoAndPlay("intro");
});
```

## Methods and properties

| | |
|---|---|
| `play()` | plays (a timeline that ran to its end without looping starts again) |
| `pause()` | holds everything: timelines, tweens, sounds |
| `stop()` | stops the main timeline, like `stop()` in a frame script — movie clips keep running |
| `gotoAndPlay(target)` / `gotoAndStop(target)` | jumps to a frame label or a 1-based frame number |
| `seek(seconds)` | sets the time from the start, deterministically (frame scripts and all); negative is 0, NaN and Infinity are ignored. Far ahead it finds where the animation repeats instead of playing every frame through |
| `currentFrame`, `totalFrames` | the main timeline's frame (1-based) and length |
| `speed` | playback speed, a positive number (1 = normal); other values are ignored |
| `muted` | turns the sounds off and on |
| `clip(name)` | a named movie clip instance: `{ play, stop, gotoAndPlay, gotoAndStop }`, or `null` |
| `on(type, fn)` | `"frame"`: `{ frame, label }` on every frame the main timeline enters (`frame` counts from 0); `"end"`: when a non-looping timeline reaches its end |

```js
const anim = svg.flash2svg;
anim.on("frame", (e) => console.log(e.frame, e.label));
anim.on("end", () => document.body.classList.add("intro-done"));
anim.speed = 0.5;
anim.clip("door")?.gotoAndStop("open");
```

> [!TIP]
> With *Start: From script*, the export waits for your `play()` — handy when the animation should begin with something on your page.

## Performance

The player hands tweened transforms and alpha to the browser as **Web Animations**, which run on the compositor: the artwork stays rastered and is only moved, so the page doesn't repaint it every frame. A test scene of 150 tweened instances of a detailed drawing runs at about 110 frames a second (2,560 at 59 fps). Symbols with hairlines (strokes that keep their width) are moved by the player itself, since their outline changes with every transform.

The player **rests** while it is out of view or in a background tab and goes on where it was — unless its sound is on, then it keeps playing like a video.

## The web component

`<flash2svg-player>` (1.7 KB) puts an exported SVG into your page **inline**, so its scripts run and scroll-driven CSS works, without you fetching and inserting it yourself. It loads the file when it comes near the screen (`loading="eager"`: at once) and shows its children until then.

```html
<script type="module" src="flash2svg-player.js"></script>

<flash2svg-player src="hero.svg">
  <img src="hero-poster.png" alt="Our product in motion">
</flash2svg-player>

<script>
  document.querySelector("flash2svg-player")
    .addEventListener("load", (e) => e.target.player?.play());
</script>
```

`flash2svg-player.js` is an ES module; `flash2svg-player.iife.js` is the same as a classic script. Both come with every [release](https://github.com/ZcarecroW/Flash2Svg/releases). The element's `player` property is the API above (for JS player exports).
