/**
 * Mouse event handlers in frame scripts, as Animate's code snippets write them (AS3 and HTML5
 * Canvas):
 *
 *     btn_next.addEventListener(MouseEvent.CLICK, fl_Click);
 *     function fl_Click(event:MouseEvent):void { gotoAndPlay(5); }
 *
 *     this.btn_next.addEventListener("click", fl_Click.bind(this));
 *     function fl_Click() { this.gotoAndPlay(4); }
 *
 * Scripts aren't run. Listeners on this timeline or its named instances are recognised, with
 * handlers made of frame jumps, play/stop, next/previous frame, `visible` and web links; other
 * code in a handler is warned about. The handlers' bodies are taken out of the frame script, so
 * their jumps aren't mistaken for frame actions.
 */

export type InteractionEvent = "click" | "over" | "out" | "down" | "up" | "dblclick";

/**
 * Whose timeline or instance: "" this one, "/" the root, ".." the parent, "@" the instance the
 * event happened on; instance names below these, "/"-separated ("../mc": the parent's child mc).
 */
export type TargetPath = string;

export type HandlerAction =
	| { type: "stop" | "play" | "next" | "prev"; target: TargetPath }
	| { type: "goto"; target: TargetPath; frame: number | string; play: boolean }
	| { type: "visible"; target: TargetPath; value: boolean }
	| { type: "url"; url: string; window: string };

export interface Interaction {
	/** The instance (its name on this timeline) the listener is on; "" = the timeline itself. */
	on: string;
	event: InteractionEvent;
	/** 0-based frame whose script adds it: active once the timeline has entered that frame. */
	frame: number;
	actions: HandlerAction[];
}

export interface ScriptParts {
	/** The script without comments, handler bodies and listener calls (blanked, positions kept). */
	frameCode: string;
	interactions: Interaction[];
}

const EVENTS: Record<string, InteractionEvent> = {
	// AS3 MouseEvent constants
	CLICK: "click",
	MOUSE_OVER: "over",
	ROLL_OVER: "over",
	MOUSE_OUT: "out",
	ROLL_OUT: "out",
	MOUSE_DOWN: "down",
	MOUSE_UP: "up",
	DOUBLE_CLICK: "dblclick",
	// CreateJS (HTML5 Canvas) event names
	click: "click",
	mouseover: "over",
	rollover: "over",
	mouseout: "out",
	rollout: "out",
	mousedown: "down",
	pressup: "up",
	dblclick: "dblclick",
};

