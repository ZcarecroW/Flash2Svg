package game {
	import flash.display.MovieClip;
	import flash.events.Event;

	/** The class of the library symbol Ball (three frames, an Eye instance named "eye"). */
	public class Ball extends MovieClip {
		public static var made:int = 0;
		public var color:String = "red";

		public function Ball() {
			made++;
			trace("Ball()", made, nameOf(), parent == null, stage == null, currentFrame, totalFrames, eye != null ? eye.name : "no eye", eye is Eye);
			addEventListener(Event.ADDED, function (e:Event):void {
				trace("Ball heard added", nameOf(), e.target == e.currentTarget ? "itself" : e.target.name);
			});
			addEventListener(Event.ADDED_TO_STAGE, onStage);
			addEventListener(Event.REMOVED_FROM_STAGE, offStage);
		}

		private function onStage(e:Event):void {
			trace("Ball on stage", nameOf(), parent == root, currentFrame);
		}

		private function offStage(e:Event):void {
			trace("Ball off stage", nameOf());
		}

		/** (names Flash Player makes up are counted differently in the JS player) */
		public function nameOf():String {
			return name.indexOf("instance") == 0 ? "instance" : name;
		}

		public function bounce(n:int):String {
			return nameOf() + " bounces " + n;
		}
	}
}
