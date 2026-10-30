# Changelog

## Unreleased

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
  by frame in lottie-web 5.13, dotLottie 0.82 (ThorVG) and Skottie (CanvasKit 0.42) — all 45
  within 0.15 % of the SVG frames, smooth and stepped, except the documented limits (filters,
  approximated blends, three ThorVG image quirks). The 45 test documents: 1369 KB of Lottie JSON,
  372 KB gzipped (SMIL: 1022 KB, 369 KB gzipped), 405 KB as .lottie; exporting all of them takes
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
  0.19 %: ThorVG blurs narrower). Bevels, gradient filters, inner and knockout shadows and glows
  have no Lottie effect (warned).
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
