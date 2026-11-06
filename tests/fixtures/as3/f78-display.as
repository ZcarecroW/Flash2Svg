import flash.display.*;
import flash.geom.*;
import flash.filters.*;
import flash.text.*;
import flash.media.*;
import flash.net.*;
import flash.events.*;
import flash.utils.*;
import flash.system.fscommand;

function r(n:Number):Number { return Math.round(n * 100) / 100; }
function rr(o:Rectangle):String { return [r(o.x), r(o.y), r(o.width), r(o.height)].join(","); }
function pp(p:Point):String { return r(p.x) + "," + r(p.y); }
function mm(m:Matrix):String { return [r(m.a), r(m.b), r(m.c), r(m.d), r(m.tx), r(m.ty)].join(","); }
function attempt(f:Function):void { try { f(); trace("no error"); } catch (e:Error) { trace(e.errorID, e.name, e.message); } }

// ---- an instance and where it is
trace("instance", one.name, r(one.x), r(one.y), r(one.width), r(one.height), r(one.scaleX), r(one.scaleY), r(one.rotation));
trace("bounds", rr(one.getBounds(this)), rr(one.getRect(this)), rr(one.getBounds(one)), rr(one.kid.getBounds(this)), rr(one.kid.getBounds(stage)), rr(two.kid.getBounds(two)));
trace("matrix", mm(one.transform.matrix), mm(one.transform.concatenatedMatrix), mm(one.kid.transform.concatenatedMatrix));
trace("points", pp(one.localToGlobal(new Point(10, 0))), pp(two.globalToLocal(new Point(100, 80))), pp(one.kid.localToGlobal(new Point(0, 0))), pp(one.kid.globalToLocal(new Point(0, 0))));
trace("hit", one.hitTestPoint(100, 80, false), one.hitTestPoint(5, 5, false), one.hitTestObject(two), two.hitTestObject(ball));
trace("shape hit", ball.hitTestPoint(300, 100, true), ball.hitTestPoint(283, 83, false), ball.hitTestPoint(283, 83, true), ball.hitTestPoint(319, 100, true), one.hitTestPoint(5, 5, true));

// ---- what setting properties does
var w:MovieClip = two;
w.x = 10.123; w.y = 20.56; trace("twips", w.x, w.y);
w.x = -3.333; trace(w.x);
w.alpha = 0.3; trace("alpha", w.alpha); w.alpha = 0.25; trace(w.alpha); w.alpha = 1.5; trace(w.alpha); w.alpha = -1; trace(w.alpha); w.alpha = 1;
w.rotation = 190; trace("rotation", w.rotation); w.rotation = -190; trace(w.rotation); w.rotation = 725; trace(w.rotation); w.rotation = 0;
w.scaleX = 1.3; trace("scale", r(w.scaleX), r(w.width)); w.scaleX = 1;
w.width = 100; trace("width", r(w.scaleX), r(w.width), r(w.height)); w.height = 10; trace(r(w.scaleY), r(w.height)); w.scaleX = w.scaleY = 1;
w.rotation = 45; trace("turned", r(w.width), r(w.height)); w.width = 100; trace(r(w.scaleX), r(w.scaleY), r(w.width), r(w.height), r(w.rotation)); w.rotation = 0; w.scaleX = w.scaleY = 1;
w.scaleX = -1; trace("mirror", r(w.scaleX), r(w.width), mm(w.transform.matrix)); w.width = 80; trace(r(w.scaleX), r(w.scaleY), r(w.width), mm(w.transform.matrix)); w.scaleX = 1;
w.scaleX = 2; w.scaleY = 3; w.rotation = 30; trace("turned 2", r(w.width), r(w.height)); w.width = 50; trace(Math.round(w.scaleX * 10) / 10, Math.round(w.scaleY * 10) / 10, r(w.rotation), Math.round(w.width), Math.round(w.height)); w.rotation = 0; w.scaleX = w.scaleY = 1;
trace("flip", r(flip.scaleX), r(flip.scaleY), r(flip.rotation), mm(flip.transform.matrix));
trace("slant", r(slant.scaleX), r(slant.scaleY), r(slant.rotation), mm(slant.transform.matrix));
w.visible = false; trace(w.visible, r(w.width)); w.visible = true;
w.transform.matrix = new Matrix(2, 0, 0, 3, 40, 50); trace("set matrix", r(w.x), r(w.y), r(w.scaleX), r(w.scaleY), r(w.rotation));
w.transform.matrix = new Matrix(1, 1, -1, 1, 0, 0); trace(r(w.scaleX), r(w.scaleY), r(w.rotation));
w.transform.matrix = new Matrix(1, 0, 0.5, 1, 0, 0); trace(r(w.scaleX), r(w.scaleY), r(w.rotation), mm(w.transform.matrix));
w.transform.matrix = new Matrix(1, 0, 0, 1, 300, 200);
var held:Matrix = w.transform.matrix; held.tx = 5; trace("a copy", r(w.x));

