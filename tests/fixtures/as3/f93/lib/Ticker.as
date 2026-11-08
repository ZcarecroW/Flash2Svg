package lib {
	import flash.events.TimerEvent;
	import flash.utils.Timer;

	/** A Timer of its own, with fields of names the player's Timer once used. */
	public class Ticker extends Timer {
		public var label:String = "tick";
		public var ticks:int = 0;
		public var id:int = 7;

		public function Ticker(delay:Number, count:int) {
			super(delay, count);
			addEventListener(TimerEvent.TIMER, onTimer);
		}

		private function onTimer(e:TimerEvent):void {
			ticks++;
		}
	}
}
