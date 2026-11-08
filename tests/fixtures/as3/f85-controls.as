import fl.controls.*;
import fl.controls.dataGridClasses.DataGridColumn;
import fl.core.UIComponent;
import fl.data.DataProvider;
import fl.events.*;
import flash.events.*;
import flash.text.*;
import flash.system.fscommand;

function r(n:Number):Number { return Math.round(n * 100) / 100; }
function pv():* { try { return pick.value; } catch (e:Error) { return e.errorID; } return null; }

// ---- what each one is when it arrives
trace("button", ok.label, ok.selected, ok.toggle, ok.enabled, ok.visible, r(ok.x), r(ok.y), ok.width, ok.height, ok.name, ok is Button, ok is UIComponent);
trace("check", tick.label, tick.selected, tick.enabled, tick.width, tick.height, tick is CheckBox, tick.toggle);
trace("radio", one.label, one.selected, one.groupName, one.value, two.label, two.selected, two.groupName, one is RadioButton);
trace("combo", pick.length, pick.selectedIndex, pick.selectedItem, pick.selectedLabel, pick.editable, pick.rowCount, pick.prompt, pick.text);
trace(pv());
trace("list", many.length, many.selectedIndex, many.selectedItem, many.selectedIndices.length, many.allowMultipleSelection, many.rowCount, many.width, many.height);
trace("input", line.text, line.length, line.maxChars, line.editable, line.displayAsPassword, line.restrict, line.enabled);
trace("area", lines.text, lines.length, lines.maxChars, lines.editable, lines.wordWrap, lines.enabled);
trace("label", title.text, title.autoSize, title.wordWrap, title.selectable, title.enabled);
trace("stepper", num.value, num.minimum, num.maximum, num.stepSize, num.nextValue, num.previousValue, num.enabled);
trace("slider", slide.value, slide.minimum, slide.maximum, slide.snapInterval, slide.tickInterval, slide.liveDragging, slide.direction, slide.enabled);
trace("color", shade.selectedColor, shade.hexValue, shade.showTextField, shade.enabled);
trace("bar", bar.value, bar.minimum, bar.maximum, bar.percentComplete, bar.mode, bar.indeterminate, bar.direction, bar.enabled);

// ---- setting them
ok.label = "Go"; trace(ok.label); ok.toggle = true; ok.selected = true; trace(ok.selected); ok.selected = false; ok.toggle = false;
ok.enabled = false; trace(ok.enabled); ok.enabled = true;
ok.setSize(120, 30); trace(ok.width, ok.height); ok.width = 100; ok.height = 22; ok.move(30, 40); trace(ok.x, ok.y); ok.x = 20; ok.y = 20;
tick.selected = true; trace(tick.selected); tick.label = "Yes"; trace(tick.label);
one.selected = true; trace(one.selected, two.selected); two.selected = true; trace(one.selected, two.selected);
trace(one.group == two.group, one.group.numRadioButtons, one.group.selection == two, one.group.selectedData, one.group.name, one.group.getRadioButtonAt(0) == one, RadioButtonGroup.getGroup("RadioButtonGroup") == one.group);
one.value = "first"; two.value = "second"; trace(one.group.selectedData);

// ---- a list of things
pick.addItem({label: "Apple", data: 1}); pick.addItem({label: "Pear", data: 2}); pick.addItem({label: "Plum", data: 3});
trace(pick.length, pick.selectedIndex, pick.selectedLabel, pv(), pick.selectedItem, pick.getItemAt(1).label, pick.itemToLabel(pick.getItemAt(2)));
pick.selectedIndex = 1; trace(pick.selectedLabel, pick.selectedItem.data, pv(), pick.text);
pick.removeItemAt(0); trace(pick.length, pick.selectedIndex, pick.selectedLabel);
pick.addItemAt({label: "Fig", data: 9}, 0); trace(pick.getItemAt(0).label, pick.length, pick.selectedIndex);
pick.replaceItemAt({label: "Kiwi", data: 8}, 0); trace(pick.getItemAt(0).label);
pick.sortItemsOn("label"); trace(pick.getItemAt(0).label, pick.getItemAt(2).label);
var dp:DataProvider = new DataProvider(["x", "y"]); trace(dp.length, dp.getItemAt(1).label, dp.getItemAt(1).data, dp.toArray().length);
var dp2:DataProvider = new DataProvider([{label: "A", data: 1}, {label: "B", data: 2}]); dp2.addItem({label: "C", data: 3}); trace(dp2.length, dp2.getItemIndex(dp2.getItemAt(2)), dp2.getItemAt(0).data);
many.dataProvider = dp2; trace(many.length, many.selectedIndex); many.selectedIndex = 2; trace(many.selectedItem.label, many.selectedIndices.join()); many.selectedItem = dp2.getItemAt(0); trace(many.selectedIndex);
many.allowMultipleSelection = true; many.selectedIndices = [0, 2]; trace(many.selectedIndices.join(), many.selectedItems.length); many.clearSelection(); trace(many.selectedIndex, many.selectedItems.length);
many.removeAll(); trace(many.length); many.labelField = "name"; many.addItem({name: "N", label: "L"}); trace(many.itemToLabel(many.getItemAt(0)));
pick.prompt = "Choose"; pick.selectedIndex = -1; trace(pick.prompt, pick.selectedLabel, pick.selectedIndex);

