# Architecture

```
Animate (JSFL, ES3)                      Panel / Node (TypeScript)
┌──────────────────────────┐   scene.json   ┌────────────────────────────────────────────┐
│ src/jsfl/flash2svg.jsfl  │ ─────────────▶ │ core/program.ts   timelines → layer items  │
│  • saveAsCopy + open     │   atlas/*.svg   │                   + fitted, verified tracks │
│  • walk timelines        │ ─────────────▶ │ core/artwork.ts   Animate SVG → defs        │
│  • tweenObj samples      │   bitmaps/…     │ emit/static.ts    one frame                 │
│  • atlas: exportSVG()    │                │ emit/bake.ts      global clock (SMIL/CSS)   │
└──────────────────────────┘                │ emit/animate.ts   SMIL / CSS writer         │
                                            │ emit/player.ts    JSON program + runtime    │
                                            │ emit/lottie.ts    Lottie / dotLottie        │
                                            └────────────────────────────────────────────┘
```

## Extraction (inside Animate)

`src/jsfl/flash2svg.jsfl` is plain ES3 + E4X (Animate's JSFL engine has no JSON, no `let`, no
arrow functions). It is resumable: the panel calls `Flash2Svg.start(options)` and then
`Flash2Svg.step(ms)` until done, so progress can be shown and the export cancelled.

1. **Copy.** `document.saveAsCopy()` + `fl.openDocument()`: all work happens on a temporary copy.
2. **Timelines.** From the root timeline, every reachable symbol timeline is read: layers (type,
   parent, visibility), keyframes (labels, scripts, sounds), elements (instances with matrix,
   transformation point, colour transform, filters, blend mode, loop settings; shapes; bitmaps;
   text with runs) and tween settings (classic ease, custom ease curves per property, rotation,
   orient to path…).
3. **Tween samples.** For every tweened instance, `frame.tweenObj.getGeometricTransform(i)` and
   `getColorTransform(i)` give Animate's own interpolation for every frame. Note:
   `getGeometricTransform` returns the change *since the keyframe*, applied in parent space.
4. **Atlas.** Shapes and text can't be described reliably through JSFL, so they are drawn by
   Animate's own SVG exporter: each run of consecutive shape elements (or text field, or
   shape-tween frame) is pasted into its own frame of an *atlas* document, and a single
   `document.exportSVG(…, currentFrame=false)` writes one SVG per frame. Details that matter:
   - frames are copied straight from library/scene timelines of the inactive copy document, the
     atlas stays the active window (switching windows costs ~0.25 s each);
   - contiguous keyframes are copied in one go;
   - pasting symbol frames into a scene moves them (Animate re-centres symbol content): the shift
     is measured and stored as `offset`;
   - pasting from a guide/mask layer converts the atlas layer — it is forced back to normal;
   - text is broken apart into outlines first (Animate writes text as SVG fonts);
   - Animate's export drops the gradient "Linear RGB" flag: it is read from the fills and
     emulated by the compiler with extra stops.
5. Bitmaps and sounds are exported with `exportToFile()`: every bitmap as a lossless PNG master,
   "Photo (JPEG)" bitmaps also as Animate's JPEG (without a quality argument it uses the bitmap's
   setting, and writes imported JPEGs unchanged). Sounds come out as WAV (imported as WAV/AIFF;
   Animate pads it with silence to several times its length) or as the imported MP3. The real
   length is the last point of the "fade out" envelope (in 44.1 kHz samples), measured on the
   frame of the working copy and put back. Frames keep their envelope (`getSoundEnvelope`, points
   from the start of playback that run on across loops) and in/out points
   (`getSoundEnvelopeLimits`); a custom envelope can report the effect "none", so the points count.
   `scene.json` is written with a small JSON serializer; the copy and atlas documents are closed.

## Compilation

- **Images** (`core/images.ts`, async, before compiling): each bitmap is lossy or lossless by
  Animate's compression setting or a per-bitmap override, and re-encoded (JPEG / WebP / AVIF, or
  oxipng PNG / WebP lossless). The codecs (`core/codecs.ts`) are the single-thread WebAssembly
  builds of the Squoosh encoders (jSquash), called directly; the panel loads them as a separate
  bundle (`panel/codecs.js`) on the first export with bitmaps, and builds it without `process`
  so they take the browser path in CEP. Instances are created asynchronously (Chromium forbids
  synchronous ones on the main thread).
