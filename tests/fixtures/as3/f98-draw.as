import flash.display.*;
import flash.geom.*;
import flash.system.fscommand;

// BitmapData.draw() of display objects and pixels, and a library picture read at once
function hex(c:uint):String {
	return c.toString(16);
}
var bd:BitmapData = new BitmapData(120, 80, true, 0);
bd.draw(art);
trace("art", hex(bd.getPixel32(10, 10)), hex(bd.getPixel32(65, 15)), hex(bd.getPixel32(110, 70)), hex(bd.getPixel32(30, 60)), art.rotation != 0);

var m:Matrix = new Matrix();
m.scale(0.5, 0.5);
m.translate(60, 0);
var bd2:BitmapData = new BitmapData(120, 80, false, 0xffffff);
bd2.draw(art, m);
trace("matrix", hex(bd2.getPixel(65, 5)), hex(bd2.getPixel(10, 10)), hex(bd2.getPixel(95, 8)));

var bd3:BitmapData = new BitmapData(60, 60, false, 0x808080);
bd3.draw(art, null, new ColorTransform(0, 1, 1, 1, 0, 255, 0, 0), BlendMode.NORMAL, new Rectangle(0, 0, 20, 60));
trace("colour and clip", hex(bd3.getPixel(10, 10)), hex(bd3.getPixel(30, 10)));

var bd4:BitmapData = new BitmapData(60, 60, false, 0x808080);
bd4.draw(art, null, null, BlendMode.MULTIPLY);
trace("multiply", hex(bd4.getPixel(10, 10)), hex(bd4.getPixel(50, 50)));

var s:Sprite = new Sprite();
s.graphics.beginFill(0x00ff00);
s.graphics.drawRect(5, 5, 10, 10);
s.graphics.endFill();
s.x = 300;
var bd5:BitmapData = new BitmapData(20, 20, true, 0);
bd5.draw(s);
trace("sprite", hex(bd5.getPixel32(10, 10)), hex(bd5.getPixel32(1, 1)));

var bd6:BitmapData = new BitmapData(40, 40, false, 0);
var src:BitmapData = new BitmapData(10, 10, false, 0xff00ff);
bd6.draw(src, new Matrix(2, 0, 0, 2, 5, 5));
trace("pixels", hex(bd6.getPixel(6, 6)), hex(bd6.getPixel(24, 24)), hex(bd6.getPixel(30, 30)));

var pic:BitmapData = new Pic(0, 0);
trace("library", pic.width, pic.height, hex(pic.getPixel32(5, 5)), hex(pic.getPixel32(40, 30)), hex(pic.getPixel32(60, 10)));
var shown:Bitmap = new Bitmap(pic);
var bd7:BitmapData = new BitmapData(64, 48, true, 0);
bd7.draw(shown);
trace("bitmap", hex(bd7.getPixel32(5, 40)));
trace("END");
fscommand("quit");
