# Roadmap: making Flash2SVG more powerful

Master plan from the technology research of 2026-10-30 (SVG animation tools, formats and browser
support). Status markers: ✅ done · 🚧 in progress · ⬜ open. Re-check versions and browser
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
| 1 | Media encoding settings | very high | medium | 🚧 images ✅, downscaling ✅, audio ✅, budget view ✅, video ⬜, fonts ⬜ |
| 2 | Player: compositor animations, pause off-screen, reduced motion | high | small | ✅ (canvas renderer ⬜) |
| 3 | Shape tweens as path morphing (SMIL and player) | very high for shape tweens | medium–high | ✅ |
| 4 | CSS: `linear()` easing, individual transform properties | medium | small–medium | ⬜ |
| 5 | Interactivity: triggers, scroll, label state machine | high | medium | ⬜ |
| 6 | Lottie / dotLottie export | very high (reach) | high | ✅ (effects ✅, state machine ✅, panel preview ✅; constructed inner filters ⬜) |
| 7 | WOFF2 fonts, video, library export | medium | medium | ⬜ |

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
- ⬜ **Video:** embedded video is not exported today. Plan: `<foreignObject><video>` for inline and player output, AV1 with an H.264 fallback, and a poster image.
- ⬜ **Fonts:** dynamic text as an embedded WOFF2 subset instead of outlines. Text stays searchable and selectable, and long texts get smaller.
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
- ⬜ Optional canvas renderer for very large scenes (with the compositor animations less needed).

### 3. Shape tweens as path morphing
- ✅ SMIL `<animate attributeName="d">` (plus colours, gradients, stroke widths) and the player blend one drawing instead of a drawing per frame. CSS keeps frames because Safari lacks CSS `d`.
  - Found first: Animate's in-betweens are exact linear blends of start and end with the eased ratio (f05: 0.03 px off, the twip rounding), but its SVG export writes every frame anew. `core/morph.ts` matches them up (lines as curves, contours restarted/turned, holes reordered, edges that shrank to nothing put back), fits start and end by least squares and checks every frame; frames that don't fit stay drawings.
  - Classic and custom eases give the ratio; other eases get each frame's ratio from the shapes. Radial gradients blend in a canonical form; Linear RGB stops are kept per frame.
  - SMIL: looping movie clips repeat the morph values with every loop on the global clock (f45: 334 → 587 KB at first); tracks that repeat are now written once with their own repeating timing (→ 104 KB).
  - Sizes (SMIL): f05 13.3 → 2.3 KB, f39 (119 frames) 75.5 → 12.7 KB, gzip 17.0 → 2.4 KB; player f39 61.6 → 21.1 KB. Stepped output 20–47 % smaller (gzip about the same).
  - Keyframes inside symbols (Animate re-centres them: an extra group) join the morph by box and colours. A keyframe Animate draws more than a quarter pixel off its morph start stays its own drawing.
  - ⬜ Gradient/pattern matrices that turn while blending: player only (SMIL keeps frames).

### 4. Leaner CSS
- ⬜ Use `linear()` easing so Animate's custom multi-point eases and bounces fit in one keyframe segment.
- ⬜ Use the individual properties `translate`, `rotate` and `scale`, for shorter keyframes and fewer nested `<g>`.
- ⬜ Optionally write `.svgz`, and add a server compression note (Brotli) to the README.
- ⬜ Choose decimal places from the displayed size instead of one global value.

### 5. Interactivity without code
- ⬜ Start triggers: hover, click, entering the viewport.
- ⬜ Scroll scrubbing with CSS `animation-timeline` (fallback for Firefox).
- ⬜ Labels as states and buttons as transitions, like the state machines of Rive and dotLottie.
- ⬜ Recognise Animate's code snippets such as "click → go to frame".

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
- ⬜ Inner and knockout shadows and glows, *hide object*: no Lottie effect, but they can be built from track mattes (the instance as an inverted matte of a coloured box, blurred, matted again) and a recoloured, blurred copy.
- ⬜ Colour effects on bitmaps: a tint (equal multipliers) is Lottie's Fill effect (colour, opacity = amount).
- ⬜ A seamless loop seam in dotLottie (its loops run about a frame short): a closing key one frame past the end.
- ⬜ Labels as states (package 5), buttons as state machine interactions.
- ⬜ Shared tile grids for frame-by-frame bitmap fills (each frame repeats its tiles today).

### 7. More
- ⬜ Responsive scale modes like Flash (show all, no border, exact fit), cropping, transparent background.
- ⬜ Accessibility: `<title>`, `<desc>`, `role="img"` and `aria-label` from Animate's accessibility panel.
- ⬜ Export library symbols as separate SVGs (icon workflows).
- ⬜ Export several scenes.
- ⬜ A web component (`<flash2svg-player>`) with lazy loading.
- ⬜ Raster fallbacks (animated WebP/AVIF, MP4, GIF), e.g. for e-mail.
- ⬜ Pick the format automatically, e.g. CSS rather than SMIL for transform-heavy scenes because of Safari.

## Sources
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