- **Bitmap resolution** (`core/bitmap-scale.ts`, used by images.ts): the largest scale of each
  bitmap's x and y axis on stage, read from the scene model (element matrices, the per-frame tween
  samples, layer-parenting matrices, the inverse of the camera, the pattern transforms of bitmap
  fills in the atlas SVGs, every shape-tween frame). Nested symbols multiply by the largest stretch
  (singular value) of their instances — an upper bound, as the levels animate independently —
  so a bitmap is never written smaller than it is shown. images.ts resamples it (Lanczos 3,
  premultiplied alpha, sRGB like browsers and Flash; `@jsquash/resize`) to that size times
  *Resolution* (default 2); the model's `pixels` then holds the file's size and the bitmap is
  stretched over its full size (`preserveAspectRatio="none"`). Repeating fills (tiles would get
  seams), pixel art and results that aren't smaller than the master keep every pixel. One pass over
  the model (~1 ms for the test documents).
- **Sounds** (`core/audio.ts`, async, player format only): each sound is cut to its real length
  and to the range its frames play (earliest in point to latest out point), then written as MP3
  (LAME, wasm-media-encoders), Opus (libopus-wasm, resampled to 48 kHz by a polyphase windowed
  sinc, wrapped in Ogg by our own muxer) or WAV, by Animate's compression setting or a per-sound
  override; imported MP3s at their own quality stay as they are. The model then says where the
  file starts in the sound (`trim`), its length and the MP3 encoder delay (LAME writes no gapless
  header; the player skips the delay when the decoded file is that much longer). The panel loads
  the codecs as `panel/audio.js` on the first player export with sounds.
- **Programs** (`core/program.ts`): per timeline and layer, *items* that exist over a frame
  range: artwork, frame-by-frame artwork (shape tweens), bitmaps, text, and symbol instances.
  Consecutive keyframes holding the same symbol in the same slot form one instance *span* (a movie
  clip keeps playing across them, as in Flash).
