package events {
	import flash.events.Event;

	public class ScoreEvent extends Event {
		public static const CHANGED:String = "scoreChanged";
		public var points:int;

		public function ScoreEvent(type:String, points:int, bubbles:Boolean = false) {
			super(type, bubbles, true);
			this.points = points;
		}

		override public function clone():Event {
			return new ScoreEvent(type, points, bubbles);
		}

		override public function toString():String {
			return formatToString("ScoreEvent", "type", "points", "cancelable");
		}
	}
}
