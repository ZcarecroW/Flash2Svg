/**
 * Frame scripts in the player: the Flash API that scripts compiled by src/core/as3 talk to. Only in
 * the runtime of programs with such scripts (__SCRIPTS__).
 *
 * Objects wrap the player's clips and instances: `$t` of a script is a timeline's MovieClip, a
 * proxy that finds its children by instance name. Setting a transform property takes that
 * instance away from the timeline, as in Flash: it stays where the script put it.
 * (Public names listed in INTERNAL of scripts/build-runtime.mjs are written quoted: they aren't mangled.)
 */
import type { Clip, Inst, Player } from "./runtime.ts";
import type { PInst, PItem, PRef, PScene, PTextExtras, PTimeline, PTrack } from "./format.ts";
import { buildFilters } from "../core/emit/filters.ts";
import type { FilterData } from "../core/model.ts";
import type { XmlNode } from "../core/xml.ts";
import {
	ArgumentError,
	asFlashError,
	BevelFilter,
	BlurFilter,
	ColorMatrixFilter,
	DropShadowFilter,
	EASINGS,
	EOFError,
	fail,
	FByteArray,
	FColorTransform,
	FFilter,
	FMatrix,
	FPoint,
	FRectangle,
	FTextFormat,
	GlowFilter,
	inverse,
	IOError,
	mul,
	PACKAGES,
	SecurityError,
	toTwips,
	twips,
	URLRequest,
	URLVariables,
	type Mat,
} from "./flash-lib.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...a: any[]) => any;
export type ScriptFactory = (t: any, f: any, r: any) => Record<number, () => void>;
export interface Frozen {
	x: number;
	y: number;
	r: number;
	k: number;
	sx: number;
	sy: number;
}

const RAD = Math.PI / 180;
const SVGNS = "http://www.w3.org/2000/svg";

function svgEl(name: string, attrs?: Record<string, string>): SVGElement {
	const e = document.createElementNS(SVGNS, name) as SVGElement;
	if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]!);
	return e;
}
const colorOf = (c: number) => "#" + ((c >>> 0) & 0xffffff).toString(16).padStart(6, "0");

// ------------------------------------------------------------------ events

class FEvent {
	static ENTER_FRAME = "enterFrame";
	static EXIT_FRAME = "exitFrame";
	static FRAME_CONSTRUCTED = "frameConstructed";
	static ADDED = "added";
	static ADDED_TO_STAGE = "addedToStage";
	static REMOVED = "removed";
	static REMOVED_FROM_STAGE = "removedFromStage";
	static COMPLETE = "complete";
	static CHANGE = "change";
	static RESIZE = "resize";
	static OPEN = "open";
	static CLOSE = "close";
	static UNLOAD = "unload";
	static SOUND_COMPLETE = "soundComplete";
	static MOUSE_LEAVE = "mouseLeave";
	static INIT = "init";
	static CANCEL = "cancel";
	static SCROLL = "scroll";
	static SELECT = "select";
	static TAB_INDEX_CHANGE = "tabIndexChange";
	static FULLSCREEN = "fullScreen";
	static ACTIVATE = "activate";
	static DEACTIVATE = "deactivate";
	target: any = null;
	currentTarget: any = null;
	eventPhase = 2;
	_stop = 0;
	type: string;
	bubbles: boolean;
	cancelable: boolean;
	constructor(type: string, bubbles = false, cancelable = false) {
		this.type = type;
		this.bubbles = bubbles;
		this.cancelable = cancelable;
	}
	stopPropagation() {
		this._stop = Math.max(this._stop, 1);
	}
	stopImmediatePropagation() {
		this._stop = 2;
	}
	preventDefault() {}
	isDefaultPrevented() {
		return false;
	}
	clone() {
		return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
	}
}

class FMouseEvent extends FEvent {
	static CLICK = "click";
	static DOUBLE_CLICK = "doubleClick";
	static MOUSE_DOWN = "mouseDown";
	static MOUSE_UP = "mouseUp";
	static MOUSE_MOVE = "mouseMove";
	static MOUSE_OVER = "mouseOver";
	static MOUSE_OUT = "mouseOut";
	static ROLL_OVER = "rollOver";
	static ROLL_OUT = "rollOut";
	static MOUSE_WHEEL = "mouseWheel";
	stageX = 0;
	stageY = 0;
	localX = 0;
	localY = 0;
	delta = 0;
	ctrlKey = false;
	shiftKey = false;
	altKey = false;
	buttonDown = false;
	relatedObject: any = null;
	updateAfterEvent() {}
}

class FKeyboardEvent extends FEvent {
	static KEY_DOWN = "keyDown";
	static KEY_UP = "keyUp";
	keyCode = 0;
	charCode = 0;
	keyLocation = 0;
	ctrlKey = false;
	shiftKey = false;
	altKey = false;
}

class FTimerEvent extends FEvent {
	static TIMER = "timer";
	static TIMER_COMPLETE = "timerComplete";
	updateAfterEvent() {}
}

/** CreateJS's mouse and frame events by what they are here. */
const CANVAS_EVENTS: Record<string, string> = {
	mousedown: "mouseDown",
	pressup: "mouseUp",
	mouseover: "mouseOver",
	mouseout: "mouseOut",
	rollover: "rollOver",
	rollout: "rollOut",
	dblclick: "doubleClick",
	tick: "enterFrame",
	stagemousedown: "mouseDown",
	stagemouseup: "mouseUp",
	stagemousemove: "mouseMove",
	pressmove: "pressMove",
};

class Dispatcher {
	_on: Map<string, { fn: Fn; capture: boolean; prio: number }[]> | null = null;
	addEventListener(type: string, fn: Fn, capture = false, prio = 0) {
		if (!current.base) type = CANVAS_EVENTS[type] ?? type;
		const m = (this._on ??= new Map<string, { fn: Fn; capture: boolean; prio: number }[]>());
		let l = m.get(type);
		if (!l) m.set(type, (l = []));
		if (l.some((e) => e.fn === fn && e.capture === capture)) return;
		l.push({ fn, capture, prio });
		l.sort((a, b) => b.prio - a.prio);
		this._listening(type);
	}
	/** CreateJS: the listener, to give to off(). */
	on(type: string, fn: Fn, scope?: unknown) {
		const f = scope ? fn.bind(scope) : fn;
		this.addEventListener(type, f);
		return f;
	}
	off(type: string, fn: Fn) {
		this.removeEventListener(type, fn);
	}
	removeAllEventListeners(type?: string) {
		if (type) this._on?.delete(CANVAS_EVENTS[type] ?? type);
		else this._on?.clear();
	}
	removeEventListener(type: string, fn: Fn, capture = false) {
		if (!current.base) type = CANVAS_EVENTS[type] ?? type;
		const l = this._on?.get(type);
		if (!l) return;
		const i = l.findIndex((e) => e.fn === fn && e.capture === capture);
		if (i >= 0) l.splice(i, 1);
	}
	hasEventListener(type: string) {
		return !!this._on?.get(type)?.length;
	}
	willTrigger(type: string): boolean {
		if (this.hasEventListener(type)) return true;
		const up = (this as unknown as { _parent?: Dispatcher })._parent;
		return !!up?.willTrigger(type);
	}
	_listening(_type: string) {}
	_fire(e: FEvent, capture = false) {
		const l = this._on?.get(e.type);
		if (!l) return;
		e.currentTarget = this;
		for (const x of l.slice()) {
			if (e._stop > 1) break;
			if (x.capture === capture) run(() => x.fn.call(this, e));
		}
	}
	dispatchEvent(e: FEvent) {
		e.target = this;
		this._fire(e);
		return true;
	}
}

let current: Scripts;
/** Runs script code: an error in it stops that code only, as a script error does in Flash. */
function run(fn: () => void) {
	try {
		fn();
	} catch (e) {
		console.error(e);
	}
}

// ------------------------------------------------------------------ display objects

interface Box {
	l: number;
	t: number;
	r: number;
	b: number;
}
const noBox = (): Box => ({ l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });

function addPoint(out: Box, x: number, y: number) {
	if (x < out.l) out.l = x;
	if (x > out.r) out.r = x;
	if (y < out.t) out.t = y;
	if (y > out.b) out.b = y;
}
/** Grows `out` by the box `s` seen through `m`. */
function addBox(out: Box, m: Mat, s: Box) {
	addPoint(out, m[0] * s.l + m[2] * s.t + m[4], m[1] * s.l + m[3] * s.t + m[5]);
	addPoint(out, m[0] * s.r + m[2] * s.t + m[4], m[1] * s.r + m[3] * s.t + m[5]);
	addPoint(out, m[0] * s.l + m[2] * s.b + m[4], m[1] * s.l + m[3] * s.b + m[5]);
	addPoint(out, m[0] * s.r + m[2] * s.b + m[4], m[1] * s.r + m[3] * s.b + m[5]);
}

const ONE: Mat = [1, 0, 0, 1, 0, 0];
const fromMat = (m: Mat): Frozen => {
	const r = Math.atan2(m[1], m[0]) / RAD;
	return { x: m[4], y: m[5], r, k: Math.atan2(-m[2], m[3]) / RAD - r, sx: Math.hypot(m[0], m[1]), sy: Math.hypot(m[2], m[3]) };
};
const matOf = (f: Frozen): Mat => {
	const r = f.r * RAD,
		q = (f.r + f.k) * RAD;
	return [Math.cos(r) * f.sx, Math.sin(r) * f.sx, -Math.sin(q) * f.sy, Math.cos(q) * f.sy, f.x, f.y];
};
const matrixText = (m: Mat) => `matrix(${m.map((n) => Math.round(n * 1e4) / 1e4).join(",")})`;
/** Alpha and the colour multipliers are kept in 1/256ths. */
const eighths = (v: number) => Math.trunc(v * 256) / 256;

/** The half of the widest stroke of a drawing (Flash counts strokes into its bounds). */
const strokes = new WeakMap<Element, number>();
function strokeOf(n: Element): number {
	let w = strokes.get(n);
	if (w !== undefined) return w;
	w = 0;
	const see = (e: Element) => {
		const s = e.getAttribute("stroke");
		if (s && s !== "none") w = Math.max(w!, +(e.getAttribute("stroke-width") ?? 1) / 2);
		const h = e.localName === "use" && (e.getAttribute("href") ?? e.getAttribute("xlink:href"));
		const to = h ? document.getElementById(h.slice(1)) : null;
		if (to) see(to);
		for (const c of e.children) see(c);
	};
	see(n);
	strokes.set(n, w);
	return w;
}

/** The box of a drawing in its node's space (its node's own transform left out). */
function drawnBox(n: Element, stroke: boolean): Box | null {
	let b: DOMRect;
	try {
		b = (n as SVGGraphicsElement).getBBox();
	} catch {
		return null;
	}
	if (!b.width && !b.height) return null;
	const s = stroke ? strokeOf(n) : 0;
	return { l: b.x - s, t: b.y - s, r: b.x + b.width + s, b: b.y + b.height + s };
}

let pen: CanvasRenderingContext2D | null = null;
const canvas2d = () => (pen ??= document.createElement("canvas").getContext("2d")!);

/** Whether a drawing covers the point, given in the space it is put down in (`inside`: in its own). */
function covers(e: Element, x: number, y: number, inside = false): boolean {
	const list = (e as SVGGraphicsElement).transform?.baseVal;
	if (list?.numberOfItems && !inside) {
		const m = list.consolidate()!.matrix;
		const i = inverse([m.a, m.b, m.c, m.d, m.e, m.f]);
		[x, y] = [i[0] * x + i[2] * y + i[4], i[1] * x + i[3] * y + i[5]];
	}
	switch (e.localName) {
		case "defs":
			return false;
		case "use": {
			const h = e.getAttribute("href") ?? e.getAttribute("xlink:href");
			const to = h ? document.getElementById(h.slice(1)) : null;
			return !!to && covers(to, x - +(e.getAttribute("x") ?? 0), y - +(e.getAttribute("y") ?? 0));
		}
		case "path": {
			const d = e.getAttribute("d");
			if (!d) return false;
			const p = new Path2D(d);
			const c = canvas2d();
			if (e.getAttribute("fill") !== "none" && c.isPointInPath(p, x, y, e.getAttribute("fill-rule") === "evenodd" ? "evenodd" : "nonzero")) return true;
			const s = e.getAttribute("stroke");
			if (!s || s === "none") return false;
			c.lineWidth = +(e.getAttribute("stroke-width") ?? 1);
			return c.isPointInStroke(p, x, y);
		}
		case "image":
		case "rect":
		case "text": {
			const b = (e as SVGGraphicsElement).getBBox?.();
			return !!b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
		}
	}
	for (const c of e.children) if ((c as SVGElement).style?.display !== "none" && covers(c, x, y)) return true;
	return false;
}

const BLENDS: Record<string, string> = { hardlight: "hard-light", add: "plus-lighter", subtract: "difference", invert: "difference", layer: "", alpha: "", erase: "", shader: "" };

/** A filter of the API as the core's FilterData. */
function filterData(f: any): FilterData {
	const hex = (c: number, a: number) => colorOf(c) + Math.round(a * 255).toString(16).padStart(2, "0");
	const d: FilterData = { ...f, name: f._t, enabled: true, quality: ["low", "low", "medium", "high"][Math.min(3, f.quality ?? 1)], strength: (f.strength ?? 1) * 100 };
	if (f.color !== undefined) d.color = hex(f.color, f.alpha);
	if (f.highlightColor !== undefined) {
		d.highlightColor = hex(f.highlightColor, f.highlightAlpha);
		d.shadowColor = hex(f.shadowColor, f.shadowAlpha);
	}
	return d;
}

function toDom(n: XmlNode): SVGElement {
	const e = svgEl(n.name, n.attrs);
	for (const c of n.children) e.appendChild(typeof c === "string" ? document.createTextNode(c) : toDom(c));
	return e;
}

