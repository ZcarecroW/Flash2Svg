---
title: Lottie and dotLottie
description: Export Animate timelines as Lottie JSON or .lottie archives for lottie-web, the dotLottie players, Skottie and the iOS, Android, Flutter and React Native players — with effects, state machines and markers.
---

# Lottie and dotLottie

Animate has no Lottie export of its own. Flash2SVG writes the same timeline as **Lottie** (a `.json` file) or **.lottie** (a dotLottie archive: the animation, its bitmaps and a state machine in one compressed file). Every test document is checked frame by frame in three players — lottie-web, dotLottie (ThorVG) and Skottie — against the SVG output, and validated with the official Lottie schema.

::: demo hero lottie,dotlottie,smil The hero demo as Lottie, played here by lottie-web. The .lottie tab shows the size of the archive; download it to try it in a dotLottie player.

## Which players

| Player | Plays | Notes |
|---|---|---|
| [lottie-web](https://github.com/airbnb/lottie-web) | `.json` | The web player; SVG or canvas renderer. |
| [dotLottie](https://developers.lottiefiles.com/docs/dotlottie-player/) (web, iOS, Android, React, Flutter) | `.json` and `.lottie` | All drawn by ThorVG; run the state machine. |
| Skottie (Skia / CanvasKit) | `.json` | Chrome's and Flutter's Lottie engine. |
| lottie-ios, lottie-android | `.json` (and `.lottie`) | Airbnb's native players. |

## What carries over

- **Symbols** become precompositions and keep their eases as Lottie keyframe curves. Movie clips that loop are drawn once and played again by a *time remap*.
- **Frame scripts** (`stop()`, `gotoAndPlay()`) are followed as in SMIL, and **frame labels** become markers: play a part with the player's marker or segment API.
- **Masks** become track mattes; **shape tweens** animated paths and gradients; **colour effects** (tint, brightness, advanced, alpha) go into the colours of the shapes inside, as Flash applies them.
- **Bitmaps** become image assets: embedded, written next to the JSON (*Embed images* off), or inside the .lottie.
- **Filters** become layer effects: blur a Gaussian blur, drop shadow and glow a drop shadow (animated too), *adjust colour* goes into the colours. The filters Lottie has no effect for — inner, knockout and *hide object* shadows and glows, bevels, gradient glows and bevels, strong or uneven blurs — are built from track mattes, blend modes and blur or Tritone effects. In lottie-web and Skottie they match the SVG output exactly.

> [!NOTE]
> Effects are not part of the Lottie specification 1.0, but lottie-web, dotLottie, Skottie and the iOS and Android players draw them. Other players may not.

## Playing it

```js
// lottie-web: frame labels are markers
const anim = lottie.loadAnimation({
  container: document.getElementById("hero"),
  renderer: "svg", loop: true, autoplay: true,
  path: "hero.json",
});
anim.goToAndPlay("intro", true);
```

```js
// dotLottie (npm @lottiefiles/dotlottie-web): the export's state machine plays it
import { DotLottie } from "@lottiefiles/dotlottie-web";
const player = new DotLottie({
  canvas: document.querySelector("canvas"),
  src: "hero.lottie",
  stateMachineId: "playback",
});
// with Start "From script": start it (again)
player.stateMachineFireEvent("play");
```

## Loops, intros and starting

A Lottie JSON loops and autoplays as the player is told. When the timeline has an intro — it stops while movie clips keep running, or loops back to a label — the export has two markers, **intro** (play once) and **loop** (then loop it); the warnings say so.

A **.lottie** carries a state machine called `playback` that plays it as your settings say: follow the timeline, loop or play once; start automatically, on a click, on hover or from script; show the *Poster* frame before a click or hover. dotLottie players run it when asked with `stateMachineId: "playback"`.

### Buttons in a .lottie

Mouse handlers from the Code Snippets panel become the state machine: every place playback can start (frame 1, jump targets, labels the buttons go to) is a state, clicks on the buttons' layers are the transitions, and *Go to Web Page* becomes an *OpenUrl* action. Mouse over and out, and handlers in nested timelines, aren't followed (warned).

## What is not in Lottie

| Feature | In Lottie |
|---|---|
| Sounds | left out (warned) |
| Button states (*Over*, *Down*) | left out; use a .lottie state machine for clicks |
| Editable text | drawn as outlines; text field borders, filters and links are left out (warned) |
| *Subtract* and *add* blends | approximated (multiply by the inverted colours, screen) |
| Hairlines | keep the width they have at the scale their symbol starts with |
| Bitmaps without smoothing | drawn smoothed |
| Colour effects on bitmaps | tint and brightness exact; other colour effects keep only their alpha |

## Size and speed

Lottie JSON is wordier than SVG but compresses as well: the test documents take 1462 KB as Lottie and 1086 KB as SMIL — gzipped 379 KB and 372 KB, and 413 KB as .lottie archives. Players draw a precomposition again for each use, so built filters cost render time: about 0.5–2 ms per shadow and 6–9 ms per bevel and frame in Skottie at 500×400.

The players differ a little (measured): lottie-web blurs drop shadows slightly less than the others; dotLottie (ThorVG) blurs narrower, draws thin seams between the tiles of a repeating bitmap fill and fades the edges of a clipped bitmap fill.
