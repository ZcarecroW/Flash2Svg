# The user guide

Source of <https://zcarecrow.github.io/Flash2Svg/>: Markdown pages, demo animations made in
Animate with this exporter, and screenshots of the panel. Every script explains itself at its top.

| Step | Command | Needs |
|---|---|---|
| Build the site into `dist/` (pages, demos in every format with their real sizes, search index) | `node docs/guide/build.mjs` | — (3 s) |
| Check it in Edge: every page at desktop and phone width, every demo tab, search, theme | `node docs/guide/tools/check.mjs` | Edge (10 s) |
| Publish: force-push `dist/` as one commit to the `gh-pages` branch | `node docs/guide/publish.mjs` | push access |
| Remake the demo animations (`demos/build-demos.jsfl` draws them, `extract-demos.jsfl` extracts them into `demos/models/`) | `node docs/guide/tools/demos.mjs [name,name]` | Animate, closed |
| Retake the panel screenshots (`images/*.webp`) | `node docs/guide/tools/screenshots.mjs` | Animate, closed; ZXPSignCmd |

- **Pages** are `pages/*.md` in the order of `NAV` in `build.mjs`. Links between pages are
  written as `page.md`; a broken link or anchor fails the build. A live demo is
  `::: demo <name> <format,format,...> [inline] [caption]`, and `{{size <demo> <format>}}` prints
  a demo's size.
- **Demos** are compiled at build time by this checkout's compiler, so the guide always shows what
  this version writes. Only their scene data is committed (`demos/models/`); the FLAs
  (`demos/fla/`) are made again by `demos.mjs`.
- **Icons** are Nucleo icons (licensed, in `theme/icons/`, listed in `theme/icons.txt`); don't add
  more than the licence allows in a public repository (100).
- **GitHub Pages** serves the `gh-pages` branch (no Jekyll). Its paths are case-sensitive:
  `zcarecrow.github.io/flash2svg` and other spellings are forwarded by the user site's repository
  (`ZcarecroW/zcarecrow.github.io`).
