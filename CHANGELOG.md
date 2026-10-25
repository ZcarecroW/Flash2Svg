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
