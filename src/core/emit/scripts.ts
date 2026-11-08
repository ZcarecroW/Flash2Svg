/**
 * Frame scripts for the JS player. A timeline whose scripts say no more than the recognised
 * actions (stop, play, frame jumps, simple mouse handlers) keeps the player's small action lists,
 * which every format has too. Any other script runs: AS3 compiled to JavaScript (src/core/as3),
 * the JavaScript of HTML5 Canvas documents as it is, on the Flash API of src/player/script.ts.
 */
import { compileClasses, type CompiledClasses } from "../as3/classes.ts";
import { compileScripts, type ScriptUnit } from "../as3/emit.ts";
import { parseScript, type Expr, type Stmt } from "../as3/parser.ts";
import type { Context } from "../context.ts";
import type { ElementData, SceneModel, TimelineData } from "../model.ts";
import { parseActions } from "../program.ts";
import { splitScript } from "../snippets.ts";
import { PLAYER_PARTS } from "./runtime-code.generated.ts";

const ACTIONS = new Set(["stop", "play", "gotoAndPlay", "gotoAndStop"]);

/** What frame scripts say when they need a part of the runtime. */
const MEDIA = /\$f\.(Bitmap|BitmapData|ByteArray|Sound|SoundChannel|SoundMixer|Video|URLLoader|NetConnection|NetStream|SharedObject|Tween|TweenEvent|None|Regular|Strong|Back|Bounce|Elastic|Loader|ProLoader|ProgressEvent|IOErrorEvent|HTTPStatusEvent|NetStatusEvent)\b|graphics\.beginBitmapFill/;
const FLV = /\$f\.(FLVPlayback|VideoEvent|VideoState|MetadataEvent|VideoScaleMode|CuePointType)\b/;
const INPUT = /\$f\.TextFieldType\b|"input"/;
const CONTROLS = /\$f\.(Button|CheckBox|RadioButton|RadioButtonGroup|ComboBox|List|TextInput|TextArea|Label|NumericStepper|Slider|ColorPicker|ProgressBar|UILoader|DataGrid|DataGridColumn|DataProvider|UIComponent|ComponentEvent|ListEvent|SliderEvent|ColorPickerEvent|DataChangeEvent|DataChangeType|ProgressBarMode|ProgressBarDirection|SliderDirection|ButtonLabelPlacement|ScrollPolicy|StyleManager|LabelButton)\b/;
const FILTERS = /\$f\.(BlurFilter|GlowFilter|DropShadowFilter|BevelFilter|ColorMatrixFilter|BitmapFilterQuality|BitmapFilterType)\b|createjs\.\w*Filter/;

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

