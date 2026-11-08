package shapes {
	public class Circle extends Shape2D implements IHasArea {
		private var r:Number = 1;
		private var _secret:Number = 42;

		public function Circle(r:Number, name:String = "circle") {
			super(name);
			this.r = r;
		}

		override public function area():Number {
			return Math.PI * r * r;
		}

		public function scaled(by:Number = 2):Number {
			return r * by;
		}

		public function sum(... rest):Number {
			var t:Number = 0;
			for each (var n:Number in rest) t += n;
			return t;
		}

		public function hidden():Number {
			return _secret;
		}

		override public function toString():String {
			return "[Circle r=" + r + "]";
		}
	}
}
