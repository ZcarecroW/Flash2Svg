# Flash2SVG 4 — animated SVG exporter for Adobe Animate

Export Adobe Animate timelines as **animated SVG**: tweens with their real easing, nested
movie clips and graphic symbols, masks, filters, the camera, buttons and sounds. You choose the
kind of animation in the file:

| Format | What you get | Works in `<img>` | Interactive |
| --- | --- | --- | --- |
| **SMIL** | `<animate>` / `<animateTransform>` with exact `keySplines` easing | ✓ | button states via CSS |
| **CSS** | `@keyframes` with `cubic-bezier()` per keyframe, class based | ✓ | button states, pause from your page CSS |
| **JS player** | artwork + compact timeline + a 14 KB runtime with real Flash semantics (15.5 KB with shape-tween morphs) | poster frame only | ✓ `play()`, `stop()`, `gotoAndPlay("label")`, buttons, sounds |
| **Frames** | one still SVG per frame | ✓ | – |
| **Lottie** / **.lottie** | Lottie JSON, or a dotLottie archive with its bitmaps, for lottie-web, dotLottie, Skottie and the app players (iOS, Android, Flutter, React Native) | – | through the player's API |

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
- **Shape tweens as morphs**: in SMIL and the JS player one drawing whose paths, colours and
  gradients blend, checked against every frame Animate drew (v3: a drawing per frame).
- **Lottie and dotLottie export** (Animate has none of its own): the same timelines as Lottie
  JSON or a `.lottie` archive, checked in three Lottie players.
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
   warnings about features that could not be reproduced exactly. A bar shows what the size is
   made of — drawing, animation, images, sounds, the player's script, linked files — and
   *Biggest drawings* names the symbols and layers whose shapes take the most (e.g.
   "Scene 1 › fbf: 38.5 KB (150 drawings)"), next to the lists of bitmaps and sounds.

Useful options: *Smooth tweens* (interpolate between frames — the "high FPS" look; off = one
step per frame like the SWF), *Loop* (follow `stop()` scripts / always / once), *Start*
(automatically, on click, on hover, from script), *Poster* frame for places where animation
doesn't run, embedding vs. linking images, decimal places.

### Images

Each bitmap is either compressed with loss or kept exactly as it is. By default Animate's bitmap
properties decide (Library › Properties › *Compression*): *Photo (JPEG)* bitmaps are compressed
with their quality setting, *Lossless (PNG/GIF)* ones keep every pixel. Override this per
bitmap in the panel's **Images** section — e.g. lossless for icons, patterns and pixel art, lossy
for photos — and choose the formats:

| | Formats | Notes |
|---|---|---|
| Lossy (photos) | **JPEG** (default), **WebP**, **AVIF** | JPEG at Animate's quality uses Animate's own JPEG: imported JPEGs stay byte for byte as they were. Transparent pictures are written as WebP (JPEG has no transparency). AVIF's quality is scaled to look like JPEG at the same number. |
| Lossless | **PNG** (default, optimised), **WebP lossless** | Every pixel stays the same, also the colour of transparent ones. |

*Quality* 0 uses each bitmap's own quality from Animate. Pictures that come out smaller without
loss (small icons, flat patterns) stay lossless. In browsers, WebP works everywhere current;
AVIF in about 93% of them (2026).

**Resolution:** a bitmap that is only ever shown smaller than its pixels — scaled down, inside
scaled symbols, in tweens, under the camera, as a bitmap fill — is written smaller, down to
twice its largest size on stage (*Resolution* 2×, the default: sharp on HiDPI screens and when
the SVG is shown at twice its size; 1×, 1.5×, 3× or *Every pixel* are the other choices). Every
frame and nesting level counts, so a bitmap is never written smaller than it is shown. It is
still drawn at its full size, so nothing moves. Pixel art (no *Allow smoothing*) and repeating
bitmap fills keep every pixel, and so does a bitmap whose smaller file wouldn't be smaller (flat
gradients); tick *Full* in the bitmap list for others. A 12-megapixel photo shown at 20 %: JPEG
1042 KB → 100 KB, AVIF 133 KB → 13 KB, and the export gets faster (fewer pixels to encode).

