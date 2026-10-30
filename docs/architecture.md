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
5. Bitmaps and sounds are exported with `exportToFile()`. `scene.json` is written with a small
   JSON serializer; the copy and atlas documents are closed.

## Compilation

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
- **Bake** (`emit/bake.ts`, SMIL/CSS only): every timeline instance gets an array "local frame at
  each global tick"; tracks are mapped run by run onto the global clock with exact sub-Bézier cuts.
  Identical arrays share one definition. Movie clips that span the whole root timeline extend the
  horizon to a common multiple so they loop seamlessly. When the root stops, the horizon runs on
  until the clips still running have played their intros, then for their common period: the
  writers emit every animation once plus a looping *tail* (SMIL: begins at the end of a clock
  animation; CSS: a second, delayed infinite animation). Played once, everything holds the last
  tick shown.
- **Writers**: SMIL uses `display` animations for visibility and `animateTransform` per transform
  component (static parts folded into matrices). CSS uses class-based `@keyframes` with a timing
  function per keyframe; animated subtrees are inlined (CSS animations inside `<use>` shadow trees
  can't be paused or seeked). The player emits artwork in `<defs>`, a compact JSON program
  (`src/player/format.ts`) and the runtime (`src/player/runtime.ts`, bundled to ~10 KB).

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
  `scripts/e2e-player.ts` drives the JS player: labels, goto, loop modes, start modes, buttons,
  sounds. `scripts/e2e-inline.ts` inlines several exports into one HTML page.
- `scripts/e2e-panel.mjs`: the panel inside Animate (signed self-test build, `src/panel/lib/selftest.ts`):
  formats, current frame, range, library symbols, several scenes, linked images, temp clean-up.
- **Ids:** every id in an export starts with a prefix (`ExportSettings.idPrefix`, default a short
  hash of document, timeline and settings), artwork-internal ids included
  (`prefixArtwork`); the player's runtime ids start with its svg id.
- `tests/unit/output.test.ts`: output-level checks on the stored models (CSS end keyframes,
  settings sanitising).