// ---- text
line.text = "Hello"; trace(line.text, line.length); line.appendText(" you"); trace(line.text); line.maxChars = 3; line.text = "Longer"; trace(line.text); line.editable = false; trace(line.editable); line.editable = true; line.restrict = "a-z"; trace(line.restrict);
lines.text = "One\nTwo"; trace(lines.length, escape(lines.text)); lines.appendText("!"); trace(lines.text.length); lines.htmlText = "<b>Bold</b>"; trace(lines.text);
title.text = "New"; trace(title.text); title.htmlText = "<b>T</b>"; trace(title.text);

// ---- numbers
num.maximum = 20; num.minimum = -5; num.stepSize = 5; trace(num.maximum, num.minimum, num.stepSize, num.value); num.value = 12; trace(num.value); num.value = 100; trace(num.value); num.value = -100; trace(num.value); num.value = 7; trace(num.value, num.nextValue, num.previousValue);
slide.maximum = 100; slide.value = 30; trace(slide.value); slide.value = 500; trace(slide.value); slide.value = -5; trace(slide.value); slide.snapInterval = 7; slide.value = 11; trace(slide.value); slide.minimum = 20; trace(slide.value);
shade.selectedColor = 0xFF8000; trace(shade.selectedColor, shade.hexValue);
bar.mode = ProgressBarMode.MANUAL; bar.setProgress(30, 120); trace(bar.value, bar.maximum, bar.percentComplete); bar.minimum = 10; trace(bar.percentComplete); bar.reset(); trace(bar.value);

// ---- events from scripts
var said:Array = [];
function say(e:Event):void { said.push(e.type + ":" + e.target.name + ":" + (e is ComponentEvent) + ":" + (e is MouseEvent)); }
ok.addEventListener(MouseEvent.CLICK, say); tick.addEventListener(Event.CHANGE, say); tick.addEventListener(MouseEvent.CLICK, say); pick.addEventListener(Event.CHANGE, say); line.addEventListener(Event.CHANGE, say); num.addEventListener(Event.CHANGE, say); slide.addEventListener(SliderEvent.CHANGE, say);
ok.dispatchEvent(new MouseEvent(MouseEvent.CLICK)); tick.selected = false; pick.selectedIndex = 0; line.text = "z"; num.value = 2; slide.value = 40;
trace("said", said.join(" "));

// ---- made by a script
var made:Button = new Button(); made.label = "New"; made.move(10, 300); addChild(made);
trace(made.parent == this, made.label, made.width, made.height, made.enabled);
var inp:TextInput = new TextInput(); inp.text = "typed"; addChild(inp); trace(inp.text, inp.width, inp.height);
removeChild(made); removeChild(inp);

