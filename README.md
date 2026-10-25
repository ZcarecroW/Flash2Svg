# Flash2SVG 4 — animated SVG exporter for Adobe Animate

Export Adobe Animate timelines as **animated SVG**: tweens with their real easing, nested
movie clips and graphic symbols, masks, filters, the camera, buttons and sounds. You choose the
kind of animation in the file:

| Format | What you get | Works in `<img>` | Interactive |
| --- | --- | --- | --- |
| **SMIL** | `<animate>` / `<animateTransform>` with exact `keySplines` easing | ✓ | button states via CSS |
| **CSS** | `@keyframes` with `cubic-bezier()` per keyframe, class based | ✓ | button states, pause from your page CSS |
| **JS player** | artwork + compact timeline + a 10 KB runtime with real Flash semantics | poster frame only | ✓ `play()`, `stop()`, `gotoAndPlay("label")`, buttons, sounds |
| **Frames** | one still SVG per frame | ✓ | – |

This is a ground-up rewrite (v4) of [TomByrne/Flash2Svg](https://github.com/TomByrne/Flash2Svg)
for current Animate versions. HTML5 Canvas documents are supported as well as ActionScript 3
documents.

## What's new compared with 3.x

- **Easing that matches Animate.** Classic eases are reproduced exactly (Animate's
  `-100…100` ease is a quadratic curve; v3 approximated it). Custom ease curves with any number
  of points, overshoot (back / elastic / bounce shapes), and **per-property eases** (separate
  curves for position, rotation, scale, colour) become exact Bézier pieces, without baking every
  frame.
- **Everything is verified against Animate.** Each tween is sampled from Animate's own
  interpolation (`frame.tweenObj`); the compiler only keeps its compact curve when it reproduces
  every frame, otherwise it falls back to the samples (motion guides, orient to path, motion
  objects, anything unusual).
- **Modern motion tweens** (object-based), motion guides and orient-to-path.
- **HTML5 Canvas documents** (v3 refused them), frame scripts `stop()`, `play()`,
  `gotoAndPlay()`, `gotoAndStop()` in AS3 or JavaScript syntax.
- **Camera** (pan, zoom, rotate, tweened), **buttons** (Up / Over / Down), **frame sounds**.
- **Filters**: blur, glow, drop shadow, inner shadow, bevel, gradient glow / bevel, adjust colour;
  blend modes multiply, screen, overlay, lighten, darken, difference, hard light, add, layer.
- **Your document is never modified.** The exporter works on a temporary copy (v3 created and
  deleted scenes and library items in your file).
- **Much faster**, a new panel with presets, live preview and per-document settings, and a
  command line compiler.

## Install

Requires **Adobe Animate 2022 or later** (tested with Animate 2024, 24.0.x on Windows).

- **Signed ZXP** (from [Releases](../../releases)): install it with
  [Anastasiy's Extension Manager](https://install.anastasiy.com/), Adobe's
  `UnifiedPluginInstallerAgent` / `ExManCmd`, or ZXPInstaller.
- **Zip** (from Releases): unzip into the CEP extensions folder as `org.flash2svg` —
  Windows `%APPDATA%\Adobe\CEP\extensions\`, macOS `~/Library/Application Support/Adobe/CEP/extensions/`.
  Unsigned installs need CEP debug mode, see [Development](#development).

Restart Animate and open **Window › Extensions › Flash2SVG (SVG Animation)**.

## Use

1. Open your FLA and go to the timeline (scene or symbol) you want to export — or select symbols
   in the Library and choose *Source: Selected library symbols*.
2. Pick a format and, if you like, an output file (default: next to the FLA).
3. Press **Export**. The panel shows a preview you can play and scrub, the file size, and any
   warnings about features that could not be reproduced exactly.

Useful options: *Smooth tweens* (interpolate between frames — the "high FPS" look; off = one
step per frame like the SWF), *Loop* (follow `stop()` scripts / always / once), *Start*
(automatically, on click, on hover, from script), *Poster* frame for places where animation
doesn't run, embedding vs. linking images, decimal places.

### Embedding

```html
<!-- SMIL / CSS: works anywhere, also as an image -->
<img src="hero.svg" alt="…">

<!-- JS player: needs a document context for scripts -->
<object data="hero.svg" type="image/svg+xml"></object>
<!-- …or inline the SVG markup in your page -->
```

JS player API (on the `<svg>` element, also dispatched as the `flash2svg:ready` event):

```js
const anim = svgElement.flash2svg;
anim.play(); anim.pause(); anim.stop();
anim.gotoAndPlay("intro");      // frame label or 1-based frame number
anim.gotoAndStop(12);
anim.seek(1.5);                  // seconds, deterministic
anim.speed = 0.5; anim.muted = true;
anim.clip("myInstance")?.gotoAndStop("open");   // named movie clip instances
anim.on("frame", (e) => console.log(e.frame, e.label));
anim.on("end", () => {});
```

## Command line

The panel's compiler also runs in Node (22+): it turns the scene data the extractor writes into
SVG, so you can re-export with other settings without Animate.

```bash
node dist/cli/flash2svg.js path/to/scene.json -o out.svg --format css --loop always
```

`--help` lists all options. (The panel keeps no scene data by default; the e2e tests write it to
`tests/out/<name>/model/`.)

## Limitations

- Animate's filters run on bitmaps with box blurs; SVG uses Gaussian blurs, so bevels and
  shadows can differ slightly at the edges. Blend modes *subtract*, *alpha*, *erase* and
  *invert* have no CSS/SVG equivalent (warned).
- 3D transforms export as their 2D projection. IK armatures, video and components are not
  exported. Layer parenting is read from Animate's rig data but could not be tested with
  scripted fixtures yet — please report results.
- Shape tweens become one drawing per frame.
- In SMIL/CSS output a movie clip that is visible for the whole timeline keeps running across
  the loop; one that appears and disappears restarts each time it appears (like Flash). Very long
  timelines with many short nested loops make big SMIL/CSS files — use the JS player then.

## Development

```bash
npm install
npm run build          # dist/extension (CEP panel) and dist/cli
npm test               # unit tests (Vitest)
npm run typecheck      # TypeScript 7
npm run dev:install    # copy dist/extension into your CEP extensions folder
npm run package        # dist/Flash2SVG-<version>.zip (+ signed .zxp if ZXPSignCmd is available)
npm run e2e            # end-to-end: drives Animate + Edge (see below)
```

Unsigned development installs need CEP debug mode (once per machine):

```bash
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

(macOS: `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`; use `CSXS.11` for Animate 2022/2023.)

**End-to-end tests** (`npm run e2e`, Windows): builds a set of fixture FLAs with JSFL, runs the
extractor on each inside Animate (command line, Animate must not be running) together with
Animate's own PNG export of every frame, renders our static frames with resvg and compares them
pixel by pixel, then plays the SMIL, CSS and player outputs in Edge (playwright-core, no browser
download) and compares them frame by frame. See [docs/architecture.md](docs/architecture.md).

## Credits

Flash2SVG was created by Thomas Byrne and David Belais. Version 4 is a rewrite in this fork.
MIT licensed — see [LICENSE](LICENSE).
