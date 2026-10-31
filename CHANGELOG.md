# Changelog

## Unreleased

- **User guide** at <https://zcarecrow.github.io/Flash2Svg/>: 19 pages with screenshots of the
  panel and 14 demo animations made in Animate and exported with Flash2SVG, each playable in every
  format with its file size.
- **Gradients share their stops.** In SMIL, CSS and JS player output, gradients with the same
  colours (every frame of a gradient shape tween, copies of a drawing) take their stops from one
  shared gradient instead of each carrying its own: the shape tween demo 186 → 110 KB (1,853 → 34
  `<stop>` elements to parse; gzipped 30.6 → 29.1 KB), the same pixels in Edge, Firefox and
  WebKit. Still frames keep their gradients whole, for editors.
- **Layer filters sized right.** A filter on a layer (*layer effects*) measured its region on the
  layer's symbols and text only: on a layer of drawn shapes it fell back to a guess, up to 11 times
  the content's width and height. Browsers filter that whole area on every frame, and the command
  line's GIF/WebP took seconds a frame (a fuzzed case: 145 s → 6 s). Now everything on the layer
  counts, in its smallest keyframe (so a blur is never cut off).
- **Exports that hung on a dialog.** Animate's first *save a copy* of a document returns before
  the copy is written; opening it that early showed "An error occurred opening file" and the
  export waited for someone to close it. The copy is now opened once it is complete (and gets a
  new name every time, never a leftover of an interrupted export).
- **Panel.** The preview fits the panel (it showed big drawings at full size with scroll bars);
  the panel also notices a document switch when Animate doesn't announce it (it checks again
  when clicked into), and a slow answer about a document closed meanwhile no longer wins over the
  current one. *Advanced › Keep the scene data* keeps the extracted scene next to the export, to
  export it again from the command line with other settings.
- **Command line:** `--guides` includes guide layers.
- **Warnings:** a camera with a tint or colour filter says those aren't exported (its position,
  zoom and rotation are); a symbol whose only text is a single character no longer warns that it
  "could not convert text to outlines".
- **Intros that loop back to a label.** A timeline whose last frame jumps back to a later frame
  (`gotoAndPlay("loop")`, the banner idiom "intro once, then loop") replayed its intro on every
  loop in SMIL and CSS. Now the intro plays once and the rest loops, as in Flash (and in the JS
  player, which was right).
- **Text fields.** A password input field showed its text in clear; now it shows a star per
  character, and its text never leaves Animate (scene data and outlines). *Show border around
  text* is drawn (a white field with a black outline), filters on text fields (a drop shadow on a
  heading) are applied like a symbol's, and a link set on text (*Properties › Options › Link*)
  makes the field a link in every SVG format. *Multiline no wrap* fields no longer wrap. A field
  of spaces no longer warns that it can't be converted to outlines. Lottie leaves borders, filters
  and links of text out (warned).
- **Smaller SMIL and CSS for looping movie clips.** An animation that repeats all through the
  loop (a spinner inside a longer timeline) is written once with its own repeating duration
  instead of unrolled over the whole loop: test documents with nested loops up to 29 % smaller.
- **Loops stay in step.** Repeating durations were rounded to 4 decimals: loops meant to stay in
  step drifted a frame apart within minutes. Now 7 (a third of a frame a day).
- **JS player.** Frame scripts that jump in a circle overflowed the stack (now 16 jumps a frame,
  like the other formats); `speed` takes positive numbers only (0, negative or NaN broke its
  clock); `seek()` ignores NaN and Infinity, and far ahead it finds where the animation repeats
  instead of playing every frame through (an hour: from seconds of a frozen page to milliseconds).
  Runtime 14.7 → 15.1 KB.
- **A jump to a label that doesn't exist** went to frame 1 in SMIL/CSS and stayed in the player
  (Flash: error #2109, the playhead stays): it is left out everywhere, with a warning.
- **Output that browsers or parsers rejected:** characters XML can't hold (control characters,
  unpaired surrogates) in labels, names or text; a drawing's gradient or pattern id repeated by a
  shape tween's copy of the same drawing (the player output of the morph test document had one
  twice); a named text field wrote its instance name as an id (now `data-name`); a Lottie file of a
  stage that isn't whole pixels.
