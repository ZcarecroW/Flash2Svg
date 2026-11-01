---
title: Interactivity
description: Start an exported animation on click, hover, when visible or with the scroll; buttons with Over and Down states; the mouse handlers Animate's Code Snippets panel writes; links.
---

# Interactivity

## Start modes

*Animation › Start* decides when the animation begins.

| Start | What happens | Where |
|---|---|---|
| **Automatically** | plays at once | everywhere |
| **On click** | waits for a click on it; a click later starts it again | SMIL, CSS, JS player, .lottie |
| **On hover** | starts when the pointer comes over it | SMIL, CSS, JS player, .lottie |
| **From script** | waits for your page (see [Player API](player-api.md)) | SMIL, CSS, JS player, .lottie |
| **When visible** | starts once half of it is on screen (or it fills half the screen) | where scripts run: inline, `<object>`; in `<img>` it just plays |
| **On scroll** | the scroll position runs it, once, first frame to last | see below |

*Delay* waits that many seconds before starting.

### On scroll

The page's scrolling plays the animation forwards and backwards. *Scroll range* says over which stretch:

- **While fully visible** — from the moment it is all on screen until it starts to leave (or, when it is taller than the screen, while it covers it);
- **While crossing the screen** — from entering at the bottom to leaving at the top;
- **With the whole page** — the page's whole scroll.

::: demo scroll css inline Scroll this page: the wheel rolls and the bar fills while the demo is fully visible.

Inline in a page, CSS output uses the browser's scroll-driven animations (`view-timeline` and `animation-timeline`: Chrome and Edge from 115, Safari 26, current Firefox), which run off the main thread. Where they can't follow the page — in an `<object>` or `<iframe>` of the same site, inside a box with `overflow: hidden` (a view timeline follows its nearest scrolling box, and that one never scrolls), in older browsers — a few lines of script set the time from the scroll position instead. SMIL and the JS player always do it by script. Opened by itself, in an `<img>` or in a frame of another site, it just plays: no script there can see the page.

## Buttons

Button symbols keep their **Up**, **Over** and **Down** states. In SMIL and CSS output the states switch with CSS `:hover` and `:active`, so they work wherever the SVG is interactive (inline or in an `<object>`). The JS player follows them exactly, *Hit* area included.

## Code snippets

The mouse handlers that Animate's **Code Snippets** panel writes into frame scripts run in the JS player — in AS3 and HTML5 Canvas documents:

```actionscript-3
stop();
btn_play.addEventListener(MouseEvent.CLICK, fl_ClickToGoToAndPlayFromFrame);
function fl_ClickToGoToAndPlayFromFrame(event:MouseEvent):void
{
	gotoAndPlay("bounce");
}
```

::: demo button player The frame script stops on frame 1; the button's click handler (the snippet above) plays the bounce.

Recognised:

| | |
|---|---|
| **Events** | click, double click, mouse over and out (also roll over and out), mouse down and up — on the timeline itself or its named instances |
| **Syntax** | `btn.addEventListener(MouseEvent.CLICK, …)`, `this.btn.addEventListener("click", ….bind(this))`, `.on("click", …)`, function literals and arrows |
| **Actions** | `gotoAndPlay()` / `gotoAndStop()` (frame or label), `play()`, `stop()`, `nextFrame()`, `prevFrame()` on this timeline, the root, the parent or named instances (`MovieClip(this.root)`, `exportRoot`, `this.parent`, `event.currentTarget`); `instance.visible = true / false`; *Go to Web Page* (`navigateToURL(new URLRequest(…))`, `window.open(…)`) |

Other code in a handler is warned about. Instances with click handlers show the hand cursor and can be reached with <kbd>Tab</kbd> and clicked with <kbd>Enter</kbd> or <kbd>Space</kbd>.

**In other formats:** SMIL, CSS and still frames turn *Go to Web Page* into an SVG link and warn about the other handlers. A **.lottie** gets them as its state machine (see [Lottie](lottie.md#buttons-in-a-lottie)). *Automatic* picks the JS player when a document has mouse handlers.

## Links

Links set on text (*Properties › Options › Link*) make the text field a link in every SVG format, and *Go to Web Page* snippets link their button. Links work inline and in an `<object>`; in an `<img>` nothing is clickable.
