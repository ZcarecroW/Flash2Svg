package shapes {
	public class Square extends Shape2D implements IHasArea {
		private var _secret:String = "square secret";
		private var side:Number;

		public function Square(side:Number) {
			// (before super: the base constructor already sees it)
			this.side = side;
			super("square");
		}

		override public function area():Number {
			return side * side;
		}

		override public function describe():String {
			return "Square! " + super.describe();
		}

		override public function get name():String {
			return "sq:" + super.name;
		}

		public function secret():String {
			return _secret;
		}
	}
}
