import { describe, expect, it } from "vitest";
import { compileScripts } from "../../src/core/as3/emit.ts";
import { parseScript, ScriptError, tokenize } from "../../src/core/as3/parser.ts";
import { scriptsRun } from "../../src/core/emit/scripts.ts";

/** Runs compiled frame scripts on a plain object; returns what they traced. */
function run(code: string, frames: number[] = [0], t: Record<string, unknown> = {}) {
	const units = frames.length === 1 ? [{ frame: frames[0]!, code }] : frames.map((f, i) => ({ frame: f, code: code.split("---")[i]! }));
	const c = compileScripts(units);
	expect(c.failed).toEqual([]);
	const log: unknown[] = [];
	const $f = { trace: (...a: unknown[]) => log.push(a.length === 1 ? a[0] : a), MovieClip: class {}, Sprite: class {} };
	const $r = {
		str: (x: unknown) => (x === null || x === undefined ? null : String(x)),
		text: (x: unknown) => String(x),
		vals: (o: Record<string, unknown>) => (Array.isArray(o) ? o : Object.values(o)),
		as: (x: unknown, c: new () => unknown) => (x instanceof c ? x : null),
		is: (x: unknown, c: unknown) => (typeof c === "string" ? typeof x === c.toLowerCase() || c === "int" : x instanceof (c as new () => unknown)),
		cls: (n: string) => n,
		err: (e: unknown) => e,
		sort: (a: unknown[], ...o: unknown[]) => (o[0] === 16 ? a.sort((x, y) => (x as number) - (y as number)) : a.sort()),
		sortOn: (a: unknown[]) => a,
		key: (k: unknown) => k,
		insertAt: (a: unknown[], i: number, v: unknown) => void a.splice(i, 0, v),
		removeAt: (a: unknown[], i: number) => a.splice(i, 1)[0],
		vec: (_of: string, ...a: unknown[]) => (Array.isArray(a[0]) ? a[0].slice() : new Array(Number(a[0]) | 0).fill(0)),
	};
	const fs = new Function(`return ${c.js}`)()(t, $f, $r) as Record<number, () => void>;
	for (const f of frames) fs[f]!();
	return { log, t, js: c.js };
}

describe("AS3 parser", () => {
	it("reads what frame scripts are made of", () => {
		const code = `
			import flash.events.MouseEvent;
			import flash.utils.*;
			var total:int = 0, name2:String = "x";
			const LIMIT:Number = 1e3;
			function add(a:int, b:int = 2, ...rest):int { return a + b; }
			for (var i:int = 0; i < 3; i++) { total += add(i); }
			for each (var v:Object in [1, 2]) { trace(v); }
			for (var k:String in {a: 1}) trace(k);
			while (total > 100) total--;
			do { total++ } while (total < 0)
			switch (total) { case 1: break; default: trace("d"); }
			try { throw new Error("x"); } catch (e:Error) { trace(e.message); } finally { }
			btn.addEventListener(MouseEvent.CLICK, function (ev:MouseEvent):void { trace(this); });
			var list:Vector.<Vector.<int>> = new Vector.<Vector.<int>>();
			var l2:Vector.<int> = new <int>[1, 2, 3];
			var o:* = x as MovieClip;
			if (o is Sprite) trace(/a+b/g.test("aab"), 4 / 2 / 1);
			outer: for (;;) { break outer; }
		`;
		expect(parseScript(code).length).toBeGreaterThan(10);
	});

	it("tells division from a regular expression", () => {
		const kinds = (s: string) => tokenize(s).map((t) => t.kind).join(" ");
		expect(kinds("a / b / c")).toBe("id op id op id end");
		expect(kinds("x = /b/g")).toBe("id op regex end");
		expect(kinds("(a) / 2")).toBe("op id op op num end");
		expect(kinds("return /x/")).toBe("id regex end");
	});

	it("ends a statement at a line break", () => {
		expect(parseScript("stop()\nplay()\n").length).toBe(2);
		expect(parseScript("var a:int = 1\nvar b:int = 2").length).toBe(2);
	});

	it("keeps counting lines through comments and refuses what isn't supported, with the line", () => {
		const err = (s: string) => {
			try {
				parseScript(s);
			} catch (e) {
				return e as ScriptError;
			}
			return null;
		};
		expect(err("/* a\n b */\n\n)")?.line).toBe(4);
		expect(err("use namespace mx_internal;")?.message).toMatch(/amespace/);
		expect(err("class A {}")?.message).toMatch(/class/);
		expect(err('var s = "open')?.message).toMatch(/string/);
	});
});

