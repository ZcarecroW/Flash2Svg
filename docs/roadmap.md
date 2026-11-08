# Roadmap: making Flash2SVG more powerful

Master plan from the technology research of 2026-10-30 (SVG animation tools, formats and browser
support). Status markers: ✅ done · 🚧 in progress · ⬜ open · ❌ measured, not built (the reason is given). Re-check versions and browser
support (sources below) before starting a package.

## Findings

**Comparable tools**
- **SVGator** exports:
  - native animated SVG that needs no player, and SVG with a JS player and API
  - Lottie, GIF, video and mobile code
  - interactions (click, hover, programmatic) without an external library

  Interactivity and Lottie export are paid features.
- **Lottie / dotLottie** is the standard for vector animation in apps.
  - dotLottie is a ZIP archive with the assets inside.
  - Since 2025 it has built-in state machines with hover, click and scroll triggers.
  - It needs a player of about 35–45 KB (min+gzip) or 150 KB including WASM, depending on how it is measured.
- **Animate has no Lottie export.** Bodymovin and the LottieFiles plugin exist only for After Effects, so this is a real gap for Flash2SVG to fill.
- **Rive** uses its own binary format with state machines. The size comparisons between Rive and Lottie are vendor claims.
- **Keyshape** exports:
  - SVG with CSS animations, or SVG with its JS library (KeyshapeJS) and an API
  - GIF, APNG, animated WebP, MP4 and sprite sheets
- **GSAP**, including MorphSVG, has been free since 2025. Its licence forbids use in visual animation-building tools without Webflow's permission, so it cannot be Flash2SVG's runtime.

**Browsers (2026)**
- **SMIL**:
  - It still works everywhere, and it is the only format with complex timing inside `<img>`.
  - Chrome's 2015 intent to deprecate it was never carried out.
  - Safari does not GPU-accelerate SMIL transforms, whereas CSS and WAAPI transform/opacity animations run on the compositor.
- **CSS `d: path()`** for path morphing does not work in Safari. SMIL can animate `d` in every browser.
- **CSS easing and paths:** `linear()` easing is Baseline (since December 2023), and `offset-path` is widely available.
- **Scroll-driven animations** (`animation-timeline`) work in Chrome, Edge and Safari 26. Firefox still needs a flag; they are an Interop 2026 focus area.
- **Images:** AVIF ~93 %, WebP ~96 %. JPEG XL is coming back (Safari 17+, newer Chrome and Firefox) but is not universal yet.
- **Audio:** Opus compresses best, but Safari supports it only from 18.4 and with gaps. MP3 or AAC are the safe choice.
- **Video:** list AV1 in MP4 first with H.264 as the fallback. Safari plays AV1 only on devices with a hardware decoder.

## Packages (by priority)

| # | Package | Benefit | Effort | Status |
|---|---|---|---|---|
| 1 | Media encoding settings | very high | medium | ✅ images, downscaling, audio, budget view, fonts, video components |
| 2 | Player: compositor animations, pause off-screen, reduced motion | high | small | ✅ (canvas renderer measured, not needed) |
| 3 | Shape tweens as path morphing (SMIL and player) | very high for shape tweens | medium–high | ✅ (also gradients that turn) |
| 4 | CSS: `linear()` easing, individual transform properties | medium | small–medium | ✅ (also decimals from the displayed size, .svgz) |
| 5 | Interactivity: triggers, scroll, label state machine | high | medium | ✅ |
| 6 | Lottie / dotLottie export | very high (reach) | high | ✅ (effects, built filters, state machine, panel preview, tinted bitmaps, loop seam, labels as states, shared tiles) |
| 7 | WOFF2 fonts, video, library export | medium | medium | ✅ accessibility, scale modes, automatic format, library symbols, scenes, web component, GIF/WebP fallbacks |

### 1. Media encoding settings
- ✅ **Images:**
  - Lossy bitmaps (*Photo (JPEG)*) can be written as JPEG, WebP or AVIF.
  - Lossless bitmaps can be written as optimised PNG or WebP lossless, pixel for pixel.
  - Animate's compression setting is the default, and the panel can override it per bitmap.
  - The quality comes from Animate or is one value for all bitmaps.
  - Transparent photos are written as WebP, and small pictures stay lossless when that is smaller.
  - The codecs (jSquash WebAssembly) load only on demand.
  - Code: `src/core/images.ts`, `src/core/codecs.ts`; test document f42.
