import flash.events.*;
import flash.text.*;
import flash.ui.Keyboard;
import flash.system.fscommand;

// keys come from outside: F2 goes to the next field, F3 ends it
function say(e:Event):void {
	trace(e.type, e.target.name, e.bubbles, e.cancelable, (e is TextEvent) ? escape(TextEvent(e).text) : "", escape(e.target.text), e.target.caretIndex);
}
var fields:Array = [one, many, most, upper, digits, block, pass];
for each (var t:TextField in fields) {
	t.addEventListener(Event.CHANGE, say);
	t.addEventListener(TextEvent.TEXT_INPUT, say);
	t.addEventListener(FocusEvent.FOCUS_IN, say);
	t.addEventListener(FocusEvent.FOCUS_OUT, say);
}
upper.restrict = "A-Z";
digits.restrict = "0-9";
block.addEventListener(TextEvent.TEXT_INPUT, function (e:TextEvent):void {
	if (e.text == "b") e.preventDefault();
});
var at:int = 0;
stage.addEventListener(KeyboardEvent.KEY_DOWN, function (e:KeyboardEvent):void {
	trace("key", e.target.name, e.currentTarget == stage, e.keyCode, e.charCode, e.shiftKey);
	if (e.keyCode == Keyboard.F2) {
		at++;
		stage.focus = fields[at];
	}
	if (e.keyCode == Keyboard.F3) {
		for each (var f:TextField in fields) trace(f.name, escape(f.text), f.length, f.numLines);
		trace("END");
		fscommand("quit");
	}
});
stage.focus = one;
stop();
