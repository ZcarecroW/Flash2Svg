# Changelog

## 4.0.0 (unreleased)

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
