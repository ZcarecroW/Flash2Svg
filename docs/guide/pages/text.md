---
title: Text and fonts
description: Static text as outlines with its words kept for screen readers, dynamic and input text as real text with its fonts embedded as WOFF2 subsets, text field borders, filters, links and password fields.
---

# Text and fonts

## Static text

Static text is drawn as **outlines**, exactly as Animate draws it — no font needed to view it. Its words stay in the file as an accessible label, so screen readers read it (as Flash did) and search engines see it.

## Dynamic and input text

Dynamic and input text stay **real text**: selectable, searchable, read aloud, and changeable by your page's scripts. Flash2SVG brings the fonts along:

1. it finds the installed font files by name (Windows, macOS and Linux folders, also font collections);
2. cuts them down to the characters the text uses (HarfBuzz's subsetter, as WebAssembly, without hinting);
3. embeds them as WOFF2 in an `@font-face` rule — Arial for 24 characters takes **2.6 KB**.

The text is laid out by the font's own metrics like Animate does: baselines from its ascent and descent, *multiline* fields wrapped at the field's width — within 1–2 pixels of Animate. Input fields carry all of Latin-1, so typing works.

::: demo text smil,css,player The heading is static text (outlines). The paragraph is dynamic text in Georgia — select it — and the countdown changes a dynamic field frame by frame.

Fonts whose licence forbids embedding (the font's *fsType*) and fonts that aren't installed are left to the viewer's fonts, with a warning. Untick **Embed fonts** to leave all of them out, or tick **Dynamic text as outlines** to draw dynamic text as shapes too. The size overview shows the fonts as a part of their own.

## Text field settings

| In Animate | In the SVG |
|---|---|
| *Show border around text* | a white field with a black outline behind the text |
| Filters on a text field (a drop shadow on a heading) | applied as on a symbol, in the stage's orientation |
| A link on the text (*Properties › Options › Link* and *Target*) | the field becomes a link (one per field) |
| *Password* input fields | a star per character — the text itself never leaves Animate |
| *Multiline*, *Multiline no wrap*, *Single line* | wrapped at the width only for *Multiline* |
| Instance name | `data-name="…"` for your page's scripts |

Change a dynamic field from your page:

```js
const svg = document.querySelector("object").contentDocument;
svg.querySelector('[data-name="score"] tspan tspan').textContent = "42";
```

## In Lottie, GIF and WebP

Lottie has no editable text that every player shows the same way, so all text is drawn as outlines there; text field borders, filters and links are left out (warned). GIF and WebP draw text as outlines too.