describe("AS3 to JavaScript", () => {
	it("makes top-level variables and functions the timeline's members, there from the start", () => {
		const { log, t } = run(`trace(typeof add, count); var count:int = 2; function add(a:int):int { return a + count; } trace(add(3));`);
		expect(log).toEqual([["function", 0], 5]);
		expect(t.count).toBe(2);
	});

	it("keeps members from frame to frame", () => {
		const { log } = run(`var n:int = 1;---n += 2; trace(n); trace(twice(n));---`.replace(/---$/, `---function twice(v:int):int { return v * 2; }`), [0, 5, 9]);
		expect(log).toEqual([3, 6]);
	});

	it("gives unknown names to the timeline: its properties, its instances", () => {
		const hit: string[] = [];
		const t = { gotoAndPlay: (f: number) => hit.push(`goto ${f}`), btn: { x: 3 }, x: 1 };
		run(`gotoAndPlay(5); btn.x = x + 1; this.x = 9;`, [0], t);
		expect(hit).toEqual(["goto 5"]);
		expect(t.btn.x).toBe(2);
		expect(t.x).toBe(9);
	});

	it("converts to the variable's type as AS3 does", () => {
		const { log } = run(`
			var i:int = 7 / 2; trace(i);
			var u:uint = -1; trace(u);
			var n:Number; trace(isNaN(n));
			var b:Boolean = "x"; trace(b);
			var s:String; trace(s);
			var a:*; trace(a);
			var c:int; trace(c);
			i = 2.9; trace(i);
			i += 1.5; trace(i);
			trace(int(3.9), uint(-1), int("12"));
			function half(v:int):int { return v / 2; }
			trace(half(5.5));
		`);
		expect(log).toEqual([3, 4294967295, true, true, null, undefined, 0, 2, 3, [3, 4294967295, 12], 2]);
	});

	it("compiles the statements", () => {
		const { log } = run(`
			var out:Array = [];
			for (var i:int = 0; i < 3; i++) { if (i == 1) continue; out.push(i); }
			for each (var v:int in [5, 6]) out.push(v);
			var o:Object = {a: 1};
			for (var k:String in o) out.push(k);
			switch (out.length) { case 5: out.push("five"); break; default: out.push("other"); }
			try { throw new Error("boom"); } catch (e:Error) { out.push(e.message); } finally { out.push("end"); }
			var w:int = 0; while (w < 2) { w++; } do { w--; } while (w > 0);
			out.push(w);
			trace(out.join(","));
		`);
		expect(log).toEqual(["0,2,5,6,a,five,boom,end,0"]);
	});

	it("closures see their function's locals, nested functions are there from the start", () => {
		const { log } = run(`
			function make(n:int):Function { var c:int = n; function inc():int { c++; return c; } return inc; }
			var f:Function = make(1); f(); trace(f());
			var g:Function = function (a:int):int { return a * 2; }; trace(g(4));
		`);
		expect(log).toEqual([3, 8]);
	});

	it("casts, as and is", () => {
		const t = { root: { a: 1 } };
		const { log } = run(`trace(MovieClip(root).a); var m:* = new MovieClip(); trace((m as MovieClip) == m, (m as Sprite), m is MovieClip);`, [0], t);
		expect(log).toEqual([1, [true, null, true]]);
	});

	it("Array's constants and numeric sort", () => {
		const { log } = run(`var a:Array = [10, 9, 1]; a.sort(Array.NUMERIC); trace(a.join()); trace(Array.DESCENDING);`);
		expect(log).toEqual(["1,9,10", 2]);
	});

	it("renames what JavaScript reserves", () => {
		const { log } = run(`function f():int { var let:int = 2; var yield:int = 3; return let + yield; } trace(f());`);
		expect(log).toEqual([5]);
	});

	it("reports a script it can't read and keeps the others", () => {
		const c = compileScripts([
			{ frame: 0, code: "trace(1);" },
			{ frame: 3, code: "var x = ;" },
		]);
		expect(c.failed.map((f) => f.frame)).toEqual([3]);
		expect(c.js).toContain("0:function");
		expect(c.js).not.toContain("3:function");
	});
});

