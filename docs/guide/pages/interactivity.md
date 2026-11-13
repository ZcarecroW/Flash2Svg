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

Instances with click handlers show the hand cursor and can be reached with <kbd>Tab</kbd> and clicked with <kbd>Enter</kbd> or <kbd>Space</kbd>. Handlers that do more than this run as frame scripts (below).

**In other formats:** SMIL, CSS and still frames turn *Go to Web Page* into an SVG link and warn about the other handlers. A **.lottie** gets them as its state machine (see [Lottie](lottie.md#buttons-in-a-lottie)). *Automatic* picks the JS player when a document has mouse handlers.

## Frame scripts

Frame scripts run in the **JS player**, wherever scripts run: inline in a page, as a file of its own, in an `<object>`. *Automatic* format picks the player for a document that needs it.

- **ActionScript 3** is compiled to JavaScript at export. The language is there: variables and types with their conversions, functions, conditions, loops, `try`, Array, Vector, Dictionary, Date, Math, String, RegExp. So is the API people use in frame scripts: display objects and the display list, mouse, keyboard, `ENTER_FRAME`, timers, dragging, bounds and hit tests, matrices, colour transforms, filters, masks, text fields, drawing with `graphics`, bitmaps and pixels, library symbols, bitmaps and sounds with `new`, Sound, Loader, URLLoader, Tween, SharedObject, ExternalInterface, scenes.
- **HTML5 Canvas** documents' JavaScript runs as it is, on the CreateJS API: Shape and Graphics, Text, Tween, Ease, Ticker, Sound, its events and mouse.

What scripts see and the order things happen in are Flash Player's and CreateJS's own: the test documents trace everything they do, and the traces are compared line by line with Flash Player and with the document as Animate publishes it.

::: demo game player Drag the ball into the moving ring. All of it is the frame script below, compiled to JavaScript at export.

```actionscript-3
var score:int = 0;
ball.addEventListener(MouseEvent.MOUSE_DOWN, function (e:MouseEvent):void { ball.startDrag(); });
stage.addEventListener(MouseEvent.MOUSE_UP, function (e:MouseEvent):void {
	ball.stopDrag();
	if (ball.hitTestObject(goal)) label.text = "Score " + (++score);
});
```

A library symbol, bitmap or sound needs *Export for ActionScript* and a class name to be made with `new`; only those your scripts name are exported.

### Classes in .as files

The **document class** and the classes of library symbols run too, with every class they use. Flash2SVG finds the `.as` files where Animate does: through the document's class path (*File > ActionScript Settings > Source path*) and Animate's own, starting from the folder of the saved `.fla`. Then it follows what the classes import, their package and the top level.

- The language of classes: packages, `class` and `interface`, `extends` and `implements`, `super`, `static` members (set up when the class is first used), code in the class body, getters and setters, `private`, `protected`, `internal`, `override`, functions of a package, classes only their file sees, custom events and errors, `Vector.<` a class `>`, `getDefinitionByName`.
- The document class takes the main timeline: its stage instances are its variables, `stage` is there in its constructor, and the frame scripts are part of it (they reach its members). It may extend `MovieClip` or `Sprite`.
- A symbol whose class has a file, or whose base class has one, gives every instance its class's object: those on the timeline and those made with `new`. As in Flash Player, the objects are there first, the constructors run children first, then `ADDED` and `ADDED_TO_STAGE`.
- A class compiled to JavaScript runs Flash Player's order exactly: fields have their values before the base class's constructor runs, a constructor may use `this` before `super()`, a method taken as a value stays bound to its object.

```actionscript-3
package game {
	import flash.display.MovieClip;
	import flash.events.Event;

	public class Ball extends MovieClip {
		public var speed:Number = 4;

		public function Ball() {
			addEventListener(Event.ENTER_FRAME, roll);
		}

		private function roll(e:Event):void {
			x += speed;
			if (x > stage.stageWidth) x = 0;
		}
	}
}
```

Give the symbol *Export for ActionScript* and the class `game.Ball`, save the `.fla` next to a folder `game` holding `Ball.as`, and every ball rolls in the JS player. The classes come with a part of the player of 1.9 KB, only for documents that have them.

**Not supported in classes:** namespaces of code (`use namespace`, `mx_internal`), `include` in a class file and assets embedded with `[Embed]` (warned). A class that can't be read is named in the warnings with its line; the others still run.

### XML

XML and E4X work in frame scripts and classes, as Flash Player has them: literals with `{expressions}`, `new XML(text)`, children by name, `.@attributes`, `..descendants`, filters, `for each`, changes, and the same printing, whitespace rules and errors. XML namespaces too (`ns::name`, `default xml namespace`, `Namespace`, `QName`), so Atom and RSS feeds read as they did in Flash. A component's `DataProvider` can be made from XML.

```actionscript-3
var loader:URLLoader = new URLLoader(new URLRequest("menu.xml"));
loader.addEventListener(Event.COMPLETE, function (e:Event):void {
	var menu:XML = new XML(loader.data);
	for each (var item:XML in menu.item.(@visible != "no")) trace(item.@label, item.price);
	list.dataProvider = new DataProvider(menu);
});
```

Put `menu.xml` next to the exported file. The XML code comes with a part of the player of 16 KB (5.7 KB gzipped), only for documents that use XML.

Plain `stop()`, `play()` and frame jumps, simple mouse handlers and counted loops don't need any of this: they work in every format, and the player stays small (16.0 KB; 87 KB with scripts, and pixels and sounds, filters, classes or CreateJS add to it only if the scripts use them).

`BitmapData.draw()` works on display objects too: the player paints the movie clip, sprite or text onto the pixels at once, as Flash Player does (blurs and shadows aren't painted). Library bitmaps have their pixels at once as well, so a frame 1 script can read a collision map or a colour table from them.

**Not run:** a SWF can't be loaded, pictures can. Web pages block sound until the visitor clicks or presses a key, also for scripts.

**In other formats:** SMIL, CSS and Lottie follow plain frame jumps and warn that the rest needs the JS player.

## Forms and components

**Input text** and Animate's **UI components** become real HTML controls in SMIL, CSS and the JS player, so forms and quizzes work without any code: you can type, tick, choose and tab through them, and screen readers know them.

::: demo quiz player Input text, a ComboBox, radio buttons, a NumericStepper and a Button, with a few lines of frame script. Try it.

| Component | Becomes | |
|---|---|---|
| Button, CheckBox, RadioButton | `<button>`, `<input>` with its label | label, selected, toggle, group, label placement |
| ComboBox, List | `<select>` (editable: an input with suggestions) | the items of the Properties panel, prompt, several at once |
| TextInput, TextArea, Label | `<input>`, `<textarea>`, text | password, limit, read-only, word wrap |
| NumericStepper, Slider | number field, range slider | minimum, maximum, step, snap, direction |
| ColorPicker, ProgressBar | colour field, `<progress>` | |
| DataGrid, UILoader | table, picture | |
| TileList | a grid of pictures and labels | columns, rows, column width, row height, direction |
| ScrollPane | a box that scrolls | a picture, or a library symbol by its class name |
| UIScrollBar | the browser's scroll bar | the text field it scrolls |

In the **JS player**, frame scripts use them through `fl.controls` as in Flash Player: `ok.label`, `pick.dataProvider`, `one.group.selection`, `slide.value`, `new Button()`, `ComponentEvent.ENTER`, with the same events in the same order. A field's `restrict`, `maxChars`, `stage.focus` and `TextEvent.TEXT_INPUT` work too.

In **HTML5 Canvas** documents the components are what Animate publishes, found by their instance names: Animate's snippets work as they are (`$("#dom_overlay_container").on("click", "#ok", ...)`, `$("#name").val()`). The jQuery UI components (RadioSet, DatePicker) come with jQuery UI's look, and `$("#day").datepicker("getDate")` works without loading jQuery UI.

## Links

Links set on text (*Properties › Options › Link*) make the text field a link in every SVG format, and *Go to Web Page* snippets link their button. Links work inline and in an `<object>`; in an `<img>` nothing is clickable.
