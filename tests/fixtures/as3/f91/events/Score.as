package events {
	import flash.events.EventDispatcher;

	/** Keeps points and says when they change. */
	public class Score extends EventDispatcher {
		private var _points:int;

		public function get points():int {
			return _points;
		}

		public function add(n:int):void {
			_points += n;
			var e:ScoreEvent = new ScoreEvent(ScoreEvent.CHANGED, _points);
			var heard:Boolean = dispatchEvent(e);
			trace("dispatched", heard, e.isDefaultPrevented(), e.target == this, e.currentTarget == this);
		}
	}
}