// ---- geometry
var m:Matrix = new Matrix(); m.translate(10, 20); m.rotate(Math.PI / 2); m.scale(2, 3); trace("m", mm(m));
var m2:Matrix = m.clone(); m2.invert(); trace(mm(m2)); m2.concat(m); trace(mm(m2));
m.identity(); m.createBox(2, 3, 0.5, 10, 20); trace(mm(m), pp(m.transformPoint(new Point(1, 1))), pp(m.deltaTransformPoint(new Point(1, 1))));
m.createGradientBox(100, 50, 0, 10, 20); trace(mm(m));
trace(new Matrix());
var p:Point = new Point(3, 4); trace(p, p.length, p.add(new Point(1, 1)), p.subtract(new Point(1, 1)), p.clone().equals(p), Point.distance(p, new Point(0, 0)), Point.interpolate(p, new Point(0, 0), 0.5), Point.polar(2, 0));
var q:Point = p.clone(); q.normalize(10); q.offset(1, 1); trace(q.x, q.y);
var re:Rectangle = new Rectangle(10, 20, 30, 40); trace(re, re.left, re.right, re.top, re.bottom, re.topLeft, re.bottomRight, re.size);
trace(re.contains(10, 20), re.contains(40, 60), re.containsPoint(new Point(15, 25)), re.containsRect(new Rectangle(11, 21, 1, 1)), re.intersects(new Rectangle(0, 0, 11, 21)), re.intersection(new Rectangle(0, 0, 11, 21)), re.union(new Rectangle(0, 0, 1, 1)));
var re2:Rectangle = re.clone(); re2.inflate(1, 2); re2.offset(5, 5); trace(re2, re2.isEmpty(), re2.equals(re)); re2.setEmpty(); trace(re2, re2.isEmpty());
re2.left = 5; re2.right = 20; re2.top = 1; re2.bottom = 9; trace(re2);
var ct:ColorTransform = new ColorTransform(0.5, 0.25, 1, 0.75, 10, 20, 30, 40); trace(ct, ct.color); ct.color = 0x336699; trace(ct, ct.color);
var c2:ColorTransform = new ColorTransform(2, 2, 2, 1, 1, 1, 1, 0); c2.concat(ct); trace(c2);