/** Comments replaced by spaces (newlines kept), strings left alone. */
export function blankComments(code: string): string {
	let out = "";
	for (let i = 0; i < code.length; ) {
		const c = code[i]!;
		if (c === '"' || c === "'" || c === "`") {
			const end = stringEnd(code, i);
			out += code.slice(i, end);
			i = end;
		} else if (c === "/" && code[i + 1] === "/") {
			const end = code.indexOf("\n", i);
			const stop = end < 0 ? code.length : end;
			out += " ".repeat(stop - i);
			i = stop;
		} else if (c === "/" && code[i + 1] === "*") {
			const end = code.indexOf("*/", i + 2);
			const stop = end < 0 ? code.length : end + 2;
			out += code.slice(i, stop).replace(/[^\n]/g, " ");
			i = stop;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

/** Index after the string literal starting at `i`. */
function stringEnd(code: string, i: number): number {
	const q = code[i];
	for (let j = i + 1; j < code.length; j++) {
		if (code[j] === "\\") j++;
		else if (code[j] === q) return j + 1;
		else if (code[j] === "\n" && q !== "`") return j;
	}
	return code.length;
}

/** Index of the bracket closing the one at `open` (strings skipped), or -1. */
function closing(code: string, open: number): number {
	const o = code[open]!;
	const c = o === "(" ? ")" : o === "{" ? "}" : "]";
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		const ch = code[i]!;
		if (ch === '"' || ch === "'" || ch === "`") i = stringEnd(code, i) - 1;
		else if (ch === o) depth++;
		else if (ch === c && --depth === 0) return i;
	}
	return -1;
}

/** The receiver of a call or property at `at` (`a.b.` before it: "a.b"), or "" (none). */
function receiverBefore(code: string, at: number): string {
	let i = at - 1;
	while (i >= 0 && /\s/.test(code[i]!)) i--;
	if (code[i] !== ".") return "";
	let start = i;
	for (i--; i >= 0; i--) {
		const ch = code[i]!;
		if (ch === ")") {
			// a cast like MovieClip(this.root): back to its "(" and the name before it
			let depth = 0;
			for (; i >= 0; i--) {
				if (code[i] === ")") depth++;
				else if (code[i] === "(" && --depth === 0) break;
			}
			continue;
		}
		if (!/[\w$.\s]/.test(ch)) break;
		start = i;
	}
	return code.slice(start, at).replace(/\s+/g, "").replace(/\.$/, "");
}

/** A receiver expression as a target path, or null when it isn't one we follow. */
export function targetPath(receiver: string): TargetPath | null {
	const expr = receiver.replace(/\s+/g, "").replace(/\b(?:MovieClip|Sprite|DisplayObject|DisplayObjectContainer|SimpleButton)\(([^()]*)\)/g, "$1");
	if (!expr || expr === "this") return "";
	const segs = expr.split(".").filter((s, i) => !(i === 0 && s === "this"));
	if (!segs.length) return "";
	const out: string[] = [];
	for (let i = 0; i < segs.length; i++) {
		const s = segs[i]!;
		if (!/^[A-Za-z_$][\w$]*$/.test(s)) return null;
		if (i === 0 && (s === "root" || s === "exportRoot" || s === "stage")) out.push("");
		else if (i === 0 && /^(?:e|ev|evt|event)$/.test(s) && /^(?:currentTarget|target)$/.test(segs[1] ?? "")) {
			out.push("@");
			i++;
		} else if (s === "parent") out.push("..");
		else out.push(s);
	}
	const path = out.join("/");
	return path === "" ? "/" : path;
}

/** The (first) string literal's text in `args`. */
function stringArg(args: string): string | undefined {
	return /^\s*(["'])((?:\\.|(?!\1).)*)\1/.exec(args)?.[2];
}

/** Arguments of the call whose "(" is at `open`, split at top-level commas. */
function callArgs(code: string, open: number): { args: string[]; end: number } | null {
	const end = closing(code, open);
	if (end < 0) return null;
	const args: string[] = [];
	let depth = 0,
		from = open + 1;
	for (let i = open + 1; i < end; i++) {
		const ch = code[i]!;
		if (ch === '"' || ch === "'" || ch === "`") i = stringEnd(code, i) - 1;
		else if (ch === "(" || ch === "{" || ch === "[") depth++;
		else if (ch === ")" || ch === "}" || ch === "]") depth--;
		else if (ch === "," && depth === 0) {
			args.push(code.slice(from, i));
			from = i + 1;
		}
	}
	args.push(code.slice(from, end));
	return { args, end };
}

type Range = [number, number];

/** A function literal starting at `at` (`function (…) {…}` or an arrow): its body and end, or null. */
function functionAt(code: string, at: number): { body: string; end: number } | null {
	const rest = code.slice(at);
	let open = -1;
	const fn = /^\s*function\s*[\w$]*\s*\(/.exec(rest);
	if (fn) {
		const params = closing(code, at + fn[0].length - 1);
		if (params < 0) return null;
		open = code.indexOf("{", params);
	} else {
		const arrow = /^\s*(?:\([^)]*\)|[\w$]+)\s*(?::\s*[\w$.<>]+\s*)?=>\s*/.exec(rest);
		if (!arrow) return null;
		const start = at + arrow[0].length;
		if (code[start] !== "{") {
			// an expression body: up to the end of the enclosing call
			let depth = 0,
				i = start;
			for (; i < code.length; i++) {
				const ch = code[i]!;
				if (ch === '"' || ch === "'" || ch === "`") i = stringEnd(code, i) - 1;
				else if (ch === "(") depth++;
				else if (ch === ")" && depth-- === 0) break;
				else if (ch === "," && depth === 0) break;
			}
			return { body: code.slice(start, i), end: i };
		}
		open = start;
	}
	if (open < 0) return null;
	const close = closing(code, open);
	return close < 0 ? null : { body: code.slice(open + 1, close), end: close + 1 };
}

/**
 * Splits a frame script into the code that runs on the frame and the mouse handlers it adds.
 * Frame numbers come out 1-based (`zeroBased`: HTML5 Canvas counts from 0).
 */
export function splitScript(script: string, opts: { frame: number; zeroBased?: boolean; scene?: string; warn?: (m: string) => void }): ScriptParts {
	const code = blankComments(script);
	const blank: Range[] = [];
	// named functions (hoisted: listeners may come before them)
	const fns = new Map<string, string>();
	const decl = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
	let m: RegExpExecArray | null;
	while ((m = decl.exec(code))) {
		const f = functionAt(code, m.index);
		if (!f) continue;
		fns.set(m[1]!, f.body);
		blank.push([m.index, f.end]);
		decl.lastIndex = f.end;
	}
	const interactions: Interaction[] = [];
	const add = /\b(addEventListener|on)\s*\(/g;
	while ((m = add.exec(code))) {
		const open = m.index + m[0].length - 1;
		const call = callArgs(code, open);
		if (!call || call.args.length < 2) continue;
		const [evArg, handlerArg] = call.args;
		const evName = /^\s*MouseEvent\s*\.\s*([A-Z_]+)\s*$/.exec(evArg!)?.[1] ?? stringArg(evArg!);
		const event = evName !== undefined ? EVENTS[evName] : undefined;
		// `.on(` is also a plain method name: only with a mouse event
		if (m[1] === "on" && !event) continue;
		const receiver = receiverBefore(code, m.index);
		const who = targetPath(receiver);
		const stmtStart = m.index - (receiver ? receiver.length + 1 : 0);
		if (!event) {
			opts.warn?.(`a ${evName ?? evArg!.trim()} listener isn't run (only mouse events are exported)`);
			blank.push([Math.max(0, stmtStart), call.end + 1]);
			continue;
		}
		if (who === null || who.includes("..") || who.startsWith("/") || who.includes("@")) {
			opts.warn?.(`the ${evName} listener on ${receiver} is left out: only listeners on this timeline or its named instances are exported`);
			continue;
		}
		// the handler: a function literal, or a function name (`fl_Click`, `fl_Click.bind(this)`)
		const at = open + 1 + call.args[0]!.length + 1;
		let body = functionAt(code, at)?.body;
		if (body === undefined) {
			const name = /^\s*([A-Za-z_$][\w$]*)\s*(?:\.\s*bind\s*\([^)]*\)\s*)?$/.exec(handlerArg!)?.[1];
			body = name ? fns.get(name) : undefined;
			if (body === undefined) {
				opts.warn?.(`the ${evName} handler ${handlerArg!.trim()} on ${receiver || "this"} isn't found in the script`);
				continue;
			}
		}
		const what = `the ${evName} handler on ${receiver || "this"}`;
		const actions = handlerActions(body, { ...opts, warn: (w) => opts.warn?.(`${what}: ${w}`) });
		blank.push([Math.max(0, stmtStart), call.end + 1]);
		if (actions.length) interactions.push({ on: who, event, frame: opts.frame, actions });
	}
	let frameCode = code;
	for (const [a, b] of blank) frameCode = frameCode.slice(0, a) + frameCode.slice(a, b).replace(/[^\n]/g, " ") + frameCode.slice(b);
	return { frameCode, interactions };
}

const CALL = /\b(stop|play|nextFrame|prevFrame|gotoAndPlay|gotoAndStop|navigateToURL|open|nextScene|prevScene)\s*\(/g;

/** What a handler body does. */
export function handlerActions(body: string, opts: { zeroBased?: boolean; scene?: string; warn?: (m: string) => void }): HandlerAction[] {
	const code = blankComments(body);
	const out: { at: number; a: HandlerAction }[] = [];
	const used: Range[] = [];
	let m: RegExpExecArray | null;
	CALL.lastIndex = 0;
	while ((m = CALL.exec(code))) {
		const fn = m[1]!;
		const open = m.index + m[0].length - 1;
		const call = callArgs(code, open);
		if (!call) continue;
		const receiver = receiverBefore(code, m.index);
		const start = m.index - (receiver ? receiver.length + 1 : 0);
		used.push([Math.max(0, start), call.end + 1]);
		CALL.lastIndex = call.end + 1;
		if (fn === "navigateToURL" || fn === "open") {
			// navigateToURL(new URLRequest("…"), "_blank") / window.open("…", "_blank")
			if (fn === "open" && receiver !== "window") {
				used.pop();
				continue;
			}
			const url = fn === "open" ? stringArg(call.args[0] ?? "") : /URLRequest\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/.exec(call.args[0] ?? "")?.[2];
			if (url === undefined) opts.warn?.(`${fn}() with a computed address is left out`);
			else out.push({ at: m.index, a: { type: "url", url, window: stringArg(call.args[1] ?? "") ?? "_blank" } });
			continue;
		}
		if (fn === "nextScene" || fn === "prevScene") {
			opts.warn?.(`${fn}() is left out: only the current scene is exported`);
			continue;
		}
		const target = targetPath(receiver);
		if (target === null) {
			opts.warn?.(`${receiver}.${fn}() is left out (its target isn't followed)`);
			continue;
		}
		if (fn === "stop" || fn === "play") out.push({ at: m.index, a: { type: fn, target } });
		else if (fn === "nextFrame" || fn === "prevFrame") out.push({ at: m.index, a: { type: fn === "nextFrame" ? "next" : "prev", target } });
		else {
			const arg = (call.args[0] ?? "").trim();
			const scene = stringArg(call.args[1] ?? "");
			if (scene !== undefined && scene !== opts.scene) {
				opts.warn?.(`${fn}() into the scene "${scene}" is left out: only the current scene is exported`);
				continue;
			}
			const label = stringArg(arg);
			let frame: number | string;
			if (label !== undefined) frame = label;
			else if (/^\d+$/.test(arg)) frame = parseInt(arg, 10) + (opts.zeroBased ? 1 : 0);
			else {
				opts.warn?.(`${fn}(${arg}) with a computed frame is left out`);
				continue;
			}
			out.push({ at: m.index, a: { type: "goto", target, frame, play: fn === "gotoAndPlay" } });
		}
	}
	const vis = /\.\s*visible\s*=\s*(true|false)\b/g;
	while ((m = vis.exec(code))) {
		const receiver = receiverBefore(code, m.index + 1);
		const target = targetPath(receiver);
		used.push([Math.max(0, m.index - receiver.length), m.index + m[0].length]);
		if (target === null || target === "" || target === "/") opts.warn?.(`${receiver || "this"}.visible is left out`);
		else out.push({ at: m.index, a: { type: "visible", target, value: m[1] === "true" } });
	}
	// whatever is left besides traces and punctuation isn't run
	let rest = code;
	for (const [a, b] of used) rest = rest.slice(0, a) + " ".repeat(b - a) + rest.slice(b);
	rest = rest.replace(/\btrace\s*\((?:[^()]|\([^()]*\))*\)/g, "").replace(/[\s;{}]/g, "");
	if (rest) opts.warn?.(`other code isn't run (${rest.length > 40 ? rest.slice(0, 40) + "…" : rest})`);
	return out.sort((x, y) => x.at - y.at).map((o) => o.a);
}

/**
 * The web page a click on the named instance opens ("Click to Go to Web Page"), for formats
 * without a script: the instance becomes an SVG link. (`_self` opens in the page around an
 * <object>, like the player.)
 */
export function clickLink(interactions: Interaction[] | undefined, name: string): { href: string; target: string } | null {
	if (!name || !interactions) return null;
	for (const i of interactions) {
		if (i.on !== name || i.event !== "click") continue;
		const a = i.actions.find((x) => x.type === "url");
		if (a?.type === "url") return { href: a.url, target: a.window === "_self" ? "_top" : a.window || "_blank" };
	}
	return null;
}
