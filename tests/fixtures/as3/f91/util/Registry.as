package util {
	import shapes.Shape2D;

	/** Statics set up in order when the class is first used, one from another class, and code in the class body. */
	public class Registry {
		public static const LIMIT:int = 3;
		public static var names:Array = ["a", "b"];
		public static var twice:int = LIMIT * 2;
		public static var shapesAtStart:int = Shape2D.count;
		private static var instances:int;

		names.push("c");
		trace("Registry set up", names.length, twice, shapesAtStart);

		public var id:int;

		public function Registry() {
			id = ++instances;
		}

		public static function get total():int {
			return instances;
		}

		public static function tallied():Number {
			return Tally.start + 0.5;
		}
	}
}

/** Seen only in this file. */
class Tally {
	public static var start:Number = 10;
}