class DisplayObject extends Dispatcher {
	/** The timeline instance, if it is one. */
	_i: Inst | null = null;
	/** The timeline, if it has one. */
	_c: Clip | null = null;
	_node: SVGElement;
	_parent: any = null;
	_gone = false;
	_m: Frozen = { x: 0, y: 0, r: 0, k: 0, sx: 1, sy: 1 };
	_alpha = 1;
	_name: string | null = null;
	_g: FGraphics | null = null;
	_ct: FColorTransform | null = null;
	_fl: FFilter[] = [];
	_fx: SVGElement | null = null;
	_vis = true;
	_mask: DisplayObject | null = null;
	_masks = 0;
	_blend = "normal";
	_sr: FRectangle | null = null;
	_clip: SVGElement | null = null;
	cacheAsBitmap = false;
	opaqueBackground: number | null = null;
	scale9Grid: FRectangle | null = null;
	accessibilityProperties: unknown = null;
	z = 0;
	rotationX = 0;
	rotationY = 0;
	rotationZ = 0;
	scaleZ = 1;
	constructor(node?: SVGElement) {
		super();
		this._node = node ?? svgEl("g");
	}
	get name() {
		// (instances without a name have one made up, as in Flash)
		return (this._i ? (this._i.it as PInst).nm : "") || (this._name ??= `instance${++current.uid}`);
	}
	set name(v: string) {
		this._name = v;
	}
	get parent() {
		return this._gone ? null : this._parent;
	}
	get root(): DisplayObject | null {
		return this._onStage() ? current.rootObj : null;
	}
	get stage(): FStage | null {
		return this._onStage() ? current.stage : null;
	}
	get loaderInfo() {
		return this._onStage() ? current.info : null;
	}
	_onStage(): boolean {
		for (let o: any = this; o; o = o.parent) if (o === current.stage) return true;
		return false;
	}
	/** Its transform now: the script's, or the timeline's at this frame. */
	_get(): Frozen {
		const i = this._i;
		if (!i) return this._m;
		return i.ov ?? decompose(current, i);
	}
	/** Takes the transform from the timeline: from now on it is the script's. */
	_own(): Frozen {
		const i = this._i;
		if (!i) return this._m;
		if (!i.ov) {
			i.ov = decompose(current, i);
			free(i);
		}
		return i.ov;
	}
	_mat(): Mat {
		return matOf(this._get());
	}
	/** The matrix its children are seen through. */
	_inner(): Mat {
		const m = this._mat();
		return this._sr ? mul(m, [1, 0, 0, 1, -this._sr.x, -this._sr.y]) : m;
	}
	/** From its space to the stage's. */
	_world(): Mat {
		let m = this._mat();
		for (let o = this.parent; o && o !== (current.stage as unknown); o = o.parent) m = mul(o._inner(), m);
		return m;
	}
	_apply() {
		const t = matrixText(this._inner());
		if (this._i) place(this._i, t);
		else this._node.setAttribute("transform", t);
		current.touched();
	}
	get x() {
		return this._get().x;
	}
	set x(v: number) {
		this._own().x = toTwips(+v);
		this._apply();
	}
	get y() {
		return this._get().y;
	}
	set y(v: number) {
		this._own().y = toTwips(+v);
		this._apply();
	}
	get rotation() {
		const r = this._get().r % 360;
		return r > 180 ? r - 360 : r <= -180 ? r + 360 : r;
	}
	set rotation(v: number) {
		this._own().r = +v;
		this._apply();
	}
	get scaleX() {
		return this._get().sx;
	}
	set scaleX(v: number) {
		this._own().sx = +v;
		this._apply();
	}
	get scaleY() {
		return this._get().sy;
	}
	set scaleY(v: number) {
		this._own().sy = +v;
		this._apply();
	}
	get alpha() {
		const i = this._i;
		if (i && i.ovAlpha === undefined) return eighths(alphaNow(i) / 100);
		return i ? i.ovAlpha! : this._alpha;
	}
	set alpha(v: number) {
		const a = eighths(+v);
		if (this._i) {
			free(this._i);
			this._i.ovAlpha = a;
		} else this._alpha = a;
		this._node.setAttribute("opacity", String(Math.max(0, Math.min(1, a))));
		current.touched();
	}
	get visible() {
		return this._vis;
	}
	set visible(v: boolean) {
		this._vis = !!v;
		this._show();
	}
	/** Hidden if it isn't visible, or masks something (a mask doesn't draw). */
	_show() {
		this._node.style.visibility = this._vis && !this._masks ? "" : "hidden";
		current.touched();
	}
	/** The box of what it draws itself, children aside, in its own space. */
	_self(stroke: boolean): Box | null {
		if (this._g) return this._g._box(stroke);
		return this._i && !this._c ? drawnBox(this._node, stroke) : null;
	}
	/** Grows `out` by what it draws; `m` leads from its space to the one asked about. */
	_collect(m: Mat, stroke: boolean, out: Box) {
		if (this._sr) return addBox(out, m, { l: 0, t: 0, r: this._sr.width, b: this._sr.height });
		const s = this._self(stroke);
		if (s) addBox(out, m, s);
	}
	/** The box, in twips, in a space `m` leads to. */
	_boxIn(m: Mat, stroke: boolean): Box | null {
		const b = noBox();
		this._collect(m, stroke, b);
		return b.l === Infinity ? null : { l: twips(b.l), t: twips(b.t), r: twips(b.r), b: twips(b.b) };
	}
	_rect(space: DisplayObject | undefined, stroke: boolean) {
		const m = !space || space === this ? ONE : mul(inverse(space._world()), this._world());
		const b = this._boxIn(m, stroke);
		return b ? new FRectangle(b.l, b.t, b.r - b.l, b.b - b.t) : new FRectangle();
	}
	getBounds(space?: DisplayObject) {
		return this._rect(space, true);
	}
	getRect(space?: DisplayObject) {
		return this._rect(space, false);
	}
	get width() {
		const b = this._boxIn(this._mat(), true);
		return b ? b.r - b.l : 0;
	}
	/** The box around a turned object is what is set, in a way that changes both scales. */
	_size(v: number, wide: boolean) {
		const b = this._boxIn(ONE, true);
		const w = b ? b.r - b.l : 0,
			h = b ? b.b - b.t : 0;
		if (!w || !h) return;
		const f = this._get();
		const c = Math.abs(Math.cos(f.r * RAD)),
			s = Math.abs(Math.sin(f.r * RAD));
		const ratio = wide ? h / w : w / h;
		const tx = v / w,
			ty = v / h;
		const set = (ratio * ((wide ? c : s) * tx + (wide ? s : c) * ty)) / ((c + ratio * s) * (ratio * c + s));
		const keep = wide ? (s * f.sx + ratio * c * f.sy) / (ratio * c + s) : (ratio * c * f.sx + s * f.sy) / (ratio * c + s);
		const o = this._own();
		o.sx = wide ? set : keep;
		o.sy = wide ? keep : set;
		this._apply();
	}
	set width(v: number) {
		this._size(+v, true);
	}
	get height() {
		const b = this._boxIn(this._mat(), true);
		return b ? b.b - b.t : 0;
	}
	set height(v: number) {
		this._size(+v, false);
	}
	_mouse(): [number, number] {
		const [x, y] = stagePoint(current.client[0], current.client[1]);
		const i = inverse(this._world());
		return [twips(i[0] * x + i[2] * y + i[4]), twips(i[1] * x + i[3] * y + i[5])];
	}
	get mouseX() {
		return this._mouse()[0];
	}
	get mouseY() {
		return this._mouse()[1];
	}
	get blendMode() {
		return this._blend;
	}
	set blendMode(v: string) {
		this._blend = v;
		this._node.style.mixBlendMode = BLENDS[v] ?? (v === "normal" ? "" : v);
		current.touched();
	}
	get filters() {
		return this._fl.map((f) => f.clone());
	}
	set filters(v: FFilter[]) {
		this._fl = (v ?? []).map((f) => f.clone());
		this._paint();
	}
	/** The colour transform and filters, as one SVG filter (they replace the timeline's, as in Flash). */
	_paint() {
		const n = this._node;
		const cm = this._i?.cm;
		const ct = this._ct && !this._ct._plain() ? this._ct : null;
		if (cm) cm.setAttribute("values", (this._ct ?? new FColorTransform())._values());
		const prims: SVGElement[] = [];
		if (ct && !cm) prims.push(svgEl("feColorMatrix", { type: "matrix", values: ct._values() }));
		let reach = 0;
		for (const f of this._fl) {
			if (f._t === "colorMatrix") {
				const v = (f as ColorMatrixFilter).matrix.map((x, i) => (i % 5 === 4 ? x / 255 : x));
				prims.push(svgEl("feColorMatrix", { type: "matrix", values: v.join(" ") }));
			}
		}
		const rest = this._fl.filter((f) => f._t !== "colorMatrix");
		if (rest.length) {
			const w = this._world();
			const built = buildFilters(rest.map(filterData), { x: Math.hypot(w[0], w[1]), y: Math.hypot(w[2], w[3]) }, () => {});
			prims.push(...built.primitives.map(toDom));
			reach = Math.max(built.margin.x, built.margin.y);
		}
		if (!prims.length) {
			this._fx?.remove();
			this._fx = null;
			n.removeAttribute("filter");
		} else {
			const f = (this._fx ??= current.player.defs.appendChild(svgEl("filter", { id: `${current.player.svg.id}_s${current.uid++}`, "color-interpolation-filters": "sRGB", filterUnits: "userSpaceOnUse" })));
			f.replaceChildren(...prims);
			const b = this._boxIn(ONE, true) ?? { l: 0, t: 0, r: 0, b: 0 };
			f.setAttribute("x", String(b.l - reach - 1));
			f.setAttribute("y", String(b.t - reach - 1));
			f.setAttribute("width", String(b.r - b.l + 2 * reach + 2));
			f.setAttribute("height", String(b.b - b.t + 2 * reach + 2));
			n.setAttribute("filter", `url(#${f.id})`);
		}
		current.touched();
	}
	get transform() {
		return new FTransform(this);
	}
	set transform(v: FTransform) {
		this._ct = v.colorTransform;
		this.alpha = this._ct!.alphaMultiplier;
		this._paint();
		const t = this.transform;
		t.matrix = v.matrix;
	}
	get mask() {
		return this._mask;
	}
	set mask(o: DisplayObject | null) {
		const old = this._mask;
		if (old === o) return;
		if (old) {
			old._masks--;
			old._show();
			this._node.removeAttribute("mask");
		}
		this._mask = o;
		if (o) {
			o._masks++;
			o._show();
			current.masked.add(this);
		} else current.masked.delete(this);
		current.touched();
	}
	/** The mask, as it is now, in this object's space. */
	_maskNow(id: string) {
		const o = this._mask!;
		let m = document.getElementById(id);
		if (!m) {
			m = current.player.defs.appendChild(svgEl("mask", { id, maskUnits: "userSpaceOnUse", x: "-16384", y: "-16384", width: "32768", height: "32768" })) as unknown as HTMLElement;
			this._node.setAttribute("mask", `url(#${id})`);
		}
		const copy = o._node.cloneNode(true) as SVGElement;
		copy.style.visibility = "";
		copy.removeAttribute("opacity");
		const g = svgEl("g", { transform: matrixText(mul(inverse(this._world()), o._world())) });
		copy.removeAttribute("transform");
		if (current.P.mf) copy.setAttribute("filter", `url(#${current.P.mf})`);
		g.appendChild(copy);
		m.replaceChildren(g);
	}
	get scrollRect() {
		return this._sr?.clone() ?? null;
	}
	set scrollRect(r: FRectangle | null) {
		this._sr = r?.clone() ?? null;
		if (r) {
			const c = (this._clip ??= current.player.defs.appendChild(svgEl("clipPath", { id: `${current.player.svg.id}_c${current.uid++}` }, )));
			c.replaceChildren(svgEl("rect", { x: String(r.x), y: String(r.y), width: String(r.width), height: String(r.height) }));
			this._node.setAttribute("clip-path", `url(#${c.id})`);
		} else {
			this._clip?.remove();
			this._clip = null;
			this._node.removeAttribute("clip-path");
		}
		this._apply();
	}
	localToGlobal(p: FPoint) {
		const m = this._world();
		return new FPoint(twips(m[0] * p.x + m[2] * p.y + m[4]), twips(m[1] * p.x + m[3] * p.y + m[5]));
	}
	globalToLocal(p: FPoint) {
		const m = inverse(this._world());
		return new FPoint(twips(m[0] * p.x + m[2] * p.y + m[4]), twips(m[1] * p.x + m[3] * p.y + m[5]));
	}
	hitTestObject(o: DisplayObject) {
		const a = this._boxIn(this._world(), true),
			b = o._boxIn(o._world(), true);
		return !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
	}
	hitTestPoint(x: number, y: number, shape = false) {
		if (!shape) {
			const b = this._boxIn(this._world(), true);
			return !!b && x >= b.l && x <= b.r && y >= b.t && y <= b.b;
		}
		return this._covers(x, y);
	}
	/** Whether what it draws covers a point of the stage. */
	_covers(x: number, y: number): boolean {
		const i = inverse(this._world());
		const lx = i[0] * x + i[2] * y + i[4],
			ly = i[1] * x + i[3] * y + i[5];
		if (this._g) return this._g._covers(lx, ly);
		return !!this._i && !this._c && covers(this._node, lx, ly, true);
	}
	override _listening(type: string) {
		current.hear(type, this);
		// (as with mouse handlers from snippets: a click target is a button, also for the keyboard)
		if (type === FMouseEvent.CLICK && this !== (current.stage as unknown)) {
			this._node.style.cursor = "pointer";
			if (!this._node.hasAttribute("tabindex")) this._node.setAttribute("tabindex", "0");
			if (!this._node.hasAttribute("role")) this._node.setAttribute("role", "button");
		}
	}
	/** Down the display list (listeners with useCapture), at the object, and back up if it bubbles. */
	override dispatchEvent(e: FEvent) {
		e.target = this;
		const up: Dispatcher[] = [];
		for (let o = this._parent; o; o = o._parent) up.push(o);
		e.eventPhase = 1;
		for (let i = up.length - 1; i >= 0 && !e._stop; i--) up[i]!._fire(e, true);
		if (!e._stop) {
			e.eventPhase = 2;
			this._fire(e);
		}
		e.eventPhase = 3;
		if (e.bubbles) for (const o of up) if (!e._stop) o._fire(e);
		return true;
	}
	/** Its class's name in AS3. */
	_cls = "DisplayObject";
	override toString() {
		return `[object ${this._cls}]`;
	}
}

class FTransform {
	private o: DisplayObject;
	constructor(o: DisplayObject) {
		this.o = o;
	}
	get colorTransform() {
		const o = this.o;
		const i = o._i;
		let c = o._ct;
		// (what the timeline gives: multipliers in percent, offsets)
		const v = !c && i && (i.it as PInst).c;
		if (v) c = new FColorTransform(...([0, 1, 2, 3, 4, 5, 6, 7].map((k) => trackValue(i!.owner.P, v[k], i!.owner.frame, k < 4 ? 100 : 0) / (k < 4 ? 100 : 1)) as [number, number, number, number, number, number, number, number]));
		c = c ? c._copy() : new FColorTransform();
		c.alphaMultiplier = o.alpha;
		return c;
	}
	set colorTransform(c: FColorTransform) {
		const o = this.o;
		o._ct = c._copy();
		if (o._i && o._i.ovAlpha === undefined) free(o._i);
		o.alpha = c.alphaMultiplier;
		o._paint();
	}
	get matrix() {
		return new FMatrix(...this.o._mat());
	}
	set matrix(v: FMatrix) {
		const f = fromMat(v._m());
		f.x = toTwips(f.x);
		f.y = toTwips(f.y);
		Object.assign(this.o._own(), f);
		this.o._apply();
	}
	/** (Flash Player places things on quarter pixels: what it says here is rounded so.) */
	get concatenatedMatrix() {
		const m = this.o._world();
		m[4] = Math.round(m[4] * 4) / 4;
		m[5] = Math.round(m[5] * 4) / 4;
		return new FMatrix(...m);
	}
	get concatenatedColorTransform() {
		const c = this.colorTransform;
		for (let o = this.o.parent; o; o = o.parent) if (o !== current.stage) c.concat(o.transform.colorTransform);
		return c;
	}
	get pixelBounds() {
		return this.o._rect(current.stage, true);
	}
}

class DisplayObjectContainer extends DisplayObject {
	mouseChildren = true;
	tabChildren = true;
	/** Children added by scripts, on top of the timeline's. */
	_dyn: DisplayObject[] = [];
	private _lc: DisplayObject[] | null = null;
	private _lv = -1;
	/** The children in stacking order: the order of their nodes (as long as nothing changed). */
	_list(): DisplayObject[] {
		if (this._lc && this._lv === current.ver) return this._lc;
		const out = [...timelineChildren(this), ...this._dyn.filter((o) => !o._i || o._i.owner.items.get(o._i.it) === o._i)];
		out.sort((a, b) => (a._node.compareDocumentPosition(b._node) & 4 ? -1 : 1));
		this._lv = current.ver;
		return (this._lc = out);
	}
	override _collect(m: Mat, stroke: boolean, out: Box) {
		super._collect(m, stroke, out);
		if (!this._sr) for (const c of this._list()) c._collect(mul(m, c._mat()), stroke, out);
	}
	override _covers(x: number, y: number) {
		return super._covers(x, y) || this._list().some((c) => c._covers(x, y));
	}
	get numChildren() {
		return this._list().length;
	}
	getChildAt(i: number) {
		const o = this._list()[i];
		if (!o) throw fail(RangeError, 2006, "The supplied index is out of bounds.");
		return o;
	}
	getChildByName(n: string) {
		return this._list().find((o) => o.name === n) ?? null;
	}
	getChildIndex(o: DisplayObject) {
		const i = this._list().indexOf(o);
		if (i < 0) throw fail(ArgumentError, 2025, "The supplied DisplayObject must be a child of the caller.");
		return i;
	}
	contains(o: DisplayObject) {
		for (let x: any = o; x; x = x.parent) if (x === this) return true;
		return false;
	}
	addChild(o: any) {
		if (!o) throw fail(TypeError, 2007, "Parameter child must be non-null.");
		return this.addChildAt(o, this._list().filter((x) => x !== o).length);
	}
	addChildAt(o: any, index: number) {
		if (!o) throw fail(TypeError, 2007, "Parameter child must be non-null.");
		if (o === this) throw fail(ArgumentError, 2024, "An object cannot be added as a child of itself.");
		if (o.contains?.(this)) throw fail(ArgumentError, 2150, "An object cannot be added as a child to one of it's children (or children's children, etc.).");
		if (index < 0 || index > this._list().filter((x) => x !== o).length) throw fail(RangeError, 2006, "The supplied index is out of bounds.");
		const on = o._onStage();
		const same = o._parent === this && !o._gone;
		if (o._parent && !same) o._parent.removeChild(o);
		if (o._c) current.orphans.delete(o._c);
		o._parent = this;
		o._gone = false;
		this._place(o, index);
		if (!same) o.dispatchEvent(new FEvent(FEvent.ADDED, true));
		if (!on && o._onStage()) o.dispatchEvent(new FEvent(FEvent.ADDED_TO_STAGE));
		current.touched();
		return o;
	}
	/** Puts a child at a stacking position: before the node of the one that is to come after it. */
	_place(o: any, index: number) {
		const rest = this._list().filter((x) => x !== o);
		const next = rest[Math.max(0, index)];
		current.placed.set(o._node, o);
		if (!this._dyn.includes(o)) this._dyn.push(o);
		if (o._i) o._i.moved = true;
		if (next) next._node.parentNode!.insertBefore(o._node, next._node);
		else this._host().appendChild(o._node);
		current.ver++;
	}
	_host(): Element {
		return this._c ? this._c.node : this._node;
	}
	removeChild(o: any) {
		if (!o) throw fail(TypeError, 2007, "Parameter child must be non-null.");
		if (o.parent !== this) throw fail(ArgumentError, 2025, "The supplied DisplayObject must be a child of the caller.");
		o.dispatchEvent(new FEvent(FEvent.REMOVED, true));
		if (o._onStage()) o.dispatchEvent(new FEvent(FEvent.REMOVED_FROM_STAGE));
		const a = this._dyn.indexOf(o);
		if (a >= 0) this._dyn.splice(a, 1);
		o._node.remove();
		o._gone = true;
		if (o._i) o._i.removed = true;
		else o._parent = null;
		// (taken off the stage, a movie clip plays on)
		if (o._c && !o._i) current.orphans.add(o._c);
		current.ver++;
		current.touched();
		return o;
	}
	removeChildAt(i: number) {
		return this.removeChild(this.getChildAt(i));
	}
	removeChildren(a = 0, b = 0x7fffffff) {
		const n = this._list().length;
		if (a < 0 || a > n || (b !== 0x7fffffff && b >= n) || b < a) {
			if (n || a || b !== 0x7fffffff) throw fail(RangeError, 2006, "The supplied index is out of bounds.");
		}
		for (const o of this._list().slice(a, b + 1)) this.removeChild(o);
	}
	setChildIndex(o: any, i: number) {
		const n = this._list().length;
		if (i < 0 || i >= n) throw fail(RangeError, 2006, "The supplied index is out of bounds.");
		this.getChildIndex(o);
		this._place(o, i);
		current.touched();
	}
	swapChildren(a: any, b: any) {
		const i = this.getChildIndex(a),
			j = this.getChildIndex(b);
		this.setChildIndex(a, j);
		this.setChildIndex(b, i);
	}
	swapChildrenAt(i: number, j: number) {
		this.swapChildren(this.getChildAt(i), this.getChildAt(j));
	}
}

