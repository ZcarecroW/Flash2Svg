import flash.events.*;
import flash.text.*;
import flash.utils.*;
import flash.system.fscommand;

function say(e:Event):void {
	trace(e.type, e.target.name, e.currentTarget.name, e.bubbles, e.cancelable, (e is TextEvent) ? TextEvent(e).text : "", (e is FocusEvent) ? (FocusEvent(e).relatedObject ? FocusEvent(e).relatedObject.name : "none") : "", e.target.text);
}
function hear(t:TextField):void {
	t.addEventListener(Event.CHANGE, say);
	t.addEventListener(TextEvent.TEXT_INPUT, say);
	t.addEventListener(FocusEvent.FOCUS_IN, say);
	t.addEventListener(FocusEvent.FOCUS_OUT, say);
}
function look(t:TextField):void {
	trace(t.name, t.type, t.text, t.length, t.multiline, t.wordWrap, t.maxChars, t.displayAsPassword, t.restrict, t.border, t.numLines, t.width, t.height);
}

look(one); look(many); look(pass); look(most); look(nowrap); look(wide); look(shown);
trace(escape(many.text));
trace(escape(wide.text), wide.getLineLength(0), wide.getLineLength(1));
trace(escape(shown.text), shown.getLineLength(0), shown.getLineLength(1));
var f:TextFormat = one.getTextFormat();
trace(f.font, f.size, f.color, f.bold, f.italic, f.align);
trace(one.selectable, one.caretIndex, one.selectionBeginIndex, one.selectionEndIndex);

// ---- empty fields have their format, and it comes back when a script fills them
function format(t:TextField):void {
	var a:TextFormat = t.defaultTextFormat;
	trace(t.name, t.length, a.font, a.size, a.color, a.bold);
}
format(pass); format(blank);
blank.text = "Filled"; format(blank);
var g:TextFormat = blank.getTextFormat(); trace(g.font, g.size, g.color);

// ---- scripts may do what the user may not
most.text = "much too long"; trace(most.text, most.length); most.text = "four";
one.restrict = "a-c"; one.text = "xyz"; trace(one.text); one.text = "Hello"; one.restrict = null;
one.appendText("!"); trace(one.text); one.replaceText(0, 1, "J"); trace(one.text); one.text = "Hello";
many.scrollV = 1; trace(many.scrollV, many.maxScrollV, many.bottomScrollV);

// ---- the selection
one.setSelection(1, 3); trace(one.selectionBeginIndex, one.selectionEndIndex, one.caretIndex);
one.setSelection(99, 2); trace(one.selectionBeginIndex, one.selectionEndIndex);
one.setSelection(5, 5); trace(one.selectionBeginIndex, one.selectionEndIndex, one.caretIndex);
one.setSelection(1, 2); one.text = "New text"; trace(one.selectionBeginIndex, one.selectionEndIndex, one.caretIndex);
one.setSelection(1, 2); one.appendText("!"); trace(one.selectionBeginIndex, one.selectionEndIndex, one.caretIndex); one.text = "Hello";
shown.setSelection(2, 4); trace(shown.selectionBeginIndex, shown.selectionEndIndex, shown.caretIndex);

// ---- the type
try { one.type = "other"; } catch (e:Error) { trace(e.errorID, e.message); }
trace(TextFieldType.INPUT, TextFieldType.DYNAMIC, TextEvent.TEXT_INPUT, TextEvent.LINK, FocusEvent.FOCUS_IN, FocusEvent.FOCUS_OUT, FocusEvent.KEY_FOCUS_CHANGE, FocusEvent.MOUSE_FOCUS_CHANGE);
var off:TextField = new TextField(); off.name = "off"; off.text = "still text"; off.type = TextFieldType.INPUT; trace(off.type, off.text, off.multiline, off.wordWrap, off.selectable);
off.type = TextFieldType.DYNAMIC; trace(off.type, off.text);
off.type = TextFieldType.INPUT; off.x = 20; off.y = 300; off.width = 200; off.height = 22; off.border = true; off.displayAsPassword = true; trace(off.text, off.displayAsPassword); off.displayAsPassword = false; addChild(off);
off.multiline = true; off.wordWrap = true; off.text = "a\nb"; trace(off.numLines, escape(off.text)); off.multiline = false; trace(off.numLines);

// ---- the keyboard
trace(stage.focus);
hear(one); hear(many); hear(most);
stage.focus = many; trace(stage.focus == many, stage.focus.name);
stage.focus = one; trace(stage.focus == one, stage.focus.name);
stage.focus = null; trace(stage.focus);
trace("END");
fscommand("quit");
stop();
