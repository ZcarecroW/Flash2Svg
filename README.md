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
  `gotoAndPlay()`, `gotoAndStop()` in AS3 or JavaScript syntax, including the banner idiom
  "play 3 times, then stop" (a pass counter in an `if`). Movie clips keep running after the main
  timeline stops, as in Flash — also in SMIL/CSS output.
- **Camera** (pan, zoom, rotate, tweened), **buttons** (Up / Over / Down), **frame sounds**.
- **9-slice scaling** of movie clips (corners keep their size, like in Animate; rotated
  instances scale normally, as in Flash) and **layer effects** of advanced layers (colour
  effect, filters and blend mode on a layer).
- **Filters**: blur, glow, drop shadow, inner shadow, bevel, gradient glow / bevel, adjust colour;
  blend modes multiply, screen, overlay, lighten, darken, difference, hard light, add, subtract, invert,
  layer, and *alpha* / *erase* (cut-outs inside a symbol with the *layer* blend).
- **Fills**: solid, linear and radial gradients (focal point, repeat / reflect, *Linear RGB* also
  on strokes and in shape tweens), bitmap fills (repeated or clipped), hairlines.
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

**Uninstalling:** close the Flash2SVG panel and quit Animate *before* you remove the extension.
Animate 2024 remembers open panels in its workspace and, if the extension of a remembered panel
is gone, quits whenever a document window opens. If that happened: install the extension again,
close the panel, quit Animate, then remove it.

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

The panel's compiler also runs in Node (24+, tested with 26 LTS): it turns the scene data the extractor writes into
SVG, so you can re-export with other settings without Animate.

```bash
node dist/cli/flash2svg.js path/to/scene.json -o out.svg --format css --loop always
```

`--help` lists all options. (The panel keeps no scene data by default; the e2e tests write it to
`tests/out/<name>/model/`.)

## Limitations

- Filters are checked against Animate's own rendering in the end-to-end tests (blur, glow,
  drop/inner shadow, bevel inner/outer/full, knockout, hide object, gradient glow and bevel,
  adjust colour): in the browser they match within a fraction of a percent of the pixels. Filters
  follow the stage orientation like Animate's; for instances nested in rotated symbols they turn
  with the parent symbol.
- *Alpha* and *erase* act inside a symbol placed with the *layer* blend, like in Animate (they
  cut into what lies below them in that symbol).
- Frame scripts are not run: `stop()`, `play()`, `gotoAndPlay()`/`gotoAndStop()` with a frame
  number or label are followed; of conditions only pass counters are understood
  (`if (n < 3) gotoAndPlay(0); else stop();`). Other conditional actions always run (warned).
- Animate adds the temporary copy each export works on to its *Recent files* list (JSFL can't
  open a document without doing so).
- 3D transforms export as their 2D projection. IK armatures, video and components are not
  exported. Layer parenting follows Animate's per-frame rig matrices (between frames they are
  interpolated linearly).
- Shape tweens become one drawing per frame.
- Strokes: the scale options *Horizontal* and *Vertical* are drawn like *Normal* (warned; *None*
  works). Animate never draws a stroke thinner than one pixel, SVG does: a stroked symbol scaled
  far down (a card flipping through scale 0) shows thinner outlines than in Animate.
- Alpha on a symbol applies to each shape inside, like in Flash; inside such a symbol, alpha on
  nested symbols applies to them as a whole (SVG can't multiply inherited alpha).
- Groups that hold symbol instances are split: the group's drawing first, its instances above
  it (a drawing sub-group placed above an instance inside the same group ends up below it).
- 9-slice: an animated scale is sliced frame by frame for symbols that only contain drawings;
  named instances and symbols with nested symbols keep normal scaling then (warned). Nested
  movie clips, bitmaps and text inside 9-slice symbols scale normally, as in Flash.
- Only the current scene is exported (Flash plays all scenes in a row): a warning tells you when
  the document has more than one. Put scenes into one timeline, or export them one by one.
  Frame scripts that jump into another scene are left out.
- In SMIL/CSS output a movie clip that is visible for the whole timeline keeps running across
  the loop; one that appears and disappears restarts each time it appears (like Flash). After a
  `stop()` the running clips loop on (their common period). Very long timelines with many short
  nested loops of different lengths make big SMIL/CSS files — use the JS player then.
- *Loop: once* stops everything on the last frame, movie clips included.

## Development

```bash
npm install
npm run build          # dist/extension (CEP panel) and dist/cli
npm test               # unit tests (Vitest)
npm run typecheck      # TypeScript 7 (+ svelte-check for the panel components)
npm run dev:install    # copy dist/extension into your CEP extensions folder
npm run package        # dist/Flash2SVG-<version>.zip (+ signed .zxp if ZXPSignCmd is available)
npm run e2e            # end-to-end: drives Animate + Edge (see below)
npm run e2e:panel      # the panel itself inside Animate (signed self-test build, removed afterwards)
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
download) and compares them frame by frame (smooth and stepped, plus the end state), and finally
drives the JS player's API, buttons and sounds, and inlines several exports into one HTML page
(ids are unique per export, so they don't clash).

`npm run e2e:panel` tests the panel inside Animate: it builds a self-test version, signs it with
Adobe's `ZXPSignCmd` (put it into `tools/zxpsign/`; no CEP debug mode needed), installs it, lets
it export a set of fixtures through the real Export path and uninstalls it again. See [docs/architecture.md](docs/architecture.md).

## Credits

Flash2SVG was created by Thomas Byrne and David Belais. Version 4 is a rewrite in this fork.
MIT licensed — see [LICENSE](LICENSE).