class Sprite extends DisplayObjectContainer {
	override _cls = "Sprite";
	buttonMode = false;
	useHandCursor = true;
	doubleClickEnabled = false;
	tabEnabled = false;
	tabIndex = -1;
	focusRect: unknown = null;
	mouseEnabled = true;
	hitArea: Sprite | null = null;
	dropTarget: DisplayObject | null = null;
	soundTransform = new FSoundTransform();
	get graphics() {
		return (this._g ??= new FGraphics(this._node));
	}
	startDrag(lock = false, bounds: FRectangle | null = null) {
		const s = current;
		const [px, py] = s.parentMouse(this);
		const m = this._own();
		s.drag = { o: this, dx: lock ? 0 : m.x - px, dy: lock ? 0 : m.y - py, b: bounds };
	}
	stopDrag() {
		const s = current;
		if (s.drag?.o === this) s.drag = null;
		this.dropTarget = s.objectAt(s.client[0], s.client[1], this);
	}
}

class FFrameLabel {
	name: string;
	frame: number;
	constructor(name: string, frame: number) {
		this.name = name;
		this.frame = frame;
	}
}

class FScene {
	name: string;
	numFrames: number;
	labels: FFrameLabel[];
	constructor(name: string, numFrames: number, labels: FFrameLabel[]) {
		this.name = name;
		this.numFrames = numFrames;
		this.labels = labels;
	}
}

class MovieClip extends Sprite {
	override _cls = "MovieClip";
	enabled = true;
	trackAsMenu = false;
	/** Its scene, if it is the root timeline: name, first frame, frames. */
	_scene(): PScene | null {
		const c = this._c;
		const list = c && c.kind === -1 ? current.P.sc : undefined;
		if (!list) return null;
		let s = list[0]!;
		for (const x of list) if (x[1] <= c!.frame) s = x;
		return s;
	}
	_target(f: number | string, sceneName?: string): number {
		const c = this._c!;
		let s = this._scene();
		if (sceneName !== undefined && sceneName !== null) {
			const to = current.P.sc?.find((x) => x[0] === sceneName);
			if (!to) throw fail(ArgumentError, 2108, `Scene ${sceneName} was not found.`);
			s = to;
		}
		const at = s ? s[1] : 0;
		if (typeof f === "number" || /^\d+$/.test(f as string)) return c.resolve(Math.max(+f - current.base, 0) + at);
		const lb = c.tl.lb ?? {};
		// (labels that are in several scenes carry their scene's name)
		for (const k of [`${s?.[0]}/${f}`, f]) if (Object.prototype.hasOwnProperty.call(lb, k)) return lb[k]!;
		if (!current.base) return c.frame;
		throw fail(ArgumentError, 2109, `Frame label ${f} not found in scene ${s ? s[0] : ""}.`);
	}
	get currentFrame() {
		return this._c ? this._c.frame - (this._scene()?.[1] ?? 0) + current.base : 1;
	}
	get totalFrames() {
		return this._c ? this._c.tl.n : 1;
	}
	get framesLoaded() {
		return this.totalFrames;
	}
	/** (Flash Player's flag: what play() and stop() said last, not whether the clip moves.) */
	isPlaying = false;
	/** The labels between two frames, numbered from the first of them. */
	_labels(from: number, n: number) {
		const lb = this._c?.tl.lb ?? {};
		const out: FFrameLabel[] = [];
		for (const k in lb) if (lb[k]! >= from && lb[k]! < from + n) out.push(new FFrameLabel(k.slice(k.indexOf("/") + 1), lb[k]! - from + 1));
		return out.sort((a, b) => a.frame - b.frame);
	}
	get currentLabels() {
		const s = this._scene();
		return s ? this._labels(s[1], s[2]) : this._labels(0, this.totalFrames);
	}
	get currentScene() {
		const s = this._scene();
		return s ? new FScene(s[0], s[2], this._labels(s[1], s[2])) : new FScene("", this.totalFrames, this._labels(0, this.totalFrames));
	}
	get scenes() {
		const list = this._c?.kind === -1 ? current.P.sc : undefined;
		return list ? list.map((s) => new FScene(s[0], s[2], this._labels(s[1], s[2]))) : [this.currentScene];
	}
	get currentFrameLabel() {
		const c = this._c;
		if (!c) return null;
		const lb = c.tl.lb ?? {};
		for (const k in lb) if (lb[k] === c.frame) return k.slice(k.indexOf("/") + 1);
		return null;
	}
	get currentLabel() {
		const c = this._c;
		if (!c) return null;
		let best: string | null = null,
			at = -1;
		const lb = c.tl.lb ?? {};
		for (const k in lb) if (lb[k]! <= c.frame && lb[k]! > at) (best = k), (at = lb[k]!);
		return best && best.slice(best.indexOf("/") + 1);
	}
	play() {
		const c = this._c;
		if (!c) return;
		c.playing = true;
		this.isPlaying = c.tl.n > 1;
		c.updateAdvance();
		current.touched();
	}
	stop() {
		const c = this._c;
		if (!c) return;
		c.playing = false;
		this.isPlaying = false;
		c.updateAdvance();
		current.touched();
	}
	gotoAndPlay(f: number | string, scene?: string) {
		if (!this._c) return;
		current.go(this._c, this._target(f, scene), true);
		this.isPlaying = this._c.tl.n > 1;
		current.touched();
	}
	gotoAndStop(f: number | string, scene?: string) {
		if (!this._c) return;
		current.go(this._c, this._target(f, scene), false);
		current.touched();
	}
	nextFrame() {
		const c = this._c;
		if (!c) return;
		current.go(c, Math.min(c.tl.n - 1, c.frame + 1), false);
		current.touched();
	}
	prevFrame() {
		const c = this._c;
		if (!c) return;
		current.go(c, Math.max(0, c.frame - 1), false);
		current.touched();
	}
	nextScene() {
		const s = this._scene();
		const list = current.P.sc;
		const to = s && list?.[list.indexOf(s) + 1];
		if (to) this.gotoAndPlay(current.base, to[0]);
	}
	prevScene() {
		const s = this._scene();
		const list = current.P.sc;
		const to = s && list?.[list.indexOf(s) - 1];
		if (to) this.gotoAndPlay(current.base, to[0]);
	}
	addFrameScript(...a: (number | Fn)[]) {
		const c = this._c;
		if (!c) return;
		for (let i = 0; i + 1 < a.length; i += 2) (c.fs ??= {})[a[i] as number] = a[i + 1] as () => void;
	}
}

/** Drawings on a timeline, or a Shape a script made. */
class Shape extends DisplayObject {
	override _cls = "Shape";
	get graphics() {
		return (this._g ??= new FGraphics(this._node));
	}
}

class SimpleButton extends MovieClip {
	override _cls = "SimpleButton";
}

class FStage extends DisplayObjectContainer {
	override _cls = "Stage";
	scaleMode = "showAll";
	align = "";
	private _quality = "HIGH";
	focus: unknown = null;
	stageFocusRect = true;
	color = 0;
	allowsFullScreen = false;
	mouseEnabled = true;
	mouseLock = false;
	get quality() {
		return this._quality;
	}
	set quality(v: string) {
		this._quality = String(v).toUpperCase();
	}
	get displayState() {
		return document.fullscreenElement ? "fullScreen" : "normal";
	}
	set displayState(v: string) {
		if (v === "normal") void document.exitFullscreen?.().catch(() => {});
		else void (current.player.svg as unknown as Element).requestFullscreen?.().catch(() => {});
	}
	get stageWidth() {
		return current.P.w;
	}
	get stageHeight() {
		return current.P.h;
	}
	get fullScreenWidth() {
		return screen.width;
	}
	get fullScreenHeight() {
		return screen.height;
	}
	get frameRate() {
		return current.rate;
	}
	set frameRate(v: number) {
		current.rate = +v;
		current.player.speed = +v / current.P.fps;
	}
	override get name() {
		return null as unknown as string;
	}
	override set name(_v: string) {}
	override get stage() {
		return this;
	}
	override get root() {
		return this as DisplayObject;
	}
	override get mouseX() {
		return twips(stagePoint(current.client[0], current.client[1])[0]);
	}
	override get mouseY() {
		return twips(stagePoint(current.client[0], current.client[1])[1]);
	}
	override _mat() {
		return ONE;
	}
	override _world() {
		return ONE;
	}
	override _onStage() {
		return true;
	}
	override _list() {
		return [current.rootObj as DisplayObject, ...this._dyn];
	}
	override _listening(type: string) {
		current.hear(type, this);
	}
	invalidate() {}
	// (CreateJS's stage)
	enableMouseOver() {}
	update() {}
}

/** One line of a text field: its characters, and how it is drawn. */
interface TextLine {
	from: number;
	to: number;
	width: number;
	ascent: number;
	descent: number;
	leading: number;
}