describe("AS3 as scripts are written", () => {
	it("takes names that are words of JavaScript", () => {
		expect(run("var of:int = 1; trace(of); function export():int { return 7; } trace(export());").log).toEqual([1, 7]);
	});

	it("keeps a uint without a sign through |=, &= and ^=", () => {
		expect(run("var c:uint = 0; c |= 0xFF000000; trace(c); c &= 0xF0000000; trace(c); c ^= 0x80000000; trace(c);").log).toEqual([
			4278190080, 4026531840, 1879048192,
		]);
	});

	it("reads a type written right before the =", () => {
		expect(run("function f(a:*=null):* { return a; } var v:Vector.<int>=new Vector.<int>(); var a:*=5; trace(f(), a, v.length);").log).toEqual([[null, 5, 0]]);
	});

	it("divides after i++ (no regular expression starts there)", () => {
		expect(run("var i:int = 3; var a:Number = i++ / 2; trace(a, i); trace(i-- / 2 / 1);").log).toEqual([[1.5, 4], 2]);
	});

	it("reads names in any script, wide spaces and lines that end in a carriage return", () => {
		expect(run("var größe:int = 4; var 得点:int = 2;　trace(größe + 得点);").log).toEqual([6]);
		expect(run("var a:int = 1; // a note\rtrace(a);\rtrace(2);").log).toEqual([1, 2]);
	});

	it("gives an array's indices as numbers to a key typed int", () => {
		expect(run("var arr:Array = [10, 20]; for (var i:int in arr) trace(i + 1);").log).toEqual([1, 2]);
		// (untyped and String keys stay text, as an object's are)
		expect(run("for (var k:String in {a: 1}) trace(k + 1);").log).toEqual(["a1"]);
	});

	it("keeps a ; inside a string of a for loop's declarations", () => {
		expect(run('for (var s:String = "a;b", n:int = 0; n < 1; n++) trace(s);').log).toEqual(["a;b"]);
	});

	it("keeps a parameter named like a catch's variable", () => {
		expect(run('function f(e:int):int { try { throw new Error("x"); } catch (e:Error) { trace(e.message); } return e; } trace(f(5));').log).toEqual(["x", 5]);
	});

	it("gives 0 for int() and uint() without a value", () => {
		expect(run("trace(int(), uint(), int(3.7));").log).toEqual([[0, 0, 3]]);
	});

	it("inserts into and removes from arrays by index", () => {
		expect(run("var a:Array = [1, 3]; a.insertAt(1, 2); trace(a.join()); trace(a.removeAt(0), a.join());").log).toEqual(["1,2,3", [1, "2,3"]]);
	});

	it("says that with isn't supported, instead of failing when the frame runs", () => {
		const c = compileScripts([{ frame: 0, code: "var o:Object = {x: 1};\nwith (o)\n{ trace(x); }" }]);
		expect(c.failed).toEqual([{ frame: 0, line: 2, message: "with isn't supported: write the object's name before its properties" }]);
	});
});

