/**
 * Frame scripts for the JS player. A timeline whose scripts say no more than the recognised
 * actions (stop, play, frame jumps, simple mouse handlers) keeps the player's small action lists,
 * which every format has too. Any other script runs: AS3 compiled to JavaScript (src/core/as3),
 * the JavaScript of HTML5 Canvas documents as it is, on the Flash API of src/player/script.ts.
 */
import { compileScripts, type ScriptUnit } from "../as3/emit.ts";
import { parseScript, type Expr, type Stmt } from "../as3/parser.ts";
import type { Context } from "../context.ts";
import type { TimelineData } from "../model.ts";
import { parseActions } from "../program.ts";
import { splitScript } from "../snippets.ts";

const ACTIONS = new Set(["stop", "play", "gotoAndPlay", "gotoAndStop"]);

/** A statement the action lists can say. */
function isAction(s: Stmt): boolean {
	if (s.k === "empty") return true;
	if (s.k !== "expr" || s.x.k !== "call") return false;
	const f = s.x.f;
	const name = f.k === "id" ? f.name : f.k === "member" && f.o.k === "this" ? f.name : "";
	return ACTIONS.has(name) && s.x.args.every((a) => a.k === "num" || a.k === "str");
}

/** An expression made of nothing but numbers and counters on the timeline (this.loops). */
function isCount(x: Expr, counters: Set<string>): boolean {
	switch (x.k) {
		case "num":
		case "lit":
			return true;
		case "member":
			if (x.o.k !== "this") return false;
			counters.add(x.name);
			return true;
		case "unary":
		case "update":
			return isCount(x.x, counters);
		case "bin":
			return isCount(x.a, counters) && isCount(x.b, counters);
		case "assign":
			return x.a.k === "member" && isCount(x.a, counters) && isCount(x.b, counters);
		default:
			return false;
	}
}

/** Actions, and the counting of passes over a frame that action lists know ("passes"). */
function isCounted(s: Stmt, counters: Set<string>): boolean {
	if (s.k === "block") return s.body.every((x) => isCounted(x, counters));
	if (s.k === "if") return isCount(s.c, counters) && isCounted(s.a, counters) && (!s.b || isCounted(s.b, counters));
	return isAction(s) || (s.k === "expr" && isCount(s.x, counters));
}

/** The counters of a frame script the recognised actions say all of; null when they can't. */
export function actionsOnly(code: string, zeroBased: boolean): Set<string> | null {
	let open = false;
	const warn = () => void (open = true);
	const parts = splitScript(code, { frame: 0, zeroBased, warn });
	// (the current scene's name doesn't matter here: a jump to another one is left out either way)
	parseActions(parts.frameCode, { zeroBased, anyScene: true, warn });
	if (open) return null;
	const counters = new Set<string>();
	try {
		return parseScript(parts.frameCode).every((s) => isCounted(s, counters)) ? counters : null;
	} catch {
		return null;
	}
}

/**
 * The frame scripts of a timeline, by frame; those on one frame together, top layer first.
 * `written`: as the author wrote them, not as joining scenes rewrote them (scripts that run know
 * their scene).
 */
function unitsOf(tl: TimelineData | undefined, written = false): ScriptUnit[] {
	const byFrame = new Map<number, string[]>();
	for (const layer of tl?.layers ?? [])
		for (const kf of layer.keyframes) {
			const code = written ? (kf.written ?? kf.script) : kf.script;
			if (!code) continue;
			const list = byFrame.get(kf.index);
			if (list) list.push(code);
			else byFrame.set(kf.index, [code]);
		}
	return [...byFrame].sort((a, b) => a[0] - b[0]).map(([frame, list]) => ({ frame, code: list.join("\n") }));
}

/**
 * Whether a timeline's scripts have to run: the action lists can't say them. A counter that two
 * frames touch is one of those (a list counts passes over one frame).
 */
export function scriptsRun(units: ScriptUnit[], zeroBased: boolean): boolean {
	const seen = new Set<string>();
	for (const u of units) {
		const counters = actionsOnly(u.code, zeroBased);
		if (!counters) return true;
		for (const c of counters) {
			if (seen.has(c)) return true;
			seen.add(c);
		}
	}
	return false;
}