/** A text field: on a timeline (its drawing is live text), or made by a script. */
class TextField extends DisplayObject {
	override _cls = "TextField";
	multiline = false;
	wordWrap = false;
	selectable = true;
	type = "dynamic";
	maxChars = 0;
	displayAsPassword = false;
	embedFonts = false;
	restrict: string | null = null;
	alwaysShowSelection = false;
	antiAliasType = "normal";
	gridFitType = "pixel";
	condenseWhite = false;
	mouseWheelEnabled = true;
	mouseEnabled = true;
	tabEnabled = false;
	tabIndex = -1;
	sharpness = 0;
	thickness = 0;
	styleSheet: unknown = null;
	scrollH = 0;
	selectionBeginIndex = 0;
	selectionEndIndex = 0;
	caretIndex = 0;
	_def: FTextFormat;
	_text = "";
	/** Each character's format. */
	_chars: FTextFormat[] = [];
	_lines: TextLine[] = [];
	_auto = "none";
	_w = 100;
	_h = 100;
	_back: SVGElement | null = null;
	_bgOn = false;
	_bg = 0xffffff;
	_brOn = false;
	_br = 0;
	_html: string | null = null;
	_v = 1;
	constructor(node?: SVGElement, extras?: PTextExtras) {
		super(node);
		this._def = new FTextFormat("Times New Roman", 12, 0, false, false, false, "", "", "left", 0, 0, 0, 0);
		this._def.letterSpacing = 0;
		this._def.blockIndent = 0;
		this._def.kerning = false;
		this._def.bullet = false;
		this._def.tabStops = [];
		const t = node && this._field();
		if (t) {
			// the look of the field in Animate
			const s = t.querySelector("[font-size]");
			const f = this._def;
			f.size = +(s?.getAttribute("font-size") ?? 12);
			f.font = (s?.getAttribute("font-family") ?? "Arial").split(",")[0]!.replace(/['"]/g, "");
			f.color = parseInt((s?.getAttribute("fill") ?? "#000000").slice(1), 16);
			f.bold = s?.getAttribute("font-weight") === "bold";
			f.italic = s?.getAttribute("font-style") === "italic";
			f.align = extras?.[2] ?? "left";
			this._text = [...t.children].map((l) => l.textContent).join("\r");
			this._chars = Array.from(this._text, () => f);
			// the field's box is its space: the text's own matrix points inside the gutter
			const list = t.transform.baseVal;
			const m = list.numberOfItems ? list.consolidate()!.matrix : null;
			const v: Mat = m ? [m.a, m.b, m.c, m.d, m.e, m.f] : ONE;
			node!.setAttribute("transform", matrixText(mul(v, [1, 0, 0, 1, -2, -2])));
			t.setAttribute("transform", "translate(2 2)");
			if (extras) {
				this._w = extras[0] / (Math.abs(v[0]) || 1);
				this._h = extras[1] / (Math.abs(v[3]) || 1);
				this.type = extras[3] ?? "dynamic";
				this.selectable = !!extras[4];
				this.multiline = !!extras[5];
				this.wordWrap = !!extras[5];
			}
			this._lay();
		} else this._draw();
	}
	_field(): SVGTextElement | null {
		return (this._node.localName === "text" ? this._node : this._node.querySelector("text")) as SVGTextElement | null;
	}
	private fontOf(f: FTextFormat) {
		return `${f.italic ? "italic " : ""}${f.bold ? "bold " : ""}${f.size}px "${f.font}", sans-serif`;
	}
	/** Breaks the text into lines and measures them. */
	_lay() {
		const c = canvas2d();
		const text = this._text;
		const room = this._w - 4;
		const lines: TextLine[] = [];
		let from = 0;
		const close = (to: number, width: number) => {
			let asc = 0,
				desc = 0,
				lead = 0;
			for (let i = from; i < Math.max(to, from + 1); i++) {
				const f = this._chars[i] ?? this._def;
				c.font = this.fontOf(f);
				const m = c.measureText("Mg");
				asc = Math.max(asc, m.fontBoundingBoxAscent ?? f.size! * 0.905);
				desc = Math.max(desc, m.fontBoundingBoxDescent ?? f.size! * 0.212);
				lead = Math.max(lead, f.leading ?? 0);
				if (this._chars[i] === this._chars[i + 1] && i + 1 < to) {
					// (a run of one format: its first character tells)
					while (i + 1 < to && this._chars[i + 1] === f) i++;
				}
			}
			lines.push({ from, to, width, ascent: asc, descent: desc, leading: lead });
		};
		let x = 0,
			space = -1,
			widthAtSpace = 0;
		for (let i = 0; i <= text.length; i++) {
			const ch = text[i];
			if (i === text.length || ch === "\r") {
				close(i, x);
				from = i + 1;
				x = 0;
				space = -1;
				continue;
			}
			const f = this._chars[i] ?? this._def;
			c.font = this.fontOf(f);
			const w = c.measureText(ch!).width + (f.letterSpacing ?? 0);
			if (this.wordWrap && x + w > room && i > from) {
				if (space >= from) {
					close(space + 1, widthAtSpace);
					from = space + 1;
					x -= widthAtSpace;
				} else {
					close(i, x);
					from = i;
					x = 0;
				}
				space = -1;
			}
			x += w;
			if (ch === " " || ch === "\t") {
				space = i;
				widthAtSpace = x;
			}
		}
		this._lines = lines;
		if (this._auto !== "none") this._fit();
	}
	/** autoSize: the box around the text. */
	private _fit() {
		const w = this.textWidth + 4,
			h = this.textHeight + 4;
		if (!this.wordWrap) {
			const dx = this._w - w;
			if (this._auto === "center") this.x += dx / 2;
			else if (this._auto === "right") this.x += dx;
			this._w = w;
		}
		this._h = h;
	}
	/** Draws the lines from the first one scrolled to. */
	_draw() {
		this._lay();
		const n = this._node;
		let t = this._field();
		if (!t) n.appendChild((t = svgEl("text", { "xml:space": "preserve" }) as SVGTextElement));
		t.removeAttribute("text-anchor");
		t.removeAttribute("transform");
		const parts: SVGElement[] = [];
		const box = this._w;
		let y = 2;
		const hide = this.displayAsPassword;
		for (let l = this._v - 1; l < this._lines.length; l++) {
			const line = this._lines[l]!;
			y += line.ascent;
			const first = this._chars[line.from] ?? this._def;
			const align = first.align ?? "left";
			const row = svgEl("tspan", { x: String(align === "center" ? box / 2 : align === "right" ? box - 2 : 2 + (first.leftMargin ?? 0)), y: String(y), "text-anchor": align === "center" ? "middle" : align === "right" ? "end" : "start" });
			for (let i = line.from; i < line.to; ) {
				const f = this._chars[i]!;
				let e = i + 1;
				while (e < line.to && this._chars[e] === f) e++;
				const s = svgEl("tspan", { "font-family": `'${f.font}', sans-serif`, "font-size": String(f.size), fill: colorOf(f.color ?? 0) });
				if (f.bold) s.setAttribute("font-weight", "bold");
				if (f.italic) s.setAttribute("font-style", "italic");
				if (f.underline) s.setAttribute("text-decoration", "underline");
				if (f.letterSpacing) s.setAttribute("letter-spacing", String(f.letterSpacing));
				s.textContent = hide ? "*".repeat(e - i) : this._text.slice(i, e);
				row.appendChild(s);
				i = e;
			}
			parts.push(row);
			y += line.descent + line.leading;
			if (y > this._h && !this._i) break;
		}
		t.replaceChildren(...parts);
		if (this._bgOn || this._brOn) {
			const r = (this._back ??= n.insertBefore(svgEl("rect"), n.firstChild) as SVGElement);
			r.setAttribute("width", String(this._w));
			r.setAttribute("height", String(this._h));
			r.setAttribute("fill", this._bgOn ? colorOf(this._bg) : "none");
			r.setAttribute("stroke", this._brOn ? colorOf(this._br) : "none");
		} else {
			this._back?.remove();
			this._back = null;
		}
		current.touched();
	}
	override _self(): Box {
		return { l: 0, t: 0, r: this._w, b: this._h };
	}
	override _covers(x: number, y: number) {
		const b = this._boxIn(this._world(), true);
		return !!b && x >= b.l && x <= b.r && y >= b.t && y <= b.b;
	}
	get text() {
		return this._text;
	}
	set text(v: string) {
		this._text = (v === null || v === undefined ? "" : String(v)).replace(/\n/g, "\r");
		this._html = null;
		const f = this._def;
		this._chars = Array.from({ length: this._text.length }, () => f);
		this._draw();
	}
	get htmlText() {
		return this._html ?? this._text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
	set htmlText(v: string) {
		const html = String(v);
		let text = "";
		const chars: FTextFormat[] = [];
		const stack = [this._def];
		const put = (s: string) => {
			const f = stack[stack.length - 1]!;
			for (const ch of s.replace(/&(lt|gt|amp|quot|apos|nbsp);/g, (_m, e: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " })[e]!)) {
				text += ch;
				chars.push(f);
			}
		};
		for (const m of html.matchAll(/<(\/?)([a-zA-Z]+)([^>]*)>|[^<]+/g)) {
			if (!m[2]) {
				put(m[0].replace(/[\r\n]+/g, this.multiline ? "\r" : ""));
				continue;
			}
			const tag = m[2].toLowerCase();
			if (m[1]) {
				if (tag !== "br") stack.length = Math.max(1, stack.length - 1);
				if (tag === "p" || tag === "li") put("\r");
				continue;
			}
			if (tag === "br") {
				put("\r");
				continue;
			}
			const at = (k: string) => new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)`, "i").exec(m[3]!)?.[1];
			const f = new FTextFormat();
			if (tag === "b") f.bold = true;
			if (tag === "i") f.italic = true;
			if (tag === "u") f.underline = true;
			if (tag === "font") {
				f.font = at("face") ?? null;
				const s = at("size");
				f.size = s ? +s : null;
				const c = at("color");
				f.color = c ? parseInt(c.slice(1), 16) : null;
			}
			if (tag === "p") f.align = at("align")?.toLowerCase() ?? null;
			if (tag === "a") {
				f.url = at("href") ?? null;
				f.target = at("target") ?? null;
			}
			stack.push(stack[stack.length - 1]!._with(f));
		}
		if (text.endsWith("\r") && /<\/p>\s*$/i.test(html)) {
			text = text.slice(0, -1);
			chars.pop();
		}
		this._text = text;
		this._chars = chars;
		this._html = html;
		this._draw();
	}
	appendText(s: string) {
		const start = this._text.length;
		const add = String(s).replace(/\n/g, "\r");
		const f = this._chars[start - 1] ?? this._def;
		this._text += add;
		for (let i = 0; i < add.length; i++) this._chars.push(f);
		this._draw();
	}
	replaceText(a: number, b: number, s: string) {
		const add = String(s).replace(/\n/g, "\r");
		const f = this._chars[a] ?? this._def;
		this._text = this._text.slice(0, a) + add + this._text.slice(b);
		this._chars.splice(a, b - a, ...Array.from({ length: add.length }, () => f));
		this._draw();
	}
	replaceSelectedText(s: string) {
		this.replaceText(this.selectionBeginIndex, this.selectionEndIndex, s);
	}
	setSelection(a: number, b: number) {
		this.selectionBeginIndex = a;
		this.selectionEndIndex = b;
	}
	get length() {
		return this._text.length;
	}
	get numLines() {
		return Math.max(1, this._lines.length);
	}
	get textWidth() {
		return this._lines.reduce((w, l) => Math.max(w, l.width), 0);
	}
	get textHeight() {
		return this._lines.reduce((h, l) => h + l.ascent + l.descent + l.leading, 0);
	}
	get scrollV() {
		return this._v;
	}
	set scrollV(v: number) {
		this._v = Math.max(1, Math.min(this.maxScrollV, +v));
		this._draw();
	}
	get maxScrollV() {
		let h = 0,
			n = this._lines.length;
		while (n > 0) {
			const l = this._lines[n - 1]!;
			h += l.ascent + l.descent + l.leading;
			if (h > this._h - 4) break;
			n--;
		}
		return Math.max(1, n + 1);
	}
	get bottomScrollV() {
		let h = 0,
			n = this._v - 1;
		while (n < this._lines.length) {
			const l = this._lines[n]!;
			h += l.ascent + l.descent + l.leading;
			if (h > this._h - 4) break;
			n++;
		}
		return Math.max(1, n);
	}
	get maxScrollH() {
		return Math.max(0, this.textWidth - this._w + 4);
	}
	getLineText(i: number) {
		const l = this._lines[i];
		if (!l) throw fail(RangeError, 2006, "The supplied index is out of bounds.");
		return this._text.slice(l.from, Math.min(this._text.length, l.to + 1));
	}
	getLineLength(i: number) {
		return this.getLineText(i).length;
	}
	getLineOffset(i: number) {
		this.getLineText(i);
		return this._lines[i]!.from;
	}
	getLineMetrics(i: number) {
		this.getLineText(i);
		const l = this._lines[i]!;
		return { x: 2, width: l.width, height: l.ascent + l.descent + l.leading, ascent: l.ascent, descent: l.descent, leading: l.leading };
	}
	get textColor() {
		return this._def.color as number;
	}
	set textColor(v: number) {
		this.setTextFormat(new FTextFormat(null, null, v));
		this._def = this._def._with(new FTextFormat(null, null, v));
	}
	get defaultTextFormat() {
		return this._def._copy();
	}
	set defaultTextFormat(f: FTextFormat) {
		this._def = this._def._with(f);
	}
	getTextFormat(a = -1, b = -1) {
		const from = a < 0 ? 0 : a,
			to = a < 0 ? this._text.length : b < 0 ? a + 1 : b;
		const first = this._chars[from];
		if (!first) return this._def._copy();
		const out = first._copy() as any;
		for (let i = from + 1; i < to; i++) {
			const f = this._chars[i] as any;
			if (f === first) continue;
			for (const k in out) if (out[k] !== f[k]) out[k] = null;
		}
		return out as FTextFormat;
	}
	setTextFormat(f: FTextFormat, a = -1, b = -1) {
		const from = a < 0 ? 0 : a,
			to = a < 0 ? this._text.length : b < 0 ? a + 1 : b;
		const made = new Map<FTextFormat, FTextFormat>();
		for (let i = from; i < to; i++) {
			const o = this._chars[i]!;
			let n = made.get(o);
			if (!n) made.set(o, (n = o._with(f)));
			this._chars[i] = n;
		}
		this._draw();
	}
	get autoSize() {
		return this._auto;
	}
	set autoSize(v: string) {
		this._auto = v;
		this._draw();
	}
	get background() {
		return this._bgOn;
	}
	set background(v: boolean) {
		this._bgOn = !!v;
		this._draw();
	}
	get backgroundColor() {
		return this._bg;
	}
	set backgroundColor(v: number) {
		this._bg = v;
		this._draw();
	}
	get border() {
		return this._brOn;
	}
	set border(v: boolean) {
		this._brOn = !!v;
		this._draw();
	}
	get borderColor() {
		return this._br;
	}
	set borderColor(v: number) {
		this._br = v;
		this._draw();
	}
	override get width() {
		return this._w * Math.abs(this.scaleX);
	}
	override set width(v: number) {
		this._w = +v / (Math.abs(this.scaleX) || 1);
		this._draw();
	}
	override get height() {
		return this._h * Math.abs(this.scaleY);
	}
	override set height(v: number) {
		this._h = +v / (Math.abs(this.scaleY) || 1);
		this._draw();
	}
}

class FGraphics {
	private d = "";
	private fill = "none";
	private fo = 1;
	private stroke = "none";
	private sw = 1;
	private so = 1;
	private cap = "round";
	private join = "round";
	private miter = 3;
	private keep = false;
	private x = 0;
	private y = 0;
	private layer: SVGElement | null = null;
	private host: SVGElement;
	/** What it covers, without and with its lines. */
	private inner = noBox();
	private outer = noBox();
	constructor(host: SVGElement) {
		this.host = host;
	}
	_box(stroke: boolean): Box | null {
		const b = stroke ? this.outer : this.inner;
		return b.l === Infinity ? null : b;
	}
	_covers(x: number, y: number) {
		this._end();
		return !!this.layer && covers(this.layer, x, y);
	}
	private pt(x: number, y: number) {
		addPoint(this.inner, x, y);
		const h = this.stroke === "none" ? 0 : this.sw / 2;
		addPoint(this.outer, x - h, y - h);
		addPoint(this.outer, x + h, y + h);
	}
	private flush() {
		if (this.d) {
			const a: Record<string, string> = { d: this.d, fill: this.fill };
			if (this.fo !== 1) a["fill-opacity"] = String(this.fo);
			if (this.stroke !== "none") {
				a.stroke = this.stroke;
				a["stroke-width"] = String(this.sw || 1);
				if (this.so !== 1) a["stroke-opacity"] = String(this.so);
				a["stroke-linecap"] = this.cap;
				a["stroke-linejoin"] = this.join;
				if (this.join === "miter") a["stroke-miterlimit"] = String(this.miter);
				if (this.keep || !this.sw) a["vector-effect"] = "non-scaling-stroke";
			}
			(this.layer ??= this.host.insertBefore(svgEl("g"), this.host.firstChild) as SVGElement).appendChild(svgEl("path", a));
			this.d = "";
			current.touched();
		}
	}
	clear() {
		this.layer?.replaceChildren();
		this.d = "";
		this.fill = this.stroke = "none";
		this.inner = noBox();
		this.outer = noBox();
		this.x = this.y = 0;
		current.touched();
	}
	lineStyle(w = NaN, color = 0, alpha = 1, _hinting = false, scale = "normal", caps: string | null = null, joints: string | null = null, miter = 3) {
		this.flush();
		this.stroke = isNaN(w) ? "none" : colorOf(color);
		this.sw = Math.max(w, 0);
		this.so = alpha;
		this.cap = caps === "none" ? "butt" : caps ?? "round";
		this.join = joints ?? "round";
		this.miter = miter;
		this.keep = scale === "none";
		if (this.d) this.d += `M${this.x} ${this.y}`;
	}
	beginFill(color: number, alpha = 1) {
		this.flush();
		this.fill = colorOf(color);
		this.fo = alpha;
	}
	beginGradientFill(type: string, colors: number[], alphas: number[], ratios: number[], matrix: FMatrix | null = null, spread = "pad", interp = "rgb", focal = 0) {
		this.flush();
		const id = `${current.player.svg.id}_g${current.uid++}`;
		const linear = type === "linear";
		const m = matrix ?? new FMatrix();
		const e = svgEl(linear ? "linearGradient" : "radialGradient", { id, gradientUnits: "userSpaceOnUse", gradientTransform: matrixText(m._m()), spreadMethod: spread, ...(interp === "linearRGB" ? { "color-interpolation": "linearRGB" } : {}) });
		if (linear) for (const [k, v] of [["x1", -819.2], ["y1", 0], ["x2", 819.2], ["y2", 0]] as const) e.setAttribute(k, String(v));
		else for (const [k, v] of [["cx", 0], ["cy", 0], ["r", 819.2], ["fx", focal * 819.2], ["fy", 0]] as const) e.setAttribute(k, String(v));
		colors.forEach((c, i) => e.appendChild(svgEl("stop", { offset: String(ratios[i]! / 255), "stop-color": colorOf(c), "stop-opacity": String(alphas[i]) })));
		current.player.defs.appendChild(e);
		this.fill = `url(#${id})`;
		this.fo = 1;
	}
	beginBitmapFill(bd: FBitmapData, matrix: FMatrix | null = null, repeat = true, smooth = false) {
		this.flush();
		const id = `${current.player.svg.id}_p${current.uid++}`;
		const p = svgEl("pattern", { id, patternUnits: "userSpaceOnUse", width: String(repeat ? bd.width : 32768), height: String(repeat ? bd.height : 32768) });
		if (matrix) p.setAttribute("patternTransform", matrixText(matrix._m()));
		const img = svgEl("image", { width: String(bd.width), height: String(bd.height), href: bd._url() });
		if (!smooth) img.style.imageRendering = "pixelated";
		p.appendChild(img);
		current.player.defs.appendChild(p);
		this.fill = `url(#${id})`;
		this.fo = 1;
	}
	endFill() {
		this.flush();
		this.fill = "none";
	}
	moveTo(x: number, y: number) {
		this.d += `M${x} ${y}`;
		this.x = x;
		this.y = y;
	}
	private start() {
		if (!this.d) this.d = `M${this.x} ${this.y}`;
		this.pt(this.x, this.y);
	}
	lineTo(x: number, y: number) {
		this.start();
		this.d += `L${x} ${y}`;
		this.pt(x, y);
		this.x = x;
		this.y = y;
	}
	/** A quadratic curve's extent: where its slope is level, on either axis. */
	private bend(p: number, c: number, e: number, axis: (t: number, v: number) => void) {
		const n = p - 2 * c + e;
		if (!n) return;
		const t = (p - c) / n;
		if (t > 0 && t < 1) axis(t, (1 - t) ** 2 * p + 2 * (1 - t) * t * c + t * t * e);
	}
	curveTo(a: number, b: number, x: number, y: number) {
		this.start();
		this.d += `Q${a} ${b} ${x} ${y}`;
		this.bend(this.x, a, x, (_t, v) => this.pt(v, y));
		this.bend(this.y, b, y, (_t, v) => this.pt(x, v));
		this.pt(x, y);
		this.x = x;
		this.y = y;
	}
	cubicCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
		this.start();
		this.d += `C${a} ${b} ${c} ${d} ${x} ${y}`;
		// (its control points hold it; closer than that, the path's own box tells)
		this.pt(a, b);
		this.pt(c, d);
		this.pt(x, y);
		this.x = x;
		this.y = y;
	}
	private box(x: number, y: number, w: number, h: number) {
		this.pt(x, y);
		this.pt(x + w, y + h);
		this.x = x;
		this.y = y;
	}
	drawRect(x: number, y: number, w: number, h: number) {
		this.d += `M${x} ${y}h${w}v${h}h${-w}Z`;
		this.box(x, y, w, h);
		return this;
	}
	drawRoundRect(x: number, y: number, w: number, h: number, ew: number, eh = ew) {
		const r = ew / 2,
			s = eh / 2;
		this.d += `M${x + r} ${y}h${w - ew}a${r} ${s} 0 0 1 ${r} ${s}v${h - eh}a${r} ${s} 0 0 1 ${-r} ${s}h${ew - w}a${r} ${s} 0 0 1 ${-r} ${-s}v${eh - h}a${r} ${s} 0 0 1 ${r} ${-s}Z`;
		this.box(x, y, w, h);
	}
	drawEllipse(x: number, y: number, w: number, h: number) {
		const r = w / 2,
			s = h / 2;
		this.d += `M${x} ${y + s}a${r} ${s} 0 1 0 ${w} 0a${r} ${s} 0 1 0 ${-w} 0Z`;
		this.box(x, y, w, h);
	}
	drawCircle(x: number, y: number, r: number) {
		this.drawEllipse(x - r, y - r, r * 2, r * 2);
	}
	_end() {
		this.flush();
	}
}

/** Pixels: the numbers are the truth, a canvas turns them into a picture when one is shown. */
class FBitmapData {
	readonly width: number;
	readonly height: number;
	readonly transparent: boolean;
	/** ARGB of each pixel; none yet for a picture not read. */
	_px: Uint32Array | null;
	/** A picture to start from, and where it is shown. */
	_href: string | null = null;
	_shown = new Set<Bitmap>();
	_gone = false;
	constructor(w: number, h: number, transparent = true, fill = 0xffffffff) {
		w = Math.trunc(w);
		h = Math.trunc(h);
		if (!(w > 0 && h > 0 && w <= 8191 && h <= 8191 && w * h <= 16777215)) throw fail(ArgumentError, 2015, "Invalid BitmapData.");
		this.width = w;
		this.height = h;
		this.transparent = transparent;
		this._px = new Uint32Array(w * h).fill(transparent ? fill >>> 0 : (fill | 0xff000000) >>> 0);
	}
	static _picture(href: string, w: number, h: number, transparent: boolean, proto: object) {
		const b = Object.create(proto) as FBitmapData;
		Object.assign(b, { width: w, height: h, transparent, _px: null, _href: href, _shown: new Set(), _gone: false });
		return b;
	}
	private live(): Uint32Array {
		if (this._gone) throw fail(ArgumentError, 2015, "Invalid BitmapData.");
		if (!this._px) {
			const px = new Uint32Array(this.width * this.height);
			this._px = px;
			const img = new Image();
			img.crossOrigin = "anonymous";
			img.src = this._href!;
			// (a picture that isn't decoded yet reads as empty: browsers have no way to wait for it here)
			if (img.complete && img.naturalWidth) this.read(img);
			else img.onload = () => this.read(img);
		}
		return this._px;
	}
	private read(img: HTMLImageElement) {
		const c = document.createElement("canvas");
		c.width = this.width;
		c.height = this.height;
		const x = c.getContext("2d")!;
		x.drawImage(img, 0, 0);
		const d = x.getImageData(0, 0, this.width, this.height).data;
		const px = this._px!;
		for (let i = 0; i < px.length; i++) px[i] = ((d[i * 4 + 3]! << 24) | (d[i * 4]! << 16) | (d[i * 4 + 1]! << 8) | d[i * 4 + 2]!) >>> 0;
	}
	get rect() {
		return new FRectangle(0, 0, this.width, this.height);
	}
	private changed() {
		this._href = null;
		current.bitmaps.add(this);
		current.touched();
	}
	/** Where the picture is: a file or a data URL of the pixels. */
	_url(): string {
		if (this._href) return this._href;
		const px = this.live();
		const c = document.createElement("canvas");
		c.width = this.width;
		c.height = this.height;
		const x = c.getContext("2d")!;
		const img = x.createImageData(this.width, this.height);
		for (let i = 0; i < px.length; i++) {
			const p = px[i]!;
			img.data[i * 4] = (p >> 16) & 255;
			img.data[i * 4 + 1] = (p >> 8) & 255;
			img.data[i * 4 + 2] = p & 255;
			img.data[i * 4 + 3] = p >>> 24;
		}
		x.putImageData(img, 0, 0);
		return (this._href = c.toDataURL());
	}
	/** Shows the pixels as they are now. */
	_show() {
		const u = this._url();
		for (const b of this._shown) b._image.setAttribute("href", u);
	}
	getPixel32(x: number, y: number) {
		const px = this.live();
		return x >= 0 && y >= 0 && x < this.width && y < this.height ? px[y * this.width + x]! : 0;
	}
	getPixel(x: number, y: number) {
		return this.getPixel32(x, y) & 0xffffff;
	}
	setPixel32(x: number, y: number, c: number) {
		const px = this.live();
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
		px[y * this.width + x] = this.transparent ? c >>> 0 : (c | 0xff000000) >>> 0;
		this.changed();
	}
	setPixel(x: number, y: number, c: number) {
		const a = this.getPixel32(x, y) & 0xff000000;
		this.setPixel32(x, y, (a | (c & 0xffffff)) >>> 0);
	}
	fillRect(r: FRectangle, c: number) {
		const px = this.live();
		const v = this.transparent ? c >>> 0 : (c | 0xff000000) >>> 0;
		const x0 = Math.max(0, r.x),
			y0 = Math.max(0, r.y),
			x1 = Math.min(this.width, r.right),
			y1 = Math.min(this.height, r.bottom);
		for (let y = y0; y < y1; y++) px.fill(v, y * this.width + x0, y * this.width + x1);
		this.changed();
	}
	copyPixels(from: FBitmapData, r: FRectangle, to: FPoint) {
		const px = this.live(),
			src = from.live();
		for (let y = 0; y < r.height; y++)
			for (let x = 0; x < r.width; x++) {
				const sx = r.x + x,
					sy = r.y + y,
					dx = to.x + x,
					dy = to.y + y;
				if (sx >= 0 && sy >= 0 && sx < from.width && sy < from.height && dx >= 0 && dy >= 0 && dx < this.width && dy < this.height) px[dy * this.width + dx] = src[sy * from.width + sx]!;
			}
		this.changed();
	}
	/** Only of pixels: a browser can't read back what it draws of a display object at once. */
	draw(src: FBitmapData | Bitmap) {
		const b = src instanceof Bitmap ? src.bitmapData : src;
		if (b instanceof FBitmapData) this.copyPixels(b, b.rect, new FPoint());
	}
	scroll(dx: number, dy: number) {
		const copy = this.clone();
		this.copyPixels(copy, copy.rect, new FPoint(dx, dy));
	}
	colorTransform(r: FRectangle, c: FColorTransform) {
		const px = this.live();
		const clamp = (v: number) => Math.max(0, Math.min(255, Math.trunc(v)));
		for (let y = Math.max(0, r.y); y < Math.min(this.height, r.bottom); y++)
			for (let x = Math.max(0, r.x); x < Math.min(this.width, r.right); x++) {
				const p = px[y * this.width + x]!;
				const a = clamp((p >>> 24) * c.alphaMultiplier + c.alphaOffset),
					rr = clamp(((p >> 16) & 255) * c.redMultiplier + c.redOffset),
					g = clamp(((p >> 8) & 255) * c.greenMultiplier + c.greenOffset),
					b = clamp((p & 255) * c.blueMultiplier + c.blueOffset);
				px[y * this.width + x] = ((a << 24) | (rr << 16) | (g << 8) | b) >>> 0;
			}
		this.changed();
	}
	noise(seed: number, low = 0, high = 255) {
		const px = this.live();
		let s = seed >>> 0 || 1;
		const next = () => (s = Math.imul(s, 1103515245) + 12345) >>> 16;
		for (let i = 0; i < px.length; i++) {
			const v = () => low + (next() % (high - low + 1));
			px[i] = ((255 << 24) | (v() << 16) | (v() << 8) | v()) >>> 0;
		}
		this.changed();
	}
	getVector(r: FRectangle) {
		const out: number[] = [];
		for (let y = r.y; y < r.bottom; y++) for (let x = r.x; x < r.right; x++) out.push(this.getPixel32(x, y));
		return out;
	}
	setVector(r: FRectangle, v: number[]) {
		let i = 0;
		for (let y = r.y; y < r.bottom; y++) for (let x = r.x; x < r.right; x++) this.setPixel32(x, y, v[i++]!);
	}
	lock() {}
	unlock() {}
	clone() {
		const px = this.live();
		const b = new FBitmapData(this.width, this.height, this.transparent, 0);
		b._px!.set(px);
		return b;
	}
	["dispose"]() {
		this._gone = true;
		this._px = null;
		this._href = null;
	}
}

class Bitmap extends DisplayObject {
	override _cls = "Bitmap";
	pixelSnapping: string;
	_image: SVGElement;
	private _bd: FBitmapData | null = null;
	private _smooth = false;
	constructor(bd: FBitmapData | null = null, snapping = "auto", smoothing = false) {
		super();
		this.pixelSnapping = snapping;
		this._image = this._node.appendChild(svgEl("image"));
		this.smoothing = smoothing;
		this.bitmapData = bd;
	}
	get smoothing() {
		return this._smooth;
	}
	set smoothing(v: boolean) {
		this._smooth = v;
		this._image.style.imageRendering = v ? "" : "pixelated";
	}
	get bitmapData() {
		return this._bd;
	}
	set bitmapData(b: FBitmapData | null) {
		this._bd?._shown.delete(this);
		this._bd = b;
		if (b) {
			b._shown.add(this);
			this._image.setAttribute("href", b._url());
			this._image.setAttribute("width", String(b.width));
			this._image.setAttribute("height", String(b.height));
		} else this._image.removeAttribute("href");
		current.touched();
	}
	override _self(): Box | null {
		return this._bd ? { l: 0, t: 0, r: this._bd.width, b: this._bd.height } : null;
	}
	override _covers(x: number, y: number) {
		const b = this._boxIn(this._world(), false);
		return !!b && x >= b.l && x <= b.r && y >= b.t && y <= b.b;
	}
}

// ------------------------------------------------------------------ CreateJS (HTML5 Canvas documents)

/** A color of CreateJS: CSS, or a number. */
const css = (c: unknown) => (typeof c === "number" ? colorOf(c) : c === null || c === undefined ? "none" : String(c));

/** createjs.Graphics: its calls chain, colours are CSS. */
class CGraphics {
	private g: FGraphics | null = null;
	private ops: ((g: any) => void)[] = [];
	private id = 0;
	private op(f: (g: any) => void) {
		if (this.g) f(this.g);
		else this.ops.push(f);
		return this;
	}
	_on(host: SVGElement) {
		this.g = new FGraphics(host);
		for (const o of this.ops) o(this.g);
		this.g._end();
	}
	_paint(key: "fill" | "stroke", paint: string) {
		return this.op((g) => {
			g._end();
			g[key] = paint;
		});
	}
	private gradient(linear: boolean, colors: string[], stops: number[], a: number[]) {
		const id = `${current.player.svg.id}_g${++this.id}${current.uid++}`;
		const e = svgEl(linear ? "linearGradient" : "radialGradient", { id, gradientUnits: "userSpaceOnUse" });
		const names = linear ? ["x1", "y1", "x2", "y2"] : ["fx", "fy", "fr", "cx", "cy", "r"];
		names.forEach((n, i) => e.setAttribute(n, String(a[i])));
		colors.forEach((c, i) => e.appendChild(svgEl("stop", { offset: String(stops[i]), "stop-color": c })));
		current.player.defs.appendChild(e);
		return `url(#${id})`;
	}
	beginFill(c: unknown) {
		return this._paint("fill", css(c));
	}
	beginStroke(c: unknown) {
		return this._paint("stroke", css(c));
	}
	beginLinearGradientFill(c: string[], s: number[], x0: number, y0: number, x1: number, y1: number) {
		return this._paint("fill", this.gradient(true, c, s, [x0, y0, x1, y1]));
	}
	beginRadialGradientFill(c: string[], s: number[], x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
		return this._paint("fill", this.gradient(false, c, s, [x0, y0, r0, x1, y1, r1]));
	}
	beginLinearGradientStroke(c: string[], s: number[], x0: number, y0: number, x1: number, y1: number) {
		return this._paint("stroke", this.gradient(true, c, s, [x0, y0, x1, y1]));
	}
	setStrokeStyle(w: number) {
		return this.op((g) => {
			g._end();
			g.sw = w;
		});
	}
	endFill() {
		return this._paint("fill", "none");
	}
	endStroke() {
		return this._paint("stroke", "none");
	}
	moveTo(x: number, y: number) {
		return this.op((g) => g.moveTo(x, y));
	}
	lineTo(x: number, y: number) {
		return this.op((g) => g.lineTo(x, y));
	}
	quadraticCurveTo(a: number, b: number, x: number, y: number) {
		return this.op((g) => g.curveTo(a, b, x, y));
	}
	bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
		return this.op((g) => g.cubicCurveTo(a, b, c, d, x, y));
	}
	arcTo(a: number, b: number, x: number, y: number, r: number) {
		return this.op((g) => (g.d += `Q${a} ${b} ${x} ${y}`, void r));
	}
	drawRect(x: number, y: number, w: number, h: number) {
		return this.op((g) => g.drawRect(x, y, w, h));
	}
	drawRoundRect(x: number, y: number, w: number, h: number, r: number) {
		return this.op((g) => g.drawRoundRect(x, y, w, h, r * 2, r * 2));
	}
	drawCircle(x: number, y: number, r: number) {
		return this.op((g) => g.drawCircle(x, y, r));
	}
	drawEllipse(x: number, y: number, w: number, h: number) {
		return this.op((g) => g.drawEllipse(x, y, w, h));
	}
	drawPolyStar(x: number, y: number, r: number, sides: number, ptr = 0, angle = 0) {
		return this.op((g) => {
			const inner = r * (1 - ptr);
			const n = ptr ? sides * 2 : sides;
			let d = "";
			for (let i = 0; i < n; i++) {
				const q = ptr && i % 2 ? inner : r;
				const a = (angle * Math.PI) / 180 + (i * 2 * Math.PI) / n;
				d += `${i ? "L" : "M"}${x + Math.cos(a) * q} ${y + Math.sin(a) * q}`;
			}
			g.d += `${d}Z`;
		});
	}
}

class CShape extends Shape {
	graphicsC: CGraphics;
	constructor(g?: CGraphics) {
		super();
		this.graphicsC = g ?? new CGraphics();
		this.graphicsC._on(this._node);
	}
	override get graphics() {
		return this.graphicsC as any;
	}
}

class CText extends TextField {
	constructor(text = "", font = "12px Arial", color = "#000") {
		super();
		const m = /(\d+(?:\.\d+)?)px\s*(.*)/.exec(font);
		this._def.size = m ? +m[1]! : 12;
		this._def.font = m?.[2] || "Arial";
		this._def.bold = /bold/.test(font);
		this._def.color = parseInt(String(color).replace(/^#/, "").padEnd(6, "0"), 16) || 0;
		this.text = text;
		this._field()?.setAttribute("fill", String(color));
	}
	get color() {
		return "";
	}
	set color(v: string) {
		this._field()?.setAttribute("fill", v);
	}
}

const easePow = (p: number) => ({
	in: (t: number) => t ** p,
	out: (t: number) => 1 - (1 - t) ** p,
	inOut: (t: number) => (t < 0.5 ? (2 * t) ** p / 2 : 1 - (2 * (1 - t)) ** p / 2),
});
const bounceOut = (t: number) => {
	const a = 7.5625;
	if (t < 1 / 2.75) return a * t * t;
	if (t < 2 / 2.75) return a * (t -= 1.5 / 2.75) * t + 0.75;
	if (t < 2.5 / 2.75) return a * (t -= 2.25 / 2.75) * t + 0.9375;
	return a * (t -= 2.625 / 2.75) * t + 0.984375;
};
const CEase: Record<string, (t: number) => number> = {
	linear: (t) => t,
	bounceOut,
	bounceIn: (t) => 1 - bounceOut(1 - t),
	bounceInOut: (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
	backOut: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
	backIn: (t) => 2.70158 * t ** 3 - 1.70158 * t ** 2,
	sineIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
	sineOut: (t) => Math.sin((t * Math.PI) / 2),
	sineInOut: (t) => (1 - Math.cos(t * Math.PI)) / 2,
};
for (const [n, p] of [["quad", 2], ["cubic", 3], ["quart", 4], ["quint", 5]] as [string, number][]) {
	const e = easePow(p);
	CEase[`${n}In`] = e.in;
	CEase[`${n}Out`] = e.out;
	CEase[`${n}InOut`] = e.inOut;
}

/** createjs.Tween: to, wait, call, one after the other in real time. */
class CTween {
	static get(o: any, opts?: { loop?: boolean | number }) {
		return new CTween(o, !!opts?.loop);
	}
	private steps: ((done: () => void) => void)[] = [];
	private at = 0;
	private o: any;
	private loop: boolean;
	constructor(o: any, loop: boolean) {
		this.o = o;
		this.loop = loop;
		queueMicrotask(() => this.next());
	}
	private next() {
		if (this.at >= this.steps.length) {
			if (!this.loop || !this.steps.length) return;
			this.at = 0;
		}
		this.steps[this.at++]!(() => this.next());
	}
	to(props: Record<string, number>, ms = 0, ease: (t: number) => number = CEase.linear!) {
		this.steps.push((done) => {
			const o = this.o,
				from: Record<string, number> = {};
			for (const k in props) from[k] = o[k];
			const t0 = performance.now();
			const tick = (now: number) => {
				const u = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
				const e = ease(u);
				for (const k in props) o[k] = from[k]! + (props[k]! - from[k]!) * e;
				if (u < 1) requestAnimationFrame(tick);
				else done();
			};
			requestAnimationFrame(tick);
		});
		return this;
	}
	wait(ms: number) {
		this.steps.push((done) => void setTimeout(done, ms));
		return this;
	}
	call(f: Fn, args?: unknown[], scope?: unknown) {
		this.steps.push((done) => {
			current.safely(() => f.apply(scope ?? this.o, args ?? []));
			done();
		});
		return this;
	}
	set(props: Record<string, unknown>) {
		this.steps.push((done) => {
			Object.assign(this.o, props);
			done();
		});
		return this;
	}
}

class FTimer extends Dispatcher {
	delay: number;
	repeatCount: number;
	currentCount = 0;
	private id = 0;
	constructor(delay: number, repeat = 0) {
		super();
		this.delay = delay;
		this.repeatCount = repeat;
	}
	get ["running"]() {
		return !!this.id;
	}
	start() {
		if (this.id) return;
		const s = current;
		this.id = window.setInterval(() => {
			this.currentCount++;
			const done = this.repeatCount > 0 && this.currentCount >= this.repeatCount;
			s.safely(() => {
				this.dispatchEvent(new FTimerEvent(FTimerEvent.TIMER));
				if (done) {
					this.stop();
					this.dispatchEvent(new FTimerEvent(FTimerEvent.TIMER_COMPLETE));
				}
			});
		}, Math.max(this.delay, 1000 / 60));
	}
	stop() {
		clearInterval(this.id);
		this.id = 0;
	}
	reset() {
		this.stop();
		this.currentCount = 0;
	}
}

class FSoundTransform {
	volume: number;
	pan: number;
	constructor(volume = 1, pan = 0) {
		this.volume = volume;
		this.pan = pan;
	}
	_copy() {
		return new FSoundTransform(this.volume, this.pan);
	}
}

class FSoundChannel extends Dispatcher {
	/** The voice playing: what the player's mixer gives. */
	_v: any = null;
	_at = 0;
	_st = new FSoundTransform();
	leftPeak = 0;
	rightPeak = 0;
	get position() {
		return this._v ? Math.max(0, this._v.pos()) * 1000 : this._at;
	}
	get soundTransform() {
		return this._st._copy();
	}
	set soundTransform(t: FSoundTransform) {
		this._st = t._copy();
		const v = this._v;
		if (v) {
			v.vol = t.volume;
			v.pan = t.pan;
			if (v.fx) {
				v.fx[0].gain.value = t.volume;
				v.fx[1].pan.value = t.pan;
			}
		}
	}
	stop() {
		const v = this._v;
		if (!v) return;
		this._at = this.position;
		this._v = null;
		v.ended = null;
		v.stop();
	}
}

class FSound extends Dispatcher {
	_id = "";
	_el: HTMLAudioElement | null = null;
	url: string | null = null;
	id3 = {};
	isBuffering = false;
	bytesLoaded = 0;
	bytesTotal = 0;
	constructor(req?: URLRequest) {
		super();
		if (req) this.load(req);
	}
	load(req: URLRequest) {
		this.url = req.url;
		const a = (this._el = new Audio(req.url));
		a.preload = "auto";
		a.onloadedmetadata = () => current.safely(() => this.dispatchEvent(new FEvent(FEvent.COMPLETE)));
		a.onerror = () => current.safely(() => this.dispatchEvent(ioError(FIOErrorEvent.IO_ERROR, 2032, `Stream Error. URL: ${req.url}`)));
	}
	play(start = 0, loops = 0, transform: FSoundTransform | null = null) {
		const c = new FSoundChannel();
		const m = current.player.mixer;
		if (this._id && m) {
			const v = m.voice([0, this._id, 0, Math.max(1, loops + 1), 0], start / 1000) as any;
			c._v = v;
			const stop = v.stop;
			// the voice ends by itself: the channel says so
			v.ended = () => current.safely(() => c.dispatchEvent(new FEvent(FEvent.SOUND_COMPLETE)));
			v.stop = function () {
				stop.call(v);
				const e = v.ended;
				v.ended = null;
				e?.();
			};
		} else if (this._el) {
			const a = this._el.cloneNode() as HTMLAudioElement;
			a.currentTime = start / 1000;
			a.loop = loops > 0;
			void a.play().catch(() => {});
			a.onended = () => current.safely(() => c.dispatchEvent(new FEvent(FEvent.SOUND_COMPLETE)));
			c._v = { stop: () => a.pause(), pos: () => a.currentTime };
		}
		if (transform) c.soundTransform = transform;
		return c;
	}
	close() {
		this._el?.pause();
	}
	get length() {
		const s = this._id ? current.P.snd[this._id] : null;
		return (Array.isArray(s) ? s[1] : (this._el?.duration ?? 0)) * 1000;
	}
}

/** The soundMixer of a player: all it plays. */
const soundMixer = {
	["stopAll"]: () => current.player.mixer?.stopAll(),
	bufferTime: 0,
	areSoundsInaccessible: () => false,
	computeSpectrum: () => {},
	_t: new FSoundTransform(),
	get soundTransform() {
		return this._t._copy();
	},
	set soundTransform(t: FSoundTransform) {
		this._t = t._copy();
		const out = (current.player.mixer as any)?.out;
		if (out) out.gain.value = t.volume;
	},
};

class FIOErrorEvent extends FEvent {
	static IO_ERROR = "ioError";
	text = "";
	errorID = 0;
}

class FProgressEvent extends FEvent {
	static PROGRESS = "progress";
	static SOCKET_DATA = "socketData";
	bytesLoaded = 0;
	bytesTotal = 0;
}

class FNetStatusEvent extends FEvent {
	static NET_STATUS = "netStatus";
	info: unknown = null;
}

class FHTTPStatusEvent extends FEvent {
	static HTTP_STATUS = "httpStatus";
	status = 0;
}

function ioError(type: string, id: number, text: string) {
	const e = new FIOErrorEvent(type);
	e.errorID = id;
	e.text = `Error #${id}: ${text}`;
	return e;
}

class FLoaderInfo extends Dispatcher {
	url: string | null = null;
	width = 0;
	height = 0;
	bytesLoaded = 0;
	bytesTotal = 0;
	contentType: string | null = null;
	content: DisplayObject | null = null;
	loader: FLoader | null = null;
	parameters: Record<string, string> = {};
	actionScriptVersion = 3;
	swfVersion = 40;
	sameDomain = true;
	childAllowsParent = true;
	parentAllowsChild = true;
	get frameRate() {
		return current.rate;
	}
}

const MIME: Record<string, string> = { png: "image/png", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp" };

class FLoader extends DisplayObjectContainer {
	override _cls = "Loader";
	contentLoaderInfo = new FLoaderInfo();
	content: DisplayObject | null = null;
	load(req: URLRequest) {
		const info = this.contentLoaderInfo;
		info.url = req.url;
		info.loader = this;
		const img = new Image();
		const say = (e: FEvent) => current.safely(() => info.dispatchEvent(e));
		queueMicrotask(() => say(new FEvent(FEvent.OPEN)));
		img.onload = () => {
			const w = img.naturalWidth,
				h = img.naturalHeight;
			const b = new Bitmap(FBitmapData._picture(req.url, w, h, true, FBitmapData.prototype));
			current.safely(() => {
				this.addChild(b);
				this.content = info.content = b;
				info.width = w;
				info.height = h;
				info.contentType = MIME[(/\.(\w+)(?:[?#]|$)/.exec(req.url)?.[1] ?? "").toLowerCase()] ?? null;
				info.dispatchEvent(new FEvent(FEvent.INIT));
				info.dispatchEvent(new FEvent(FEvent.COMPLETE));
			});
		};
		img.onerror = () => say(ioError(FIOErrorEvent.IO_ERROR, 2035, `URL Not Found. URL: ${req.url}`));
		img.src = req.url;
	}
	unload() {
		const c = this.content;
		if (!c) return;
		this.removeChild(c);
		this.content = this.contentLoaderInfo.content = null;
		this.contentLoaderInfo.dispatchEvent(new FEvent(FEvent.UNLOAD));
	}
	unloadAndStop() {
		this.unload();
	}
	close() {}
}

class URLLoader extends Dispatcher {
	data: unknown = undefined;
	dataFormat = "text";
	bytesLoaded = 0;
	bytesTotal = 0;
	private ask: AbortController | null = null;
	constructor(req?: URLRequest) {
		super();
		if (req) this.load(req);
	}
	load(req: URLRequest) {
		const say = (e: FEvent) => current.safely(() => this.dispatchEvent(e));
		this.ask = new AbortController();
		const init: RequestInit = { method: req.method, signal: this.ask.signal };
		let url = req.url;
		if (req.data !== null && req.data !== undefined) {
			const body = req.data instanceof FByteArray ? Uint8Array.from(req.data) : String(req.data);
			if (req.method === "POST") {
				init.body = body;
				init.headers = { "content-type": req.contentType ?? "application/x-www-form-urlencoded", ...Object.fromEntries(req.requestHeaders.map((h) => [h.name, h.value])) };
			} else url += (url.includes("?") ? "&" : "?") + body;
		}
		queueMicrotask(() => say(new FEvent(FEvent.OPEN)));
		const failed = () => say(ioError(FIOErrorEvent.IO_ERROR, 2032, `Stream Error. URL: ${req.url}`));
		fetch(url, init).then(
			async (r) => {
				const status = new FHTTPStatusEvent(FHTTPStatusEvent.HTTP_STATUS);
				status.status = r.status;
				say(status);
				if (!r.ok) return failed();
				const bytes = new Uint8Array(await r.arrayBuffer());
				this.bytesLoaded = this.bytesTotal = bytes.length;
				const p = new FProgressEvent(FProgressEvent.PROGRESS);
				p.bytesLoaded = p.bytesTotal = bytes.length;
				say(p);
				if (this.dataFormat === "binary") {
					const b = new FByteArray();
					for (const x of bytes) b.push(x);
					this.data = b;
				} else {
					const text = new TextDecoder().decode(bytes);
					this.data = this.dataFormat === "variables" ? new URLVariables(text) : text;
				}
				say(new FEvent(FEvent.COMPLETE));
			},
			(e: Error) => {
				if (e.name !== "AbortError") failed();
			},
		);
	}
	close() {
		this.ask?.abort();
	}
}

class NetConnection extends Dispatcher {
	connected = false;
	client: unknown = this;
	connect() {
		this.connected = true;
		queueMicrotask(() => current.safely(() => this.dispatchEvent(netStatus("NetConnection.Connect.Success"))));
	}
	close() {
		this.connected = false;
	}
}

function netStatus(code: string) {
	const e = new FNetStatusEvent(FNetStatusEvent.NET_STATUS);
	e.info = { code, level: "status" };
	return e;
}

/** A stream of a video a browser can play: a <video> element. */
class NetStream extends Dispatcher {
	client: any = {};
	bufferTime = 0.1;
	_el = document.createElement("video");
	soundTransform = new FSoundTransform();
	constructor(_c?: NetConnection) {
		super();
		const v = this._el;
		v.playsInline = true;
		const say = (code: string) => current.safely(() => this.dispatchEvent(netStatus(code)));
		v.onplaying = () => say("NetStream.Play.Start");
		v.onended = () => say("NetStream.Play.Stop");
		v.onerror = () => say("NetStream.Play.StreamNotFound");
		v.onloadedmetadata = () => current.safely(() => this.client?.onMetaData?.({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }));
	}
	play(url: string) {
		this._el.src = url;
		void this._el.play().catch(() => {});
	}
	pause() {
		this._el.pause();
	}
	resume() {
		void this._el.play().catch(() => {});
	}
	togglePause() {
		if (this._el.paused) this.resume();
		else this.pause();
	}
	seek(t: number) {
		this._el.currentTime = t;
	}
	close() {
		this._el.pause();
		this._el.removeAttribute("src");
	}
	get ["time"]() {
		return this._el.currentTime;
	}
	get bytesLoaded() {
		return this._el.buffered.length ? 1 : 0;
	}
	get bytesTotal() {
		return 1;
	}
}

class Video extends DisplayObject {
	override _cls = "Video";
	smoothing = false;
	deblocking = 0;
	private box: SVGElement;
	private w: number;
	private h: number;
	private ns: NetStream | null = null;
	constructor(w = 320, h = 240) {
		super();
		this.w = w;
		this.h = h;
		this.box = this._node.appendChild(svgEl("foreignObject", { width: String(w), height: String(h) }));
	}
	attachNetStream(s: NetStream | null) {
		this.ns = s;
		if (!s) return this.box.replaceChildren();
		s._el.style.cssText = "width:100%;height:100%;display:block";
		this.box.replaceChildren(s._el);
	}
	clear() {
		this.box.replaceChildren();
	}
	get videoWidth() {
		return this.ns?._el.videoWidth ?? 0;
	}
	get videoHeight() {
		return this.ns?._el.videoHeight ?? 0;
	}
	override _self(): Box {
		return { l: 0, t: 0, r: this.w, b: this.h };
	}
}

class FTweenEvent extends FEvent {
	static MOTION_START = "motionStart";
	static MOTION_STOP = "motionStop";
	static MOTION_RESUME = "motionResume";
	static MOTION_FINISH = "motionFinish";
	static MOTION_CHANGE = "motionChange";
	static MOTION_LOOP = "motionLoop";
	["time"] = 0;
	position = 0;
}

/** fl.transitions.Tween: one property of an object over time, frame by frame. */
class FTween extends Dispatcher {
	obj: any;
	prop: string;
	func: (t: number, b: number, c: number, d: number) => number;
	begin: number;
	finish: number;
	duration: number;
	useSeconds: boolean;
	looping = false;
	isPlaying = false;
	FPS: number;
	private at = 0;
	private started = 0;
	private change = 0;
	private beat = () => this.tick();
	constructor(obj: any, prop: string, func: (t: number, b: number, c: number, d: number) => number, begin: number, finish: number, duration: number, useSeconds = false) {
		super();
		this.obj = obj;
		this.prop = prop;
		this.func = func ?? ((t, b, c, d) => (c * t) / d + b);
		this.begin = begin;
		this.finish = finish;
		this.change = finish - begin;
		this.duration = duration <= 0 ? 0.001 : duration;
		this.useSeconds = useSeconds;
		this.FPS = current.rate;
		this.start();
	}
	private now() {
		return this.useSeconds ? performance.now() / 1000 : current.ticks;
	}
	private send(type: string) {
		const e = new FTweenEvent(type);
		e["time"] = this.at;
		e.position = this.position;
		this.dispatchEvent(e);
	}
	get position() {
		return this.func(Math.min(this.at, this.duration), this.begin, this.change, this.duration);
	}
	set position(v: number) {
		this.obj[this.prop] = v;
	}
	get ["time"]() {
		return this.at;
	}
	set ["time"](t: number) {
		this.at = t;
		this.started = this.now() - t;
		this.obj[this.prop] = this.position;
	}
	private run() {
		this.isPlaying = true;
		current.stage.addEventListener(FEvent.ENTER_FRAME, this.beat);
	}
	private rest() {
		this.isPlaying = false;
		current.stage.removeEventListener(FEvent.ENTER_FRAME, this.beat);
	}
	private tick() {
		this["time"] = this.now() - this.started;
		if (this.at >= this.duration) {
			if (this.looping) {
				this["time"] = 0;
				this.send(FTweenEvent.MOTION_LOOP);
			} else {
				this.at = this.duration;
				this.obj[this.prop] = this.finish;
				this.rest();
				this.send(FTweenEvent.MOTION_FINISH);
				return;
			}
		}
		this.send(FTweenEvent.MOTION_CHANGE);
	}
	start() {
		this["time"] = 0;
		this.run();
		this.send(FTweenEvent.MOTION_START);
	}
	stop() {
		this.rest();
		this.send(FTweenEvent.MOTION_STOP);
	}
	resume() {
		this.started = this.now() - this.at;
		this.run();
		this.send(FTweenEvent.MOTION_RESUME);
	}
	rewind(t = 0) {
		this["time"] = t;
	}
	fforward() {
		this["time"] = this.duration;
	}
	nextFrame() {
		this["time"] = this.at + 1;
	}
	prevFrame() {
		this["time"] = this.at - 1;
	}
	yoyo() {
		this.continueTo(this.begin, this.at);
	}
	continueTo(finish: number, duration: number) {
		this.begin = this.position;
		this.finish = finish;
		this.change = finish - this.begin;
		this.duration = duration <= 0 ? 0.001 : duration;
		this.start();
	}
}

/** flash.net.SharedObject: in the browser's local storage. */
const sharedObject = {
	getLocal(name: string) {
		const key = `f2s-so:${location.pathname}:${name}`;
		let data: Record<string, unknown> = {};
		try {
			data = JSON.parse(localStorage.getItem(key) ?? "{}");
		} catch {}
		return {
			data,
			get size() {
				return JSON.stringify(data).length;
			},
			flush() {
				try {
					localStorage.setItem(key, JSON.stringify(data));
					return "flushed";
				} catch {
					return "pending";
				}
			},
			clear() {
				this.data = data = {};
				try {
					localStorage.removeItem(key);
				} catch {}
			},
			close() {},
		};
	},
};

// ------------------------------------------------------------------ helpers

function decompose(s: Scripts, i: Inst): Frozen {
	const it = i.it as PInst;
	if (!it.tr) {
		// a drawing or text put down once: its transform is in its node
		const m = (i.node as unknown as SVGGraphicsElement).transform?.baseVal.consolidate()?.matrix;
		return fromMat(m ? [m.a, m.b, m.c, m.d, m.e, m.f] : ONE);
	}
	const P = s.P,
		t = i.owner.frame;
	const v = (k: number, d: number) => trackValue(P, it.tr[k], t, d);
	const rad = v(2, 0) * RAD,
		cos = Math.cos(rad),
		sin = Math.sin(rad),
		sk = Math.tan(v(3, 0) * RAD),
		sx = v(4, 1),
		sy = v(5, 1);
	const a = cos * sx,
		b = sin * sx,
		c = (cos * sk - sin) * sy,
		d = (sin * sk + cos) * sy;
	const tpx = v(6, 0),
		tpy = v(7, 0);
	return fromMat([a, b, c, d, v(0, 0) - (a * tpx + c * tpy), v(1, 0) - (b * tpx + d * tpy)]);
}

let trackValue: (P: Scripts["P"], tr: PTrack | undefined, t: number, def: number) => number;

/** Its Web Animations end: a script holds its transform or alpha now. */
function free(i: Inst) {
	for (const a of i.anims ?? []) {
		a.cancel();
		i.owner.player.anims.delete(a);
	}
	i.anims = null;
	i.animTransform = i.animAlpha = false;
}

function place(i: Inst, matrix: string) {
	i.lastM = matrix;
	(i.tnode ?? i.node).setAttribute("transform", matrix);
}

/** The alpha the timeline gives it now (0..100). */
function alphaNow(i: Inst): number {
	const it = i.it as PInst;
	return it.c ? trackValue(i.owner.P, it.c[3], i.owner.frame, 100) : 100;
}

function local(node: Element, cx: number, cy: number): [number, number] {
	const m = (node as unknown as SVGGraphicsElement).getScreenCTM?.();
	if (!m) return [cx, cy];
	const i = m.inverse();
	return [i.a * cx + i.c * cy + i.e, i.b * cx + i.d * cy + i.f];
}
function stagePoint(cx: number, cy: number): [number, number] {
	return local(current.player.svg, cx, cy);
}
function clientOf(x: number, y: number): [number, number] {
	const m = current.player.svg.getScreenCTM();
	return m ? [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f] : [x, y];
}

/** A timeline's children in stacking order. */
function timelineChildren(o: DisplayObjectContainer): DisplayObject[] {
	const c = o._c;
	if (!c) return [];
	const out: DisplayObject[] = [];
	const tl: PTimeline = c.tl;
	for (const l of tl.ly)
		for (const it of l.it as PItem[]) {
			const i = c.items.get(it);
			if (i && !i.removed && !i.moved) out.push(current.objOfInst(i));
		}
	return out;
}

// ------------------------------------------------------------------ the scripts of a player

export class Scripts {
	readonly P: Player["P"];
	readonly stage: FStage;
	rootObj!: MovieClip;
	/** 1 in AS3, 0 in HTML5 Canvas (CreateJS counts frames from 0). */
	base: number;
	/** The mouse, in the page's pixels. */
	client: [number, number] = [0, 0];
	/** The objects listening to the events every timeline gets, in the order they began to. */
	heard = new Map<string, Set<Dispatcher>>();
	drag: { o: Sprite; dx: number; dy: number; b: FRectangle | null } | null = null;
	uid = 0;
	private queue: { c: Clip; f: number; fn: () => void }[] = [];
	private busy = 0;
	private dirty = false;
	private front = -1;
	/** Movie clips scripts took off the stage. */
	orphans = new Set<Clip>();
	private objs = new WeakMap<Inst, DisplayObject>();
	private clips = new WeakMap<Clip, MovieClip>();
	private nodes = new WeakMap<Node, Inst>();
	/** The objects scripts put on stage. */
	placed = new WeakMap<Node, DisplayObject>();
	private over: DisplayObject | null = null;
	private down: DisplayObject | null = null;
	readonly api: Record<string, unknown>;
	readonly helpers: Record<string, unknown>;
	/** Changes to any list of children count up: lists kept from before are out of date then. */
	ver = 0;
	/** Objects with a script's mask, and pixels changed: shown once per frame. */
	masked = new Set<DisplayObject>();
	bitmaps = new Set<FBitmapData>();
	/** Frames per second, as scripts set it; frames gone by. */
	rate: number;
	ticks = 0;
	info = new FLoaderInfo();
	/** The classes of library items (their linkage). */
	private made = new Map<string, unknown>();

	readonly player: Player;
	readonly ClipClass: new (p: Player, tl: PTimeline, kind: number) => Clip;
	readonly code: Record<string, ScriptFactory>;

	constructor(player: Player, ClipClass: new (p: Player, tl: PTimeline, kind: number) => Clip, code: Record<string, ScriptFactory>, track: typeof trackValue) {
		this.player = player;
		this.ClipClass = ClipClass;
		this.code = code;
		current = this;
		trackValue = track;
		this.P = player.P;
		this.base = this.P.zb ? 0 : 1;
		this.rate = this.P.fps;
		Object.assign(this.info, { url: location.href, width: this.P.w, height: this.P.h, parameters: Object.fromEntries(new URLSearchParams(location.search)) });
		const advance = player.step.bind(player);
		player.step = () => this.step(advance);
		this.stage = new FStage(player.svg as unknown as SVGElement);
		const self = this;
		this.api = {
			trace: (...a: unknown[]) => {
				const s = a.map(traceText).join(" ");
				console.log(s);
				player.emit({ type: "trace", frame: player.root?.frame ?? 0, label: s });
			},
			navigateToURL: (r: { url: string }, w = "_blank") => void (w === "_blank" ? open(r.url, w, "noopener") : open(r.url, w === "_self" ? "_top" : w)),
			getTimer: () => Math.round(performance.now()),
			setTimeout: (f: Fn, ms: number, ...a: unknown[]) => window.setTimeout(() => self.safely(() => f(...a)), ms),
			clearTimeout: (i: number) => clearTimeout(i),
			setInterval: (f: Fn, ms: number, ...a: unknown[]) => window.setInterval(() => self.safely(() => f(...a)), ms),
			clearInterval: (i: number) => clearInterval(i),
			fscommand: () => {},
			getDefinitionByName: (n: string) => {
				const name = n.split(/[.:]/).pop()!;
				const c = self.api[name] ?? self.classOf(name);
				if (c === undefined) throw fail(ReferenceError, 1065, `Variable ${name} is not defined.`);
				return c;
			},
			getQualifiedClassName: (v: unknown) => self.qualified(v),
			getQualifiedSuperclassName: (v: unknown) => self.qualified(v, true),
			int: { MAX_VALUE: 2147483647, MIN_VALUE: -2147483648 },
			uint: { MAX_VALUE: 4294967295, MIN_VALUE: 0 },
			ArgumentError,
			IOError,
			SecurityError,
			EOFError,
			EventDispatcher: Dispatcher,
			DisplayObject,
			DisplayObjectContainer,
			InteractiveObject: DisplayObject,
			Sprite,
			MovieClip,
			Shape,
			SimpleButton,
			Bitmap,
			BitmapData: FBitmapData,
			FrameLabel: FFrameLabel,
			Scene: FScene,
			LoaderInfo: FLoaderInfo,
			Stage: FStage,
			Graphics: FGraphics,
			StageAlign: { TOP_LEFT: "TL", TOP: "T", LEFT: "L", RIGHT: "R", BOTTOM: "B", TOP_RIGHT: "TR", BOTTOM_LEFT: "BL", BOTTOM_RIGHT: "BR" },
			StageScaleMode: { NO_SCALE: "noScale", SHOW_ALL: "showAll", EXACT_FIT: "exactFit", NO_BORDER: "noBorder" },
			StageDisplayState: { NORMAL: "normal", FULL_SCREEN: "fullScreen", FULL_SCREEN_INTERACTIVE: "fullScreenInteractive" },
			StageQuality: { LOW: "low", MEDIUM: "medium", HIGH: "high", BEST: "best" },
			BlendMode: Object.fromEntries("normal layer multiply screen lighten darken difference add subtract invert alpha erase overlay hardlight shader".split(" ").map((n) => [n.toUpperCase(), n])),
			PixelSnapping: { NEVER: "never", ALWAYS: "always", AUTO: "auto" },
			GradientType: { LINEAR: "linear", RADIAL: "radial" },
			SpreadMethod: { PAD: "pad", REFLECT: "reflect", REPEAT: "repeat" },
			InterpolationMethod: { RGB: "rgb", LINEAR_RGB: "linearRGB" },
			LineScaleMode: { NORMAL: "normal", NONE: "none", VERTICAL: "vertical", HORIZONTAL: "horizontal" },
			CapsStyle: { NONE: "none", ROUND: "round", SQUARE: "square" },
			JointStyle: { MITER: "miter", ROUND: "round", BEVEL: "bevel" },
			MouseCursor: { ARROW: "arrow", AUTO: "auto", BUTTON: "button", HAND: "hand", IBEAM: "ibeam" },
			Event: FEvent,
			MouseEvent: FMouseEvent,
			KeyboardEvent: FKeyboardEvent,
			TimerEvent: FTimerEvent,
			FocusEvent: Object.assign(class extends FEvent {}, { FOCUS_IN: "focusIn", FOCUS_OUT: "focusOut", KEY_FOCUS_CHANGE: "keyFocusChange", MOUSE_FOCUS_CHANGE: "mouseFocusChange" }),
			TextEvent: Object.assign(class extends FEvent {}, { LINK: "link", TEXT_INPUT: "textInput" }),
			ProgressEvent: FProgressEvent,
			IOErrorEvent: FIOErrorEvent,
			HTTPStatusEvent: FHTTPStatusEvent,
			NetStatusEvent: FNetStatusEvent,
			SecurityErrorEvent: Object.assign(class extends FEvent {}, { SECURITY_ERROR: "securityError" }),
			AsyncErrorEvent: Object.assign(class extends FEvent {}, { ASYNC_ERROR: "asyncError" }),
			Keyboard: KEYS,
			Mouse: {
				hide: () => self.cursor(true),
				show: () => self.cursor(false),
				supportsCursor: true,
			},
			Timer: FTimer,
			TextField,
			TextFormat: FTextFormat,
			TextFieldAutoSize: { NONE: "none", LEFT: "left", CENTER: "center", RIGHT: "right" },
			TextFieldType: { DYNAMIC: "dynamic", INPUT: "input" },
			TextFormatAlign: { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFY: "justify", START: "start", END: "end" },
			AntiAliasType: { NORMAL: "normal", ADVANCED: "advanced" },
			GridFitType: { NONE: "none", PIXEL: "pixel", SUBPIXEL: "subpixel" },
			Sound: FSound,
			SoundChannel: FSoundChannel,
			SoundTransform: FSoundTransform,
			SoundMixer: soundMixer,
			Video,
			URLRequest,
			URLVariables,
			URLLoader,
			URLRequestMethod: { GET: "GET", POST: "POST", PUT: "PUT", DELETE: "DELETE", HEAD: "HEAD", OPTIONS: "OPTIONS" },
			URLLoaderDataFormat: { TEXT: "text", BINARY: "binary", VARIABLES: "variables" },
			sendToURL: (r: URLRequest) => void fetch(r.url, { method: r.method, mode: "no-cors" }).catch(() => {}),
			NetConnection,
			NetStream,
			SharedObject: sharedObject,
			ExternalInterface: {
				available: true,
				marshallExceptions: false,
				objectID: player.svg.id,
				call: (n: string, ...a: unknown[]) => (window as any)[n]?.(...a) ?? null,
				addCallback: (n: string, f: Fn) => void ((window as any)[n] = (...a: unknown[]) => self.safely(() => f(...a))),
			},
			Security: { allowDomain() {}, allowInsecureDomain() {}, loadPolicyFile() {}, sandboxType: "remote" },
			System: { setClipboard: (s: string) => void navigator.clipboard?.writeText(s).catch(() => {}), gc() {}, totalMemory: 0, useCodePage: false },
			Tween: FTween,
			TweenEvent: FTweenEvent,
			...EASINGS,
			Point: FPoint,
			Rectangle: FRectangle,
			Matrix: FMatrix,
			ColorTransform: FColorTransform,
			Transform: FTransform,
			Vector: Array,
			Dictionary: Object,
			ByteArray: FByteArray,
			Capabilities: { playerType: "SVG", version: "WEB 32,0,0,0", os: navigator.platform, language: navigator.language, screenResolutionX: screen.width, screenResolutionY: screen.height },
			BlurFilter,
			GlowFilter,
			DropShadowFilter,
			BevelFilter,
			ColorMatrixFilter,
			BitmapFilterQuality: { LOW: 1, MEDIUM: 2, HIGH: 3 },
			BitmapFilterType: { INNER: "inner", OUTER: "outer", FULL: "full" },
			Loader: FLoader,
			ProLoader: FLoader,
			// HTML5 Canvas documents
			createjs: {
				Shape: CShape,
				Graphics: CGraphics,
				Text: CText,
				Tween: CTween,
				Ease: { ...CEase, get: () => CEase.linear },
				Ticker: Object.assign(new Dispatcher(), { framerate: player.P.fps, getTicks: () => Math.round(performance.now() * player.P.fps / 1000) }),
				MovieClip,
				Container: Sprite,
				Touch: { enable: () => {} },
				Event: FEvent,
			},
			canvas: player.svg,
			lib: new Proxy({}, { get: (_t, k) => self.classOf(String(k)) }),
		};
		this.helpers = {
			str: (x: unknown) => (x === null || x === undefined ? null : String(x)),
			text: (x: unknown) => String(x),
			vals: (o: unknown) => (o === null || o === undefined ? [] : Array.isArray(o) ? o.slice() : Object.values(o as object)),
			is: (x: unknown, c: unknown) => isType(x, c),
			as: (x: unknown, c: unknown) => (isType(x, c) ? x : null),
			cls: (n: string, t: Record<string, unknown>) => self.classOf(n) ?? t[n],
			err: asFlashError,
			key: dictKey,
			keys: dictKeys,
			sort: sortArray,
			sortOn: (a: Record<string, unknown>[], f: string, o = 0) =>
				sortArray(a, (x: Record<string, unknown>, y: Record<string, unknown>) => {
					const p = x[f],
						q = y[f];
					const c = o & 16 ? (p as number) - (q as number) : String(p) < String(q) ? -1 : String(p) > String(q) ? 1 : 0;
					return o & 2 ? -c : c;
				}),
		};
		for (const n in this.P.cl) {
			const tl = this.P.tl[this.P.cl[n]!];
			if (tl) this.classNames.set(tl, n);
		}
		this.listen();
	}

	/** Hides the mouse pointer, whatever an object below it asks for. */
	private hides: HTMLStyleElement | null = null;
	cursor(hide: boolean) {
		if (hide) (this.hides ??= document.head.appendChild(document.createElement("style"))).textContent = `#${this.player.svg.id},#${this.player.svg.id} *{cursor:none!important}`;
		else this.hides?.remove(), (this.hides = null);
	}

	/** The name Flash has for a value's class (or the one it extends). */
	qualified(v: any, sup = false): string | null {
		if (v === null || v === undefined) return v === null ? "null" : "void";
		const of = (name: string) => {
			for (const p in PACKAGES) if (PACKAGES[p]!.split(" ").includes(name)) return `${p}::${name}`;
			return name === "MainTimeline" ? `${this.P.dn ?? "main"}_fla::MainTimeline` : name;
		};
		const nameOf = (c: unknown) => {
			if (c === Object) return "Object";
			for (const k in this.api) if (this.api[k] === c) return k;
			return null;
		};
		let c: any = typeof v === "function" ? v : v.constructor;
		if (sup) {
			c = Object.getPrototypeOf(c);
			return c === Dispatcher ? "flash.events::EventDispatcher" : of(nameOf(c) ?? "Object");
		}
		if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? "int" : "Number";
		if (typeof v === "string") return "String";
		if (typeof v === "boolean") return "Boolean";
		if (Array.isArray(v) && !(v instanceof FByteArray)) return "Array";
		if (v._cls) return of(v._cls);
		const name = nameOf(c);
		if (name) return of(name);
		for (const [n, k] of this.made) if (k === c) return n;
		return "Object";
	}

	/** The mouse in the space an object is moved in. */
	parentMouse(o: DisplayObject): [number, number] {
		const [x, y] = stagePoint(this.client[0], this.client[1]);
		const p = o.parent;
		if (!p || p === this.stage) return [x, y];
		const i = inverse(p._world());
		return [i[0] * x + i[2] * y + i[4], i[1] * x + i[3] * y + i[5]];
	}

	/** The class of a library symbol or sound (its linkage). */
	classOf(name: string): unknown {
		let c = this.made.get(name);
		if (c) return c;
		const self = this;
		const pic = this.P.bd?.[name];
		const key = this.P.cl?.[name] as string;
		if (pic) {
			const K: any = class extends FBitmapData {
				constructor() {
					super(1, 1);
					return FBitmapData._picture(pic![0], pic![1], pic![2], !!pic![3], K.prototype);
				}
			};
			c = K;
		} else if (key === undefined) return undefined;
		else if (this.P.snd[key] !== undefined) {
			const s = this.P.snd[key];
			c = class extends FSound {
				constructor() {
					super();
					this._id = key;
					this.bytesLoaded = this.bytesTotal = (Array.isArray(s) ? s[0] : s).length;
				}
			};
		} else {
			c = function () {
				return self.newClip(self.P.tl[key]!);
			};
			Object.defineProperty(c, Symbol.hasInstance, { value: (x: any) => x?._cls === name });
		}
		this.made.set(name, c);
		return c;
	}

	private newClip(tl: PTimeline): MovieClip {
		const c = new this.ClipClass(this.player, tl, 0);
		c.up = this.player.root;
		c.fresh = true;
		c.sync();
		const o = this.objOfClip(c);
		c.runActions();
		c.updateAdvance();
		return o;
	}

	objOfClip(c: Clip): MovieClip {
		let o = this.clips.get(c);
		if (o) return o;
		const m = c.inst && (c.inst.it as PInst).t === 2 ? new SimpleButton(c.node) : new MovieClip(c.node);
		m._c = c;
		m._cls = this.classNames.get(c.tl) ?? (c.kind === -1 ? "MainTimeline" : "MovieClip");
		if (c.kind === -1) m._name = "root1";
		o = new Proxy(m, {
			get(t, k) {
				if (k in t || typeof k === "symbol") return Reflect.get(t, k, t);
				const kid = t._list().find((x) => x.name === k);
				if (kid) return kid;
				// (an instance of this timeline that isn't there now: its variable is null)
				return c.tl.ly.some((l) => l.it.some((i) => (i as PInst).nm === k)) ? null : undefined;
			},
			set(t, k, v) {
				(t as any)[k] = v;
				return true;
			},
		}) as MovieClip;
		// (the proxy is what scripts see, of a parent or a child too)
		c.obj = o;
		this.clips.set(c, o);
		const i = c.inst;
		if (i) {
			m._i = i;
			// (the instance may still be being made: its node comes when asked for)
			Object.defineProperty(m, "_node", { get: () => i.node ?? c.node });
			m._parent = this.objOfClip(i.owner);
			this.objs.set(i, o);
		}
		return o;
	}

	objOfInst(i: Inst): DisplayObject {
		let o = this.objs.get(i);
		if (o) return o;
		const it = i.it as PInst;
		if (i.clip) return this.objOfClip(i.clip);
		if ((i.it as PItem).k === "r" && i.node.querySelector("text")) o = new TextField(i.node, (i.it as PRef).tx);
		else o = new Shape(i.node);
		o._i = i;
		o._parent = this.objOfClip(i.owner);
		this.objs.set(i, o);
		return o;
	}

	/** A new instance on stage: mouse events find it from its node. */
	track(i: Inst) {
		this.nodes.set(i.node, i);
		this.ver++;
	}

	/** Frame functions of a timeline: its object, with the scripts bound to it. */
	bind(c: Clip): Record<number, () => void> {
		const key = this.keyOf(c.tl);
		const f = key === undefined ? undefined : this.code[key];
		if (!f) return {};
		return f(this.objOfClip(c), this.api, this.helpers);
	}

	/** Timelines with a class of their own (linkage). */
	private classNames = new Map<PTimeline, string>();
	private keys: Map<PTimeline, string> | null = null;
	private keyOf(tl: PTimeline) {
		if (!this.keys) {
			this.keys = new Map();
			for (const k in this.P.tl) this.keys.set(this.P.tl[k]!, k);
		}
		return this.keys.get(tl);
	}

	/** A frame's script: after the code running and the frame's construction are through. */
	frame(c: Clip) {
		const fs = (c.fs ??= this.bind(c));
		const fn = fs[c.frame];
		if (!fn) return;
		// (a goto's frame comes before what was waiting)
		if (this.front < 0) this.queue.push({ c, f: c.frame, fn });
		else this.queue.splice(this.front++, 0, { c, f: c.frame, fn });
	}

	/** Outside of scripts and frames: what is waiting runs now. */
	settle() {
		if (!this.busy && this.queue.length) this.safely(() => this.construct());
	}

	/**
	 * A goto. Inside the timeline's own frame script it waits until that script is through (the last
	 * one counts, over stop() and play() too). Anywhere else it happens now, and the frame gets built:
	 * FRAME_CONSTRUCTED, the scripts waiting, EXIT_FRAME. A script of a frame left meanwhile is dropped.
	 */
	go(c: Clip, f: number, play: boolean) {
		if (c.inScript) {
			c.pending = [f, play];
			return;
		}
		this.jump(c, f, play);
	}

	private jump(c: Clip, f: number, play: boolean) {
		this.busy++;
		if (f === c.frame) {
			c.playing = play;
			c.updateAdvance();
		} else {
			const was = this.front;
			this.front = 0;
			c.gotoFrame(f, play);
			this.front = was;
		}
		this.construct();
		this.busy--;
	}

	private construct() {
		this.broadcast(FEvent.FRAME_CONSTRUCTED);
		this.flush();
		this.broadcast(FEvent.EXIT_FRAME);
	}

	private broadcast(type: string) {
		const set = this.heard.get(type);
		if (!set) return;
		const e = new FEvent(type);
		for (const o of [...set]) {
			e.target = o;
			e._stop = 0;
			o._fire(e);
		}
	}

	/** Runs script code; afterwards the stage shows the changes. */
	safely(fn: () => void) {
		this.busy++;
		run(fn);
		this.busy--;
		if (!this.busy && this.dirty) {
			this.dirty = false;
			this.player.wake();
			const p = this.player;
			if (!p.inTick) p.root.render(p.time * p.P.fps);
		}
	}

	private flush() {
		for (let n = 0; this.queue.length && n < 4096; n++) {
			const { c, f, fn } = this.queue.shift()!;
			if (c.frame !== f) continue;
			c.inScript = true;
			run(fn);
			c.inScript = false;
			const p = c.pending;
			if (p) {
				c.pending = null;
				this.jump(c, p[0], p[1]);
			}
		}
	}

	touched() {
		this.dirty = true;
		if (!this.busy) this.safely(() => {});
	}

	/** A frame of the player: timelines moved on, then ENTER_FRAME, then the frame gets built. */
	step(advance: () => void) {
		this.busy++;
		this.ticks++;
		advance();
		for (const c of this.orphans) c.tick();
		this.broadcast(FEvent.ENTER_FRAME);
		this.construct();
		this.busy--;
		this.dirty = false;
	}

	/** Children scripts added move and draw with their parent. */
	dynTick(c: Clip) {
		const o = c.obj as DisplayObjectContainer | undefined;
		if (o) for (const d of o._dyn) d._c?.tick();
	}
	dynRender(c: Clip, frac: number) {
		const o = c.obj as DisplayObjectContainer | undefined;
		if (o) for (const d of o._dyn) if (!d._i) d._c?.render(frac);
		for (const d of (o?._dyn ?? []) as any[]) d._g?._end?.();
		if (c.kind === -1) this.present();
	}

	/** What a frame shows of pixels and masks that scripts changed. */
	private present() {
		for (const b of this.bitmaps) if (!b._gone) b._show();
		this.bitmaps.clear();
		for (const o of this.masked) o._maskNow(`${this.player.svg.id}_m${this.uid}`);
	}

	/** What is under the page's point `x, y`. */
	objectAt(x: number, y: number, except?: DisplayObject): DisplayObject | null {
		const hide = except?._node;
		const was = hide?.style.pointerEvents;
		if (hide) hide.style.pointerEvents = "none";
		const e = document.elementFromPoint(x, y);
		if (hide) hide.style.pointerEvents = was ?? "";
		return e ? this.targetOf(e) : null;
	}

	/** The object that takes the mouse at a DOM node. */
	private targetOf(n: Node | null): DisplayObject {
		let target: DisplayObject | null = null;
		for (let x: Node | null = n; x && x !== this.player.svg; x = x.parentNode) {
			const i = this.nodes.get(x);
			const o = (i ? this.objOfInst(i) : this.placed.get(x)) as any;
			if (!o) continue;
			// (a drawing doesn't take the mouse: the clip it is in does)
			if (o instanceof Shape) continue;
			if (o.mouseEnabled !== false && !target) target = o;
			// a parent that keeps the mouse from its children takes it
			if (o.mouseChildren === false) target = o;
		}
		return target ?? (this.rootObj as DisplayObject) ?? this.stage;
	}

	private mouse(type: string, target: DisplayObject, e: MouseEvent, bubbles = true, related: DisplayObject | null = null) {
		const ev = new FMouseEvent(type, bubbles);
		const [sx, sy] = stagePoint(e.clientX, e.clientY);
		const [lx, ly] = target._mouse();
		Object.assign(ev, { target, stageX: sx, stageY: sy, localX: lx, localY: ly, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, buttonDown: e.buttons > 0, relatedObject: related });
		if (e instanceof WheelEvent) ev.delta = -Math.sign(e.deltaY) * 3;
		if (!bubbles) return target._fire(ev);
		target.dispatchEvent(ev);
	}

	private chain(o: DisplayObject | null): DisplayObject[] {
		const out: DisplayObject[] = [];
		for (let x: any = o; x; x = x._parent) out.push(x);
		return out;
	}

	private listen() {
		const svg = this.player.svg;
		const pick = (e: Event) => this.targetOf(e.target as Node);
		const on = (t: string, fn: (e: any) => void) => svg.addEventListener(t, (e) => this.safely(() => fn(e)), true);
		on("pointerdown", (e: PointerEvent) => {
			this.client = [e.clientX, e.clientY];
			const t = pick(e);
			this.down = t;
			this.mouse(FMouseEvent.MOUSE_DOWN, t, e);
		});
		on("pointerup", (e: PointerEvent) => {
			const t = pick(e);
			this.mouse(FMouseEvent.MOUSE_UP, t, e);
			const d = this.down;
			this.down = null;
			if (d) {
				// the click goes to what was pressed and released, or what holds both
				const c = this.chain(d).find((o) => this.chain(t).includes(o));
				if (c) this.mouse(FMouseEvent.CLICK, c, e);
			}
		});
		on("dblclick", (e: MouseEvent) => this.mouse(FMouseEvent.DOUBLE_CLICK, pick(e), e));
		on("wheel", (e: WheelEvent) => this.mouse(FMouseEvent.MOUSE_WHEEL, pick(e), e));
		on("keydown", (e: KeyboardEvent) => {
			// Enter or Space on a focused instance: a click
			if (e.key !== "Enter" && e.key !== " ") return;
			const t = this.targetOf(e.target as Node);
			if (t !== (this.rootObj as DisplayObject)) this.mouse(FMouseEvent.CLICK, t, e as unknown as MouseEvent);
		});
		const move = (e: PointerEvent) =>
			this.safely(() => {
				this.client = [e.clientX, e.clientY];
				const d = this.drag;
				if (d) {
					const [px, py] = this.parentMouse(d.o);
					let x = px + d.dx,
						y = py + d.dy;
					if (d.b) {
						x = Math.max(d.b.left, Math.min(d.b.right, x));
						y = Math.max(d.b.top, Math.min(d.b.bottom, y));
					}
					d.o.x = x;
					d.o.y = y;
				}
				const inside = svg.contains(e.target as Node);
				const t = inside ? pick(e) : null;
				if (t) this.mouse(FMouseEvent.MOUSE_MOVE, t, e);
				const old = this.over;
				if (t === old) return;
				this.over = t;
				const was = this.chain(old),
					now = this.chain(t);
				if (old) {
					this.mouse(FMouseEvent.MOUSE_OUT, old, e, true, t);
					for (const o of was) if (!now.includes(o)) this.mouse(FMouseEvent.ROLL_OUT, o, e, false, t);
				}
				if (t) {
					this.mouse(FMouseEvent.MOUSE_OVER, t, e, true, old);
					for (const o of now.slice().reverse()) if (!was.includes(o)) this.mouse(FMouseEvent.ROLL_OVER, o, e, false, old);
				}
			});
		// (the whole window: a drag goes on outside the stage)
		window.addEventListener("pointermove", move);
		const key = (type: string) => (e: KeyboardEvent) =>
			this.safely(() => {
				const ev = new FKeyboardEvent(type, true);
				ev.target = this.stage;
				ev.keyCode = e.keyCode || 0;
				ev.charCode = e.key.length === 1 ? e.key.charCodeAt(0) : 0;
				ev.ctrlKey = e.ctrlKey;
				ev.shiftKey = e.shiftKey;
				ev.altKey = e.altKey;
				this.stage._fire(ev);
			});
		window.addEventListener("resize", () => this.safely(() => this.stage.dispatchEvent(new FEvent(FEvent.RESIZE))));
		window.addEventListener("keydown", key(FKeyboardEvent.KEY_DOWN));
		window.addEventListener("keyup", key(FKeyboardEvent.KEY_UP));
	}

	hear(type: string, o: Dispatcher) {
		if (type !== FEvent.ENTER_FRAME && type !== FEvent.FRAME_CONSTRUCTED && type !== FEvent.EXIT_FRAME) return;
		let s = this.heard.get(type);
		if (!s) this.heard.set(type, (s = new Set()));
		s.add(o);
	}

	/** The root timeline is there: its object hangs from the stage. */
	started(root: Clip) {
		const o = this.objOfClip(root);
		this.rootObj = o;
		o._parent = this.stage;
	}
}

function isType(x: unknown, c: unknown): boolean {
	switch (c) {
		case "int":
			return typeof x === "number" && (x | 0) === x;
		case "uint":
			return typeof x === "number" && x >>> 0 === x;
		case "Number":
		case Number:
			return typeof x === "number";
		case "String":
		case String:
			return typeof x === "string";
		case "Boolean":
		case Boolean:
			return typeof x === "boolean";
		case Object:
			return x !== null && x !== undefined;
	}
	return typeof c === "function" && x instanceof c;
}

function sortArray(a: unknown[], ...o: unknown[]): unknown[] {
	const f = o.find((x) => typeof x === "function") as Fn | undefined;
	const flags = (o.find((x) => typeof x === "number") as number) ?? 0;
	if (f) a.sort(f);
	else if (flags & 16) a.sort((x, y) => (x as number) - (y as number));
	else if (flags & 1) a.sort((x, y) => String(x).toLowerCase().localeCompare(String(y).toLowerCase()));
	else a.sort();
	if (flags & 2 && !f) a.reverse();
	return a;
}

/** What trace() prints of a value. */
function traceText(v: unknown): string {
	if (v === null) return "null";
	if (v === undefined) return "undefined";
	if (v instanceof Date) return v.toString().replace(/^(\w+ \w+ \d+) (\d+) ([\d:]+) (GMT[+-]\d+).*/, "$1 $3 $4 $2");
	if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return "[object Object]";
	return String(v);
}

/** What Date has in AS3 and not in JavaScript: its parts as properties. */
for (const n of ["FullYear", "Month", "Date", "Hours", "Minutes", "Seconds", "Milliseconds"])
	for (const u of ["", "UTC"]) {
		const k = (u ? n.toLowerCase() + u : n.charAt(0).toLowerCase() + n.slice(1)).replace("fullyearUTC", "fullYearUTC");
		Object.defineProperty(Date.prototype, k, {
			get(this: any) {
				return this[`get${u}${n}`]();
			},
			set(this: any, v: number) {
				this[`set${u}${n}`](v);
			},
			configurable: true,
		});
	}
Object.defineProperties(Date.prototype, {
	day: { get(this: Date) { return this.getDay(); }, configurable: true },
	dayUTC: { get(this: Date) { return this.getUTCDay(); }, configurable: true },
	time: { get(this: Date) { return this.getTime(); }, set(this: Date, v: number) { this.setTime(v); }, configurable: true },
	timezoneOffset: { get(this: Date) { return this.getTimezoneOffset(); }, configurable: true },
});
(Error.prototype as any).errorID = 0;
(Error.prototype as any).getStackTrace = function (this: Error) {
	return this.stack ?? null;
};

/** Objects as keys of a Dictionary: JavaScript would make them strings. */
const keyOf = new WeakMap<object, string>();
const keyed = new Map<string, unknown>();
let keys = 0;
function dictKey(k: unknown): unknown {
	if (typeof k !== "object" && typeof k !== "function") return k;
	if (k === null) return k;
	let s = keyOf.get(k as object);
	if (!s) {
		keyOf.set(k as object, (s = `\u0001${++keys}`));
		keyed.set(s, k);
	}
	return s;
}
const dictKeys = (d: object) => Object.keys(d).map((k) => (keyed.has(k) ? keyed.get(k) : k));

const KEYS: Record<string, number> = { BACKSPACE: 8, TAB: 9, ENTER: 13, SHIFT: 16, CONTROL: 17, ALTERNATE: 18, ESCAPE: 27, SPACE: 32, PAGE_UP: 33, PAGE_DOWN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, INSERT: 45, DELETE: 46 };
for (let i = 48; i <= 57; i++) KEYS[`NUMBER_${i - 48}`] = i;
for (let i = 65; i <= 90; i++) KEYS[String.fromCharCode(i)] = i;
for (let i = 1; i <= 12; i++) KEYS[`F${i}`] = 111 + i;