// ---- a grid, and a picture
grid.addColumn("Name"); grid.addColumn("Age");
trace(grid.columns.length, grid.getColumnAt(0).dataField, grid.getColumnAt(1).headerText, grid.getColumnCount());
var col:DataGridColumn = new DataGridColumn("City"); col.headerText = "Town"; grid.addColumn(col); trace(grid.columns.length, col.dataField, col.headerText, col.sortable, col.editable, col.visible);
grid.dataProvider = new DataProvider([{Name: "Ann", Age: 30, City: "Rome"}, {Name: "Bob", Age: 25, City: "Oslo"}]);
trace(grid.length, grid.selectedIndex, grid.getItemAt(1).Name); grid.selectedIndex = 1; trace(grid.selectedItem.Name, grid.selectedIndices.join());
grid.sortItemsOn("Age", Array.NUMERIC); trace(grid.getItemAt(0).Name, grid.selectedIndex);
trace(grid is DataGrid, grid is UIComponent, grid.width, grid.height);
trace(loads.source, loads.autoLoad, loads.scaleContent, loads.maintainAspectRatio, loads.percentLoaded, loads.width, loads.height, loads is UILoader);
loads.autoLoad = false; loads.source = "pic.png"; trace(loads.source, loads.autoLoad); loads.scaleContent = false; loads.maintainAspectRatio = false; trace(loads.scaleContent, loads.maintainAspectRatio);

// ---- shown and hidden, sizes, styles
ok.addEventListener(ComponentEvent.HIDE, function (e:Event):void { trace("hide", e.bubbles); });
ok.addEventListener(ComponentEvent.SHOW, function (e:Event):void { trace("show", e.bubbles); });
ok.addEventListener(ComponentEvent.MOVE, function (e:Event):void { trace("move", e.bubbles, ok.x, ok.y); });
ok.addEventListener(ComponentEvent.RESIZE, function (e:Event):void { trace("resize", e.bubbles, ok.width, ok.height); });
ok.addEventListener(ComponentEvent.LABEL_CHANGE, function (e:Event):void { trace("label", e.bubbles, ok.label); });
ok.visible = false; ok.visible = false; ok.visible = true; ok.move(1.5, 2.5); ok.setSize(50, 20); ok.x = 7; ok.width = 60; ok.label = "Again"; ok.label = "Again";
trace(ok.x, ok.y, ok.width, ok.height, ok.scaleX, ok.scaleY);
ok.scaleX = 2; trace(ok.width, ok.scaleX); ok.scaleY = 2; trace(ok.height, ok.scaleY);
ok.setStyle("textPadding", 5); trace(ok.getStyle("textPadding"), ok.getStyle("nothing")); ok.clearStyle("textPadding"); trace(ok.getStyle("textPadding"));
trace(String(ok), String(tick), String(many), String(line), Object(ok).toString(), tick.toggle, one.toggle, tick.autoRepeat);
try { tick.toggle = false; } catch (e:Error) { trace(e.message.substr(9)); }
try { one.toggle = false; } catch (e:Error) { trace(e.message.substr(9)); }
try { pick.getItemAt(99); } catch (e:Error) { trace(e is RangeError, e.message); }
try { new DataProvider(5); } catch (e:Error) { trace(e is TypeError, e.message); }
var fromXml:DataProvider = new DataProvider(<list><i label="Apple" data="1"/><i label="Pear"><data>2</data><more><x/></more></i></list>);
trace("xml provider", fromXml.length, fromXml.getItemAt(0).label, fromXml.getItemAt(0).data, fromXml.getItemAt(1).label, fromXml.getItemAt(1).data, fromXml.getItemAt(1).more);

trace(ProgressBarMode.EVENT, ProgressBarMode.POLLED, ProgressBarMode.MANUAL, ProgressBarDirection.RIGHT, ProgressBarDirection.LEFT, SliderDirection.HORIZONTAL, SliderDirection.VERTICAL, ButtonLabelPlacement.RIGHT, ButtonLabelPlacement.LEFT, ButtonLabelPlacement.TOP, ButtonLabelPlacement.BOTTOM);
trace(ComponentEvent.ENTER, ComponentEvent.SHOW, ComponentEvent.HIDE, ComponentEvent.MOVE, ComponentEvent.RESIZE, ComponentEvent.LABEL_CHANGE, ComponentEvent.BUTTON_DOWN, SliderEvent.CHANGE, SliderEvent.THUMB_DRAG, SliderEvent.THUMB_PRESS, SliderEvent.THUMB_RELEASE, ListEvent.ITEM_CLICK, ListEvent.ITEM_ROLL_OVER, ListEvent.ITEM_ROLL_OUT, ListEvent.ITEM_DOUBLE_CLICK, ColorPickerEvent.CHANGE, ColorPickerEvent.ENTER, ColorPickerEvent.ITEM_ROLL_OVER, ColorPickerEvent.ITEM_ROLL_OUT);
trace("END");
fscommand("quit");
stop();