// ---- colour, filters, masks
one.transform.colorTransform = new ColorTransform(0.5, 1, 1, 1, 10, 0, 0, 0);
trace("colour", one.transform.colorTransform.redMultiplier, one.transform.colorTransform.redOffset);
one.alpha = 0.5; trace(one.alpha, one.transform.colorTransform.alphaMultiplier);
one.transform.colorTransform = new ColorTransform(); trace(one.alpha);
one.filters = [new BlurFilter(4, 4, 2), new GlowFilter(0xFF0000, 1, 6, 6, 2, 1, false, false)];
trace("filters", one.filters.length, one.filters[0].blurX, one.filters[0].quality, one.filters[1].color, one.filters[1].strength);
var fs:Array = one.filters; fs[0].blurX = 20; trace(one.filters[0].blurX, one.filters == one.filters);
one.filters = fs; trace(one.filters[0].blurX);
one.filters = []; trace(one.filters.length);
var ds:DropShadowFilter = new DropShadowFilter(); trace("shadow", ds.distance, ds.angle, ds.color, ds.alpha, ds.blurX, ds.blurY, ds.strength, ds.quality, ds.inner, ds.knockout, ds.hideObject);
var gl:GlowFilter = new GlowFilter(); trace("glow", gl.color, gl.alpha, gl.blurX, gl.blurY, gl.strength, gl.quality, gl.inner, gl.knockout);
var bl:BlurFilter = new BlurFilter(); trace("blur", bl.blurX, bl.blurY, bl.quality);
one.mask = two; trace("mask", one.mask == two, one.mask.name); one.mask = null; trace(one.mask);
trace("blend", one.blendMode); one.blendMode = BlendMode.MULTIPLY; trace(one.blendMode); one.blendMode = "normal";
trace(BlendMode.ADD, BlendMode.SCREEN, BlendMode.LAYER, BlendMode.ERASE, BlendMode.ALPHA, BlendMode.INVERT, BlendMode.OVERLAY, BlendMode.HARDLIGHT, BlendMode.DARKEN, BlendMode.LIGHTEN, BlendMode.DIFFERENCE, BlendMode.SUBTRACT);
trace("cache", one.cacheAsBitmap, one.opaqueBackground, one.scrollRect, one.scale9Grid);
one.cacheAsBitmap = true; trace(one.cacheAsBitmap); one.cacheAsBitmap = false;
one.scrollRect = new Rectangle(0, 0, 10, 10); trace(one.scrollRect); one.scrollRect = null; trace(one.scrollRect);

// ---- the display list
var box:Sprite = new Sprite(); box.name = "holder"; addChild(box);
var s1:Sprite = new Sprite(), s2:Shape = new Shape(), s3:Sprite = new Sprite(); s1.name = "s1"; s2.name = "s2"; s3.name = "s3";
box.addChild(s1); box.addChild(s2); box.addChildAt(s3, 1);
function names(o:*):String { var a:Array = []; for (var i:int = 0; i < o.numChildren; i++) a.push(o.getChildAt(i).name); return a.join(" "); }
trace("list", names(box), box.getChildIndex(s2), box.getChildByName("s3") == s3, box.getChildByName("no"), box.contains(s1), box.contains(box), box.contains(this));
box.setChildIndex(s1, 2); trace(names(box));
box.swapChildren(s1, s2); trace(names(box));
box.swapChildrenAt(0, 2); trace(names(box));
trace(box.removeChildAt(0) != null, names(box));
box.removeChildren(); trace(box.numChildren, s1.parent, s1.stage, s1.root, box.parent == this, box.root == root, box.stage == stage, s1.loaderInfo);
box.addChild(s1); box.addChild(s2); box.addChild(s3); box.removeChildren(1, 1); trace(names(box));
box.removeChildren();
attempt(function ():void { box.getChildAt(5); });
attempt(function ():void { box.removeChild(s1); });
attempt(function ():void { box.addChild(box); });
attempt(function ():void { box.addChildAt(s1, 3); });
attempt(function ():void { box.addChild(null); });
attempt(function ():void { box.setChildIndex(s1, 0); });
attempt(function ():void { box.getChildIndex(s1); });
attempt(function ():void { var o:Object = null; o.x = 1; });
attempt(function ():void { gotoAndStop("nothing here"); });

// ---- drawing
var g:Sprite = new Sprite(); addChild(g);
trace("drawn", rr(g.getBounds(g)), g.width, g.height);
g.graphics.beginFill(0x336699, 0.5); g.graphics.drawRect(10, 20, 30, 40); g.graphics.endFill();
trace(rr(g.getBounds(g)), g.width, g.height, g.hitTestPoint(15, 25, true), g.hitTestPoint(5, 5, true), g.hitTestPoint(15, 25, false));
g.graphics.lineStyle(4, 0xFF0000); g.graphics.moveTo(0, 0); g.graphics.lineTo(50, 0);
trace(rr(g.getBounds(g)), rr(g.getRect(g)), g.width, g.height);
g.graphics.clear(); trace(rr(g.getBounds(g)), g.width);
g.graphics.beginFill(0); g.graphics.drawCircle(50, 50, 10); g.graphics.endFill(); trace(rr(g.getBounds(g)));
g.graphics.beginFill(0); g.graphics.drawEllipse(0, 0, 20, 10); g.graphics.endFill(); trace(rr(g.getBounds(g)));
g.graphics.beginFill(0); g.graphics.drawRoundRect(100, 100, 30, 20, 5, 5); g.graphics.endFill(); trace(rr(g.getBounds(g)));
g.graphics.clear(); g.graphics.moveTo(0, 0); g.graphics.lineStyle(2, 0); g.graphics.curveTo(50, 100, 100, 0); trace(rr(g.getBounds(g)), rr(g.getRect(g)));
g.scaleX = 2; trace(rr(g.getBounds(this)), r(g.width));
g.graphics.clear(); g.scaleX = 1;
var kidS:Shape = new Shape(); kidS.graphics.beginFill(0xFF0000); kidS.graphics.drawRect(0, 0, 10, 10); kidS.x = 30; g.addChild(kidS);
trace(rr(g.getBounds(g)), rr(g.getBounds(this)), g.width, kidS.parent == g);
removeChild(g);