- ✅ **Auto downscaling:**
  - Each bitmap is limited to its largest size on stage × *Resolution* (default 2×; 1×, 1.5×, 3×, every pixel; *Full* per bitmap).
  - The size comes from every frame and level: nested symbols, tween samples, layer parenting, the camera, bitmap fills and shape-tween frames (`src/core/bitmap-scale.ts`).
  - Resampling: Lanczos 3 with premultiplied alpha (`@jsquash/resize`, 34 KB WebAssembly).
  - Pixel art, repeating fills and pictures whose smaller file wouldn't be smaller keep every pixel.
  - Bitmaps that are never drawn aren't encoded at all.
  - A 12-megapixel photo at 20 %: JPEG 1042 → 100 KB, AVIF 133 → 13 KB, and the export is faster.
  - Test document f44.
  - On the way: every place a bitmap was drawn embedded its own copy; now each bitmap is in the file once (the image test document's player export: 432 → 224 KB).
  - Not done: crisp pixel art at non-integer scales; downscaling for older models without lossless masters.
- ✅ **Audio:**
  - MP3 (LAME) or Opus (libopus, Ogg muxer of our own) for compressed sounds, WAV for uncompressed ones; bit rate from Animate's MP3 setting, one for all, or a default scaled to the sample rate (Opus at half).
  - Animate's compression setting per sound as the default (Raw = WAV at its sample rate, convert to mono), per-sound override in the panel; imported MP3s at their own quality stay byte for byte.
  - Cut to the real length (Animate pads its WAVs with silence) and to the range the frames play. Embedded or linked.
  - Player: Web Audio mixer (in/out points, gapless loops, envelopes, stream sounds on the playhead, button sounds); sounds run on the player clock, so blocked autoplay and decoding delays don't break sync; `<audio>` fallback.
  - The test sound document: 886 KB of WAV → 64 KB MP3 / 41 KB Opus. Encoding 3 min stereo: MP3 2.2 s, Opus 1.8 s.
  - Code: `src/core/audio.ts`, `src/core/audio-codecs.ts`, the Mixer in `src/player/runtime.ts`; test document f43.
  - Not done: AAC (no small WebAssembly encoder without FFmpeg; Opus already beats it in size, MP3 in reach); a gapless header (LAME tag) in our MP3s — the player compensates the delay instead; trimming silence inside a sound; encoding in a worker (the panel waits ~2 s for a 3-minute song).
- ✅ **Video:** video components (FLVPlayback, Canvas Video) as `<foreignObject><video>` in every SVG format, the linked file copied along, muted autoplay, loop/controls/poster from the component (f51, f52; `scripts/e2e-video.ts`). Not done: transcoding (AV1/H.264: no encoder without FFmpeg; the linked file is kept as it is) and video embedded in the timeline (FLV).
- ✅ **Fonts:** dynamic and input text with its installed fonts embedded as WOFF2 subsets (`src/core/fonts.ts`; harfbuzzjs subsetter without hinting, woff2-encoder; name-table index of the font folders; fsType respected), laid out by the fonts' metrics (Animate's baselines, multiline wrapping; within 1–2 px). Test document f49.
- ✅ **Budget view:**
  - After an export the panel shows a bar of what the size is made of: drawing, animation, images, sounds, the player's script and linked files.
  - *Biggest drawings* lists the symbols and layers whose shapes take the most, next to the lists of bitmaps (format, pixels, size) and sounds.
  - The command line prints the same split.
  - The parts are measured while the file is written, so the overview costs no extra time.

### 2. Player: smaller and faster
- ❌ Embed the program data compressed (`DecompressionStream`). Measured: the JSON shrinks by 60–90 %, the file by up to 24 %, but web servers compress SVG anyway (gzip/Brotli) and then the transfer gets slightly *bigger* (Brotli 14.3 → 15.4 KB for f17), plus unpacking time. Not worth it; `.svgz` (package 4) is the better tool for files on disk.
- ✅ Transform and opacity as Web Animations on the compositor:
  - Measured first (Edge 156): SVG groups with WAAPI transform/opacity animations get compositor layers (`ActiveTransformAnimation`). Animations driven from script (setting the time every frame, or CSS transform + `will-change`) are re-rastered at every scale change and gain little.
  - So the player creates real, running animations per instance (keyframes from the tracks: the transform as `translate rotate skewX scale translate`, CSS easing per segment when all tracks share it, else 4 samples a frame) and only sets their start time when a timeline jumps. `play()` would start them a frame late (looks like a drift); setting `startTime` takes effect at once.
  - Hairlines (`vector-effect: non-scaling-stroke`) change with every transform, the browser can't keep them rastered: symbols drawing them (`PTimeline.hl`) are moved as before.
  - Heavy test scene (150 tweened instances of a detailed drawing): 1.2 fps → ~110 fps.