- **Tracks**: each instance matrix is decomposed as
  `translate(x,y) · rotate(r) · skewX(k) · scale(sx,sy) · translate(−tp)` — the transformation
  point moves, the object turns and scales around it, like Animate does. For each classic tween
  segment the ease curve of each property group is turned into Bézier pieces (split at extrema so
  they are also valid SMIL `keySplines`). The prediction is compared with Animate's sample at every
  frame (tolerance ≈ Animate's 1/20 px rounding); on mismatch the samples are used instead and
  simplified (Ramer–Douglas–Peucker). Animate eases the *position* of the transformation point but
  builds in-between matrices around the start keyframe's point, so the point itself steps.
- **Layer effects** (advanced layers): a layer with a colour effect, filters or a blend mode is
  moved into a synthetic graphic symbol that follows the timeline frame by frame; the effects
  become that instance's colour, filters and blend mode, so every emitter handles them.
- **Instance alpha** (`markShapeAlpha`): Flash applies it to each shape inside, so it is
  written as inherited `fill-opacity` / `stroke-opacity` where possible (not inside another such
  instance, nor with filters, the layer blend or bitmaps), otherwise as a group `opacity`.
- **Alpha / erase blends**: a layer holding only such elements becomes a mask layer
  (`maskMode`: by alpha, or inverted) over a synthetic graphic symbol with all layers below it.
- **9-slice** (`core/nineslice.ts`): each 9-slice movie clip instance with a fixed, unrotated
  scale gets a derived copy of its symbol drawn at that scale. Like Flash, the vertices of the
  drawing are moved piecewise (corners unscaled, edges in one direction) against the content
  bounds including strokes; strokes keep their width, gradients/bitmaps/text and nested movie
  clips scale normally, nested graphic symbols are sliced. The instance keeps only its position.
- **Timing** (`emit/timing.ts`): graphic symbols follow their parent (loop / play once / single
  frame / reverse modes), movie clips simulate their playhead with frame scripts. Arriving at a
  frame runs its actions; a goto moves on at once (that frame isn't shown, as in Flash). Actions
  under a pass counter (`FrameAction.passes`) count the passes over their frame; the simulation
  ends in a prefix plus an endless cycle.
- **Shape tweens as morphs** (`core/morph.ts`, `Context.morph`, computed once per item): Animate's
  in-betweens are linear blends of start and end (its morph keeps one edge list), with the eased
  ratio (`ArtSeqItem.ratio`, from the classic or custom ease). Each frame's imported artwork is
  scanned (structure signature; numbers of `d`, colours, gradient and stroke values, matrices;
  radial gradients in canonical form, radius 1 and the size in the matrix, as Animate's own form
  doesn't blend linearly). Frames with the same structure form runs. Path data is brought to one
  layout: lines as curves with the control point in the middle, subpaths matched by bounding box
  (a hole shares its outline's centre), each frame's contours started and directed like the
  frame expected from the two before it (points may move further than they are apart), edges
  that shrank to nothing put back by dynamic programming (at most 8 a frame). Least squares give
  start and end values; every frame must match within Animate's rounding (0.06 px + the output's
  precision, colours ±1.6), else the run splits or stays frames. Paths that don't follow the
  ease get each frame's ratio from the shapes (`MorphPart.ratio`); values that aren't linear
  (Linear RGB stops) are kept per frame (`MorphChannel.f`). The keyframe, often written with
  fewer edges, joins the first part if its outline (or, in another structure, its box and
  colours) matches the start within a quarter pixel. SMIL: `BakedMorph` nodes with the ratio
  mapped onto the global clock; the writer copies the drawing (fresh ids) and animates each
  channel (`animate` on `d`, `fill`, `stop-color`...; matrices as translate + scale
  `animateTransform` with fixed rotation and skew added; parts with other matrices stay frames).
  A track that repeats through the looping horizon is written once with its own `dur` and
  `repeatCount` (long path data, many loops). The player gets the drawing as a template group
  (`PMorph`) the runtime copies (ids made unique) and blends per frame; `PSeq.st` keeps it to
  whole frames when not smooth.
- **Bake** (`emit/bake.ts`, SMIL/CSS only): every timeline instance gets an array "local frame at
  each global tick"; tracks are mapped run by run onto the global clock with exact sub-Bézier cuts.
  Identical arrays share one definition. Movie clips that span the whole root timeline extend the
  horizon to a common multiple so they loop seamlessly. When the root stops, the horizon runs on
  until the clips still running have played their intros, then for their common period: the
  writers emit every animation once plus a looping *tail* (SMIL: begins at the end of a clock
  animation; CSS: a second, delayed infinite animation). Played once, everything holds the last
  tick shown.
- **Bitmaps in the output** (`emit/document.ts`): each bitmap is one `<image>` in `<defs>`;
  bitmap elements, the player's poster and bitmap fills (the atlas' own `<image>` becomes a
  `<use>`) refer to it, so an embedded bitmap is in the file once.
- **Size overview** (`CompileOutput.stats.parts`, `.drawings`): `OutputDoc.toString` serializes the
  `<defs>` entries one by one (joined as raw markup, so the output stays the same) and keeps each
  artwork's share; `sizeParts` splits each file by embedded images and sounds, the player's script
  and timeline data, SMIL elements and CSS. Drawings are named by the atlas source (timeline and
  layer). The panel's `Budget.svelte` shows them.
- **Writers**: SMIL uses `display` animations for visibility and `animateTransform` per transform
  component (static parts folded into matrices). CSS uses class-based `@keyframes` with a timing
  function per keyframe; animated subtrees are inlined (CSS animations inside `<use>` shadow trees
  can't be paused or seeked). The player emits artwork in `<defs>`, a compact JSON program
  (`src/player/format.ts`) and the runtime (`src/player/runtime.ts`, bundled to ~14 KB; programs
  with sounds get a build with the mixer, ~18 KB, programs with shape-tween morphs one with the
  morph code, +1.3 KB: four builds, `PLAYER_RUNTIMES`; internal member names are shortened with esbuild
  `mangleProps`, list in `scripts/build-runtime.mjs`). Tweened transforms and alpha are Web
  Animations (keyframes from the tracks, cached per item): the browser plays them on the
  compositor, and `sync()` only sets an animation's start time when its timeline jumps or stops
  (setting `startTime` takes effect at once; `play()` would start a frame late and look like a
  drift). Held animations (pause, stop, out of view) are committed as styles and cancelled: the
  compositor draws paused animations snapped to whole pixels, half a pixel off a still frame;
  setting the start time again plays them. Clips whose time runs on through their last frame (`flows`) let their animations play
  through it and set them back once at the wrap. Symbols drawing hairlines (`PTimeline.hl`) are
  moved by attribute writes, as their outline changes with every transform. The player rests out
  of view (IntersectionObserver) and in background tabs, unless its sound is on; with
  `prefers-reduced-motion` it shows the poster frame (`PProgram.pf`) until a click. SMIL output
  gets a still copy of the poster frame for that (`.f2s-still`, shown by a media query), CSS output
  an `animation: none` rule. The mixer plays sounds with Web Audio: in/out
  points and loops through `loopStart`/`loopEnd`, envelopes as gain ramps per channel, stream
  sounds following the playhead. Every sound runs on the player's clock, so one that can't start
  yet (decoding, autoplay blocked until the first click or key) joins at its position; pause and
  hidden tabs hold the sounds. Without Web Audio, or for files it can't fetch (linked files on
  `file:`), an `<audio>` element plays them.

## Lottie output

`emit/lottie.ts` writes Lottie JSON (`core/dotlottie.ts` packs it with its bitmaps into a
dotLottie v2 archive, fflate). It starts from the same baked global clock as SMIL, so frame
scripts, movie clip playheads and graphic loop modes behave the same, and uses only what the
Lottie spec 1.0 has (no expressions) plus layer effects for filters, so lottie-web, dotLottie
(ThorVG) and Skottie draw the same; all three are checked against the static frames
(`scripts/e2e-lottie.ts`).

- **Structure:** each distinct baked timeline is a precomposition, each instance a precomp layer
  with the transform as Lottie properties (`p`, `a` = transformation point, `s`, `r`, `sk` =
  −skew, `sa` 0 — measured pixel-exact in all three players) and eases as keyframe handles (tracks
  of different dimensions keyed at the union of their keys, eases cut exactly). Precomps clip to
  their `w`×`h` in every player: content is moved into a box computed from the drawings' bounds
  (instances sampled every tick) and the precomp layer's anchor moves it back.
- **Drawings** become shape layers, one group per path (quadratic curves as the cubic that is the
  same curve), styles after their shapes (a stroke above its fill). Linear gradients under any
  matrix are exact as start/end points; elliptical radials keep a circular gradient in its own
  space (the gradient in a group with the gradient matrix, the paths in a group inside with its
  inverse). Repeat/reflect gradients get copies of their stops over the shape's extent. Bitmaps are
  image layers (asset at its pixel size, scaled by the layer); repeating bitmap fills are tiles
  under a track matte of the path; clip groups and nested viewports (Animate's edge strips of
  clipped bitmap fills) are precomps under a matte or clipped by their own box.
- **Masks** are track mattes (`td` on the matte, `tt` + `tp` on the matted layer, the matte
  directly above): the masked layers go into one precomp, the mask layer's content into another,
  drawn opaque (Flash masks by shape, as the SVG mask filter does). Alpha and erase blends become
  alpha / inverted alpha mattes.
- **Colour:** Flash colours each shape inside a symbol, not the symbol as a whole. Colour effects
  (tint, brightness, advanced) and alpha where `markShapeAlpha` found it per shape are pushed
  into the paints of the drawings inside (a `Paint`: the colour transform at its key times, nested
  ones composed); colours are linear in the transform's values, so keyframes at its keys with its
  eases are exact, and where clamping bends them they are keyed every tick. Other alpha (filters,
  blends, bitmaps) is the layer's opacity. Invert is a difference blend of the instance painted
  white.
- **Repetition** (`emit/periods.ts`): a looping movie clip makes the baked horizon long (up to the
  common multiple of all loops) and repeats its keys on every loop. The smallest period after
  which a node repeats is found by comparing its tracks as curves (keys can differ) on the
  stretches where it shows; a timeline that repeats is written for one period and played by a
  sawtooth time remap (`tm`, local time running 0.0002 frames ahead so rounding never lands a
  frame boundary just before the frame); runs of nodes that repeat sooner than the timeline
  around them go into such a slice.
- **Shape tweens:** the morph drawing is converted at every key of its ratio track and the values
  that change are merged into keyframes (Lottie blends keyframes linearly, like the morph);
  values that aren't linear in the ratio (an elliptical gradient's inverse transform) are found
  by a check at each stretch's middle and keyed every tick.
- **Hairlines** keep their width in pixels at the scale their symbol starts with (Lottie strokes
  scale). lottie-web needs `st` on every layer and `o` in every group transform (it hangs
  without), and `x` on masks.
- **Filters** (`lottieFilters`, `effectsJson`): blur → Gaussian blur effect (`ty` 29,
  blurriness = σ / 0.3; two directional ones when blurX ≠ blurY), drop shadow and glow → drop
  shadow (`ty` 25: opacity 0–255, direction clockwise from up = Flash angle + 90, Flash's whole
  pixel offset, softness = σ / 0.3), adjust colour → a 4×5 colour matrix composed into the
  paints (a `CT` of 20 numbers; also applied to the colour of shadows before it in the chain).
  An instance's intervals are split where the filters change their make-up (`filterRuns`); within
  a run the effect values are keyframes held from one filter set to the next. Measured in the
  three players (2026-10-30): lottie-web and ThorVG apply effect values in the layer's own space
  (its transform and parents), Skottie in the composition's; ThorVG clips effects to the precomp
  box, lottie-web clips a drop shadow to the layer's bounding box (its default filter region);
  ThorVG fades a layer before its effects (a half transparent instance shows its own shadow
  through). So the effects go on a precomp layer without a transform holding the instance
  (`effectsLayer`), its box grown by the effects' reach and covered by a transparent rectangle
  (the bounding box), the instance's alpha on one more precomp level above. Effect values carry
  After Effects' names (`nm`): lottie-android finds drop shadow values by name.
- **Playback:** after a `stop()` with running movie clips the horizon has a looping tail; the
  markers `intro` and `loop` hold the two parts. dotLottie players (dotlottie-rs) play a marker
  over [tm, tm + dr] with the end frame, a whole animation over [0, op − 1]: in a .lottie the
  markers end a frame earlier (else a frame past the content shows empty at each loop).
  `core/statemachine.ts` writes the .lottie's state machine (`s/playback.json`, listed in the
  manifest): `intro` (once, segment `intro`) → `tail` (segment `loop`, looping) on an
  `OnComplete` that fires the event `introDone`, or one `play` state looping or not; with a
  click / hover / script start an `idle` state on the `poster` marker first, every state going
  to the first one on the event `play` (fired by `Click` / `PointerEnter`, or by the page). A
  state entered again keeps its frame: the first state's entry action `SetFrame 0` restarts it.