describe("which frame scripts run", () => {
	const runs = (...code: string[]) => scriptsRun(code.map((c, frame) => ({ frame, code: c })), false);

	it("leaves what action lists say to them", () => {
		expect(runs("stop();")).toBe(false);
		expect(runs('this.gotoAndPlay("on");')).toBe(false);
		expect(runs('gotoAndPlay(1, "Scene 2");')).toBe(false);
		expect(runs("// a comment\n/* and another */\nplay();")).toBe(false);
		expect(runs('b.addEventListener(MouseEvent.CLICK, f);\nfunction f(e:MouseEvent):void { gotoAndPlay(5); }')).toBe(false);
	});

	it("leaves the banner's counted loops to them", () => {
		expect(runs("if (!this.alreadyExecuted) {\n\tthis.alreadyExecuted = true;\n\tthis.loopNum = 1;\n} else {\n\tthis.loopNum++;\n\tif (this.loopNum == 3) {\n\t\tthis.stop();\n\t}\n}")).toBe(false);
		expect(runs('if (!this.loops) this.loops = 0;\nif (++this.loops < 3) gotoAndPlay("loop");\nelse stop();')).toBe(false);
	});

	it("runs anything else", () => {
		expect(runs('trace("x");')).toBe(true);
		expect(runs("var n:int = 0;")).toBe(true);
		expect(runs("nextFrame();")).toBe(true);
		expect(runs("gotoAndStop(currentFrame + 1);")).toBe(true);
		expect(runs("if (Math.random() < 0.5) stop();")).toBe(true);
		expect(runs("this.n++;\nif (Math.random() * 3 < 1) stop();")).toBe(true);
		expect(runs("n++;\nif (currentFrame == 3) stop();")).toBe(true);
		expect(runs("x = (")).toBe(true);
		expect(runs('b.addEventListener(MouseEvent.CLICK, f);\nfunction f(e:MouseEvent):void { b.x += 3; }')).toBe(true);
	});

	it("runs a counter two frames share: a list counts passes over one frame", () => {
		expect(runs("this.n = 0;", "if (++this.n == 3) stop();")).toBe(true);
		expect(runs("if (++this.n == 3) stop();", "if (++this.m == 3) stop();")).toBe(false);
	});
});

describe("E4X", () => {
	it("reads XML literals with their {expressions} apart: in content, attribute values and names", () => {
		const t = tokenize('var x:XML = <a {n}="1" b={v + "}"}>{"<" + 1}<c/></a>;').find((k) => k.kind === "xml")!;
		expect(t.parts).toEqual(['<a ', { src: "n", ctx: 2, line: 1 }, '="1" b=', { src: 'v + "}"', ctx: 1, line: 1 }, ">", { src: '"<" + 1', ctx: 0, line: 1 }, "<c/></a>"]);
		expect(tokenize("a < b").map((k) => k.kind)).toEqual(["id", "op", "id", "end"]);
		expect(tokenize("new <int>[1]").map((k) => k.text).slice(0, 4)).toEqual(["new", "<", "int", ">"]);
		expect(tokenize("var l = <><a/><b/></>;").find((k) => k.kind === "xml")?.text).toBe("<><a/><b/></>");
	});

	it("reads attributes, descendants, filters and qualified names", () => {
		const [s] = parseScript('x.item.(@id == "1")..ns::name.@*;') as [{ k: "expr"; x: unknown }];
		expect(JSON.stringify(s.x)).toBe(
			JSON.stringify({ k: "xattr", o: { k: "xdesc", o: { k: "xfilter", o: { k: "member", o: { k: "id", name: "x" }, name: "item" }, pred: { k: "bin", op: "==", a: { k: "xattr", o: null, name: "id" }, b: { k: "str", v: "1" } } }, name: "name", ns: { k: "id", name: "ns" } }, name: "*" }),
		);
		expect(parseScript("default xml namespace = atom;")[0]).toEqual({ k: "xmlns", x: { k: "id", name: "atom" } });
		expect(parseScript("x.@id = 2; delete x.@id;").length).toBe(2);
	});

	it("compiles E4X to the XML part's helpers, == between XML values too", () => {
		const c = compileScripts([{ frame: 0, code: 'var x:XML = <a><b id="1"/></a>; trace(x.b.@id, x..b.length(), x.b.(@id == "1").length(), x.name, x == x.copy(), typeof x);' }]);
		expect(c.failed).toEqual([]);
		expect(c.js).toMatch(/\$r\.xml\(0,"<a><b id=\\"1\\"\/><\/a>"\)/);
		expect(c.js).toMatch(/\$r\.xa\(/);
		expect(c.js).toMatch(/\$r\.xd\(/);
		expect(c.js).toMatch(/\$r\.xf\(.*\(\$x\)=>/);
		expect(c.js).toMatch(/\$r\.xc\(\$t\.x,"name"\)/);
		expect(c.js).toMatch(/\$r\.xeq\(/);
		expect(c.js).toMatch(/"xml"/);
	});
});