- **GIF and WebP from the command line:** resvg (the CLI's renderer) panicked on clipped bitmap
  fills and on filtered symbols far off stage, and after a few hundred panics on everything. Clipped
  fills are drawn exactly (f42 as GIF: 33 s or a crash → 0.7 s), a frame resvg can't take is
  drawn without the parts it can't (warned), each panic gets a fresh resvg.
- **Smaller fixes:** still frames of a range past the end of the timeline wrote a file per frame
  number; the panel kept a .gif/.webp file name when the format changed to SVG; the CLI explains
  input that isn't a scene model; the warning about clip loops without a common period names the
  real repeat time.
- **Tested from scratch:** a fresh clone builds, type-checks and passes everything; a fuzzer
  (`scripts/fuzz.ts`) mutates the test documents' scene data in every way Animate allows and some
  it doesn't, compiles them in every format and checks the XML, ids, Lottie schema, determinism,
  and with `--browser` drives the player in Edge (thousands of cases, no failures left); the browser
  checks also look an hour ahead; six new test documents (library folders with equal names, a
  movie clip used as a graphic, empty and guide-only symbols, stroke styles, unusual text, 3D and
  other instance settings, awkward scenes, a long 60 fps timeline with loops of coprime lengths).

- **Lottie and dotLottie export.** Two new formats: *Lottie* (JSON) and *.lottie* (a dotLottie v2
  archive with the bitmaps inside). Written from the same baked timeline as SMIL, so frame
  scripts, movie clip playheads and graphic loop modes behave the same: symbols become
  precompositions, transforms Lottie properties with the eases as keyframe curves, drawings shape
  layers (quadratic curves as the same cubic curves), gradients exact (elliptical radials in their
  own space, repeat / reflect as copied stops), bitmaps image assets (embedded, linked or in the
  archive), repeating bitmap fills tiles under a matte, masks and *alpha* / *erase* track mattes,
  shape tweens animated paths and gradients, frame labels markers. Colour effects and per-shape
  alpha go into the colours of the shapes inside, as Flash applies them (exact keyframes; a tinted,
  half-transparent symbol matches Animate better than our SVG does). Invert is exact, subtract and
  add are close approximations; sounds and button states are left out (warned).
  Looping movie clips are drawn once and played again by a time remap instead of keying every
  loop (test documents: 2.2 MB → 251 KB, 684 → 15 KB, 448 → 186 KB). Apart from effects (below), only features of the Lottie
  spec 1.0 are used: every test document is valid against the official schema and checked frame
  by frame in lottie-web 5.13, dotLottie 0.82 (ThorVG) and Skottie (CanvasKit 0.42) — all 46
  within 0.15 % of the SVG frames, smooth and stepped, except the documented limits (a
  four-stop gradient glow, approximated blends, ThorVG's narrower blur and three image quirks). The 46 test documents: 1462 KB of Lottie JSON,
  379 KB gzipped (SMIL: 1078 KB, 373 KB gzipped), 413 KB as .lottie; exporting all of them takes
  0.2 s. `--format lottie|dotlottie`; in the panel the file name follows the format.
- **Filters as Lottie effects.** Blur becomes a Gaussian blur (two directional ones when blurX
  and blurY differ), drop shadow and glow a drop shadow, animated filters keyframed effect values;
  *adjust colour* goes into the colours inside as a colour matrix (and into the shadows before
  it). Measured in all three players first: they disagree on where effect values apply
  (lottie-web and ThorVG in the layer's own space, Skottie in the composition's), ThorVG clips
  effects to the precomposition and fades a layer before its effects, lottie-web clips drop
  shadows to the layer's bounding box — so the effects sit on a layer without a transform (the
  parent's space, as Animate applies filters) with room for them, the instance's alpha one level
  up. The effect values carry After Effects' names (lottie-android reads them by name). Test
  documents with filters, worst frame: 2.8 % → 0.03 %, 0.45 % → 0.01 %, 0.8 % → 0.00 % (dotLottie
  0.19 %: ThorVG blurs narrower).
- **The other filters, built from mattes.** Inner, knockout and *hide object* shadows and glows,
  shadows and glows stronger than 100 % or blurred unevenly, bevels (inner, outer, full,
  knockout), gradient glows and gradient bevels have no Lottie effect: they are built from track
  mattes, blend modes and Gaussian blur / Tritone effects — the silhouette (a colour under a
  matte of the instance, inverted for inner ones), blurred and moved; bevels from two moved
  copies as one grey image ½ + ½ (o1 − o2) (half opacities and a difference blend, exact) and
  Tritone lookups of its two sides; strength as a gain in colour dodge; gradient lookups by Tritone and luma mattes at 0, 50 and 100 % (exact for Animate's
  default gradients and any straight in between; warned otherwise). Every building block was
  measured in lottie-web, dotLottie and Skottie first. Filter test documents against the SVG
  frames, worst frame: 7.2 % → 0.00 % (lottie-web, Skottie; dotLottie 0.14 %), 0.74 % → 0.00 %,
  the new one with 16 kinds of filter: 0.11 % (its four-stop gradient glow; dotLottie 0.22 %).
  dotLottie (ThorVG) ignores a track matte on a layer with effects and the opacity and blend mode
  of the layers right inside one: the output keeps to that (also for filtered instances on masked
  layers, which dotLottie showed unmasked before). Cost: players render a precomposition again
  for every reference, so a built filter is drawn several times (a bevel blurs four times): the
  new test document (16 filtered instances, 500×400) takes 31 ms a frame in Skottie on the CPU
  (6 ms without its filters), 28 ms in dotLottie; a shadow costs about 0.5–2 ms, a bevel 6–9 ms.
  Lottie JSON of all 46 test documents: 1462 KB (gzip 379 KB; without these filters 1378 / 373).
- **Filters closer to Animate (SVG and Lottie).** Blurs: Animate's box covers the pixels at its
  ends in part (blur 2: ¼ ½ ¼), so even blur amounts are wider than we drew them (blur 2 at high
  quality: σ 1.22, was 0.87). Gradient glows: colour and alpha come from the gradient at
  strength × blurred alpha (we faded the alpha once more and looked the colour up unstrengthened),
  inner ones from the plain blurred alpha (the gradient's end fills the inside; we used the
  inverse), a knockout cuts the shape out. Measured in Animate over black and white backgrounds;
  test documents against Animate: 1.64 % → 0.12 % (new filter document), 0.41 % → 0.35 %,
  0.76 % → 0.73 %, the others unchanged.
- **dotLottie state machine.** A `.lottie` carries a state machine (`s/playback.json`,
  dotLottie 2.0) that plays it as the *Loop*, *Start* and *Poster* settings say: through once,
  looping, or — a `stop()` while movie clips run on — the intro once and then the tail; started
  automatically, on a click, on hover or from script (event `play`), the poster frame until then,
  restarted by the next click. Checked in dotlottie-web: intro and tail meet without a gap or an
  extra frame. Lottie JSON gets the markers `intro` and `loop` for the same.
- **Lottie preview in the panel.** The *Result* plays a Lottie export in lottie-web or dotLottie,
  a `.lottie` with its state machine (click the preview). The players are separate bundles
  loaded only then (lottie-web 217 KB, dotLottie 58 KB + 1.2 MB WebAssembly); tested inside
  Animate 2024.
- **Shape tweens as path morphs.** SMIL output and the JS player draw a shape tween as one
  drawing whose path data, colours and gradients blend from the start to the end shape, instead
  of a drawing per frame. Animate's in-betweens are such blends, but its SVG export writes each
  frame anew; the frames are matched up again (contours started elsewhere or turned around,
  lines for curves, holes in another order, edges that shrank to nothing put back), start and
  end are fitted to all frames and every frame is checked against Animate's drawing (twip
  rounding); frames that don't fit stay drawings. Classic and custom eases give the blend ratio,
  frames that follow another ease get their own; radial gradients blend in a linear form
  (radius 1, size in the matrix); gradient and pattern matrices are SMIL `animateTransform`s
  where rotation and skew stay (the player blends any matrix). Test documents, SMIL: a simple
  tween 13.3 → 2.3 KB, 119 frames 75.5 → 12.7 KB (gzip 17.0 → 2.4 KB), the morph test
  document 334 → 104 KB; player 61.6 → 21.1 KB. One step per frame: 20–47 % smaller
  (gzip about the same). The analysis takes 2–20 ms per tween (a 2000-edge shape over 120 frames:
  0.2 s). Animations of looping movie clips that repeat are written once with their own
  repeating timing. CSS output keeps a drawing per frame. `--no-morph` turns it off.
- The player runtime with the morph code (1.3 KB) is only in programs with shape tweens.
- **Image formats and compression per bitmap.** Lossy bitmaps (*Photo (JPEG)* in Animate) as
  JPEG, WebP or AVIF; lossless ones (*Lossless (PNG/GIF)*) as optimised PNG or WebP lossless,
  pixel for pixel. Animate's setting decides by default and can be overridden per bitmap in the
  panel's new *Images* section (or `--image-mode` on the command line); quality from Animate or
  one for all. Transparent photos become WebP instead of losing their transparency; pictures
  that are smaller without loss stay lossless. The panel shows format and size of each bitmap.
- Fixed: photo bitmaps were exported at JPEG quality 100, ignoring Animate's quality setting
  (imported JPEGs grew to about three times their size). A test document with a JPEG, a
  transparent icon, a pixel pattern (repeated and clipped) and transparent "photo" bitmaps:
  about 150 KB before, 31 KB now with the default settings (WebP 22 KB, AVIF 14 KB).
- The encoders (WebAssembly builds of the Squoosh codecs) load only when a document has bitmaps;
  the panel starts as fast as before.
- **Bitmaps shown smaller are written smaller.** The largest size each bitmap is shown at on stage
  is worked out over every frame (nested symbols, tweens, layer parenting, the camera, bitmap
  fills), and the bitmap is resampled (Lanczos 3, premultiplied alpha) down to twice that size by
  default (*Resolution* in the panel's *Images* section, `--image-resolution`; *Full* per bitmap,
  `--image-full`). It is still drawn at its full size. Pixel art and repeating fills keep every
  pixel, and so does a bitmap whose smaller file wouldn't be smaller. A 12-megapixel photo shown
  at 20 %: JPEG 1042 KB → 100 KB (1.6 s → 1.2 s), WebP 1645 KB → 36 KB, AVIF 133 KB → 13 KB
  (6.8 s → 1.1 s), lossless PNG 15 MB → 2 MB. Bitmaps the export never draws (only on guide
  layers) are no longer encoded at all.
- **The JS player runs big scenes smoothly.** Tweened transforms and alpha are Web Animations
  now: the browser plays them on the compositor, the artwork stays rastered, the player only sets
  them when a timeline jumps (goto, loop, stop, speed). A scene of 150 tweened instances of a
  detailed drawing: 1.2 fps before, about 110 fps now (Edge, measured). Symbols with hairlines
  (non-scaling strokes) are moved by the player as before, as their outline changes with every
  transform; the camera moves the stage as a Web Animation too. Unchanged transforms are no longer
  written again every frame.
- **The player rests out of view** (and in background tabs) and goes on where it was; one whose
  sound is on keeps playing, like a video.
- **Reduce motion:** with `prefers-reduced-motion` set, SMIL and CSS output show the poster frame,
  the JS player shows it until a click (*Still poster for “reduce motion”*, on by default;
  `--ignore-reduced-motion`). SMIL gets a still copy of the poster frame for it (+2–19 % for the
  test documents, the bigger share for the tiny ones); CSS and the player need no extra data.
- Fixed: `stop()` and `gotoAndStop()` left the player interpolating towards the next frame until
  the next tick.
- Fixed: a paused or stopped player drew tweened symbols up to half a pixel off their still frame
  (browsers draw paused Web Animations on the compositor, snapped to whole pixels): held
  animations become plain styles until they play again.
- Fixed: with one step per frame, a movie clip the player holds (a stop, the end of a single
  play) could show the frame before (the step lies right at the frame's time).
- The player runtime is 14.3 KB (was 12.3 KB); programs with sounds get a build with the mixer
  (17.8 KB). Its internal names are shortened in the bundle.
- Not done: compressing the player's timeline data (measured: −24 % on disk, but transfer with the
  usual gzip/Brotli of web servers gets a little bigger, and unpacking costs time).
- **Size overview.** After an export the panel shows a bar of what the size is made of (drawing,
  animation, images, sounds, the player's script, linked files) and the biggest drawings by symbol
  and layer; the command line prints the same split. Measured while writing the file (each part of
  `<defs>` is serialized once anyway), so it costs nothing extra.
- Fixed: every place a bitmap was drawn embedded its own copy of the file (the JS player also
  one more for its poster frame). Each bitmap is now in the file once: the image test document's
  player export went from 432 KB to 224 KB.
- **Sounds as MP3, Opus or WAV, cut to what plays.** Animate's sound properties decide (*Raw*
  stays uncompressed, everything else is compressed at its MP3 bit rate, or 128/64 kbps scaled down for low sample rates; *Convert
  stereo to mono* is followed), the panel's new *Sounds* section (or `--sound-format`,
  `--sound-bitrate`, `--sound-mode`) overrides it. Imported MP3s at their own quality stay as
  they are. Before, every sound was embedded as Animate's WAV, padded with silence: the sound test
  document went from 886 KB of WAV to 64 KB (MP3) or 41 KB (Opus).