// ---- text
var tf:TextField = new TextField();
trace("text", tf.width, tf.height, tf.text == "", tf.length, tf.type, tf.multiline, tf.wordWrap, tf.selectable, tf.autoSize, tf.border, tf.background, tf.textColor, tf.maxChars, tf.numLines, tf.embedFonts, tf.displayAsPassword, tf.borderColor, tf.backgroundColor, tf.restrict, tf.alwaysShowSelection);
tf.text = "one\ntwo"; trace(tf.length, tf.numLines, escape(tf.text));
tf.appendText("!"); trace(tf.text.length);
tf.text = "a\rb\r\nc"; trace(tf.length, escape(tf.text));
tf.text = "x"; tf.textColor = 0xFF0000; tf.background = true; tf.backgroundColor = 0x00FF00; tf.border = true; tf.borderColor = 0x0000FF; trace(tf.textColor, tf.background, tf.backgroundColor, tf.border, tf.borderColor);
var dflt:TextFormat = new TextField().defaultTextFormat; trace("default", dflt.font, dflt.size, dflt.color, dflt.bold, dflt.italic, dflt.underline, dflt.url, dflt.target, dflt.align, dflt.leftMargin, dflt.rightMargin, dflt.indent, dflt.leading, dflt.letterSpacing, dflt.blockIndent, dflt.kerning, dflt.bullet, dflt.tabStops);
var fmt:TextFormat = new TextFormat("Arial", 20, 0x336699, true, false, false, null, null, "center");
trace("format", fmt.font, fmt.size, fmt.color, fmt.bold, fmt.italic, fmt.underline, fmt.url, fmt.target, fmt.align, fmt.leading, fmt.letterSpacing, fmt.leftMargin, fmt.rightMargin, fmt.indent, fmt.blockIndent, fmt.kerning, fmt.bullet, fmt.tabStops);
var empty:TextFormat = new TextFormat(); trace(empty.font, empty.size, empty.color, empty.bold, empty.align);
tf.defaultTextFormat = fmt; tf.text = "styled"; trace(tf.getTextFormat().size, tf.defaultTextFormat.font, tf.getTextFormat(0, 2).bold, tf.getTextFormat().align);
tf.setTextFormat(new TextFormat(null, 12)); trace(tf.getTextFormat().size, tf.getTextFormat().font, tf.defaultTextFormat.size);
tf.htmlText = "<b>bold</b> plain"; trace(tf.text, tf.length);
tf.text = "<b>not</b>"; trace(tf.text, tf.length);
tf.maxChars = 3; tf.type = TextFieldType.INPUT; tf.text = "longer"; trace(tf.text, tf.type); tf.type = TextFieldType.DYNAMIC;
tf.autoSize = TextFieldAutoSize.LEFT; trace(tf.autoSize, TextFieldAutoSize.NONE, TextFieldAutoSize.CENTER, TextFieldAutoSize.RIGHT);
trace(label.text, label.length, label.type, label.name, label.numLines, label.getTextFormat().size, label.getTextFormat().font, label.selectable, label.border);
trace("field", r(label.x), r(label.y), r(label.width), r(label.height), label.autoSize, label.wordWrap, label.multiline, label.textWidth > 0, label.textHeight > 0, rr(label.getBounds(this)));
label.text = "Changed"; trace(label.text, label.textColor);
trace(tf.getLineText != null, label is TextField, label.parent == this);

