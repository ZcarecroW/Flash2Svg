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
import {
	ArgumentError,
	asFlashError,
	EOFError,
	fail,
	FColorTransform,
	FMatrix,
	FPoint,
	FRectangle,
	FTextFormat,
	FVector,
	inverse,
	makeVector,
	IOError,
	mul,
	PACKAGES,
	SecurityError,
	toTwips,
	twips,
	URLRequest,
	URLVariables,
	vectorGet,
	vectorSet,
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
	c?: unknown;
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
	_no = false;
	preventDefault() {
		if (this.cancelable) this._no = true;
	}
	isDefaultPrevented() {
		return this._no;
	}
	clone() {
		return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
	}
	formatToString(cls: string, ...props: string[]) {
		return `[${cls}${props.map((p) => ` ${p}=${typeof (this as any)[p] === "string" ? `"${(this as any)[p]}"` : (this as any)[p]}`).join("")}]`;
	}
	toString() {
		return this.formatToString("Event", "type", "bubbles", "cancelable", "eventPhase");
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

class Dispatcher {
	_on: Map<string, { fn: Fn; capture: boolean; prio: number }[]> | null = null;
	addEventListener(type: string, fn: Fn, capture = false, prio = 0) {
		const m = (this._on ??= new Map<string, { fn: Fn; capture: boolean; prio: number }[]>());
		let l = m.get(type);
		if (!l) m.set(type, (l = []));
		if (l.some((e) => e.fn === fn && e.capture === capture)) return fn;
		l.push({ fn, capture, prio });
		l.sort((a, b) => b.prio - a.prio);
		this._listening(type);
		return fn;
	}
	removeEventListener(type: string, fn: Fn, capture = false) {
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
			if (x.capture !== capture) continue;
			// (a function literal isn't called on anything: `this` in it isn't the dispatcher)
			const f = x.fn;
			run(() => f(e));
		}
	}
	toString() {
		return `[object ${(current.qualified(this) ?? "Object").replace(/.*::/, "")}]`;
	}
	dispatchEvent(e: FEvent) {
		// (nobody listening: Flash Player doesn't even give the event its target)
		if (!this._on?.get(e.type)?.length) return true;
		e.target = this;
		this._fire(e);
		return !e.isDefaultPrevented();
	}
}

let current: Scripts;
/** (Object.hasOwn is newer than the browsers the runtime is for) */
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** What a class's JS constructor is given by its subclass's: make the object, run no AS3 constructor. */
const NEW = {};
/** A class's name without its package: a class of the document's own, or the player's. */
const bareName = (o: any) => (o.constructor.$n ? o.constructor.$n.slice(o.constructor.$n.lastIndexOf(":") + 1) : o._cls);
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
/** CreateJS keeps a transform in other terms (set when a document needs it). */
let canvasMatrix: ((f: Frozen) => Mat) | null = null;
const matOf = (f: Frozen): Mat => {
	if (f.c) return canvasMatrix!(f);
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
/** (An SVG file is an XML document: plain createElement doesn't make HTML elements there.) */
const htmlEl = (name: string) => document.createElementNS("http://www.w3.org/1999/xhtml", name) as HTMLElement;
const canvas2d = () => (pen ??= (htmlEl("canvas") as HTMLCanvasElement).getContext("2d")!);

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
	_fl: { clone(): any }[] = [];
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
	set filters(v: { clone(): any }[]) {
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
		// (the filters come with their part, in documents whose scripts use them)
		const reach = this._fl.length ? current.filterPrims!(this._fl, this._world(), prims) : 0;
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
		if (type === FMouseEvent.CLICK && this !== (current.stage as unknown) && !this._node.querySelector("foreignObject")) {
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
		return !e.isDefaultPrevented();
	}
	/** Its class's name in AS3. */
	_cls = "DisplayObject";
	override toString() {
		return `[object ${bareName(this)}]`;
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
		if (!on && o._onStage()) current.toStage(o, FEvent.ADDED_TO_STAGE);
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
		if (o._onStage()) current.toStage(o, FEvent.REMOVED_FROM_STAGE);
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

/** A label in several scenes carries its scene's name on the joined timeline. */
function bareLabel(k: string) {
	const i = k.indexOf("/");
	return i > 0 && current.P.sc?.some((s) => s[0] === k.slice(0, i)) ? k.slice(i + 1) : k;
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
	constructor(node?: SVGElement) {
		super(node);
		// (a class of the library, or of the document's own: the timeline of its symbol)
		if (!node && new.target !== MovieClip) current.adopt(this, new.target);
	}
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
		for (const k in lb) {
			const f = lb[k]!;
			if (f < from || f >= from + n) continue;
			const name = bareLabel(k);
			// (a label an earlier scene has too is left out of the lists: Flash Player's table holds one)
			if (name !== k && Object.keys(lb).some((o) => o !== k && bareLabel(o) === name && lb[o]! < from)) continue;
			out.push(new FFrameLabel(name, f - from + 1));
		}
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
		for (const k in lb) if (lb[k] === c.frame) return bareLabel(k);
		return null;
	}
	get currentLabel() {
		const c = this._c;
		if (!c) return null;
		let best: string | null = null,
			at = -1;
		const lb = c.tl.lb ?? {};
		for (const k in lb) if (lb[k]! <= c.frame && lb[k]! > at) (best = k), (at = lb[k]!);
		return best && bareLabel(best);
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
	_focus: any = null;
	stageFocusRect = true;
	color = 0;
	allowsFullScreen = false;
	mouseEnabled = true;
	mouseLock = false;
	get focus() {
		return this._focus;
	}
	set focus(v: any) {
		if (v === this._focus) return;
		const was = this._focus;
		this._focus = v;
		// (the page may have no keyboard yet: scripts hear of it at once all the same)
		if (was) was.dispatchEvent(new FFocusEvent(FFocusEvent.FOCUS_OUT, true, false, v));
		if (v) v.dispatchEvent(new FFocusEvent(FFocusEvent.FOCUS_IN, true, false, was));
		was?._in?.blur();
		v?._in?.focus();
	}
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
class FTextEvent extends FEvent {
	static LINK = "link";
	static TEXT_INPUT = "textInput";
	text: string;
	constructor(type: string, bubbles = false, cancelable = false, text = "") {
		super(type, bubbles, cancelable);
		this.text = text;
	}
}

class FFocusEvent extends FEvent {
	static FOCUS_IN = "focusIn";
	static FOCUS_OUT = "focusOut";
	static KEY_FOCUS_CHANGE = "keyFocusChange";
	static MOUSE_FOCUS_CHANGE = "mouseFocusChange";
	relatedObject: unknown;
	shiftKey = false;
	keyCode = 0;
	constructor(type: string, bubbles = true, cancelable = false, relatedObject: unknown = null) {
		super(type, bubbles, cancelable);
		this.relatedObject = relatedObject;
	}
}

/** The keys that have a character of their own. */
const CHAR_KEYS: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 127 };

class TextField extends DisplayObject {
	override _cls = "TextField";
	selectable = true;
	embedFonts = false;
	restrict: string | null = null;
	_multi = false;
	_wrap = false;
	_type = "dynamic";
	_most = 0;
	_pass = false;
	/** Input text: the control the user types in, and the face it came with (embedded fonts have a family of their own). */
	_in: HTMLInputElement | HTMLTextAreaElement | null = null;
	_face: [string, string] | null = null;
	_selected: [number, number] = [0, 0];
	/** Input text: in parts/input.ts. */
	declare _look: (box: HTMLInputElement | HTMLTextAreaElement, f: FTextFormat) => void;
	declare _take: (box: HTMLInputElement | HTMLTextAreaElement) => void;
	declare _box: () => void;
	declare _typed: () => void;
	declare _showIn: (b: HTMLInputElement | HTMLTextAreaElement) => void;
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
	/** The gutter around the text (CreateJS has none). */
	_gutter: number;
	constructor(node?: SVGElement, extras?: PTextExtras, gutter = 2) {
		super(node);
		this._gutter = gutter;
		this._def = new FTextFormat("Times New Roman", 12, 0, false, false, false, "", "", "left", 0, 0, 0, 0);
		this._def.letterSpacing = 0;
		this._def.blockIndent = 0;
		this._def.kerning = false;
		this._def.bullet = false;
		this._def.tabStops = [];
		const box = node?.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement | null;
		const t = box ? (box.parentNode!.parentNode as SVGGElement) : node && this._field();
		if (t) {
			// the look of the field in Animate
			const f = this._def;
			if (box) {
				this._look(box, f);
			} else {
				const s = t.querySelector("[font-size]");
				f.size = +(s?.getAttribute("font-size") ?? 12);
				f.font = (s?.getAttribute("font-family") ?? "Arial").split(",")[0]!.replace(/['"]/g, "");
				f.color = parseInt((s?.getAttribute("fill") ?? "#000000").slice(1), 16);
				f.bold = s?.getAttribute("font-weight") === "bold";
				f.italic = s?.getAttribute("font-style") === "italic";
				this._text = [...t.children].map((l) => l.textContent).join("\r");
			}
			// (a field of several lines says its text, and Flash ends it with a line of its own)
			if (extras?.[8] !== undefined) this._text = extras[8].replace(/\r\n|\n/g, "\r") + (gutter ? "\r" : "");
			f.align = extras?.[2] ?? "left";
			this._chars = Array.from(this._text, () => f);
			this._selected = [this._text.length, this._text.length];
			// the field's box is its space: the text's own matrix points inside the gutter
			const list = (t as SVGGElement).transform.baseVal;
			const m = list.numberOfItems ? list.consolidate()!.matrix : null;
			const v: Mat = m ? [m.a, m.b, m.c, m.d, m.e, m.f] : ONE;
			const g = this._gutter;
			node!.setAttribute("transform", matrixText(mul(v, [1, 0, 0, 1, -g, -g])));
			t.setAttribute("transform", `translate(${g} ${g})`);
			if (extras) {
				this._w = extras[0] / (Math.abs(v[0]) || 1);
				this._h = extras[1] / (Math.abs(v[3]) || 1);
				this._type = extras[3] ?? "dynamic";
				this.selectable = !!(extras[4] & 1);
				if (extras[4] & 2) {
					// "Show border around text": the look it came with
					this._bgOn = this._brOn = true;
					const r = (this._back = node!.querySelector("rect"));
					r?.removeAttribute("transform");
				}
				this._multi = !!extras[5];
				this._wrap = !!extras[5] && extras[7] !== 0;
				(this as any)["$_lh"] = extras[6];
			}
			if (box) this._take(box);
			this._lay();
		} else this._draw();
	}
	get type() {
		return this._type;
	}
	set type(v: string) {
		v = String(v);
		if (v !== "input" && v !== "dynamic") throw fail(ArgumentError, 2008, "Parameter type must be one of the accepted values.");
		if (v === this._type) return;
		this._type = v;
		if (v === "input") this._box?.();
		else {
			this._in?.parentNode?.parentNode?.removeChild(this._in.parentNode);
			this._in = null;
		}
		this._draw();
	}
	get multiline() {
		return this._multi;
	}
	set multiline(v: boolean) {
		this._multi = !!v;
		this._box?.();
	}
	get wordWrap() {
		return this._wrap;
	}
	set wordWrap(v: boolean) {
		this._wrap = !!v;
		this._box?.();
		this._draw();
	}
	get maxChars() {
		return this._most;
	}
	set maxChars(v: number) {
		this._most = v;
	}
	get displayAsPassword() {
		return this._pass;
	}
	set displayAsPassword(v: boolean) {
		this._pass = !!v;
		this._box?.();
		this._draw();
	}
	get selectionBeginIndex() {
		return this._in?.selectionStart ?? this._selected[0];
	}
	get selectionEndIndex() {
		return this._in?.selectionEnd ?? this._selected[1];
	}
	get caretIndex() {
		return this._in?.selectionEnd ?? this._selected[1];
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
		const room = this._w - 2 * this._gutter;
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
		const w = this.textWidth + 2 * this._gutter,
			h = this.textHeight + 2 * this._gutter;
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
		if (this._in) {
			this._showIn(this._in);
			this._backing();
			current.touched();
			return;
		}
		let t = this._field();
		if (!t) n.appendChild((t = svgEl("text", { "xml:space": "preserve" }) as SVGTextElement));
		t.removeAttribute("text-anchor");
		t.removeAttribute("transform");
		const parts: SVGElement[] = [];
		const box = this._w;
		const g = this._gutter;
		let y = g;
		const hide = this.displayAsPassword;
		for (let l = this._v - 1; l < this._lines.length; l++) {
			const line = this._lines[l]!;
			y += line.ascent;
			const first = this._chars[line.from] ?? this._def;
			const align = first.align ?? "left";
			const row = svgEl("tspan", { x: String(align === "center" ? box / 2 : align === "right" ? box - g : g + (first.leftMargin ?? 0)), y: String(y), "text-anchor": align === "center" ? "middle" : align === "right" ? "end" : "start" });
			for (let i = line.from; i < line.to; ) {
				const f = this._chars[i]!;
				let e = i + 1;
				while (e < line.to && this._chars[e] === f) e++;
				const s = svgEl("tspan", { "font-family": `'${f.font}', sans-serif`, "font-size": String(f.size), fill: (this as any)._css ?? colorOf(f.color ?? 0) });
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
		this._backing();
		current.touched();
	}
	/** The field's background and border. */
	private _backing() {
		const n = this._node;
		if (this._bgOn || this._brOn) {
			const r = (this._back ??= n.insertBefore(svgEl("rect"), n.firstChild) as SVGElement);
			r.setAttribute("x", ".5");
			r.setAttribute("y", ".5");
			r.setAttribute("width", String(this._w - 1));
			r.setAttribute("height", String(this._h - 1));
			r.setAttribute("fill", this._bgOn ? colorOf(this._bg) : "none");
			r.setAttribute("stroke", this._brOn ? colorOf(this._br) : "none");
		} else {
			this._back?.remove();
			this._back = null;
		}
	}
	override _self(): Box {
		return { l: 0, t: 0, r: this._w, b: this._h };
	}
	override _covers(x: number, y: number) {
		const b = this._boxIn(this._world(), true);
		return !!b && x >= b.l && x <= b.r && y >= b.t && y <= b.b;
	}
	get text() {
		return current.base ? this._text : this._text.replace(/\r/g, "\n");
	}
	set text(v: string) {
		this._text = (v === null || v === undefined ? "" : String(v)).replace(/\n/g, "\r");
		this._html = null;
		const f = this._def;
		this._chars = Array.from({ length: this._text.length }, () => f);
		// (new text: the selection starts again)
		this._selected = [0, 0];
		if (this._in) this._in.value = "";
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
		const n = this._text.length;
		a = Math.max(0, Math.min(n, a));
		b = Math.max(0, Math.min(n, b));
		this._selected = [Math.min(a, b), Math.max(a, b)];
		this._in?.setSelectionRange(this._selected[0], this._selected[1]);
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
		const l = this._lines[0];
		return this._in && l ? 1 + Math.round(this._in.scrollTop / (l.ascent + l.descent + l.leading)) : this._v;
	}
	set scrollV(v: number) {
		this._v = Math.max(1, Math.min(this.maxScrollV, +v));
		const l = this._lines[0];
		if (this._in) this._in.scrollTop = l ? (this._v - 1) * (l.ascent + l.descent + l.leading) : 0;
		else this._draw();
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
		return this._text.slice(l.from, this._lines[i + 1]?.from ?? this._text.length);
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
	beginBitmapFill(bd: any, matrix: FMatrix | null = null, repeat = true, smooth = false) {
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
	/** The arcs and stars CreateJS draws. */
	arc(x: number, y: number, r: number, a0: number, a1: number, ccw: boolean) {
		const sx = x + r * Math.cos(a0),
			sy = y + r * Math.sin(a0);
		this.start();
		this.d += `L${sx} ${sy}`;
		let sweep = a1 - a0;
		if (ccw) sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep;
		else sweep = sweep < 0 ? sweep + 2 * Math.PI : sweep;
		sweep = Math.max(-2 * Math.PI + 1e-4, Math.min(2 * Math.PI - 1e-4, sweep));
		const ex = x + r * Math.cos(a0 + sweep),
			ey = y + r * Math.sin(a0 + sweep);
		this.d += `A${r} ${r} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${ex} ${ey}`;
		this.box(x - r, y - r, 2 * r, 2 * r);
		this.x = ex;
		this.y = ey;
	}
	arcCorner(a: number, b: number, x: number, y: number, r: number) {
		const ux = this.x - a,
			uy = this.y - b,
			vx = x - a,
			vy = y - b;
		const lu = Math.hypot(ux, uy),
			lv = Math.hypot(vx, vy);
		const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
		const t = r / Math.tan(turn / 2);
		this.lineTo(a + (ux / lu) * t, b + (uy / lu) * t);
		const ex = a + (vx / lv) * t,
			ey = b + (vy / lv) * t;
		this.d += `A${r} ${r} 0 0 ${ux * vy - uy * vx < 0 ? 1 : 0} ${ex} ${ey}`;
		this.pt(ex, ey);
		this.x = ex;
		this.y = ey;
	}
	polyStar(x: number, y: number, r: number, sides: number, ptr: number, angle: number) {
		const inner = r * (1 - ptr);
		const n = ptr ? sides * 2 : sides;
		for (let i = 0; i < n; i++) {
			const q = ptr && i % 2 ? inner : r;
			const a = (angle * Math.PI) / 180 + (i * 2 * Math.PI) / n;
			const px = x + Math.cos(a) * q,
				py = y + Math.sin(a) * q;
			this.d += `${i ? "L" : "M"}${px} ${py}`;
			this.pt(px, py);
		}
		this.d += "Z";
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

class FLoaderInfo extends Dispatcher {
	url: string | null = null;
	width = 0;
	height = 0;
	bytesLoaded = 0;
	bytesTotal = 0;
	contentType: string | null = null;
	content: DisplayObject | null = null;
	loader: DisplayObject | null = null;
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
	private queue: { c: Clip; f: number; fn: (() => void) | null }[] = [];
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
	bitmaps = new Set<any>();
	/** Frames per second, as scripts set it; frames gone by. */
	rate: number;
	ticks = 0;
	info = new FLoaderInfo();
	/** Draws filters as SVG primitives, into `out`; says how far they reach (with the filters' part). */
	filterPrims: ((list: any[], world: Mat, out: SVGElement[]) => number) | null = null;
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
			FrameLabel: FFrameLabel,
			Scene: FScene,
			LoaderInfo: FLoaderInfo,
			Stage: FStage,
			Graphics: FGraphics,
			Dictionary: Object,
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
			FocusEvent: FFocusEvent,
			TextEvent: FTextEvent,
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
			SoundTransform: FSoundTransform,
			URLRequest,
			URLVariables,
			URLRequestMethod: { GET: "GET", POST: "POST", PUT: "PUT", DELETE: "DELETE", HEAD: "HEAD", OPTIONS: "OPTIONS" },
			URLLoaderDataFormat: { TEXT: "text", BINARY: "binary", VARIABLES: "variables" },
			sendToURL: (r: URLRequest) => void fetch(r.url, { method: r.method, mode: "no-cors" }).catch(() => {}),
			ExternalInterface: {
				available: true,
				marshallExceptions: false,
				objectID: player.svg.id,
				call: (n: string, ...a: unknown[]) => (window as any)[n]?.(...a) ?? null,
				addCallback: (n: string, f: Fn) => void ((window as any)[n] = (...a: unknown[]) => self.safely(() => f(...a))),
			},
			Security: { allowDomain() {}, allowInsecureDomain() {}, loadPolicyFile() {}, sandboxType: "remote" },
			System: { setClipboard: (s: string) => void navigator.clipboard?.writeText(s).catch(() => {}), gc() {}, totalMemory: 0, useCodePage: false },
			Point: FPoint,
			Rectangle: FRectangle,
			Matrix: FMatrix,
			ColorTransform: FColorTransform,
			Transform: FTransform,
			Vector: Array,
			Capabilities: { playerType: "SVG", version: "WEB 32,0,0,0", os: navigator.platform, language: navigator.language, screenResolutionX: screen.width, screenResolutionY: screen.height },
			stage: this.stage,
			get root() {
				return self.rootObj;
			},
		};
		this.helpers = {
			str: (x: unknown) => (x === null || x === undefined ? null : String(x)),
			text: (x: unknown) => String(x),
			vals: (o: unknown) => (o === null || o === undefined ? [] : Array.isArray(o) ? o.slice() : Object.values(o as object)),
			is: (x: unknown, c: unknown) => isType(x, c),
			as: (x: unknown, c: unknown) => (isType(x, c) ? x : null),
			cls: (n: string, t: Record<string, unknown> | null) => self.classOf(n) ?? t?.[n],
			NEW,
			err: asFlashError,
			vec: makeVector,
			vget: vectorGet,
			vset: vectorSet,
			re: (s: string, f: string) => Object.defineProperty(new RegExp(s, f), "extended", { value: true }),
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
		// the parts of the API this document's scripts use came along with them
		const L = {
			DisplayObject,
			DisplayObjectContainer,
			Sprite,
			MovieClip,
			Shape,
			TextField,
			FGraphics,
			FPoint,
			FRectangle,
			FMatrix,
			FColorTransform,
			FSoundTransform,
			FLoaderInfo,
			URLVariables,
			Dispatcher,
			FEvent,
			fail,
			ArgumentError,
			EOFError,
			mul,
			inverse,
			twips,
			svgEl,
			htmlEl,
			colorOf,
			matrixText,
			FMouseEvent,
			FTextEvent,
			noBox,
			addBox,
			alphaNow,
			free,
			run,
			stagePoint,
			bareName,
			canvasMatrix: (f: (x: Frozen) => Mat) => (canvasMatrix = f),
			scripts: this,
		} as Record<string, unknown>;
		for (const p of (code as unknown as { $p?: ((l: unknown) => Record<string, unknown>)[] }).$p ?? []) {
			const made = p(L);
			Object.assign(L, made);
			Object.assign(this.api, made);
		}
		this.listen();
	}

	// (the document's own classes, with the part that has them: parts/classes.ts)
	/** A class of the document's own by its name, qualified or not. */
	userClass(_name: string): any {
		return undefined;
	}
	/** The class whose object a timeline's is: the document class, a symbol's class with AS3 code. */
	classFor(_c: Clip): any {
		return null;
	}
	/** The object of a timeline's class: its constructor runs, or (`unbuilt`) not yet. */
	declare make: (c: Clip, cls: any, unbuilt?: boolean) => any;

	/** Canvas documents: what the frame event carries; the ticker's listeners and tweens. */
	tickEvent: (() => any) | null = null;
	ticker: Dispatcher | null = null;
	private beats = new Set<() => void>();
	onTick(f: () => void) {
		this.beats.add(f);
	}
	offTick(f: () => void) {
		this.beats.delete(f);
	}

	/** Hides the mouse pointer, whatever an object below it asks for. */
	private hides: HTMLStyleElement | null = null;
	cursor(hide: boolean) {
		if (hide) (this.hides ??= document.documentElement.appendChild(htmlEl("style")) as HTMLStyleElement).textContent = `#${this.player.svg.id},#${this.player.svg.id} *{cursor:none!important}`;
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
			if (c && hasOwn(c, "$n")) return c.$n;
			return c === Dispatcher ? "flash.events::EventDispatcher" : of(nameOf(c) ?? "Object");
		}
		if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? "int" : "Number";
		if (typeof v === "string") return "String";
		if (typeof v === "boolean") return "Boolean";
		if (Array.isArray(v) && (v as any).position === undefined) return "Array";
		if (c && hasOwn(c, "$n")) return c.$n;
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
	classOf(name: string): any {
		let c = this.made.get(name) ?? this.userClass(name);
		if (c) return c;
		const pic = this.P.bd?.[name];
		const key = this.P.cl?.[name] as string;
		const Pixels = this.api.BitmapData as any;
		if (pic && !this.base) {
			// (in a Canvas document a library bitmap is a display object)
			c = class extends (this.api.Bitmap as any) {
				constructor() {
					super(Pixels._picture(pic![0], pic![1], pic![2], !!pic![3], Pixels.prototype));
				}
			};
		} else if (pic) {
			const K: any = class extends Pixels {
				constructor() {
					super(1, 1);
					return Pixels._picture(pic![0], pic![1], pic![2], !!pic![3], K.prototype);
				}
			};
			c = K;
		} else if (key === undefined) return undefined;
		else if (this.P.snd[key] !== undefined) {
			const s = this.P.snd[key];
			c = class extends (this.api.Sound as any) {
				constructor() {
					super();
					this._id = key;
					this.bytesLoaded = this.bytesTotal = (Array.isArray(s) ? s[0] : s).length;
				}
			};
		} else {
			// (a class Animate makes for the symbol: of MovieClip, or of a class of the document's own)
			const base = this.P.cb?.[name];
			const B = (base && this.classOf(base)) || MovieClip;
			const K: any = class extends B {};
			K.$n = name;
			this.generated.add(K);
			this.links.set(K, key);
			Object.defineProperty(K, Symbol.hasInstance, { value: (x: any) => x?._cls === name || Function.prototype[Symbol.hasInstance].call(K, x) });
			c = K;
		}
		this.made.set(name, c);
		return c;
	}

	/** Classes Animate makes for symbols; the timelines of classes. */
	generated = new WeakSet<object>();
	private links = new Map<unknown, string | undefined>();
	/** The timeline of a class's symbol (the class's own, or one it extends). */
	private linkedKey(cls: any): string | undefined {
		if (this.links.has(cls)) return this.links.get(cls);
		let key: string | undefined;
		for (let x = cls; x && x !== MovieClip && key === undefined; x = Object.getPrototypeOf(x)) {
			if (this.links.has(x)) key = this.links.get(x);
			else if (hasOwn(x, "$n")) {
				const n = x.$n as string;
				key = this.P.cl?.[n.slice(n.lastIndexOf(":") + 1)];
			}
		}
		this.links.set(cls, key);
		return key;
	}

	/** The timeline being given to the object of its class now (the class's constructor takes it). */
	making: { c: Clip; cls: unknown } | null = null;
	/**
	 * Objects of classes whose constructor hasn't run yet: made for a child's constructor (its parent
	 * is there in Flash Player), built when their own instance is in place (children's first).
	 */
	unbuilt = new WeakSet<object>();
	/** Instances in place (their object built, or none needed). */
	private inPlace = new WeakSet<Inst>();


	/** A class's object made: its timeline (one being made for it, or a new one of its symbol). */
	adopt(o: MovieClip, cls: unknown) {
		const mk = this.making;
		let c: Clip;
		let fresh = false;
		if (mk && mk.cls === cls) {
			c = mk.c;
			this.making = null;
		} else {
			const key = this.linkedKey(cls);
			if (key === undefined) return;
			c = new this.ClipClass(this.player, this.P.tl[key]!, 0);
			c.up = this.player.root;
			c.fresh = true;
			fresh = true;
		}
		this.attach(o, c);
		// (its first frame's instances are there when the constructor's body runs)
		if (fresh || c.kind === -1) c.sync();
		if (fresh) {
			c.runActions();
			c.updateAdvance();
		}
	}

	/** Makes `o` the object of a timeline. */
	private attach(o: any, c: Clip) {
		const self = this;
		o._c = c;
		o._node = c.node;
		if (!hasOwn(o.constructor, "$n") || this.generated.has(o.constructor)) o._cls = this.classNames.get(c.tl) ?? (c.kind === -1 ? "MainTimeline" : "MovieClip");
		if (c.kind === -1 && this.base) o._name = "root1";
		c.obj = o;
		this.clips.set(c, o);
		if (c.kind === -1) {
			this.rootObj = o;
			o._parent = this.stage;
		}
		const i = c.inst;
		if (i) {
			o._i = i;
			// (written as literals: the fields' names are renamed in the bundle)
			Object.defineProperties(
				o,
				Object.getOwnPropertyDescriptors({
					get _node() {
						return i.node ?? c.node;
					},
					// (its parent's object when first asked for)
					get _parent() {
						const p = self.objOfClip(i.owner);
						delete this._parent;
						this._parent = p;
						return p;
					},
					set _parent(v: any) {
						delete this._parent;
						this._parent = v;
					},
				}),
			);
			this.objs.set(i, o);
		}
		// the names of the timeline's instances: Animate declares them as the class's variables
		const names = new Set<string>();
		for (const l of c.tl.ly) for (const it of l.it) if ((it as PInst).nm) names.add((it as PInst).nm!);
		for (const k of names) {
			if (k in o) continue;
			Object.defineProperty(o, k, {
				configurable: true,
				get: () => this.named(o, c, k),
				set: (v) => Object.defineProperty(o, k, { value: v, writable: true, configurable: true }),
			});
		}
	}

	/** A timeline's instance by its name: on stage, taken elsewhere by a script, or null. */
	private named(t: any, c: Clip, k: string): unknown {
		const kid = t._list().find((x: DisplayObject) => x.name === k);
		if (kid) return kid;
		for (const i of c.items.values()) if ((i.it as PInst).nm === k) return this.objOfInst(i);
		return null;
	}

	/** Whether an instance's timeline hangs from the stage (without making objects for it). */
	private onStage(i: Inst): boolean {
		for (let c: Clip | null = i.owner; c; c = c.inst?.owner ?? null) if (c.kind === -1) return c === this.player.root;
		return false;
	}

	/**
	 * An instance the timeline put in place (its own instances are in place already): its class's
	 * constructor runs, then it hears it was added, as in Flash Player.
	 */
	born(i: Inst) {
		this.inPlace.add(i);
		const c = i.clip;
		const cls = c && c.kind !== 1 ? this.classFor(c) : null;
		if (!cls && !this.addedHeard) return;
		this.safely(() => {
			let o: any = this.objs.get(i) ?? (c ? this.clips.get(c) : undefined);
			if (cls) {
				if (!o) o = this.clips.get(c!) ?? this.make(c!, cls);
				else if (this.unbuilt.has(o)) {
					this.unbuilt.delete(o);
					run(() => o.$ctor());
				}
			}
			o ??= this.objOfInst(i);
			o.dispatchEvent(new FEvent(FEvent.ADDED, true));
			// (its own instances heard it in their turn)
			if (this.onStage(i)) o.dispatchEvent(new FEvent(FEvent.ADDED_TO_STAGE));
		});
	}

	/** Movie clips with frame scripts that a timeline takes off this frame (before it does). */
	private leavers: Clip[] = [];
	leaving(c: Clip) {
		for (const [it, i] of c.items) {
			const k = i.clip;
			if (!k || k.kind !== 0 || (c.frame >= it.s && c.frame < it.e)) continue;
			const key = this.keyOf(k.tl);
			if (key !== undefined && this.code[key]) this.leavers.push(k);
		}
	}

	/** An instance the timeline takes off: its object hears it. */
	gone(i: Inst) {
		const o: any = this.objs.get(i) ?? (i.clip ? this.clips.get(i.clip) : undefined);
		if (!o) return;
		this.safely(() => {
			o.dispatchEvent(new FEvent(FEvent.REMOVED, true));
			if (this.onStage(i)) this.toStage(o, FEvent.REMOVED_FROM_STAGE);
		});
	}

	/** ADDED_TO_STAGE or REMOVED_FROM_STAGE: to the object, then to everything inside it that has an object. */
	toStage(o: any, type: string) {
		o.dispatchEvent(new FEvent(type));
		const c: Clip | null = o._c;
		if (c) for (const i of c.items.values()) {
			const k = this.objs.get(i) ?? (i.clip ? this.clips.get(i.clip) : undefined);
			if (k) this.toStage(k, type);
		}
		for (const d of o._dyn ?? []) if (!d._i) this.toStage(d, type);
	}
	/** Someone listens for ADDED (it bubbles up from every instance the timeline puts on stage). */
	addedHeard = false;

	objOfClip(c: Clip): MovieClip {
		let o = this.clips.get(c);
		if (o) return o;
		const cls = this.classFor(c);
		if (cls) {
			const made = this.make(c, cls, !!c.inst && !this.inPlace.has(c.inst));
			return this.clips.get(c) ?? made;
		}
		const self = this;
		const m = c.inst && (c.inst.it as PInst).t === 2 ? new SimpleButton(c.node) : new MovieClip(c.node);
		m._c = c;
		m._cls = this.classNames.get(c.tl) ?? (c.kind === -1 ? "MainTimeline" : "MovieClip");
		if (c.kind === -1 && this.base) m._name = "root1";
		o = new Proxy(m, {
			get(t, k) {
				if (k in t || typeof k === "symbol") return Reflect.get(t, k, t);
				const kid = t._list().find((x) => x.name === k);
				if (kid) return kid;
				// (taken elsewhere by a script: the variable still holds it)
				for (const i of c.items.values()) if ((i.it as PInst).nm === k) return self.objOfInst(i);
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
		if (c.kind === -1) {
			this.rootObj = o;
			m._parent = this.stage;
		}
		const i = c.inst;
		if (i) {
			m._i = i;
			// (the instance may still be being made: its node comes when asked for)
			// (written as a literal: the field's name is renamed in the bundle)
			Object.defineProperties(
				m,
				Object.getOwnPropertyDescriptors({
					get _node() {
						return i.node ?? c.node;
					},
				}),
			);
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
		const ct = (i.it as PRef).ct;
		if (ct) {
			const Control = (this.api as any)[ct[0]];
			if (this.base) o = Control ? new Control(i.node, ct) : new Shape(i.node);
			else {
				// (HTML5 Canvas: scripts work on the elements, with jQuery; the instance stands at its middle)
				const box = i.node.firstElementChild as SVGGElement;
				const t = box.transform.baseVal.consolidate()?.matrix;
				i.node.setAttribute("transform", `matrix(1,0,0,1,${(t?.e ?? 0) + ct[2] / 2},${(t?.f ?? 0) + ct[3] / 2})`);
				box.setAttribute("transform", `translate(${-ct[2] / 2} ${-ct[3] / 2})`);
				o = new Shape(i.node);
			}
			o!._i = i;
			o!._parent = this.objOfClip(i.owner);
			this.objs.set(i, o!);
			// (radio buttons know each other: all of them come at once)
			if (ct[0] === "RadioButton") for (const x of i.owner.items.values()) if ((x.it as PRef).ct?.[0] === "RadioButton") this.objOfInst(x);
			return o!;
		}
		if ((i.it as PItem).k === "r" && i.node.querySelector("text,input,textarea")) o = new TextField(i.node, (i.it as PRef).tx, this.base ? 2 : 0);
		else o = new Shape(i.node);
		o._i = i;
		o._parent = this.objOfClip(i.owner);
		this.objs.set(i, o);
		return o;
	}

	/** A control got the keyboard. */
	focused(o: DisplayObject) {
		const s = this.stage;
		const was = s._focus;
		s._focus = o;
		o.dispatchEvent(new FFocusEvent(FFocusEvent.FOCUS_IN, true, false, was));
	}
	/** A control lost it, maybe to another (whose focusin follows). */
	blurred(o: DisplayObject, to: Node | null) {
		this.stage._focus = null;
		o.dispatchEvent(new FFocusEvent(FFocusEvent.FOCUS_OUT, true, false, to ? this.targetOf(to) : null));
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
	classNames = new Map<PTimeline, string>();
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
		let fn: (() => void) | null = null;
		// (a timeline of a class: its object isn't made to bind its scripts, it is made in its turn)
		if (!c.fs && !this.clips.has(c) && this.classFor(c)) {
			const key = this.keyOf(c.tl);
			if (key === undefined || !this.code[key]) return;
		} else {
			fn = (c.fs ??= this.bind(c))[c.frame] ?? null;
			if (!fn) return;
		}
		// (a goto's frame comes before what was waiting; a parent's script before its children's)
		if (this.front >= 0) return void this.queue.splice(this.front++, 0, { c, f: c.frame, fn });
		let at = this.queue.length;
		for (let k = 0; k < at; k++) for (let p = this.queue[k]!.c.up; p; p = p.up) if (p === c) at = k;
		this.queue.splice(at, 0, { c, f: c.frame, fn });
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

	/** CreateJS's tick: tweens, then the objects listening, then the ticker's listeners. */
	private tock() {
		for (const f of [...this.beats]) f();
		const set = this.heard.get("tick");
		if (set) for (const o of [...set]) (o as any)._fireAll(this.tickEvent!(), 2);
		(this.ticker as any)?._fireAll(this.tickEvent!(), 2);
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
			const { c, f, fn: given } = this.queue.shift()!;
			if (c.frame !== f) continue;
			const fn = given ?? (c.fs ??= this.bind(c))[f];
			if (!fn) continue;
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
		// (clips this frame took off still went on to their next frame first: its script runs, after the others)
		for (const c of this.leavers.splice(0)) {
			if (c.playing) c.frame = c.frame + 1 >= c.tl.n ? 0 : c.frame + 1;
			c.runActions();
		}
		for (const c of this.orphans) c.tick();
		if (this.base) this.broadcast(FEvent.ENTER_FRAME);
		else this.tock();
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
	targetOf(n: Node | null): DisplayObject {
		let target: DisplayObject | null = null;
		for (let x: Node | null = n; x && x !== this.player.svg; x = x.parentNode) {
			const i = this.nodes.get(x);
			const o = (i ? this.objOfInst(i) : this.placed.get(x)) as any;
			if (!o) continue;
			// (a drawing doesn't take the mouse in Flash: the clip it is in does)
			if (o instanceof Shape && this.base) continue;
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

	listen() {
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
			// Enter or Space on a focused instance: a click (not in a control: it is typing)
			if ((e.key !== "Enter" && e.key !== " ") || (e.target as Element).namespaceURI !== svg.namespaceURI) return;
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
				ev.keyCode = e.keyCode || 0;
				ev.charCode = e.key.length === 1 ? e.key.charCodeAt(0) : (CHAR_KEYS[e.key] ?? 0);
				ev.ctrlKey = e.ctrlKey;
				ev.shiftKey = e.shiftKey;
				ev.altKey = e.altKey;
				// (from what has the focus, up to the stage)
				((this.stage._focus as DisplayObject | null) ?? this.stage).dispatchEvent(ev);
			});
		window.addEventListener("resize", () => this.safely(() => this.stage.dispatchEvent(new FEvent(FEvent.RESIZE))));
		window.addEventListener("keydown", key(FKeyboardEvent.KEY_DOWN));
		window.addEventListener("keyup", key(FKeyboardEvent.KEY_UP));
	}

	hear(type: string, o: Dispatcher) {
		if (type === FEvent.ADDED) this.addedHeard = true;
		if (type !== FEvent.ENTER_FRAME && type !== FEvent.FRAME_CONSTRUCTED && type !== FEvent.EXIT_FRAME && type !== "tick") return;
		let s = this.heard.get(type);
		if (!s) this.heard.set(type, (s = new Set()));
		s.add(o);
	}

	/** The root timeline is there: its object hangs from the stage. */
	started(root: Clip) {
		this.safely(() => void this.objOfClip(root));
	}
}

function isType(x: unknown, c: unknown): boolean {
	if (typeof c === "string" && c.startsWith("Vector.<")) return x instanceof FVector && c === `Vector.<${x._t}>`;
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

function sortArray(a: unknown[], ...o: unknown[]): unknown {
	const f = o.find((x) => typeof x === "function") as Fn | undefined;
	const flags = (o.find((x) => typeof x === "number") as number) ?? 0;
	// RETURNINDEXEDARRAY: where each would go, the array left alone
	if (flags & 8) {
		const copy = a.map((v, i) => ({ v, i }));
		const by = sortArray(copy.map((c) => c.v), ...o.map((x) => (typeof x === "number" ? x & ~12 : x))) as unknown[];
		return by.map((v) => {
			const at = copy.findIndex((c) => c.v === v);
			return copy.splice(at, 1)[0]!.i;
		});
	}
	// UNIQUESORT: 0, the array left alone, if two are the same
	if (flags & 4 && new Set(a).size < a.length) return 0;
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
Object.defineProperties(RegExp.prototype, {
	extended: { value: false, configurable: true },
	dotall: { get(this: RegExp) { return this.dotAll; }, configurable: true },
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