/** Whether a document has such an element on stage. */
function elementOf(ctx: Context, is: (e: ElementData) => boolean): boolean {
	for (const t of Object.values(ctx.model.timelines))
		for (const l of t.layers)
			for (const k of l.keyframes)
				for (const e of k.elements) if (is(e)) return true;
	return false;
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

/** Whether a document's scripts run: frame scripts the action lists can't say, or classes in .as files. */
export function modelRuns(model: SceneModel): boolean {
	return (model.doc.type === "Flash" && !!model.classes?.files.length) || documentRuns(Object.values(model.timelines), model.doc.type !== "Flash");
}

/** The instance names on a timeline (all its frames): Animate declares them as its class's variables. */
function instanceNames(tl: TimelineData | undefined): string[] {
	const out = new Set<string>();
	for (const l of tl?.layers ?? []) for (const k of l.keyframes) for (const e of k.elements) if ((e as { name?: string }).name) out.add((e as { name: string }).name);
	return [...out];
}

/** The class of a timeline: the document class for the scenes, a symbol's own class. */
function classOfTimeline(model: SceneModel, id: string): string | null {
	const cf = model.classes;
	if (!cf) return null;
	if (id.startsWith("scene:")) return cf.doc ?? null;
	for (const [q, t] of Object.entries(cf.symbols ?? {})) if (t === id) return cf.bases?.[q] ?? q;
	return null;
}

const compiled = new WeakMap<SceneModel, CompiledClasses>();

/** A document's classes, compiled once. */
function classesOf(model: SceneModel): CompiledClasses | null {
	const cf = model.classes;
	if (!cf?.files.length || model.doc.type !== "Flash") return null;
	let c = compiled.get(model);
	if (!c) {
		const instances: Record<string, string[]> = {};
		if (cf.doc) instances[cf.doc] = Object.keys(model.timelines).filter((k) => k.startsWith("scene:")).flatMap((k) => instanceNames(model.timelines[k]));
		for (const [q, id] of Object.entries(cf.symbols ?? {})) instances[q] = instanceNames(model.timelines[id]);
		compiled.set(model, (c = compileClasses(cf.files, { instances }, new Set(Object.keys(model.linkage ?? {})))));
	}
	return c;
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
	/** The parts of the runtime they need, as the code to run before it. */
	parts: string[];
	/** The document class; library classes extending a class of the document's own (name -> that class). */
	doc?: string;
	bases?: Record<string, string>;
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
	const cls = canvas ? null : classesOf(ctx.model);
	if (!timelines.size && !cls?.js) return null;
	if (cls) {
		for (const x of cls.failed) warn(`${x.file}${x.line ? `, line ${x.line}` : ""}: this class can't run (${x.message})`);
		for (const w of cls.warnings) warn(w);
	}
	const entries: string[] = [];
	for (const id of timelines) {
		const name = ctx.programs[id]!.name;
		let js: string;
		if (canvas) {
			js = canvasScripts(units.get(id)!, name, warn);
		} else {
			const c = compileScripts(units.get(id)!, new Set(Object.keys(ctx.model.linkage ?? {})), cls ? cls.scope(classOfTimeline(ctx.model, ctx.programs[id]!.source ?? id) ?? "") : null);
			for (const f of c.failed) warn(`${name}, frame ${f.frame + 1}: this script can't run (line ${f.line}: ${f.message})`);
			js = c.js;
		}
		entries.push(`${JSON.stringify(id)}:${js}`);
	}
	if (cls?.js) entries.push(`"$c":${cls.js}`);
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
	const cf = ctx.model.classes;
	if (cls?.js) for (const q in cf?.symbols ?? {}) {
		const bare = q.slice(q.lastIndexOf(".") + 1);
		classes[bare] = cf!.symbols![q]!;
		missing.delete(bare);
	}
	for (const n of missing) if (!cls?.classes.has(n) && ![...(cls?.classes.keys() ?? [])].some((q) => q.endsWith(`.${n}`))) warn(`Scripts use ${n}, which the player doesn't have and the library doesn't export for ActionScript`);
	const list = [];
	const any = js.includes("getDefinitionByName");
	if (canvas || any || MEDIA.test(js) || Object.keys(bitmaps).length || Object.keys(classes).some((n) => ctx.model.sounds[classes[n]!])) list.push("media");
	if (any || FILTERS.test(js)) list.push("filters");
	if (canvas) {
		list.push("createjs");
		if (/\$\(|\bjQuery\b/.test(js)) list.push("query");
	} else {
		const controls = CONTROLS.test(js) || elementOf(ctx, (e) => e.kind === "control");
		if (controls || INPUT.test(js) || elementOf(ctx, (e) => e.kind === "text" && e.textType === "input")) list.push("input");
		if (controls) list.push("controls");
		if (FLV.test(js) || elementOf(ctx, (e) => e.kind === "video")) list.push("flv");
		if (cls?.js) list.push("classes");
	}
	const parts = list.map((p) => `${PLAYER_PARTS[p as keyof typeof PLAYER_PARTS]};((window.__f2s[${JSON.stringify(playerId)}].$p=window.__f2s[${JSON.stringify(playerId)}].$p||[]).push(__f2sPart.default));`);
	const bases: Record<string, string> = {};
	for (const [q, b] of Object.entries(cf?.bases ?? {})) bases[q.slice(q.lastIndexOf(".") + 1)] = b;
	return { timelines, js, classes, bitmaps, parts, ...(cls?.js && cf?.doc ? { doc: cf.doc } : {}), ...(cls?.js && Object.keys(bases).length ? { bases } : {}) };
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
	return `function($t,$f,$r){var createjs=$f.createjs,cjs=createjs,stage=$f.stage,exportRoot=$f.root,canvas=$f.canvas,lib=$f.lib,playSound=$f.playSound,$=$f.$,jQuery=$f.$;return{${frames.join(",")}}}`;
}