## Panel preview

`src/panel/LottiePreview.svelte` plays a Lottie result in lottie-web (JSON; linked bitmaps
pointed at the export's folder) or dotLottie (a .lottie, or a JSON on request), with play/pause,
a frame slider and, for a .lottie, its state machine (state shown, clicks on the canvas go to
it). The players are separate bundles loaded on first use (`lib/lottie-players.ts`:
`panel/lottie-web.js` 217 KB with lottie-web's SVG renderer and effects, `panel/dotlottie.js`
58 KB; dotLottie's WebAssembly is read from `wasm/` into a blob URL, as it would fetch it from a
CDN otherwise).

## Tests

- `tests/unit`: easing maths, matrix decomposition, and "programs reproduce Animate's tween
  samples frame by frame" on stored scene models (`tests/fixtures/models`).
- `scripts/e2e*.{mjs,ts}`: fixtures are generated by `tests/fixtures/build-fixtures.jsfl`
  (eases, transforms, nesting, shape tweens, motion objects, masks, filters, guides, HTML5 Canvas,
  text, labels/stop, camera, parenting, buttons, sounds, bitmaps, deep nesting, paint styles,
  animated masks, `stop()` with running clips, blend modes, an HTML5 Canvas banner, a stress
  file). Static renders are rasterised in Edge (resvg alongside) and compared with Animate's PNG
  export; SMIL/CSS/player are seeked in Edge and compared with the static renders (smooth,
  `--steps`, ticks after a `stop()` into the looping tail, and the end state of a play-once
  export).
  `scripts/e2e-lottie.ts` exports every fixture as Lottie JSON and as .lottie, validates it with
  the Lottie Animation Community's schema (`@lottie-animation-community/lottie-specs` + ajv) and
  plays it in lottie-web (SVG renderer) and dotLottie (ThorVG WebAssembly) in Edge and in Skottie
  (CanvasKit, Node) (`scripts/lib/lottie-players.ts`); every sampled frame is compared with the
  static frame. Where our SVG approximates (a tinted symbol coloured as a group), a frame that
  matches Animate's own PNG at least as well passes. `scripts/e2e-statemachine.ts` runs the
  .lottie state machines in dotlottie-web (state and frame on every animation frame): intro then
  tail without an extra frame, a click start and restart from the poster, looping, playing once.
  `scripts/e2e-player.ts` drives the JS player: labels, goto, loop modes, start modes, buttons,
  sounds (Web Audio calls recorded: in/out points, loops, envelopes, stream sync after goto and
  pause, mute, seek, button sounds, MP3 and Opus, blocked autoplay). `scripts/e2e-inline.ts`
  inlines several exports into one HTML page.
- `scripts/e2e-panel.mjs`: the panel inside Animate (signed self-test build, `src/panel/lib/selftest.ts`):
  formats, current frame, range, library symbols, several scenes, linked images, image and sound
  codecs, bitmap resolution (pixels written per bitmap), the Lottie preview (mounted off screen:
  lottie-web's SVG and filters, dotLottie's pixels, the time moving, a state machine's state
  before and after a click), temp clean-up.
- **Ids:** every id in an export starts with a prefix (`ExportSettings.idPrefix`, default a short
  hash of document, timeline and settings), artwork-internal ids included
  (`prefixArtwork`); the player's runtime ids start with its svg id.
- `tests/unit/output.test.ts`: output-level checks on the stored models (CSS end keyframes,
  settings sanitising).