- **The JS player plays sounds like Flash** (Web Audio): in and out points, loops without gaps,
  the effects and custom envelopes (fade, panning), *Stream* sounds following the playhead (after
  a goto they join at that frame; they stop with the timeline), sounds on button states. Before,
  the effects, in/out points and the stream sync were ignored and a loop restarted the file.
  Pause and hidden tabs hold the sounds; seeking plays no sounds of the frames passed. Blocked
  autoplay: sounds run on silently and join at their position at the first click.
- Warnings: sounds in SMIL/CSS/still output (they only play in the player), sounds inside graphic
  symbols (they don't play, as in Flash).
- Tests: a downscaling test document (f44: a photo at a quarter, a bitmap in a tweened clip,
  clipped and repeated bitmap fills, pixel art, a rotated bitmap scaled per axis); the comparison
  with Animate can re-encode the images first (`--images=webp|avif|lossless`; "lossless" never
  took effect before);
  resvg (for information) runs in a child process, so a resvg crash no longer ends the run.
  The Animate watchdog leaves progress windows alone (it closed "Exporting Image Sequence"): only
  windows of an idle Animate count as dialogs.
- **Leaner CSS output.** An instance is one element: the individual properties `translate`,
  `rotate` and `scale` carry its tweens (each with its own timing, sharing keyframes where they
  can), `transform` what follows them (a skew, the transformation point). Before, every animated
  part had an element and an animation of its own. Keyframes leave out the timing most of them
  use (it is the animation's own: `animation:… cubic-bezier(…)`), keyframes that look the same
  share one rule (`75%,to{…}`), and keys that all lie on one line — Animate's frame-by-frame
  samples, stepped output — become one keyframe pair with a `linear()` timing function, where
  that is shorter (exact: flat stretches for steps, jumps where Animate jumps). Tracks with
  different key times are merged exactly (eased pieces cut, no sampling), parts that only move
  below the printed precision (Animate's ±0.001° skew of sampled frames) stay still. The 46 test
  documents: 1737 → 1295 KB (gzip 459 → 427 KB), stepped 2042 → 1375 KB (490 → 444 KB); e.g. the
  stress test 236 → 139 KB, the eases one stepped 30.4 → 9.9 KB. Playback costs Edge the same or
  a little less (style recalculation −2 to −19 %). Checked frame by frame in Edge, Firefox and
  WebKit (all 46, smooth and stepped). Needs browsers from 2023 on: `linear()` (Chrome/Edge 113,
  Firefox 112, Safari 17.2; older ones move such a stretch linearly) and the individual transform
  properties (since 2022). The poster stays in the `transform` attribute for renderers without
  CSS; while the animations run their keyframes hold `transform:scale(1)` in its place (WebKit
  lets `transform:none` fall back to the attribute).
- **Decimals from the displayed size.** *Decimals* is the precision on screen: a symbol shown at
  a tenth of its size gets a decimal less, one shown 8 times larger one more (rounded on the log
  scale, so the error on screen stays within about three times what the setting gives at 1:1).
  Angles and scale factors get as many as the content they turn or stretch spans, but never
  fewer than before (3 and 4: their error lands on the whole outline; a large picture gets
  more). Measured from the timelines before anything is drawn (the largest scale each symbol is
  shown at over all its uses and frames, how far its content reaches; < 0.2 ms). SMIL, CSS,
  player and still frames; in the test documents (mostly shown 1:1) a little smaller: SMIL
  1078 → 1070 KB, stepped 1381 → 1355 KB.
- **Compressed .svgz** (*Compressed .svgz* in *Advanced*, `--svgz`): gzip of the same SVG, the
  same bytes on every export; the size overview counts it compressed. For design tools and for
  servers that send `.svgz` with `Content-Encoding: gzip` — tested: Edge, Firefox and WebKit open
  it only then, not from disk and not from a server that only sends the type. On the web, plain
  SVG compressed by the server is smaller: the 46 test documents as SMIL 1070 KB, .svgz 372 KB,
  Brotli 341 KB. Node's zlib packs it (the CLI and the panel; 3–8 % smaller and faster than the
  JavaScript fallback).
- **SMIL morphs gradients that turn.** A shape tween whose radial gradient turns used to be drawn
  frame by frame in SMIL; now its `gradientTransform` is animated as translate, rotate, skew and
  scale from the matrix's decomposition at every frame (matrices blended linearly don't turn
  evenly), each cut to the keys linear interpolation needs: exact at every frame in Edge, Firefox
  and WebKit. Test document f53: 29.3 → 5.3 KB. Repeating bitmap fills that turn keep their frames:
  WebKit draws an animated pattern that is turned and scaled a little off (also when only its
  rotation is fixed, now frames as well).
- **Lottie: repeating bitmap fills share their tiles.** A fill's tiles are laid out once in the
  pattern's own space and placed by the pattern's transform, so the frames of a shape tween share
  one grid even while the fill turns (each frame used to carry its own tiles; keyed by content,
  not by each drawing's copies of the definitions). The morph test document 250 → 141 KB
  (.lottie 35 → 28 KB), the image documents a little smaller too; unchanged in all three players.
- **Labels as dotLottie states.** A .lottie of a document whose code snippets make buttons jump
  holds the whole root timeline and a state machine: frame 1, the frame scripts' and the buttons'
  jump targets are states playing up to the next stop() or jump (gotoAndStop targets: stills),
  clicks on the buttons' layers fire the jumps, *Go to Web Page* opens with OpenUrl. Checked in
  dotlottie-web: f47's buttons go to frame 2 and play to the stop(), and to the "end" label.
- **Video components.** AS3 *FLVPlayback* and HTML5 Canvas *Video* components become an HTML
  `<video>` in a `<foreignObject>` over their place, in SMIL, CSS, the player and still frames;
  the linked file is copied next to the SVG (`videos/`), autoplay is muted (as browsers require),
  loop, controls and poster follow the component. Tested in Edge, Firefox and WebKit, inline and
  in an `<object>`: the video plays where the component was (`scripts/e2e-video.ts`; test
  documents f51, f52). Found on the way: a self-closing `<video/>` inlined in an HTML page stays
  open (the HTML parser ignores "/>" there) and swallows what follows — written with an end tag.
- **GIF and WebP fallbacks** (`--format gif|webp`): the timeline's first pass as an animated
  GIF (a palette per frame, 1-bit transparency, delays rounded on the running total so the length
  stays) or an animated WebP (lossy at the image quality with alpha; each frame only the rectangle
  that changed, written by our own RIFF muxer). Identical neighbouring frames merge. Frames come
  from the still renderer tick by tick (nested clips at their own playheads), rasterised by resvg
  (WebAssembly) in the CLI and by the browser in the panel. Checked frame by frame with
  ImageDecoder in Edge: GIF exact at pixelmatch's colour threshold, WebP within 0.12 %; e.g. the
  nested-clips test document 48 KB GIF / 28 KB WebP, exported in 0.2 s.
- **Web component** `<flash2svg-player src="hero.svg">` (1.7 KB, `dist/web`): loads an export
  when it comes near the screen, puts it inline (scripts run: the JS player, code snippets, start
  triggers; scroll-driven CSS works) and shows its children until then; `element.player` is the
  player's API, `load` / `error` events. Tested: fetched only near the screen, the player runs,
  a CSS scroll export inside follows the scroll.
- **Tinted bitmaps in Lottie.** Tint and brightness on a bitmap become Lottie's Fill effect (the
  colour mixed in by the amount, keyed when it changes); lottie-web, dotLottie and Skottie draw it
  like our SVG. Other colour effects on bitmaps (unequal multipliers) still show only their alpha
  (warned). Test document f50.
- **dotLottie loops keep their length.** dotLottie players play an animation over [0, op − 1]
  including its last frame, so every loop ran a frame short (its last frame only flashed at the
  wrap). A .lottie now holds the last frame once more and its intro / loop markers cover their
  full length: measured, a 48-frame loop takes 2000 ms of 2000 (before: a frame less).
- **Fonts for dynamic and input text.** The installed fonts are embedded as WOFF2 subsets of the
  characters used (`@font-face`, HarfBuzz's subsetter and a WOFF2 encoder, both WebAssembly, loaded
  only when a document has such text; no hinting: Arial for 24 characters 14.3 → 2.6 KB), so the
  text looks the same on every computer and stays text. Fonts are found by their name tables
  (system and user font folders, collections; ~0.3 s), licences that forbid embedding are
  respected. Laid out by the fonts' metrics as Animate does — which also fixed our dynamic text
  sitting 2 px too low and right (the field's matrix already includes its gutter) and wraps
  multiline fields. Test document f49 (Arial, Times bold italic, Georgia, an input field, text in
  a moving clip): Edge and WebKit load every face; SMIL, CSS and the player pass in Edge, Firefox
  and WebKit; *Embed fonts* (`--no-embed-fonts`).
- **All scenes in a row.** *Source: All scenes in a row* exports a document with several scenes
  as one animation, the scenes one after the other as Flash plays them: frame numbers, scene jumps
  (`gotoAndPlay(5, "Scene 2")`, also in code-snippet handlers), `nextScene()` / `prevScene()`
  and labels (named with their scene where two scenes share one) count on the joined timeline
  (`src/core/scenes.ts`). Before, only the current scene was exported.
- **Animate's Output panel is checked.** The panel self-test saves and clears it after every job,
  the fixture build and the extraction after their run: errors there fail the test. It caught the
  accessibility settings being read in HTML5 Canvas documents, which Animate reported as
  unsupported for every property.
- **Automatic format** (`--format auto`): the JS player when sounds or mouse handlers need its
  script, otherwise CSS (its transforms play on the compositor), or SMIL when that is more than
  15 % smaller (shape tweens: SMIL morphs one drawing, CSS draws every frame). The test
  documents: CSS 40, SMIL 5, player 3. The choice and the sizes are the first message.
- **Scale modes.** *Size* (`--scale fixed|fit|fill|stretch`): the stage size as before, or
  filling the space the page gives the SVG like Flash's *show all* (letterboxed in the stage
  colour when the background is exported), *no border* and *exact fit*. Checked in the browser
  against the fixed-size frame placed the same way.
- **Accessibility.** The settings of Animate's *Accessibility* panel go into the SVG: the
  document's name and description as `<title>` / `<desc>` with a role (`img`, or `group` when
  parts are accessible), named instances as labelled images with their descriptions, buttons with
  role, shortcut and tab index, *Make object accessible* off as `aria-hidden`; static text drawn
  as outlines keeps its words as a label (+2 KB over the test documents). The JS player sets the
  same at run time, and instances with a click handler can be used with Tab and Enter / Space.
  Checked in the browser's accessibility tree (Playwright `ariaSnapshot`). Test document f48.