The result section lists the format, pixels and size of every bitmap.
The encoders are WebAssembly builds of the Squoosh codecs, loaded only when a document has
bitmaps (the sound codecs likewise: LAME, libopus, mpg123).

### Sounds

Frame sounds play in the **JS player** format, with Animate's sound settings: *Event*, *Start*,
*Stop* and *Stream* sync, *Repeat* and *Loop*, the effects and custom envelopes (*Edit sound
envelope*: volume and panning), in and out points, sounds in movie clips and on button states.
Stream sounds follow the playhead, also after `gotoAndPlay()` or a pause.

| | Formats | Notes |
|---|---|---|
| Compressed | **MP3** (default), **Opus** | Bit rate from Animate's MP3 setting (otherwise 128 kbps stereo / 64 mono, less for low sample rates), or one for all. Opus sounds as good at half the bit rate; it plays in all current browsers, Safari from 18.4. Imported MP3s at their own quality stay byte for byte. |
| Uncompressed | **WAV** | Sounds set to *Raw* in Animate (at its sample rate), or chosen per sound. |

Every sound is cut to the part the frames play: Animate pads its sounds with silence (a 0.4 s
beep came out as a 3.7 s file). *Convert stereo to mono* is followed. Browsers block sound until
the visitor clicks or presses a key: until then the sounds run on silently and join at their
position (a long one starts in the middle). In SMIL and CSS output sounds don't play (warned).

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

**Smooth with big scenes:** the JS player hands tweened transforms and alpha to the browser as
Web Animations, which run on the compositor: the artwork stays rastered and is only moved, so
the page doesn't repaint it every frame. A test scene of 150 tweened instances of a detailed
drawing ran at 1.2 fps before and runs at about 110 fps now. Symbols with hairlines (strokes
thinner than a pixel, which keep their width) are moved by the player as before: their outline
changes with every transform. The player also rests while it is out of view or in a background
tab and goes on where it was (one whose sound is on keeps playing, like a video).

**Reduce motion:** visitors who turned animations off in their system settings
(`prefers-reduced-motion`) see the poster frame, still — SMIL and CSS output, and the JS player
until it is clicked (*Still poster for “reduce motion”* in the panel, on by default;
`--ignore-reduced-motion`). For SMIL this adds a still copy of the poster frame (it shares the
drawings; a few percent of the file). Browsers apply the setting to `<img>` images too; to be
sure, offer a still picture with `<picture><source media="(prefers-reduced-motion: no-preference)" srcset="hero.svg"><img src="hero-still.svg" alt="…"></picture>`.

