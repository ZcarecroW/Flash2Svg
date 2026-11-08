package lib {
	import flash.errors.IllegalOperationError;
	import flash.utils.getQualifiedClassName;

	/** An abstract class, as AS3 projects write them. */
	public class Shape3 {
		public function Shape3() {
			if (getQualifiedClassName(this) == "lib::Shape3") throw new IllegalOperationError("Shape3 is abstract");
		}

		public function volume():Number {
			throw new IllegalOperationError("override volume");
		}
	}
}
