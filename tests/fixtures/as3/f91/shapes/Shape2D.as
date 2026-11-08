package shapes {
	/** A base class: statics, protected and private fields, accessors, a method its subclasses override. */
	public class Shape2D {
		public static var count:int = 0;
		protected static const UNIT:String = "px";
		protected var _name:String;
		private var _secret:String = "base secret";
		private var _label:String = "";
		public var sets:int;
		/** Set before the subclass's constructor body runs: what the base constructor sees of it. */
		public var seen:String;

		public function Shape2D(name:String = "shape") {
			_name = name;
			count++;
			seen = describe();
		}

		public static function made():String {
			return count + " made";
		}

		public function get name():String {
			return _name;
		}

		public function get label():String {
			return _label || _name;
		}

		public function set label(v:String):void {
			_label = v.toUpperCase();
			sets++;
		}

		public function area():Number {
			return 0;
		}

		public function describe():String {
			return _name + " of " + area().toFixed(1) + UNIT;
		}

		public function baseSecret():String {
			return _secret;
		}

		public function toString():String {
			return "[Shape " + _name + "]";
		}
	}
}