// ---- bitmaps
var bd:BitmapData = new BitmapData(4, 3, false, 0xFF3366);
trace("bitmap", bd.width, bd.height, bd.transparent, bd.rect, bd.getPixel(1, 1).toString(16), bd.getPixel32(1, 1).toString(16));
bd.setPixel(1, 1, 0x112233); trace(bd.getPixel(1, 1).toString(16), bd.getPixel32(1, 1).toString(16));
bd.fillRect(new Rectangle(0, 0, 2, 2), 0xFF00FF00); trace(bd.getPixel(0, 0).toString(16), bd.getPixel(3, 2).toString(16));
trace(bd.getPixel(-1, 0), bd.getPixel(9, 9), bd.getPixel32(9, 9));
var bt:BitmapData = new BitmapData(2, 2, true, 0xFFFF0000); trace(bt.getPixel32(0, 0).toString(16), bt.getPixel(0, 0).toString(16)); bt.setPixel32(1, 1, 0); trace(bt.getPixel32(1, 1), bt.getPixel(1, 1));
var bdef:BitmapData = new BitmapData(1, 1); trace(bdef.transparent, bdef.getPixel32(0, 0).toString(16));
var bc:BitmapData = bd.clone(); bc.copyPixels(bd, new Rectangle(0, 0, 1, 1), new Point(3, 2)); trace(bc.getPixel(3, 2).toString(16), bd.getPixel(3, 2).toString(16));
bc.dispose(); attempt(function ():void { bc.getPixel(0, 0); });
attempt(function ():void { new BitmapData(0, 5); });
var bmp:Bitmap = new Bitmap(bd); addChild(bmp); bmp.x = 10; bmp.scaleX = 5; trace(bmp.width, bmp.height, bmp.bitmapData == bd, bmp.smoothing, bmp.pixelSnapping, rr(bmp.getBounds(this)), bmp.hitTestPoint(12, 1, true));
bmp.bitmapData = null; trace(bmp.width, bmp.height, bmp.bitmapData);
removeChild(bmp);
var im:MyImage = new MyImage(0, 0); trace("library", im.width, im.height, im is BitmapData, im.transparent, getQualifiedClassName(im));
var ib:Bitmap = new Bitmap(im); addChild(ib); trace(ib.width, ib.height, rr(ib.getBounds(this))); removeChild(ib);

// ---- the timeline as an object
trace("timeline", totalFrames, framesLoaded, currentFrame, currentLabel, currentFrameLabel, isPlaying, currentScene.name, currentScene.numFrames, scenes.length, currentLabels.length, currentLabels[1].name, currentLabels[1].frame, currentScene.labels.length, enabled, buttonMode, useHandCursor, mouseChildren, mouseEnabled, tabEnabled, tabIndex, doubleClickEnabled, trackAsMenu, hitArea, dropTarget);
trace(one.totalFrames, one.currentFrame, one.currentLabel, one.currentFrameLabel, one.isPlaying, one.currentLabels.length, one.currentLabels[1].name, one.currentScene.name, one.currentScene.numFrames);
one.gotoAndStop("b"); trace(one.currentFrame, one.currentLabel, one.currentFrameLabel, one.isPlaying, one.kid);
one.gotoAndStop(2); trace(one.currentFrame, one.currentLabel, one.currentFrameLabel);
one.gotoAndStop(1); trace(one.kid.name);
attempt(function ():void { one.gotoAndStop(0); trace(one.currentFrame); });
attempt(function ():void { one.gotoAndStop(99); trace(one.currentFrame); });
one.gotoAndStop(1);

