package {
	import flash.display.Sprite;
	import flash.errors.IllegalOperationError;
	import flash.events.Event;
	import flash.events.TimerEvent;
	import flash.system.fscommand;
	import flash.utils.getDefinitionByName;
	import flash.utils.getQualifiedClassName;
	import lib.*;

	/** The document class of f93 extends Sprite: one frame, what a project of code alone looks like. */
	public class App extends Sprite {
		private var frames:int;

		public function App() {
			trace("App()", this is Sprite, getQualifiedClassName(this), numChildren, logo.name, stage != null);
			try {
				new Shape3();
			} catch (e:Error) {
				trace("abstract", e is IllegalOperationError, e.message, getQualifiedClassName(e));
			}
			var list:Vector.<Shape3> = new Vector.<Shape3>();
			list.push(new Cube(2), new Cube(3));
			var total:Number = 0;
			for each (var s:Shape3 in list) total += s.volume();
			trace("vector", list.length, total, list[0] is Cube, list.indexOf(list[1]));
			var C:Class = getDefinitionByName("lib.Cube") as Class;
			var c:Object = new C(4);
			trace("by name", c.volume(), c is Shape3, C == Cube, C is Class);
			trace("static accessors", Cube.made, Counter.value);
			Counter.value = 41;
			trace("set", Counter.value, Counter.sets);
			trace("closures", adders().join());
			var t:Ticker = new Ticker(50, 3);
			t.addEventListener(TimerEvent.TIMER_COMPLETE, done);
			t.start();
			trace("ticker", t.id, t.delay, t.repeatCount, t.running, t is Ticker);
			addEventListener(Event.ENTER_FRAME, tick);
		}

		/** Functions made in a loop share its variable (it belongs to the function, not the loop). */
		private function adders():Array {
			var out:Array = [];
			var fs:Array = [];
			for (var i:int = 0; i < 3; i++) fs.push(function ():int {
				return i;
			});
			for each (var f:Function in fs) out.push(f());
			return out;
		}

		private function tick(e:Event):void {
			frames++;
		}

		private function done(e:TimerEvent):void {
			var t:Ticker = Ticker(e.target);
			trace("ticker done", t.label, t.currentCount, t.ticks, frames > 0, t.running);
			trace("END");
			fscommand("quit");
		}
	}
}