const judged = new WeakMap<TimelineData, boolean>();

/** Whether a timeline's scripts have to run (once for a document: it takes parsing them). */
export function timelineRuns(tl: TimelineData, zeroBased: boolean): boolean {
	let run = judged.get(tl);
	if (run === undefined) judged.set(tl, (run = scriptsRun(unitsOf(tl), zeroBased)));
	return run;
}

/** Whether any script of a document has to run. */
export function documentRuns(timelines: Iterable<TimelineData>, zeroBased: boolean): boolean {
	for (const t of timelines) if (timelineRuns(t, zeroBased)) return true;
	return false;
}

export interface PlayerScripts {
	/** Program ids of the timelines whose scripts run. */
	timelines: Set<string>;
	/** The code, to run before the runtime. */
	js: string;
	/** Library classes the scripts use: name -> program or sound id. */
	classes: Record<string, string>;
	/** Library bitmaps the scripts use: name -> bitmap id. */
	bitmaps: Record<string, string>;
}

/** The scripts of a document that have to run; null when the action lists say it all. */
export function playerScripts(ctx: Context, playerId: string, warn: (m: string) => void): PlayerScripts | null {
	const canvas = ctx.model.doc.type !== "Flash";
	const timelines = new Set<string>();
	const units = new Map<string, ScriptUnit[]>();
	for (const id in ctx.programs) {
		const tl = ctx.model.timelines[ctx.programs[id]!.source ?? id];
		if (!tl || !timelineRuns(tl, canvas)) continue;
		units.set(id, unitsOf(tl, true));
		timelines.add(id);
	}
	if (!timelines.size) return null;
	const entries: string[] = [];
	for (const id of timelines) {
		const name = ctx.programs[id]!.name;
		let js: string;
		if (canvas) {
			js = canvasScripts(units.get(id)!, name, warn);
		} else {
			const c = compileScripts(units.get(id)!, new Set(Object.keys(ctx.model.linkage ?? {})));
			for (const f of c.failed) warn(`${name}, frame ${f.frame + 1}: this script can't run (line ${f.line}: ${f.message})`);
			js = c.js;
		}
		entries.push(`${JSON.stringify(id)}:${js}`);
	}
	const js = `(window.__f2s=window.__f2s||{})[${JSON.stringify(playerId)}]={${entries.join(",")}};`;
	const classes: Record<string, string> = {};
	const bitmaps: Record<string, string> = {};
	const linkage = ctx.model.linkage ?? {};
	const use = (name: string) => {
		const to = linkage[name];
		if (to) (ctx.model.bitmaps[to] ? bitmaps : classes)[name] = to;
		return !!to;
	};
	const missing = new Set<string>();
	for (const m of js.matchAll(/\$r\.cls\("([^"]+)"/g)) if (!use(m[1]!)) missing.add(m[1]!);
	// (Canvas documents: lib.Name)
	if (canvas) for (const m of js.matchAll(/\blib\.([A-Za-z_$][\w$]*)/g)) use(m[1]!);
	// (getDefinitionByName: any name in the library may be asked for)
	if (js.includes("getDefinitionByName")) for (const n in linkage) use(n);
	for (const n of missing) warn(`Frame scripts use ${n}, which the player doesn't have and the library doesn't export for ActionScript`);
	return { timelines, js, classes, bitmaps };
}

/** HTML5 Canvas: frame scripts are JavaScript with `this` the timeline, each frame on its own. */
function canvasScripts(units: ScriptUnit[], name: string, warn: (m: string) => void): string {
	const frames: string[] = [];
	for (const u of units) {
		try {
			new Function(u.code);
			frames.push(`${u.frame}:function(){${u.code}\n}.bind($t)`);
		} catch (e) {
			warn(`${name}, frame ${u.frame + 1}: this script can't run (${(e as Error).message})`);
		}
	}
	return `function($t,$f,$r){var createjs=$f.createjs,cjs=createjs,stage=$f.stage,exportRoot=$f.root,canvas=$f.canvas,lib=$f.lib,playSound=$f.playSound;return{${frames.join(",")}}}`;
}
