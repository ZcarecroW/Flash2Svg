package {
	import flash.display.MovieClip;
	import flash.display.Sprite;
	import flash.events.Event;
	import flash.utils.getQualifiedClassName;
	import game.*;

	/** The document class of f92: classes of library symbols, on the stage and made by code. */
	public class Game extends MovieClip {
		private var ticks:int = 0;

		public function Game() {
			trace("Game()", numChildren, ball1 is Ball, ball1.color, Ball.made, plain is MovieClip, getQualifiedClassName(plain), getQualifiedClassName(ball1), ball2.nameOf());
			var b:Ball = new Ball();
			b.name = "made";
			trace("new Ball", b.currentFrame, b.totalFrames, b.eye.name, b.parent == null, Ball.made);
			addChild(b);
			b.x = 50;
			var d:Dot = new Dot(4);
			d.x = 10.6;
			addChild(d);
			trace("Dot", d.x, d.radius, d.width, d.height, d is Sprite, getQualifiedClassName(d));
			var s:Star = new Star();
			addChild(s);
			trace("Star", s is Spinner, s.speed, s.spin(), s.totalFrames, getQualifiedClassName(s));
			addEventListener(Event.ENTER_FRAME, tick);
		}

		private function tick(e:Event):void {
			ticks++;
			trace("tick", ticks, currentFrame, ball1 == null ? "gone" : ball1.currentFrame);
		}
	}
}
