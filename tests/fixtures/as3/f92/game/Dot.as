package game {
	import flash.display.Sprite;

	/** A sprite drawn by code, with its own x setter and width getter. */
	public class Dot extends Sprite {
		private var r:Number;

		public function Dot(r:Number) {
			this.r = r;
			graphics.beginFill(0x3366CC);
			graphics.drawCircle(0, 0, r);
			graphics.endFill();
		}

		override public function set x(v:Number):void {
			super.x = Math.round(v);
		}

		override public function get width():Number {
			return super.width + 1000;
		}

		public function get radius():Number {
			return r;
		}
	}
}
