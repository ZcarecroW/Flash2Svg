import { describe, expect, it } from "vitest";
import { compileClasses, type ClassSource } from "../../src/core/as3/classes.ts";
import { parseClassFile, ScriptError } from "../../src/core/as3/parser.ts";

/** The helpers of the JS player that compiled classes use (src/player/script.ts), enough to run them in Node. */
function helpers(log: unknown[]) {
	const NEW = {};
	const bare = (o: any) => (o.constructor.$n ?? "Object").replace(/.*::/, "");
	const $r = {
		NEW,
		str: (x: unknown) => (x === null || x === undefined ? null : String(x)),
		text: (x: unknown) => String(x),
		vals: (o: any) => (Array.isArray(o) ? o.slice() : Object.values(o ?? {})),
		is: (x: any, c: any) => (typeof c === "string" ? typeof x === c.toLowerCase() : x instanceof c),
		as: (x: any, c: any) => (x instanceof c ? x : null),
		err: (e: unknown) => e,
		cls: (n: string, t: any) => t?.[n],
		m: (o: any, k: string) => {
			let b = o.$m;
			if (!b) Object.defineProperty(o, "$m", { value: (b = {}) });
			return (b[k] ??= o[k].bind(o));
		},
		base: (o: any, B: any, a: unknown[]) => {
			if (B === Error || B.prototype instanceof Error) {
				o.message = a[0] === undefined ? "" : String(a[0]);
				return;
			}
			Object.defineProperties(o, Object.getOwnPropertyDescriptors(Reflect.construct(B, a)));
		},
		iface: (name: string, bases: any[]) => {
			const I: any = function () {};
			I.$n = name;
			I.$b = bases;
			const meets = (i: any): boolean => i === I || i.$b.some(meets);
			Object.defineProperty(I, Symbol.hasInstance, {
				value: (x: any) => {
					for (let c = x?.constructor; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) if (Object.prototype.hasOwnProperty.call(c, "$i") && c.$i.some(meets)) return true;
					return false;
				},
			});
			return I;
		},
		objStr: (o: any) => `[object ${bare(o)}]`,
	};
	class Event {
		type: string;
		bubbles: boolean;
		constructor(type: string, bubbles = false) {
			this.type = type;
			this.bubbles = bubbles;
		}
	}
	const $f = { trace: (...a: unknown[]) => log.push(a.length === 1 ? a[0] : a), Event };
	return { $f, $r };
}

/** Compiles classes and runs `main` (a function of the registry); returns what was traced. */
function run(sources: ClassSource[], main: (c: Record<string, any>, log: unknown[]) => void, opts = {}) {
	const r = compileClasses(sources, opts);
	expect(r.failed).toEqual([]);
	const log: unknown[] = [];
	const { $f, $r } = helpers(log);
	const reg = new Function(`return ${r.js}`)()($f, $r) as { c: Record<string, any>; n: Record<string, string> };
	main(reg.c, log);
	return { log, js: r.js, warnings: r.warnings };
}

