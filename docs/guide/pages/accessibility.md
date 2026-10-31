---
title: Accessibility
description: What Flash2SVG carries over from Animate's Accessibility panel — titles, descriptions, roles, shortcuts and tab order — plus readable static text, keyboard access in the JS player and reduced motion.
---

# Accessibility

## From Animate's Accessibility panel

Whatever is set in Animate's **Accessibility** panel (*Window › Other Panels › Accessibility*, ActionScript 3 documents) goes into every SVG format:

| In Animate | In the SVG |
|---|---|
| The document's *Name* and *Description* | the SVG's `<title>` and `<desc>`; role `img`, or `group` when parts of it are accessible themselves |
| A symbol instance's *Name* | the instance becomes an image with that name (what is inside counts as part of it) |
| An instance's *Description* | a `<desc>` |
| Buttons | role `button`, their *Shortcut* as `aria-keyshortcuts` and their *Tab index* |
| *Make object accessible* off | the instance, text field or whole document is hidden from screen readers |

Documents without these settings stay as they were, apart from the static text labels below.

## Text stays readable

**Static text** is drawn as outlines, but its words stay in the file as the label of that drawing, so screen readers read it as they did in Flash. **Dynamic and input text** stay real text (see [Text and fonts](text.md)).

Give an animation that is used as an image a good `alt` text on the page:

```html
<img src="chart.svg" alt="Sales rose 40 % from March to June">
```

## Keyboard

In the JS player, instances with a click handler (from the Code Snippets panel) can be reached with <kbd>Tab</kbd> and clicked with <kbd>Enter</kbd> or <kbd>Space</kbd>, and they show the hand cursor.

## Reduced motion

Visitors who asked their system for less motion see the poster frame, still — see [Embedding](embedding.md#reduced-motion). The JS player plays when they click it.