- **Start when visible.** *Start: When visible* (`--begin visible`) starts the animation once half
  of it is on screen. SMIL and CSS hold it with a few lines of script, so it still plays where
  scripts don't run (`<img>`); the JS player waits for its first sight.
- **Scroll.** *Start: On scroll* (`--begin scroll`, `--scroll-range visible|crossing|page`) lets the
  scroll position run the animation once: while it is fully visible, while it crosses the screen,
  or with the whole page. CSS uses scroll-driven animations (a `view-timeline` on the SVG; inline
  SVG), SMIL and the JS player set their time by script (inline or in an `<object>` of the same
  site; alone or in `<img>` they just play). Measured first in Edge, Firefox 159 (now without a
  flag) and WebKit, which map time durations onto the scroll range the same way; tested frame by
  frame at scroll positions, inline and in an `<object>`, in all three. The player scrubs forward
  step by step and replays from the start backwards (about 7 ms a frame for 150 tweened symbols).
- **Animate's code snippets.** Mouse handlers in frame scripts — *Click to Go to Frame and Play /
  Stop*, *Go to Web Page*, *Mouse Over / Out*, *Click to Hide an Object* and the like, in AS3 and
  HTML5 Canvas syntax — run in the JS player: click, mouse over / out, down / up and double click
  on the timeline or named instances, with frame jumps, play / stop, next / previous frame and
  `visible` on this timeline, the root, the parent or named instances, and web pages. Instances
  with a click handler show the hand cursor. SMIL, CSS and still frames turn *Go to Web Page* into
  an SVG link and warn about the rest. The handlers' jumps used to be taken for frame actions.
  The handler code comes into the player's script only when a document has handlers (14.6 →
  17.4 KB). Test document f47 (Animate's own snippet texts).
- **Player:** a `stop()` on frame 1 now holds when the player starts by itself (the start used to
  override it, also on hover), and a movie clip created at the start or after a jump runs its
  first frame's script before it advances (a `stop()` there was skipped).
- **SMIL plays in Safari.** WebKit doesn't run SMIL animations inside a `<use>` copy on an element
  that holds another `<use>` (our shared drawings), and only sometimes through two `<use>`: nested
  symbols stood still in Safari (10 of the 46 test documents, also during normal playback). SMIL
  now writes animated symbols in place like CSS does and shares only still content; the test
  documents grow 1069 → 1086 KB (gzip 373 → 372 KB).
- Tests: the browser check runs in Firefox (the installed one, over WebDriver BiDi) and WebKit
  too (`--browser=firefox|webkit`): SMIL, CSS and the player pass all 46 test documents in Edge,
  Firefox and WebKit; unit tests for the keyframe encoder (with a `linear()` evaluator after the
  CSS Easing 2 rules), the decimals and .svgz.

## 4.0.0 (2026-10-30)

Complete rewrite.

- New extractor that works on a temporary copy of the document and uses Animate's own tween
  interpolation and SVG exporter; supports HTML5 Canvas documents.
- Exact easing: classic eases (quadratic), multi-point custom eases with overshoot, per-property
  eases; verified against Animate frame by frame.
- Modern (object-based) motion tweens, motion guides, orient to path, camera, buttons, frame
  sounds, frame scripts (`stop`, `play`, `gotoAndPlay`, `gotoAndStop`).
- Output formats: SMIL, CSS keyframes, JS player (with API), still frames.
- More filters (inner shadow, bevel, gradient glow/bevel, knockout, hide object) and blend modes
  (add, layer).
- Linear-RGB gradients rendered correctly.
- New panel (Svelte 5, CEP 11/12) with presets, preview, per-document settings.
- Command line compiler, unit tests and Animate/browser end-to-end tests.
- Requires Animate 2022 or later. (3.x supported CS5.5–CC 2019.)

### 4.0.0 (2026-10-30): changes since rc.1

- **Semi-transparent symbols look like in Animate.** Flash applies an instance's alpha to every
  shape inside it, so overlapping parts show through each other (most visibly the inner half of a
  stroke over its fill). The export used a group opacity, which hid them; it now sets the alpha
  on the shapes (inherited `fill-opacity` / `stroke-opacity`), which browsers also draw faster (no
  offscreen group). Instances with filters, the *layer*, *invert* or *subtract* blend, or bitmaps
  inside stay one picture.
- Strokes with the scale option *None* keep their width when the symbol is scaled (they scaled
  like normal strokes). *Horizontal* and *Vertical* scale like normal strokes (warned).
- *Loop: once* with a frame script that jumps back (`gotoAndPlay("intro")` on the last frame):
  the JS player now ends after the first pass like SMIL and CSS (it kept playing); its *last
  frame* poster and the reported duration follow the scripts too.
- Frame scripts: `gotoAndPlay(1, "Scene 2")` into another scene is left out with a warning (it
  was read as a jump within the current scene); labels may contain commas and brackets.
- Alpha in fill and stroke colours is written as `#rrggbbaa` (shorter, and it leaves the
  inherited alpha alone).
- Tests: new fixtures for edge cases (content appearing late, instances flipping and collapsing
  through scale 0, special characters in symbol, layer, label and instance names and in the file
  name, an odd frame rate, a cross-scene jump, an empty document, a 1920×1080 stage at 60 fps,
  stroke scale options, hairlines, dotted, dashed and ragged strokes, caps, joins and miter limits)
  and for alpha on symbols (masks, nesting, bitmaps, filters, blend modes, cache as bitmap).
- Tests notice when Animate crashes, hangs or shows a dialog: the dialog is saved as a picture
  and closed (Esc), a hung or crashed Animate is ended, and the run fails with the reason instead
  of waiting for the timeout.
- CLI: options also take the `--format=css` form.

### 4.0.0-rc.1 (2026-10-30): changes since alpha.2

- **The user's document could be closed without saving.** With some (older) documents Animate
  hands back the open original instead of the temporary copy the exporter works on; cleaning up
  then closed the user's document. The exporter now tries new copies, falls back to the file as
  last saved (warned), and never closes the source document.
- Symbol instances inside groups (also nested groups) keep animating: the group's drawing and
  its instances are exported separately. Before, the whole group was a still picture.
- Animate's Output panel is captured in all test runs; two messages it showed during exports of
  HTML5 Canvas documents (`scalingGrid`, `motionTweenScale` not supported) are gone.
- Filters (drop shadow, glow, blur...) on rotated or scaled instances: the shadow direction and
  blur sizes now follow the stage like in Animate (they turned with the instance; SMIL/CSS also
  shrank them by the instance's scale). Fewer distinct filter definitions in the output.
- Movie clips keep running after the main timeline stops (`stop()`), as in Flash: SMIL and CSS
  output play the stopped timeline once, then loop the clips' common period. Before, SMIL/CSS
  froze everything at the `stop()` — e.g. a one-frame main timeline with all the animation inside
  movie clips came out as a still picture.
- Frame scripts: HTML5 Canvas frame numbers count from 0 (`this.gotoAndPlay(0)` is frame 1); the
  banner idiom "play N times, then stop" (pass counters in `if`/`else`, Animate's code snippet
  included) is followed; other conditional actions are warned about. A frame that runs
  `gotoAndPlay()` is not shown in SMIL/CSS either (the player already skipped it, like Flash).
- *Loop: once*: everything holds the last frame that was shown (SMIL/CSS held the state one
  frame later; the JS player let movie clips run on).
- JS player: graphic symbols nested in graphic symbols showed a wrong frame until the next tick.
- Bitmap fills: the image was missing (Animate's SVG export links it as a file); clipped bitmap
  fills extend their edge pixels like Animate.
- *Linear RGB* gradient strokes; strokes thinner than a pixel draw as 1 px hairlines like Animate.
- Blend modes: *invert* and *subtract* exact (invert was approximated, subtract dropped), *alpha*
  and *erase* implemented inside symbols placed with the *layer* blend, also between other
  elements of one layer (alpha acts within the element's bounds only, like Flash; elsewhere
  Animate doesn't draw them).
- Faster artwork import and output (path compaction was quadratic in rare cases; duplicate
  detection only compares drawings that may match): about 10% on big drawings.
- Extraction pastes artwork straight onto the end of the atlas timeline (no blank keyframe
  first): about half the paste time in long Animate sessions.
- Still frames: movie clips inside graphic symbols keep running while the main timeline holds.
- Tests: the comparison with Animate's rendering now rasterises in Edge (resvg alongside); new
  fixtures for deep nesting, paint styles, animated masks, `stop()` with running clips, motion
  tweens with property keyframes, blend modes, an HTML5 Canvas banner, text, filters on rotated
  instances, groups with symbols and nested layer folders. Real-world files from other projects
  were used as inspiration for these (own AS3 fixtures only).

### 4.0.0-alpha.2 (2026-10-29): fixes since alpha.1

- CLI: the built `dist/cli/flash2svg.js` did not start (duplicate shebang); options are validated
  (`--format`, `--loop`, `--begin`, `--poster`, `--digits`, `--delay`, `--frames`).
- CSS: an animation that stops (`stop()` on the last frame, *Play once*) now holds its last frame
  instead of falling back to the first one.
- JS player: `play()` after a *Play once* animation ended plays it again; `muted = true` also
  silences sounds that are already playing; finished sounds are released.
- Bitmaps with smoothing turned off stay pixelated in SMIL, CSS and player output (was static only).
- Panel: empty or out-of-range *Decimals* / *Delay* fields no longer produce `NaN` in the SVG; the
  preview uses the format that was actually exported; temporary files are removed after failed or
  cancelled exports; output paths containing `#` work.
- Toolchain: Node 24+ required (22 is end-of-life), CI on Node 26 LTS; `npm run typecheck` runs
  TypeScript 7 over `src`, `tests` and `scripts` plus `svelte-check` for the panel components
  (TypeScript 6 is installed only as the API for svelte-check); Prettier pinned with the Svelte
  plugin and a project config; npm 12 `allowScripts` for esbuild.
- Several exports can be inlined into one HTML page: every id (artwork, gradients, filters,
  masks, CSS selectors and keyframes, player runtime ids) starts with a per-export prefix
  (`idPrefix`, CLI `--id-prefix`; default a short deterministic hash). Before, inlined SVGs
  overwrote each other's artwork and filters.
- Bevel filters match Animate pixel for pixel (the highlight/shadow offset was half the
  distance); gradient bevels use their whole gradient instead of the first and last colour.
- Documents with several scenes: warning that only the current scene is exported.
- Release builds of the panel no longer contain the self-test hook (a `flash2svg-selftest.json`
  in the temp folder made the panel run exports and quit Animate); only `build.mjs --selftest`
  includes it.
- Layer parenting now works in SMIL, CSS and player output (only still frames followed the parent
  layer before).
- 9-slice scaling: movie clips with 9-slice guides keep their corners when scaled (the guides
  were ignored before), also while the scale is tweened. Graphic symbols inside are sliced too;
  rotated instances scale normally.
- Layer effects of advanced layers (colour effect, filters, blend mode on the layer) are exported;
  they were read but dropped.
- Filter tweens that start from no filter (only the end keyframe has filters) are animated; they
  were exported without filters.
- "Linear RGB" gradients stay linear RGB through shape tweens (in-between frames used sRGB).
- Shape tweens: in-between frames are baked in the working copy before they are exported. When
  Animate had already opened another document in the session, every in-between frame could come
  out as the start shape, or all of them shifted (the start keyframe reports the bounds of the
  whole tween, which threw off the paste offset).
- Tests: fixtures for 9-slice, reverse graphic loops, brightness / advanced colour, invisible
  instances, hidden layers, dashed strokes, filter tweens, masks over several layers and inside
  symbols, layer effects and gradient shape tweens; the layer parenting fixture really parents
  now (Animate 24 takes `setRigParentAtFrame(parentLayer, frame)`). The browser check commits seeked CSS values
  as static styles (no compositor rounding) and allows 0.15% differing pixels instead of 1%, the Animate comparison 0.3% (a whole misplaced object
  used to pass).
- Tests: second filter fixture (bevel types, knockout, gradient filters, quality, hide object),
  inline-embedding test, `npm run e2e:panel` (the panel inside Animate: formats, current frame,
  range, library symbols, scenes, linked images, temp clean-up; leaves Animate as it was).
- Tests: bitmap fixture, end-state and `--steps` checks in the browser test, and a new player
  interaction test (`scripts/e2e-player.ts`).