// ---- the stage
trace("stage", stage.stageWidth, stage.stageHeight, stage.frameRate, stage.scaleMode, stage.align, stage.quality, stage.displayState, stage.focus, stage.numChildren, stage.getChildAt(0) == root, stage.mouseChildren, stage.stageFocusRect, stage.tabChildren, stage.x, stage.alpha, stage.name, stage.parent, stage.stage == stage);
stage.frameRate = 30; trace(stage.frameRate); stage.frameRate = 24;
trace(StageAlign.TOP, StageAlign.TOP_LEFT, StageAlign.BOTTOM_RIGHT, StageScaleMode.NO_SCALE, StageScaleMode.SHOW_ALL, StageScaleMode.EXACT_FIT, StageScaleMode.NO_BORDER, StageQuality.BEST, StageQuality.LOW, StageDisplayState.NORMAL, StageDisplayState.FULL_SCREEN);

// ---- helpers
trace("class", getQualifiedClassName(one), getQualifiedClassName(this), getQualifiedClassName(new Sprite()), getQualifiedClassName(1), getQualifiedClassName("s"), getQualifiedClassName([]), getQualifiedClassName(new Point()), getQualifiedClassName(tf), getQualifiedSuperclassName(new Sprite()), getQualifiedSuperclassName(one));
trace(getDefinitionByName("flash.display.Sprite") == Sprite, getDefinitionByName("flash.geom.Point") == Point);
attempt(function ():void { getDefinitionByName("flash.no.Such"); });
var ba:ByteArray = new ByteArray(); ba.writeInt(258); ba.writeByte(7); ba.writeUTF("hi"); ba.writeShort(-2); ba.writeBoolean(true); ba.writeDouble(1.5); ba.writeUTFBytes("ä"); ba.position = 0;
trace("bytes", ba.length, ba.readInt(), ba.readByte(), ba.readUTF(), ba.readShort(), ba.readBoolean(), ba.readDouble(), ba.bytesAvailable, ba[0], ba[3]);
var d:Date = new Date(2020, 0, 31, 12, 30, 15, 500); trace("date", d.fullYear, d.month, d.date, d.day, d.hours, d.minutes, d.seconds, d.milliseconds, d.getFullYear(), d.getTime() > 0); d.month = 1; trace(d.month, d.date);
trace(JSON.stringify({b: [1, 2]}), JSON.parse('{"x":5}').x);
trace(parseInt("ff", 16), parseFloat("1.5x"), isNaN(NaN), isFinite(1 / 0), escape("a b"), unescape("a%20b"), encodeURIComponent("ä&"), decodeURIComponent("%C3%A4"), encodeURI("a b"));
trace((255).toString(16), (1.5).toFixed(2), (1234.5).toPrecision(2), (1234.5).toExponential(1), int.MAX_VALUE, int.MIN_VALUE, uint.MAX_VALUE, Number("12"), String(12), Boolean(""), int("7.9"), uint(-1));
var dict:Dictionary = new Dictionary(); dict[one] = 1; dict["s"] = 2; var cnt:int = 0; for (var kk:* in dict) cnt++; trace(cnt, dict[one]); delete dict[one]; trace(dict[one]);
trace("abc".charAt(1), "abc".charCodeAt(1), "a,b".split(","), "abc".substr(1), "abc".substring(1, 2), "abc".slice(-1), "aXb".toLowerCase(), "abc".indexOf("c"), "aba".lastIndexOf("a"), "a-b".replace("-", "+"), "x".concat("y"), "ab".search(/b/), "a1b2".match(/\d/g), "abc".localeCompare("abd"), String.fromCharCode(65));
var rx:RegExp = /(\w+)@(\w+)/i; var hit:Object = rx.exec("me@host"); trace(hit[1], hit[2], hit.index, rx.source, rx.ignoreCase, rx.global, rx.test("x@y"));
var vars:URLVariables = new URLVariables("a=1&b=two%20words"); trace(vars.a, vars.b); var req:URLRequest = new URLRequest("x.txt"); trace(req.url, req.method, URLRequestMethod.POST, req.data, req.contentType);

