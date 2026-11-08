import fl.controls.*;
import fl.containers.ScrollPane;
import fl.data.DataProvider;
import fl.events.*;
import flash.display.MovieClip;
import flash.events.*;
import flash.system.fscommand;

// TileList, ScrollPane and UIScrollBar in scripts (they draw on the next frame: the tests run then)
function name4(o:Object):String {
	return o == null ? "null" : o.label;
}
var frames:int = 0;
addEventListener(Event.ENTER_FRAME, function (e:Event):void {
	frames++;
	if (frames == 1) first();
	if (frames == 3) second();
});

function first():void {
	trace("tiles", tiles.length, tiles.columnCount, tiles.rowCount, tiles.columnWidth, tiles.rowHeight, tiles.direction, tiles.scrollPolicy, tiles.selectedIndex, name4(tiles.getItemAt(1)), tiles.sourceField, tiles.labelField);
	trace("vtiles", vtiles.length, vtiles.columnCount, vtiles.rowCount, vtiles.direction, vtiles.width, vtiles.height);
	tiles.addEventListener(Event.CHANGE, function (e:Event):void {
		trace("tiles change", tiles.selectedIndex);
	});
	tiles.selectedIndex = 2;
	trace("selected", tiles.selectedIndex, name4(tiles.selectedItem), tiles.isItemSelected(tiles.getItemAt(2)), tiles.selectedIndices);
	tiles.addItem({label: "New", source: "pic.png"});
	trace("added", tiles.length, name4(tiles.getItemAt(tiles.length - 1)));
	tiles.columnWidth = 40;
	tiles.rowHeight = 30;
	trace("sizes", tiles.columnCount, tiles.rowCount, tiles.width, tiles.height);
	tiles.rowCount = 2;
	trace("rows", tiles.height, tiles.rowCount);
	vtiles.columnCount = 3;
	trace("cols", vtiles.width, vtiles.columnCount);
	tiles.direction = ScrollBarDirection.VERTICAL;
	trace("direction", tiles.direction, tiles.columnCount, tiles.rowCount);

	trace("pane", pane.source, pane.content is MovieClip, pane.content.width, pane.content.height, pane.horizontalScrollPolicy, pane.verticalScrollPolicy, pane.scrollDrag);
	pane.addEventListener(ScrollEvent.SCROLL, function (e:ScrollEvent):void {
		trace("pane scroll", e.direction, e.delta, e.position);
	});

	trace("story", story.numLines, story.scrollV, story.maxScrollV, story.bottomScrollV);
	trace("bar", bar.scrollTarget == story, bar.direction, bar.minScrollPosition, bar.maxScrollPosition, bar.scrollPosition, bar.pageSize, bar.width, bar.height);
	bar.addEventListener(ScrollEvent.SCROLL, function (e:ScrollEvent):void {
		trace("bar scroll", e.direction, e.delta, e.position, story.scrollV);
	});
	story.addEventListener(Event.SCROLL, function (e:Event):void {
		trace("story scroll", story.scrollV);
	});
}

function second():void {
	trace("pane drawn", pane.maxHorizontalScrollPosition, pane.maxVerticalScrollPosition, pane.horizontalScrollPosition, pane.verticalScrollPosition);
	pane.verticalScrollPosition = 50;
	trace("pane v", pane.verticalScrollPosition);
	pane.horizontalScrollPosition = 9999;
	trace("pane h", pane.horizontalScrollPosition);
	trace("bar drawn", bar.maxScrollPosition, bar.scrollPosition, bar.pageSize);
	bar.scrollPosition = 3;
	trace("bar set", bar.scrollPosition, story.scrollV);
	story.scrollV = 5;
	trace("story set", story.scrollV, bar.scrollPosition);
	bar.scrollPosition = 99;
	trace("bar max", bar.scrollPosition, story.scrollV);
	var made:TileList = new TileList();
	made.dataProvider = new DataProvider([{label: "A"}, {label: "B"}, {label: "C"}]);
	made.move(10, 250);
	addChild(made);
	trace("made", made.width, made.height, made.columnCount, made.rowCount, made.length);
	trace("END");
	fscommand("quit");
}