**Shape tweens as morphs:** in SMIL and the JS player a shape tween is one drawing whose paths,
colours and gradients blend from the start to the end shape, instead of a drawing per frame.
Animate's in-betweens are exactly such blends; the exporter matches up the frames Animate writes
(contours started at another point, curves written as lines, holes in another order, edges that
shrank to nothing left out), fits the start and end shape to all of them and checks every frame
against Animate's drawing. Frames that don't fit stay drawings of their own. Files get much
smaller and the shape moves smoothly between frames: a 119-frame shape tween takes 12.7 KB
instead of 75.5 KB as SMIL (2.4 instead of 17 KB gzipped). CSS output keeps a drawing per frame
(Safari can't animate paths with CSS). `--no-morph` turns it off.

### Lottie

*Lottie* writes a `.json` file, *.lottie* a dotLottie archive: the same animation and its bitmaps
in one compressed file. Play them with [lottie-web](https://github.com/airbnb/lottie-web), the
dotLottie players (web, iOS, Android, React, Flutter — all drawn by ThorVG), Skottie, or Airbnb's
lottie-ios / lottie-android.

- Symbols become precompositions and keep their eases as Lottie keyframe curves; movie clips that
  loop are drawn once and played again by a time remap; frame scripts (`stop()`,
  `gotoAndPlay()`…) are followed like in SMIL; frame labels become markers (play a part with the
  player's marker or segment API).
- Masks become track mattes, shape tweens animated paths, colour effects (tint, brightness,
  advanced, alpha) apply to the colours of the shapes inside, as in Flash; bitmaps are image
  assets — embedded, next to the JSON (*Embed images* off), or inside the .lottie.
- Only what the Lottie specification has is used, so every player shows the same: each test
  document is checked frame by frame in lottie-web, dotLottie and Skottie against the SVG output,
  and validated with the official schema.
- Not in Lottie (warned): filters are left out; the *subtract* and *add* blends are drawn as
  multiply by the inverted colours and as screen (close, not exact); sounds, button states and
  editable text (text is outlined) are not exported; hairlines keep the width they have at the
  scale their symbol starts with; bitmaps without smoothing are drawn smoothed. Looping and
  autoplay are settings of the player; if the main timeline ends on `stop()` while movie clips run
  on, set it to play once.
- dotLottie (ThorVG) draws a few things differently (measured): thin seams between the tiles of a
  repeating bitmap fill, faded edges where a clipped bitmap fill stretches its edge pixels, pixel
  art smoothed.
- Size: Lottie JSON is wordier than SVG, but compresses as well — the 45 test documents take
  1347 KB as Lottie and 1022 KB as SMIL, gzipped 368 KB and 369 KB; as .lottie archives 391 KB.

```js
// lottie-web (frame labels are markers: goToAndPlay("intro", true))
lottie.loadAnimation({ container: document.getElementById("hero"), renderer: "svg", loop: true, autoplay: true, path: "hero.json" });
// dotLottie (npm @lottiefiles/dotlottie-web)
new DotLottie({ canvas: document.querySelector("canvas"), src: "hero.lottie", loop: true, autoplay: true });
```

## Command line

The panel's compiler also runs in Node (24+, tested with 26 LTS): it turns the scene data the extractor writes into
SVG, so you can re-export with other settings without Animate.

```bash
node dist/cli/flash2svg.js path/to/scene.json -o out.svg --format css --loop always
node dist/cli/flash2svg.js scene.json --image-lossy avif --image-lossless webp --image-mode "logo.png=lossless"
node dist/cli/flash2svg.js scene.json --image-resolution 1 --image-full "poster.jpg"
node dist/cli/flash2svg.js scene.json --format player --sound-format opus --sound-mode "click.wav=lossless"
node dist/cli/flash2svg.js scene.json --format lottie        # scene.json → <document>.json
node dist/cli/flash2svg.js scene.json --format dotlottie -o hero.lottie
```

`--help` lists all options. After the export it prints what the size is made of (drawing,
animation, images, sounds, runtime). (The panel keeps no scene data by default; the e2e tests
write it to `tests/out/<name>/model/`.)

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
- Shape tweens: CSS output draws them frame by frame. Animate draws a shape tween's keyframe a
  little differently from the start of its morph (it re-approximates curves): if they differ by
  more than a quarter pixel, the keyframe stays a drawing of its own for that frame. A shape
  that splits into several looks different in Animate's preview than in its SVG export (the
  export fills the in-betweens); the export is what we get.
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
- Lottie: filters, sounds, button states and editable text are not exported; *subtract* and
  *add* are approximated; see [Lottie](#lottie).

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
it export a set of fixtures through the real Export path and uninstalls it again. See [docs/architecture.md](docs/architecture.md); planned features: [docs/roadmap.md](docs/roadmap.md).

## Credits

Flash2SVG was created by Thomas Byrne and David Belais. Version 4 is a rewrite in this fork.
MIT licensed — see [LICENSE](LICENSE).
