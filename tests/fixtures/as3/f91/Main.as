package {
	import flash.display.MovieClip;
	import flash.events.Event;
	import flash.utils.getQualifiedClassName;
	import flash.utils.getQualifiedSuperclassName;
	import shapes.*;
	import events.Score;
	import events.ScoreEvent;
	import errors.BadMove;
	import util.clamp;
	import util.Registry;

	/** The document class of f91: the language of classes, traced line by line. */
	public class Main extends MovieClip {
		public static const TITLE:String = "classes";
		private static var made:int = 0;
		// (names the JS player's own fields once had)
		private var _name:String = "main field";
		private var _alpha:Number;
		private var _parent:Object = null;
		private var _node:String = "mine";
		protected var count:int = 3.7;
		public var flag:Boolean;
		public var nothing:Object;
		public var num:Number;
		public var any:*;
		private var score:Score;
		private var frames:int = 0;
		private var listeners:Array = [];
		private var _level:int = 1;

		public function Main() {
			made++;
			trace("Main", TITLE, made, _name, isNaN(_alpha), count, flag, nothing, isNaN(num), any, this is MovieClip, getQualifiedClassName(this), getQualifiedSuperclassName(this));
			trace("stage", stage != null, currentFrame, totalFrames, numChildren, box.name, box is MovieClip, root == this, parent == stage, name);
			_alpha = 0.5;
			_name = "renamed";
			trace("own fields", _name, _alpha, alpha, name, _node, _parent, x, visible);
			testShapes();
			testStatics();
			testEvents();
			testClosures();
			testErrors();
			testMisc();
			addEventListener(Event.ENTER_FRAME, tick);
			trace("constructor done");
		}

		private function testShapes():void {
			var c:Circle = new Circle(2);
			var s:Square = new Square(3);
			var list:Array = [c, s, new Circle(1, "tiny")];
			for each (var sh:Shape2D in list) trace(sh.name, sh.area().toFixed(2), sh.describe(), sh.seen, sh is IHasArea, sh is INamed, sh is Circle, String(sh));
			trace("count", Shape2D.count, Shape2D.made(), c.label, s.label);
			c.label = "round";
			trace("label", c.label, c.sets, s.sets);
			var a:IHasArea = c;
			trace("iface", a.area().toFixed(3), IHasArea(s).area(), (s as IHasArea) != null, (c as Square) == null, a.name);
			trace("names", getQualifiedClassName(c), getQualifiedSuperclassName(c), getQualifiedClassName(Circle), getQualifiedClassName(IHasArea), getQualifiedSuperclassName(Shape2D));
			trace("private", s.secret(), s.baseSecret(), c.hidden(), c.baseSecret());
			trace("defaults", c.scaled(), c.scaled(3), c.sum(1, 2, 3), c.sum());
			trace("plain", String(new Score()), new Shape2D().name, new Shape2D().seen, Shape2D.count);
		}

		private function testStatics():void {
			trace("before registry", Shape2D.count);
			trace("registry", Registry.LIMIT, Registry.twice, Registry.names.join(), Registry.shapesAtStart, Registry.total);
			var r1:Registry = new Registry(), r2:Registry = new Registry();
			trace("ids", r1.id, r2.id, Registry.total, Registry.tallied(), clamp(5, 0, 3), clamp(-1), clamp(0.5));
			Registry.names = null;
			trace("set static", Registry.names);
		}

		private function testEvents():void {
			score = new Score();
			score.addEventListener(ScoreEvent.CHANGED, onScore);
			score.add(5);
			score.add(-2);
			var e:ScoreEvent = new ScoreEvent("x", 9, true);
			var copy:ScoreEvent = ScoreEvent(e.clone());
			trace("event", e, copy.points, copy.bubbles, copy.cancelable, copy is Event, copy.type);
			score.removeEventListener(ScoreEvent.CHANGED, onScore);
			score.add(1);
			trace("score", score.points, score.hasEventListener(ScoreEvent.CHANGED));
		}

		private function onScore(e:ScoreEvent):void {
			trace("heard", e.points, e.type, this == root, e.target is Score);
			if (e.points < 4) e.preventDefault();
		}

		private function testClosures():void {
			var f:Function = describeMe;
			var g:Function = this.describeMe;
			trace("closure", f(), g(), f == g);
			var c:Circle = new Circle(3, "c3");
			var area:Function = c.area;
			trace("bound", area().toFixed(1), area.call(null).toFixed(1));
			var self:Main = this;
			var inner:Function = function ():String {
				return _name + " " + count + " " + (this == self);
			};
			trace("inner", inner());
			listeners.push(describeMe);
			trace("same", listeners.indexOf(describeMe));
		}

		public function describeMe():String {
			return "I am " + _name;
		}

		private function testErrors():void {
			try {
				throw new BadMove("e4");
			} catch (e:BadMove) {
				trace("caught", e.message, e.errorID, e.move, e.name, e is Error, String(e));
			}
			try {
				var n:Circle = null;
				n.area();
			} catch (e:TypeError) {
				trace("type error", e.errorID);
			}
		}

		private function testMisc():void {
			trace("getter", level, Main.TITLE, made);
			level = 7.9;
			trace("setter", level);
			var n:int = 0;
			for (var i:int = 0; i < 3; i++) n += twice(i);
			trace("loop", n);
		}

		public function get level():int {
			return _level;
		}

		public function set level(v:int):void {
			_level = v + 1;
		}

		private static function twice(v:int):int {
			return v * 2;
		}

		override public function gotoAndStop(frame:Object, scene:String = null):void {
			trace("going to", frame);
			super.gotoAndStop(frame, scene);
		}

		private function tick(e:Event):void {
			frames++;
			trace("tick", frames, currentFrame, e.target == this);
			if (frames == 2) {
				removeEventListener(Event.ENTER_FRAME, tick);
				gotoAndStop("end");
			}
		}
	}
}
