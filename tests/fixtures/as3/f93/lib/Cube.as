package lib {
	public class Cube extends Shape3 {
		private static var _made:int;
		private var side:Number;

		public function Cube(side:Number) {
			super();
			this.side = side;
			_made++;
		}

		public static function get made():int {
			return _made;
		}

		override public function volume():Number {
			return side * side * side;
		}
	}
}
