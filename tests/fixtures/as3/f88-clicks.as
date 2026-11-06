import fl.controls.*;
import fl.data.DataProvider;
import fl.events.*;
import flash.events.*;
import flash.ui.Keyboard;
import flash.system.fscommand;

// what a user does comes from outside: F2 asks for the state of everything, F3 ends it
function state(c:Object):String {
	switch (c) {
		case ok: return "";
		case tog: return String(tog.selected);
		case tick: return String(tick.selected);
		case one: return one.selected + " " + two.selected + " " + (one.group.selection ? one.group.selection.name : "none");
		case two: return one.selected + " " + two.selected + " " + (one.group.selection ? one.group.selection.name : "none");
		case pick: return pick.selectedIndex + " " + pick.selectedLabel + " " + (pick.selectedItem ? pick.value : "none") + " " + pick.text;
		case many: return many.selectedIndex + " " + (many.selectedItem ? many.selectedItem.label : "none");
		case line: return line.text + " " + line.length;
		case lines: return escape(lines.text) + " " + lines.length;
		case num: return String(num.value);
		case slide: return String(slide.value);
		case live: return String(live.value);
		case shade: return shade.selectedColor + " " + shade.hexValue;
	}
	return "";
}
function say(e:Event):void {
	var more:String = "";
	if (e is ListEvent) more = ListEvent(e).rowIndex + " " + ListEvent(e).columnIndex + " " + ListEvent(e).index + " " + (ListEvent(e).item ? ListEvent(e).item.label : "none");
	if (e is SliderEvent) more = SliderEvent(e).value + " " + SliderEvent(e).clickTarget + " " + SliderEvent(e).triggerEvent;
	if (e is ColorPickerEvent) more = String(ColorPickerEvent(e).color);
	if (e is TextEvent) more = escape(TextEvent(e).text);
	trace(e.type, e.currentTarget.name, e.bubbles, e.cancelable, more, "|", state(e.currentTarget));
}
var all:Array = [ok, tog, tick, one, two, pick, many, line, lines, num, slide, live, shade];
var types:Array = ["click", "change", "buttonDown", "enter", "itemClick", "thumbPress", "thumbDrag", "thumbRelease", "textInput"];
for each (var c:Object in all) for each (var t:String in types) c.addEventListener(t, say);
one.group.addEventListener(Event.CHANGE, function (e:Event):void { trace("group change", e.target.name, e.target.selection.name, e.target.selectedData); });
one.group.addEventListener(MouseEvent.CLICK, function (e:Event):void { trace("group click", e.target.name, e.target.selection ? e.target.selection.name : "none"); });

function look():void {
	for each (var c:Object in all) trace(c.name, c.enabled, "|", state(c));
}
trace(pick.length, pick.selectedIndex, many.length, many.selectedIndex, tog.selected, tick.selected, one.selected, one.value, two.value, slide.value, live.liveDragging);
look();
var turn:int = 0;
addEventListener(Event.ENTER_FRAME, function (e:Event):void {
	if (++turn == 2) {
		trace("drawn");
		look();
	}
});
stage.addEventListener(KeyboardEvent.KEY_DOWN, function (e:KeyboardEvent):void {
	if (e.keyCode == Keyboard.F2) look();
	if (e.keyCode == Keyboard.F3) {
		look();
		trace("END");
		fscommand("quit");
	}
});
stop();
