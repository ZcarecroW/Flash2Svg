package game {
	import flash.display.MovieClip;
	import flash.utils.getQualifiedClassName;

	/** The base class of the library symbol Star, whose own class Animate makes. */
	public class Spinner extends MovieClip {
		public var speed:Number = 10;

		public function Spinner() {
			trace("Spinner()", getQualifiedClassName(this), this is Spinner, totalFrames);
		}

		public function spin():Number {
			rotation += speed;
			return rotation;
		}
	}
}