- ✅ Pause automatically when not visible (IntersectionObserver, `visibilitychange`); players with sound on keep playing out of view.
- ✅ `prefers-reduced-motion`: SMIL (still copy of the poster frame), CSS (`animation: none`), player (poster frame until a click). In `<img>` the browser applies the system setting (DevTools emulation doesn't reach images).
- ❌ Optional canvas renderer for very large scenes: measured first (Edge, frame cap off) with the stress test's layers multiplied: 40 / 320 / 1280 / 2560 tweened instances 86 / 83 / 79 / 59 fps, ~5000 at 25 fps. A canvas renderer would have to redo masks, filters, blend modes, gradients and text (a second SVG renderer in the runtime) for scenes beyond what Animate documents usually hold: not built.

### 3. Shape tweens as path morphing
- ✅ SMIL `<animate attributeName="d">` (plus colours, gradients, stroke widths) and the player blend one drawing instead of a drawing per frame. CSS keeps frames because Safari lacks CSS `d`.
  - Found first: Animate's in-betweens are exact linear blends of start and end with the eased ratio (f05: 0.03 px off, the twip rounding), but its SVG export writes every frame anew. `core/morph.ts` matches them up (lines as curves, contours restarted/turned, holes reordered, edges that shrank to nothing put back), fits start and end by least squares and checks every frame; frames that don't fit stay drawings.
  - Classic and custom eases give the ratio; other eases get each frame's ratio from the shapes. Radial gradients blend in a canonical form; Linear RGB stops are kept per frame.
  - SMIL: looping movie clips repeat the morph values with every loop on the global clock (f45: 334 → 587 KB at first); tracks that repeat are now written once with their own repeating timing (→ 104 KB).
  - Sizes (SMIL): f05 13.3 → 2.3 KB, f39 (119 frames) 75.5 → 12.7 KB, gzip 17.0 → 2.4 KB; player f39 61.6 → 21.1 KB. Stepped output 20–47 % smaller (gzip about the same).
  - Keyframes inside symbols (Animate re-centres them: an extra group) join the morph by box and colours. A keyframe Animate draws more than a quarter pixel off its morph start stays its own drawing.
  - ✅ Gradient matrices that turn while blending: SMIL animates translate, rotate, skewX and scale from the decomposition at every frame, each simplified (f53: 29.3 → 5.3 KB, exact in Edge, Firefox, WebKit). Pattern matrices that turn keep frames: measured, WebKit draws an animated turned and scaled pattern off (static equivalents render alike).

### 4. Leaner CSS
- ✅ `linear()` easing (`src/core/emit/keyframes.ts`): keys on one line in value space (frame-by-frame samples, stepped output, multi-piece eases) become one keyframe pair with a `linear()` timing function where that is shorter.
  - Measured first in Edge 156, Firefox 159 and WebKit 27.2: flat stretches (two positions), jumps (equal positions, also clamped `0%`), outputs outside 0..1, 200 points, positions left out (spread evenly) all behave alike.
  - Animate's multi-piece custom eases mostly stay `cubic-bezier()` pieces: exact and shorter than sampling them within a printed step. The bigger wins are elsewhere: the timing most keyframes use is the animation's own (stepped CSS no longer repeats `step-end`), equal keyframes share a rule, and samples collapse into `linear()`.
- ✅ Individual properties `translate`, `rotate` and `scale` (plus `transform` for a skew and the transformation point): an instance is one element, its tweens one or a few animations. Tracks with different key times merge exactly (`alignTracks`).
  - WebKit lets `transform:none` fall back to the `transform` attribute (WebKit bug 217286, still open), so the keyframes hold `transform:scale(1)` in place of the poster attribute.
  - Safari 16 was reported to mishandle separate `rotate` and `scale` on SVG elements; WebKit 27.2 draws all 46 test documents right.
  - The 46 test documents: CSS 1737 → 1295 KB (gzip 459 → 427), stepped 2042 → 1375 KB (490 → 444); playback costs Edge the same or less (style recalculation −2 to −19 %).
- ✅ `.svgz` (`ExportSettings.svgz`, `--svgz`) and a server compression note (Brotli) in the README. Tested: Edge, Firefox and WebKit show .svgz only with `Content-Encoding: gzip` from a server (not from disk, not with only the type); Brotli of plain SVG is 8 % smaller than .svgz (341 vs 372 KB for the test documents as SMIL).
- ✅ Decimal places from the displayed size (`src/core/precision.ts`): coordinates get as many as they span on screen (rounded on the log scale), angles and scale factors too but never fewer than 3 and 4; drawings those of the largest scale they are shown at.
- ❌ SMIL merging an instance's animated parts (`additive="sum"`): measured, the nested transform wrappers it would remove are 2 KB of 1100 KB (0.2 %, gzip ~1 KB) — not worth the sandwich-order risk with tails.

### 5. Interactivity without code
- ✅ Start triggers: hover and click (before), *when visible* (half on screen): SMIL and CSS hold the animation with a few lines of script (IntersectionObserver), so it still plays where scripts don't run; the player starts on its first sight (`src/core/emit/triggers.ts`).
- ✅ Scroll scrubbing (*on scroll*: while fully visible = `contain`, while crossing = `cover`, or the page's scroll):
  - Measured first: Edge 156, Firefox 159 (now on by default) and WebKit 27.2 run scroll-driven animations alike, a named `view-timeline` on the `<svg>` drives its children, and time durations and delays map onto the range proportionally per animation (so every animation keeps the export's length, played once). The `animation` shorthand resets `animation-timeline`: the timeline rule comes after the animation rules.
  - CSS: the browser's timeline inline in a page that scrolls normally; elsewhere (an `<object>`, inside a box with `overflow: hidden` — the view timeline then follows that box and stands still —, browsers without scroll timelines) a script sets the time (2026-11-01). SMIL and the player: a script sets the time from the position (the same ranges), also in an `<object>` of the same origin; alone or in `<img>` it just plays. The player scrubs forward step by step and replays from the start backwards (7 ms a frame for 150 tweened symbols).
  - `scripts/e2e-triggers.ts`: frames at scroll positions against the static frames, inline and in an `<object>` (served over HTTP), in Edge, Firefox and WebKit.
- ✅ Animate's code snippets (`src/core/snippets.ts`): mouse handlers in AS3 and Canvas syntax (named functions, `.bind(this)`, `.on()`, function literals, arrows) on this timeline or named instances; in the handlers goto/play/stop/next/previous frame on this timeline, the root, the parent or named instances, `visible`, web pages. The player runs them (a build with the handler code only when needed: 14.6 → 17.4 KB); SMIL/CSS/frames turn web pages into SVG links. Their jumps had been mistaken for frame actions. Test document f47.
  - Found on the way (player): a `stop()` on frame 1 was overridden by the automatic start, and movie clips created at the start or after a jump skipped their first frame's script.
- ✅ Labels as states and buttons as transitions: the player through the code snippets and its API; dotLottie through its state machine (`src/core/interactive.ts`).

### 6. Lottie / dotLottie export
- ✅ Formats *Lottie* (JSON) and *.lottie* (dotLottie v2: manifest, `a/`, bitmaps in `i/`; fflate), written from the baked timeline like SMIL (`src/core/emit/lottie.ts`, `src/core/dotlottie.ts`).
  - Researched first (Lottie spec 1.0.1, dotLottie 2.0, the players) and measured in three players before writing it: the transform mapping (`sk` = −skew) is pixel-exact; precomps clip to their box; lottie-web hangs without `o` in group transforms and needs `st` on every layer and `x` on masks; a group without `tr` crashes lottie-web and dotLottie.
  - Symbols are precompositions, drawings shape layers (quadratic curves as exact cubics), gradients exact (elliptical radials in their own space, repeat/reflect as copied stops), bitmaps image assets, repeating bitmap fills tiles under a matte, masks and alpha/erase track mattes, shape tweens animated paths and gradients, labels markers.
  - Colour effects and per-shape alpha are pushed into the shapes' colours (Flash colours each shape; a tinted, half-transparent symbol then matches Animate better than our SVG, which colours it as a group). Invert is exact (difference with a white copy); subtract and add are approximated (multiply by the inverted colours, screen).
  - Repetition: looping movie clips stretch the baked horizon to the common multiple of their loops and repeat their keys; content that repeats is written once and played by a sawtooth time remap (repeats found by comparing tracks as curves where they show). The morph test document 2.2 MB → 251 KB, groups 684 → 15 KB, stress 448 → 186 KB.
  - Hairlines keep their width in pixels at the scale their symbol starts with.
  - Tests: `scripts/e2e-lottie.ts` (schema validation; lottie-web, dotLottie/ThorVG, Skottie frame by frame against the SVG frames, Animate's own frames as arbiter), unit tests, panel self-test jobs in Animate.
- ✅ Filters as Lottie layer effects: blur → Gaussian blur, drop shadow and glow → drop shadow (keyframed when animated), adjust colour → a colour matrix in the paints.
  - Measured per player first: blur factor (σ = 0.3 × blurriness in all three; lottie-web uses softness / 4 for shadows; ThorVG blurs narrower: two of three box passes, quality setting has no effect), angle (clockwise from up), opacity (0–255), and where effects apply (lottie-web, ThorVG: the layer's own space; Skottie: the composition's). ThorVG clips effects to the precomp and fades a layer before its effects; lottie-web clips drop shadows to the bounding box. Hence effects on an untransformed wrapper precomp with room and a transparent box, alpha one level up.
  - Effect values carry After Effects' names (lottie-android reads drop shadows by name).
  - Filter test documents, worst frame: 2.8 % → 0.03 %, 0.45 % → 0.01 %, 0.8 % → 0.00 %.
- ✅ dotLottie state machine (`s/playback.json`): follow the timeline (intro once, then the tail), loop or play once; start automatically, on click, on hover or from script (event `play`), poster until then, restart on the next click. Markers `intro` / `loop` also in Lottie JSON. dotlottie-rs plays marker ends inclusive: markers in .lottie end a frame earlier. `scripts/e2e-statemachine.ts`.
- ✅ Lottie preview in the panel: lottie-web or dotLottie (separate bundles loaded on demand), state machine with clicks; checked inside Animate by the panel self-test.
- ✅ The filters without a Lottie effect, built from track mattes, blend modes and blur / Tritone effects: inner, knockout and *hide object* shadows and glows, strong or unevenly blurred ones, bevels (exact clamped difference: lighten, then difference), gradient glows and bevels (Tritone lookup at 0, 50, 100 %); strength as a colour-dodge gain. Exact in lottie-web and Skottie except gradients with other stops.
- ✅ Colour effects on bitmaps: tint and brightness as Lottie's Fill effect (colour, opacity = amount, keyed), exact in all three players (f50); other colour effects alpha only (warned).
- ✅ A seamless loop seam in dotLottie: one more frame holding the last (op + 1, layers that run to the end extended), markers over their full length; loop periods measured exact.
- ✅ Labels as states, buttons as state machine interactions (`src/core/interactive.ts`): the whole root timeline in the .lottie (a frame range bakes it in order), states from frame 1 and every jump target, Click interactions on the buttons' layers, OpenUrl; one-frame states are stills (dotLottie plays everything for a zero-length segment).
- ✅ Shared tile grids for frame-by-frame bitmap fills: tiles in the pattern's space, one precomp per pattern content and range, placed by the pattern transform (f45: 250 → 141 KB, 901 → 258 image layers). Measured: snapping ranges to share more grids made single fills bigger than it saved.

### 7. More
- ✅ Responsive scale modes like Flash (show all, no border, exact fit; `scale`, `--scale`), letterbox in the stage colour; a transparent background was there already (*Background* off).
- ✅ Accessibility: `<title>`, `<desc>`, roles and `aria-label` from Animate's Accessibility panel (document, instances, buttons with shortcut and tab index, *Make object accessible* off → `aria-hidden`), static text outlines labelled with their words, keyboard use of click handlers in the player; checked in the browser's accessibility tree (f48).
- ✅ Export library symbols as separate SVGs (icon workflows): *Source: Selected library symbols* (one file each) was there already.
- ✅ Export several scenes: *All scenes in a row* joins them into one timeline (`src/core/scenes.ts`; frame numbers, scene jumps, next/previous scene, labels per scene).
- ✅ A web component (`<flash2svg-player>`, `src/web/flash2svg-player.ts`, 1.7 KB) with lazy loading: inline SVG (no shadow root: the player finds its svg through `document.currentScript`), scripts recreated so they run.
- ✅ Raster fallbacks: animated GIF (gifenc) and animated WebP (own muxer, changed rectangles), `src/core/raster.ts`; resvg-wasm in the CLI, the browser in the panel; `scripts/e2e-raster.ts`. (MP4 / AVIF sequences: not done — no small encoder without FFmpeg; WebCodecs could do H.264 in the panel.)
- ✅ Pick the format automatically (`auto`): the player for sounds / mouse handlers, else CSS unless SMIL is more than 15 % smaller (test documents: CSS 40, SMIL 5, player 3).

## Part 2: every Flash feature (research of 2026-11-01)

Goal: everything a Flash/Animate document can do comes out of Flash2SVG — exactly where the
format allows it, otherwise as close as possible and warned. Animate is in maintenance mode at
2024 (24.0.x, no new features), so the target is fixed. Feature list from Animate's
documentation and release notes (2017–2024: camera, layer depth, layer parenting, layer effects,
Asset Warp with bones, Flexi bones and the envelope deformer, modern rigging, frame picker and
auto lip-sync, last-frame looping), the Code Snippets panel and Flash Player itself. For
comparison: Ruffle (a Flash Player in WebAssembly) runs ActionScript 3 at roughly 90 % of the
language and 80 % of the API after years of work — a whole AS3 virtual machine is not the goal,
the AS3 that Animate users actually write is.

### Where we stand
| Area | Status | Notes |
|---|---|---|
| Shapes, gradients (focal point, spread, linear RGB), bitmap fills, stroke styles | ✅ | checked against Animate's frames |
| Stroke scale *Normal* under uneven scale, *Horizontal*, *Vertical* | ✅ | a round pen, as measured (`src/core/pens.ts`, f83); scale that changes over time keeps the plain stroke |
| Variable-width strokes | ✅ | come through Animate's SVG export as outlines: 0.00 % in f70, on scaled symbols and in shape tweens |
| Art and pattern brushes, fluid brush | ✅ / ❓ | art and pattern brushes 0.00 % (f101, brushes of our own as XFL); the fluid brush: no document to check (it needs a pen; Animate's samples have none) |
| Static, dynamic, input text; fonts embedded | ✅ | input text is a real field in SMIL, CSS and the player |
| Bitmaps, smoothing, compression, downscaling | ✅ | |
| Filters (all 7), colour effects, blend modes, layer effects | ✅ | tweened filters: one filter whose numbers change in the player (package 9); SMIL and CSS a `<filter>` per frame — cheaper to draw in Chromium, compresses well (filters demo 284 KB, 19 KB gzip) |
| Masks, 9-slice | ✅ | 9-slice with animated scale and nested symbols too (f100) |
| Classic and motion tweens, eases, shape tweens with hints | ✅ | |
| Motion guides, orient to path, motion-tween paths | ✅ | guides as paths (package 8); motion tweens, bent paths and the pace along guides as curves through Animate's frames (package 21, f99) |
| Graphic looping, frame picker, lip sync, movie clips, scenes | ✅ | SMIL/CSS: clips with unrelated loop lengths jump at the repeat (player exact) |
| Layer parenting, modern rigging (scale/skew/flip) | ✅ | f65 |
| Camera pan, zoom, rotate, depth; layer depth (parallax), attached layers; colour effects | ✅ | f61, f62, f82 |
| 3D rotation and translation (perspective) | ✅ | `src/core/persp.ts`: a flat transform plus a CSS `matrix3d` on HTML in a `foreignObject`; Lottie flat (warned) |
| IK armatures (bones on symbols and on shapes) | ✅ | baked in the working copy (f67–f69): 0.00 % |
| Asset Warp | ✅ | as Animate's warped bitmaps (f71–f73) |
| Flexi bones, envelope deformer; warps with "Auto convert vector to bitmap" off | ✅ / ❓ | vector warps fixed and checked on Animate's own samples (bicycle, jellyfish with warp bones, robot, mantis: 0.00–0.08 %); no document of our own (the warp data is binary, the tool needs its panel); Flexi bones and the envelope deformer are warps drawn the same way, not seen in a document |
| Sounds | ✅ | player, SMIL, CSS, MP4, WebM; Lottie JSON on request |
| Video components / video in the timeline | ✅ / ⬜ | embedded FLV: warned, see package 16 |
| Buttons (states, Hit frame), links, start triggers, scroll | ✅ | e2e-hit: a real mouse in three engines; Lottie: its art is the hit area |
| Frame scripts | ✅ | run in the JS player (package 12); SMIL, CSS and Lottie keep `stop`/`play`/`goto`/counters (warned) |
| Code snippets | ✅ | all of them run, AS3 and HTML5 Canvas, tested one by one (`tests/out/snipsmoke.ts`, the snippets' text isn't committed) |
| ActionScript in general (variables, conditions, loops, Math, properties) / Canvas JavaScript | ✅ | package 12; 392 lines identical to Flash Player, 57 to CreateJS |
| Document class, classes in `.as` files | ✅ | package 17 (Part 3) |
| UI components (Button, CheckBox, ComboBox, … ; Canvas components) | ✅ | real HTML controls; TileList, ScrollPane, UIScrollBar and the jQuery UI components since package 19 |
| *Export as bitmap* / *cache as bitmap* on instances | ✅ | drawn as vectors: measured the same (f84: 0.00 %) |

### Packages, in the suggested order
| # | Package | Benefit | Effort | Status |
|---|---|---|---|---|
| 8 | Motion along paths: motion guides and motion-tween paths as real paths (SMIL `animateMotion` with `keyPoints` and `rotate="auto"`, CSS `offset-path`, the player, Lottie position keys with spatial tangents) | smoother (any frame rate), smaller; the user's request | medium | ✅ motion guides (SMIL, CSS, Lottie); ⬜ motion tweens (see below) |
| 9 | Animated filters as animated filter primitives (SMIL and player animate `stdDeviation`, `dx`, `slope`, colours; CSS keeps a filter per frame where nothing else is exact) | filter animations ~10× smaller | medium | ✅ player (one filter per tween); SMIL/CSS measured and kept (see below) |
| 10 | Measure-first sweep: a test document each for IK (symbols, shapes), Asset Warp (bitmap and vector, Flexi bones, envelope), layer depth with the camera, modern rigging, variable-width strokes and brushes, input text, button hit areas, 3D — extracted and compared with Animate's frames; fix what breaks | turns every ❓ into ✅ or a known gap | medium | ✅ but brushes (see below) |
| 11 | Bones and warps: whatever 10 finds missing (poses baked to transforms like guided tweens; deformed shapes as morphs or frames) | rigged characters export | medium–high | ✅ done in 10 |
| 12 | Scripts in the player: Animate's AS3 (a subset compiled to JavaScript at export: variables, conditions, loops, functions, Math, display-object properties, events — mouse, keyboard, `ENTER_FRAME`, timers, drag and drop, text, sounds) and Canvas documents' JavaScript (run as it is, on a CreateJS-like `this`); every code snippet Animate offers that a browser can do; what can't be compiled is warned | interactive pieces, simple games | high | ✅ (see below); all snippets but FLVPlayback's |
| 13 | Remaining appearance: camera colour effects, stroke scale *Horizontal*/*Vertical*, 3D with real perspective where the format allows (measure: CSS 3D, Lottie 3D layers), *Export as bitmap* | fidelity | medium | ✅ (see below) |
| 14 | Sounds outside the player: SMIL/CSS with a few lines of script (inline, `<object>`), Lottie audio layers where players support them | sound everywhere a script runs | medium | ✅ (`src/player/soundtrack.ts`; audio layers on request: only lottie-web with Howler plays them) |
| 15 | Input text and UI components as real HTML controls (`<foreignObject>`), working in the player | forms, quizzes | medium | ✅ (`src/player/control-markup.ts`, `parts/controls.ts`; `scripts/e2e-typing.ts` posts real keys and clicks to Flash Player's window; TileList, ScrollPane, UIScrollBar warned) |
| 16 | Video: MP4/WebM export through WebCodecs in the panel, APNG; video embedded in the timeline if Animate can hand over its frames | social media, lossless with alpha | medium | ✅ MP4, WebM with sound (`src/core/video.ts`, `mux.ts`), APNG, FLVPlayback in scripts (`parts/flv.ts`). Embedded video stays warned: only FLV can be embedded, browsers can't play it, Animate hands over no frames |

**8. Motion along paths** (2026-11-01): classic tweens on motion guides follow the guide's curve
in SMIL (`animateMotion`), CSS (`offset-path`) and Lottie (spatial tangents); 42–59 % smaller,
exact at every frame (`src/core/motionpath.ts`, test document f60). Open: *motion tweens* —
their XML (`getMotionObjectXML`) holds only X and Y as separate curves over time (anchor and
handles per key), no path geometry: fit those curves exactly instead of sampling the frames
(fewer keys for every motion tween), and bent motion-tween paths (no way found to make one from
JSFL to measure it: a curve fitted through the frames). The JS player could move along the curve
with `offset-path` in its Web Animations too. Firefox's SMIL draws f09 wrong far into the loop
(~8 minutes, before this package too).

**22. Unverified features** (2026-11-08): 9-slice symbols whose scale is animated now keep their
9-slice with nested symbols inside, and nested graphics scale normally as Animate draws them
(f100; it showed the old rule, graphics sliced, was a guess). Art and pattern brushes: their XFL is
readable (`PaintBrushDefinitions.xml`: per brush JSON parameters with the art as SVG;
`PaintBrushStroke paintBrushDefinition=…`), so f101 has brushes of our own; they come through
Animate's SVG export as outlines (0.00 %). Animate ships samples (`Common/Configuration/Samples`,
`Coachmark/workflows`; read locally, never committed) that showed three bugs: vector warps (Asset
Warp without bitmap conversion) came out empty, since their frames are shapes worked out on drawing
that a frame copy loses — now each is drawn alone in a scratch scene of the working copy and exported
(`exportWarpFrame`); a pasted raw shape listed as several elements stopped the export (Hippo); a
long export stopped on Animate's "script running a long time" question (mantis). Also found: the SMIL/CSS
horizon of a looping root ignored clips nested in clips and graphics. Not possible: an own
vector-warp document (pins and mesh are binary or need the tool's panel, whose tabs ignore
synthetic clicks; a hand-written puppet drew nothing), a fluid-brush one (needs a pen). Animate
hangs on quit after documents with warps or XML-edited motion tweens (robot, Hippo, f99): for 25.

**21. Motion as curves** (2026-11-08): motion tweens, armatures, the camera, layer depth, guided
paces and classic tweens whose ease Animate's settings don't describe were written as Animate's
frames simplified to straight pieces; now cubic timing functions are fitted through the frames
(least squares, Levenberg-Marquardt with an analytic Jacobian): keys at turning points (between
frames where the peak is smooth), a group moving along straight lines keyed together (x/y, a
uniform scale, a tint: one animation for SMIL's and CSS's translate), turn and scale tolerances
sized by how far the content reaches. A bent path can be made from JSFL after all: handles
written into the motion tween's XML (`setMotionObjectXML`) bend it, so a bent path is simply X
and Y curved over time; one of those curves takes a key per rising or falling piece (f99: arc,
S, orient to path, a corner; every frame within 0.05 px, 0.00 % against Animate). The JS player
moves along the fitted curves, smooth between frames: `offset-path` would not be smaller (CSS
already writes x and y as nested animations of their own). Over the 99 test documents Lottie
1.6 %, SMIL 0.4 % smaller; the transforms document 39 % in SMIL, armatures up to 63 % in
Lottie; building the programs 27.6 → 46 ms for all of them.

**13. Appearance** (2026-11-06): the camera's tint and Adjust Color go on one wrapper around all layers, the
way layer effects do, so every format has them (f82). Strokes: Animate's pen stays round under an uneven scale
where SVG and Lottie stretch it; widths measured for 16 scale pairs: Normal width x sqrt((sx² + sy²) / 2),
Horizontal x sx, Vertical x sy; `src/core/pens.ts` redraws such strokes in the scaled space, for Lottie the scale
moves into the drawing because a layer stretches whatever is in it (f83: 0.00 % everywhere). *Export as bitmap*
looks the same as vectors (f84: 0.00 %): nothing to do. 3D: `src/core/persp.ts`. JSFL gives `matrix3D` per
frame once a tween is baked (`convertToFrameByFrameAnimation`), the view angle and vanishing point only in a copy
saved as XFL (`doc.saveAsCopy`, the folder named like the file). The stored angle belongs to the stage's width:
focal length = (width / 2) / tan(angle / 2); no angle in the file: 528.25. Instance bounds of a 3D element are
local, those of a baked tween's frames the stage's. Flash draws 3D through a bitmap, its edges are softer. Animate
hangs closing a document with a 3D motion tween (after saving it). CSS 3D measured: Edge and Firefox honour
`matrix3d` in a `foreignObject`, inline, as a file and in `<img>`; Playwright's WebKit flattens it. A `<use>` can't
hold a `foreignObject`: such timelines stay in place.

**12. Scripts** (2026-11-06): frame scripts run. `src/core/as3` parses AS3 and compiles it to JavaScript at
export (`parser.ts`, `emit.ts`); Canvas documents' JavaScript goes in as it is (`src/core/emit/scripts.ts`).
`src/player/script.ts` is the Flash API on the player's clips and instances, `src/player/flash-lib.ts` what
doesn't touch the player, `src/player/parts/` what comes only with documents that use it (media, filters,
createjs). The order of events is measured, not assumed: the test documents f74–f78 and f80 trace everything
they do, Animate's debug Flash Player runs the SWF (`scripts/e2e-as3.ts`), and the JS player must trace the
same lines; f79 does the same against the document Animate publishes, on its own `createjs.min.js`
(`scripts/e2e-canvas.ts`), real mouse included. Things only measuring finds: positions keep twentieths of a
pixel (truncated when set), alpha 256ths (0.3 reads 0.296875, nothing clamps), `width` on a turned object
changes both scales, `isPlaying` is what `play()` and `stop()` said last, `concatenatedMatrix` is rounded to
quarter pixels, a label two scenes share is listed only in the first. Open: the document class and `.as`
files; a BitmapData from the library reads as empty until the browser has decoded it; `BitmapData.draw()` of
display objects (a browser can't read them back at once); FLVPlayback (packages 15, 16); WebKit plays sound
only after a click, like every browser, so `SOUND_COMPLETE` comes after it.

**10. Sweep** (2026-11-06): each feature got a test document (f61–f73) checked against Animate's frames.
JSFL can't make bones, warps or width profiles: documents are written as XFL (`tests/fixtures/build-xfl.mjs`:
Animate takes hand-written armatures) or made with the real tool (`scripts/animate-session.mjs`, window
messages for most tools, the real mouse for Asset Warp) and kept in `tests/fixtures/assets`.
Armatures: JSFL shows only the first pose, `frame.convertToFrameByFrameAnimation()` bakes them.
Asset Warp: a warped object is a symbol of type puppet (frame 0 the art, then a frame per frame of a tween)
whose frames are only worked out when drawn; its SVG export doesn't warp. Layer depth: scale f / (f + z)
about the stage's centre, f = 528.25 whatever the stage size, layers stacked by depth. 3D stays for
package 13: Animate's view angle and vanishing point are only in the file (`viewAngle3D`,
`vanishingPoint3DX/Y`; `setStageVanishingPoint` is gone), the focal length is the same 528.25.

**9. Animated filters** (2026-11-01): the JS player writes a tweened filter as one filter whose
numbers it sets frame by frame (`src/core/emit/filteranim.ts`: filter sets built into primitives,
runs of one make-up, the attributes that change as held tracks; the runtime animates a copy per
instance, in the runtime with morphs): the filters demo 297 → 61 KB, every frame the same in three
engines. Measured and kept: SMIL and CSS switch between a filter per frame. Chromium draws a filter
again at every refresh of the screen while a SMIL animation of one of its primitives runs, even
with an unchanged value (2.8 times the rendering work of the filters demo at 144 Hz; minimal test:
660 ms per 4 s against 240 still, 150 switching filters); the filters per frame compress about
15× (284 KB → 19 KB with gzip). Values step with the frames, as in Animate: interpolating them costs
the same redraws, and Firefox draws a fractional `feOffset` cut to whole pixels (a step a frame
early). Found on the way: the player added a colour filter to `<defs>` each time a movie clip
appeared (f24-deep: 1278 after 12 s) — fixed, checked in `e2e-player`. Measured and kept: SMIL colour
tweens animate an `feColorMatrix` the same way, but switching a colour filter per frame (as CSS
does) made no difference in the five test documents with colour tweens (rendering work within
1–5 %, their other animations redraw every frame anyway; gzip 3 % larger to 21 % smaller) and
would make the fades step. Open: CSS filter functions
(`blur()`, `drop-shadow()`) interpolate cheaply but are isotropic and without strength — exact
for some filters? Firefox keeps SMIL times in whole milliseconds (seeks round to 1 ms): loops
whose length isn't whole milliseconds (.7923269 s next to 1.6666667 s in f35-edge) drift apart,
visibly after a few minutes (f35 far ahead 4.1 %, f09) — whole-millisecond loop lengths (×3
unrolled at 24/30/60 fps) would cure it.

Found by covering the guide's demos in the browser and Lottie checks (2026-11-01): the JS player
with *Play once* and a one-frame root moved its movie clips one frame on before holding, and its
held clips' Web Animations ran on (fixed: the root ends before they move, held means paused);
lottie-web draws the filters demo's inner gradient bevel only faintly (Skottie exact, gradient
glows and plain bevels right in lottie-web) — open: render the construction's layers one by one in
lottie-web to find the part it drops.

Found while answering the guide feedback of 2026-11-01 (fixed, unreleased): Chromium 156 drew
CSS exports wrong while running (a moving `transform` animation next to separate
`translate`/`rotate`/`scale` ones: 18 of 59 documents) — `scripts/e2e-running.ts` checks every
CSS export running against paused now; CSS on scroll stood still inside `overflow: hidden` boxes
and in `<object>` — a script takes over there. Still open: the gradient bevel at low quality
draws a 1 px softer rim than Animate (~0.1 % of the filters demo).

## Part 3: after 5.0.0 (goals of 2026-11-07)

Parts 1 and 2 are done and released. These are the goals for later, biggest first; work starts when
the user says go, in this order unless the user changes it. Each is compared with Flash Player or
Animate as before: an own test document, real keys and clicks where a user is involved.

| # | Goal | Benefit | Effort | Status |
|---|---|---|---|---|
| 17 | **Document class and classes in `.as` files:** the parser learns `package`, `class`, `extends`, `super`, statics, getters and setters, interfaces, imports across files. The extractor finds the files through the document's class path. The document class's constructor runs before frame 1 | real AS3 projects, not only frame scripts | high | ✅ f91–f93: 85 lines as Flash Player |
| 18 | **XML and E4X:** XML, XMLList, `@attributes`, `..` and filters in the AS3 compiler and the runtime | data-driven content; DataProvider from XML | medium–high | ✅ f94, f95: 91 lines as Flash Player, namespaces too |
| 19 | **The remaining UI components:** TileList, ScrollPane, UIScrollBar, and jQuery UI components in HTML5 Canvas documents (today: warned) | every component exports | medium | ✅ f96 (29 lines as Flash Player), f97 (7 lines as the published page) |
| 20 | **`BitmapData.draw()` of display objects**, and library BitmapData readable before it is decoded | canvas-style effects in scripts | medium | ✅ f98: 9 lines as Flash Player (`src/player/paint.ts`, `png.ts`) |
| 21 | **Motion tweens as curves:** fit their X and Y curves instead of a keyframe per frame; bent motion-tween paths; the JS player moving along `offset-path` | smaller, cleaner motion tweens | medium | ✅ curves through Animate's frames (`src/core/tracks.ts` fitCurve, fitTogether), f99: bent paths (see below) |
| 22 | **Unverified Animate features:** test documents for art, pattern and fluid brushes, Flexi bones, the envelope deformer, warps with "Auto convert vector to bitmap" off, 9-slice on animated symbols with nested symbols | certainty, fixes for what they show | medium | ✅ f100, f101; vector warps fixed (see below); fluid brush, Flexi bones, envelope ❓ |
| 23 | **Smaller gaps in the output:** lottie-web's faint inner gradient bevel, the rim of a gradient bevel, CSS filter functions, Firefox's SMIL drifting far into long loops | fidelity | low–medium | ⬜ |
| 24 | **MP4 and WebM from the command line:** the CLI has no video encoder; through an installed browser or a WebAssembly encoder | batch export of video | medium | ⬜ |
| 25 | **Why Animate crashes quitting:** after the full batch of test documents, 2 of 4 runs, all work done by then. Find out whether a document or the extractor causes it | a user's Animate must not crash | low, if it can be reproduced | ⬜ |

Video embedded in the timeline stays out unless Animate turns out to hand over its frames: only FLV
can be embedded, and browsers can't play it.

## Sources
- Animate features: https://helpx.adobe.com/animate/using/whats-new/2023.html, https://www.videohelp.com/software/Flash-Professional/version-history, https://helpx.adobe.com/animate/desktop/animation/bone-tool-animation.html, https://helpx.adobe.com/animate/desktop/interactivity/add-interactivity-code-snippets.html, https://community.adobe.com/t5/animate-discussions/asset-warp-tool-creates-bitmaps-when-generating-mesh/m-p/12602916
- Ruffle: https://en.wikipedia.org/wiki/Ruffle_(software), https://ruffle.rs/blog/2024/09/12/optimisations-text-more
- `offset-path`: https://www.cssportal.com/css-properties/offset-path.php (support on SVG elements: to be measured)
- SVGator: https://www.svgator.com/help/export-and-file-formats, https://www.svgator.com/alternatives/svgator-vs-lottielab, https://us.fitgap.com/products/008879/svgator
- dotLottie: https://lottiefiles.com/dotlottie, https://docs.lottiefiles.com/en/format/dotlottie/why-dotlottie.md, https://docs.lottiefiles.com/en/runtimes
- Lottie in Animate: https://community.adobe.com/t5/animate-discussions/export-to-lottie/m-p/9451694, https://aescripts.com/lottiefiles/
- Rive vs. Lottie: https://lottiefiles.com/blog/working-with-lottie-animations/lottiefiles-or-rive, https://framer.rive.app/blog/rive-as-a-lottie-alternative
- Keyshape: https://tr-web.dev.trustradius.com/products/keyshape/details
- GSAP licence: https://gsap.com/community/standard-license/
- SMIL vs. CSS/WAAPI: https://blog.openreplay.com/modern-svg-animation-techniques/, https://www.testmuai.com/web-technologies/svg-smil-safari/, https://groups.google.com/a/chromium.org/g/blink-dev/c/5o0yiO440LM/m/YGEJBsjUAwAJ
- CSS `d`: https://developer.mozilla.org/en-US/docs/Web/CSS/d, https://web-platform-dx.github.io/web-features-explorer/features/path-shape
- `linear()` / `offset-path`: https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear, https://developer.mozilla.org/docs/Web/CSS/offset-path
- Scroll-driven animations: https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026, https://web.dev/blog/interop-2026
- Images: https://modpagespeed.com/blog/avif-vs-webp-2026/, https://developer.chrome.com/blog/jpeg-xl-in-chrome
- Audio: https://frequal.com/java/OggOpusStillNotWorkingInSafari18_4.html, https://www.testmuai.com/web-technologies/mediarecorder/
- Video: https://bitmovin.com/av1-playback-support/, https://www.schieb.de/?p=716378
