package lib {
	/** A static getter and setter. */
	public class Counter {
		private static var _v:int = 1;
		public static var sets:int = 0;

		public static function get value():int {
			return _v;
		}

		public static function set value(v:int):void {
			_v = v + 1;
			sets++;
		}
	}
}