// ---- sound, one step after the other: nothing here depends on how long a thing takes
var beep:Beep = new Beep();
trace("sound", beep is Sound, beep.length > 0, beep.bytesTotal > 0, getQualifiedClassName(beep));
var ch:SoundChannel = beep.play();
trace(ch != null, ch.position >= 0, ch.soundTransform.volume, ch.soundTransform.pan, ch.leftPeak >= 0, ch.rightPeak >= 0);
ch.soundTransform = new SoundTransform(0.5, 0); trace(ch.soundTransform.volume, ch.soundTransform.pan);
SoundMixer.soundTransform = new SoundTransform(0.25); trace(SoundMixer.soundTransform.volume); SoundMixer.soundTransform = new SoundTransform(1);
ch.stop();
SoundMixer.stopAll();
var ch2:SoundChannel = new Beep().play();
ch2.addEventListener(Event.SOUND_COMPLETE, function (e:Event):void { trace("complete", e.type, e.target == ch2); trace("playing", one.isPlaying, two.isPlaying, ball.isPlaying, isPlaying);
	two.play(); trace(two.isPlaying); two.stop(); trace(two.isPlaying); two.gotoAndPlay(2); trace(two.isPlaying); two.gotoAndStop(1); trace(two.isPlaying); two.nextFrame(); trace(two.isPlaying); ball.play(); trace(ball.isPlaying); play(); trace(isPlaying); stop();
	var fresh:Ball = new Ball(); trace(fresh.isPlaying, fresh.totalFrames); fresh.play(); trace(fresh.isPlaying);
	loadText(); });

// ---- loading
function loadText():void {
	var ul:URLLoader = new URLLoader();
	trace("loading", ul.dataFormat, URLLoaderDataFormat.TEXT, URLLoaderDataFormat.BINARY, URLLoaderDataFormat.VARIABLES, ul.data, ul.bytesLoaded, ul.bytesTotal);
	ul.addEventListener(Event.OPEN, function (e:Event):void { trace("open", e.type); });
	ul.addEventListener(Event.COMPLETE, function (e:Event):void {
		trace("text", ul.data, ul.bytesLoaded, ul.bytesTotal, e.target == ul);
		loadVars();
	});
	ul.load(new URLRequest("note.txt"));
}
function loadVars():void {
	var ul:URLLoader = new URLLoader();
	ul.dataFormat = URLLoaderDataFormat.VARIABLES;
	ul.addEventListener(Event.COMPLETE, function (e:Event):void {
		trace("vars", ul.data.a, ul.data.b, ul.data is URLVariables);
		loadBytes();
	});
	ul.load(new URLRequest("vars.txt"));
}
function loadBytes():void {
	var ul:URLLoader = new URLLoader();
	ul.dataFormat = URLLoaderDataFormat.BINARY;
	ul.addEventListener(Event.COMPLETE, function (e:Event):void {
		trace("binary", ul.data is ByteArray, ul.data.length, ul.data[0]);
		loadMissing();
	});
	ul.load(new URLRequest("note.txt"));
}
function loadMissing():void {
	var ul:URLLoader = new URLLoader();
	ul.addEventListener(IOErrorEvent.IO_ERROR, function (e:IOErrorEvent):void {
		trace("missing", e.type, e.errorID);
		loadPicture();
	});
	ul.load(new URLRequest("no-such-file.txt"));
}
function loadPicture():void {
	var ld:Loader = new Loader();
	addChild(ld);
	ld.x = 5;
	ld.contentLoaderInfo.addEventListener(Event.INIT, function (e:Event):void { trace("init", ld.content != null); });
	ld.contentLoaderInfo.addEventListener(Event.COMPLETE, function (e:Event):void {
		trace("picture", ld.content is Bitmap, ld.content.width, ld.content.height, ld.width, ld.height, ld.numChildren, ld.getChildAt(0) == ld.content, ld.content.parent == ld, ld.contentLoaderInfo.width, ld.contentLoaderInfo.height, ld.contentLoaderInfo.contentType, Bitmap(ld.content).bitmapData.width, ld.contentLoaderInfo.content == ld.content);
		ld.unload();
		trace(ld.content, ld.numChildren, ld.width);
		removeChild(ld);
		loadBroken();
	});
	ld.load(new URLRequest("pic.png"));
}
function loadBroken():void {
	var ld:Loader = new Loader();
	ld.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, function (e:IOErrorEvent):void {
		trace("no picture", e.type, e.errorID);
		fscommandQuit();
	});
	ld.load(new URLRequest("no-such-picture.png"));
}
function fscommandQuit():void {
	trace("END");
	fscommand("quit");
}
stop();