describe("AS3 class files", () => {
	it("reads packages, classes, interfaces and their members", () => {
		const f = parseClassFile(`
			package a.b {
				import flash.display.Sprite;
				import a.c.*;
				[SWF(width="400")]
				public dynamic class Box extends Sprite implements IOne, ITwo {
					public static const N:int = 3;
					[Embed(source="x.png")] private var Pic:Class;
					protected var size:Number = 1, other:String;
					trace("set up");
					public function Box(s:Number = 2) { super(); size = s; }
					override public function get width():Number { return size; }
					public function set w(v:Number):void {}
					public static function make():Box { return new Box(); }
				}
			}
			class Helper {}
			function local():void {}
		`);
		expect(f.pkg).toBe("a.b");
		expect(f.imports).toEqual(["flash.display.Sprite", "a.c.*"]);
		const [box, helper] = f.classes;
		expect(box!.name).toBe("Box");
		expect(box!.ext).toBe("Sprite");
		expect(box!.impl).toEqual(["IOne", "ITwo"]);
		expect(box!.dynamic).toBe(true);
		expect(box!.ctor?.params[0]?.name).toBe("s");
		expect(box!.members.map((m) => `${m.isStatic ? "static " : ""}${m.access} ${m.kind} ${m.name}${m.embed ? " [Embed]" : ""}`)).toEqual([
			"static public const N",
			"private var Pic [Embed]",
			"protected var size",
			"protected var other",
			"public get width",
			"public set w",
			"static public method make",
		]);
		expect(box!.init.map((i) => i.at)).toEqual([4]);
		expect(box!.members.find((m) => m.name === "width")!.override).toBe(true);
		expect(helper!.local).toBe(true);
		expect(f.defs.map((d) => [d.f?.name, d.local])).toEqual([["local", true]]);
		const i = parseClassFile("package { public interface IShape extends IA, IB { function area():Number; function get name():String; } }").classes[0]!;
		expect(i.kind).toBe("interface");
		expect(i.impl).toEqual(["IA", "IB"]);
		expect(i.members.map((m) => [m.kind, m.name, m.f?.bodiless])).toEqual([
			["method", "area", true],
			["get", "name", true],
		]);
	});

	it("refuses namespaces and says where", () => {
		const err = (src: string) => {
			try {
				parseClassFile(src);
			} catch (e) {
				return e as ScriptError;
			}
			return null;
		};
		expect(err("package {\n class A {\n mx_internal function f():void {} } }")?.line).toBe(3);
		expect(err("package { class A { use namespace x; } }")?.message).toMatch(/Namespaces/);
		expect(err("package { class A { function f():void { super.x(); } } }")).toBeNull();
		expect(err("package a {} package b {}")?.message).toMatch(/one package/);
	});

	it("runs fields before the constructor body, and before the base class's constructor", () => {
		const { log } = run(
			[
				{ path: "Base.as", code: "package { public class Base { public var seen:String; public function Base() { seen = describe(); } public function describe():String { return 'base'; } } }" },
				{ path: "Kid.as", code: "package { public class Kid extends Base { private var color:String = 'red'; private var size:int; public function Kid(s:Number) { size = s; super(); } override public function describe():String { return color + ' ' + size; } } }" },
			],
			(c, log) => {
				const k = new c.Kid!(7.9);
				log.push(k.seen, k.describe());
			},
		);
		// (size was set before super(): the base constructor sees it, as an int)
		expect(log).toEqual(["red 7", "red 7"]);
	});

	it("keeps two classes' private members apart", () => {
		const { log, js } = run(
			[
				{ path: "A.as", code: "package { public class A { private var _x:String = 'a'; public function ax():String { return _x; } } }" },
				{ path: "B.as", code: "package { public class B extends A { private var _x:Number = 2; public function bx():Number { return this._x; } } }" },
				{ path: "C.as", code: "package { public class C extends B { public var _x:Boolean = true; } }" },
			],
			(c, log) => {
				const o = new c.C!();
				log.push(o.ax(), o.bx(), o._x);
			},
		);
		expect(log).toEqual(["a", 2, true]);
		expect(js).toMatch(/_x\$1/);
	});

	it("binds a method taken as a value to its object, the same function each time", () => {
		const { log } = run([{ path: "A.as", code: "package { public class A { public var n:int = 5; public function get():int { return n; } public function both():Boolean { var f:Function = get; return f == this.get; } public function call():int { var f:Function = get; return f(); } } }" }], (c, log) => {
			const a = new c.A!();
			log.push(a.both(), a.call());
		});
		expect(log).toEqual([true, 5]);
	});

	it("sets a class up when it is first used: its statics, then the code in its body, in order", () => {
		const { log } = run(
			[
				{ path: "S.as", code: "package { public class S { public static var a:Array = [1]; a.push(2); public static var n:int = a.length * 10; trace('S set up', n); public static function count():int { return n; } } }" },
				{ path: "T.as", code: "package { public class T { public static function go():void { trace('before'); trace(S.count()); trace(S.count()); } } }" },
			],
			(c, log) => {
				log.push("start");
				c.T!.go();
			},
		);
		expect(log).toEqual(["start", "before", ["S set up", 20], 20, 20]);
	});

	it("knows interfaces, also inherited ones, and the class's name", () => {
		const { log } = run(
			[
				{ path: "p/IA.as", code: "package p { public interface IA {} }" },
				{ path: "p/IB.as", code: "package p { public interface IB extends IA {} }" },
				{ path: "p/K.as", code: "package p { public class K implements IB {} }" },
				{ path: "p/L.as", code: "package p { public class L extends K { public function test():Array { return [this is IA, this is IB, this is K]; } } }" },
			],
			(c, log) => {
				const l = new c.p$L!();
				log.push(l.test(), String(l), c.p$K!.$n);
			},
		);
		expect(log).toEqual([[true, true, true], "[object L]", "p::K"]);
	});

	it("keeps the other half of an overridden getter or setter", () => {
		const { log } = run(
			[
				{ path: "A.as", code: "package { public class A { protected var v:int; public function get value():int { return v; } public function set value(x:int):void { v = x; } } }" },
				{ path: "B.as", code: "package { public class B extends A { override public function get value():int { return v * 2; } } }" },
			],
			(c, log) => {
				const b = new c.B!();
				b.value = 4;
				log.push(b.value);
			},
		);
		expect(log).toEqual([8]);
	});

	it("calls a base class of the player's with super(...)'s arguments, and Error's", () => {
		const { log } = run(
			[
				{ path: "E.as", code: "package { import flash.events.Event; public class E extends Event { public var n:int; public function E(t:String, n:int) { super(t, true); this.n = n; } } }" },
				{ path: "Bad.as", code: "package { public class Bad extends Error { public function Bad() { super('no'); } } }" },
			],
			(c, log) => {
				const e = new c.E!("go", 3);
				const b = new c.Bad!();
				log.push(e.type, e.bubbles, e.n, b.message, b instanceof Error);
			},
		);
		expect(log).toEqual(["go", true, 3, "no", true]);
	});

	it("finds names through imports, its own package and the top level; package functions too", () => {
		const { log } = run(
			[
				{ path: "util/twice.as", code: "package util { public function twice(n:int):int { return n * 2; } }" },
				{ path: "util/Num.as", code: "package util { public class Num { public static function three():int { return 3; } } }" },
				{ path: "Top.as", code: "package { public class Top { public static const K:int = 4; } }" },
				{ path: "app/Main.as", code: "package app { import util.*; import util.twice; public class Main { public function go():Array { return [twice(Num.three()), Top.K, Helper.v]; } } }\nclass Helper { public static var v:String = 'mine'; }" },
			],
			(c, log) => log.push(new c.app$Main!().go()),
		);
		expect(log).toEqual([[6, 4, "mine"]]);
	});

	it("reports a file it can't read and compiles the rest", () => {
		const r = compileClasses([
			{ path: "Good.as", code: "package { public class Good {} }" },
			{ path: "Bad.as", code: "package { public class Bad {\n var x:XML = <a/>; } }" },
		]);
		expect(r.failed).toEqual([{ file: "Bad.as", line: 2, message: expect.stringMatching(/XML/) }]);
		expect(r.js).toMatch(/"Good"/);
	});

	it("warns of assets embedded with [Embed] and leaves the timeline's instances to the player", () => {
		const r = compileClasses([{ path: "M.as", code: "package { import flash.display.MovieClip; public class M extends MovieClip { [Embed(source='a.png')] public var Pic:Class; public var box:MovieClip; public var other:int = 1; } }" }], { instances: { M: ["box"] } });
		expect(r.warnings).toEqual(["M.Pic: assets embedded with [Embed] aren't exported"]);
		expect(r.js).toMatch(/this\.other=1/);
		expect(r.js).not.toMatch(/this\.box=/);
	});
});
