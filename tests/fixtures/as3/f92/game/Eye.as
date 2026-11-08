package game {
	import flash.display.MovieClip;
	import flash.events.Event;

	public class Eye extends MovieClip {
		public function Eye() {
			trace("Eye()", name, parent == null, stage == null);
			addEventListener(Event.ADDED_TO_STAGE, function (e:Event):void {
				var p:String = parent.name;
				trace("Eye on stage", name, p.indexOf("instance") == 0 ? "instance" : p);
			});
		}
	}
}
