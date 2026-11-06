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
import type { PInst, PItem, PTimeline, PTrack } from "./format.ts";

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
const num = (v: unknown, d = 0) => (typeof v === "number" && !isNaN(v) ? v : d);

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
	_name = "";
	mouseEnabled = true;
	tabEnabled = false;
	cacheAsBitmap = false;
	useHandCursor = true;
	constructor(node?: SVGElement) {
		super();
		this._node = node ?? svgEl("g");
	}
	get name() {
		// (instances without a name have one made up, as in Flash)
		return (this._i ? (this._i.it as PInst).nm : "") || (this._name ||= `instance${++current.uid}`);
	}
	set name(v: string) {
		this._name = v;
	}
	get parent() {
		return this._gone ? null : this._parent;
	}
	get root() {
		return current.rootObj;
	}
	get stage(): FStage | null {
		return this._onStage() ? current.stage : null;
	}
	_onStage(): boolean {
		for (let o: any = this; o; o = o._parent) if (o === current.stage) return true;
		return false;
	}
	/** Its matrix now: the script's, or the timeline's at this frame. */
	_get(): Frozen {
		const i = this._i;
		if (!i) return this._m;
		if (i.ov) return i.ov;
		return decompose(current, i);
	}
	/** Takes the transform from the timeline: from now on it is the script's. */
	_own(): Frozen {
		const i = this._i;
		if (!i) return this._m;
		if (!i.ov) {
			i.ov = { ...decompose(current, i) };
			free(i);
		}
		return i.ov;
	}
	_apply() {
		const m = this._i?.ov ?? this._m;
		const t = matrixText(m);
		if (this._i) place(this._i, t);
		else this._node.setAttribute("transform", t);
		current.touched();
	}
	get x() {
		return this._get().x;
	}
	set x(v: number) {
		this._own().x = +v;
		this._apply();
	}
	get y() {
		return this._get().y;
	}
	set y(v: number) {
		this._own().y = +v;
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
		if (i && i.ovAlpha === undefined) return alphaNow(i) / 100;
		return i ? i.ovAlpha! : this._alpha;
	}
	set alpha(v: number) {
		const a = Math.max(0, Math.min(1, +v));
		if (this._i) {
			free(this._i);
			this._i.ovAlpha = a;
		} else this._alpha = a;
		this._node.setAttribute("opacity", String(a));
		current.touched();
	}
	get visible() {
		return this._node.style.display !== "none";
	}
	set visible(v: boolean) {
		this._node.style.display = v ? "" : "none";
		current.touched();
	}
	/** The box of what it draws, in its parent's space. */
	_box() {
		let b: DOMRect | { x: number; y: number; width: number; height: number };
		try {
			b = (this._node as unknown as SVGGraphicsElement).getBBox();
		} catch {
			b = { x: 0, y: 0, width: 0, height: 0 };
		}
		const m = this._get();
		const cos = Math.cos(m.r * RAD),
			sin = Math.sin(m.r * RAD),
			ck = Math.cos((m.r + m.k) * RAD),
			sk = Math.sin((m.r + m.k) * RAD);
		const a = cos * m.sx,
			bb = sin * m.sx,
			c = -sk * m.sy,
			d = ck * m.sy;
		const xs = [b.x, b.x + b.width],
			ys = [b.y, b.y + b.height];
		let l = Infinity,
			t = Infinity,
			r = -Infinity,
			o = -Infinity;
		for (const x of xs)
			for (const y of ys) {
				const px = a * x + c * y + m.x,
					py = bb * x + d * y + m.y;
				l = Math.min(l, px);
				r = Math.max(r, px);
				t = Math.min(t, py);
				o = Math.max(o, py);
			}
		return { l, t, r, o, w: b.width, h: b.height };
	}
	get width() {
		const b = this._box();
		return b.r - b.l;
	}
	set width(v: number) {
		const w = this._box().w;
		if (w) this.scaleX = +v / w;
	}
	get height() {
		const b = this._box();
		return b.o - b.t;
	}
	set height(v: number) {
		const h = this._box().h;
		if (h) this.scaleY = +v / h;
	}
	get mouseX() {
		return local(this._node, current.client[0], current.client[1])[0];
	}
	get mouseY() {
		return local(this._node, current.client[0], current.client[1])[1];
	}
	get blendMode() {
		return this._node.style.mixBlendMode || "normal";
	}
	set blendMode(v: string) {
		this._node.style.mixBlendMode = v === "normal" ? "" : v;
	}
	get filters() {
		return [];
	}
	set filters(_v: unknown) {}
	get transform() {
		return new FTransform(this);
	}
	set transform(v: FTransform) {
		this.transform.colorTransform = v.colorTransform;
	}
	getBounds(space?: DisplayObject) {
		const a = this._node.getBoundingClientRect();
		const p = local((space ?? this)._node, a.left, a.top),
			q = local((space ?? this)._node, a.right, a.bottom);
		return new FRectangle(p[0], p[1], q[0] - p[0], q[1] - p[1]);
	}
	getRect(space?: DisplayObject) {
		return this.getBounds(space);
	}
	localToGlobal(pt: FPoint) {
		const m = (this._node as unknown as SVGGraphicsElement).getScreenCTM();
		if (!m) return new FPoint(pt.x, pt.y);
		const s = stagePoint(m.a * pt.x + m.c * pt.y + m.e, m.b * pt.x + m.d * pt.y + m.f);
		return new FPoint(s[0], s[1]);
	}
	globalToLocal(pt: FPoint) {
		const c = clientOf(pt.x, pt.y);
		const p = local(this._node, c[0], c[1]);
		return new FPoint(p[0], p[1]);
	}
	hitTestObject(o: DisplayObject) {
		const a = this._node.getBoundingClientRect(),
			b = o._node.getBoundingClientRect();
		return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
	}
	hitTestPoint(x: number, y: number, shape = false) {
		const c = clientOf(x, y);
		if (shape) {
			const e = document.elementFromPoint(c[0], c[1]);
			return !!e && this._node.contains(e);
		}
		const a = this._node.getBoundingClientRect();
		return c[0] >= a.left && c[0] <= a.right && c[1] >= a.top && c[1] <= a.bottom;
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
		return (this.o as any)._ct ?? new FColorTransform();
	}
	set colorTransform(c: FColorTransform) {
		(this.o as any)._ct = c;
		const id = `${current.player.svg.id}_s${current.uid++}`;
		const f = svgEl("filter", { id, "color-interpolation-filters": "sRGB" });
		const v = [c.redMultiplier, 0, 0, 0, c.redOffset / 255, 0, c.greenMultiplier, 0, 0, c.greenOffset / 255, 0, 0, c.blueMultiplier, 0, c.blueOffset / 255, 0, 0, 0, c.alphaMultiplier, c.alphaOffset / 255];
		f.appendChild(svgEl("feColorMatrix", { type: "matrix", values: v.join(" ") }));
		current.player.defs.appendChild(f);
		this.o._node.setAttribute("filter", `url(#${id})`);
		current.touched();
	}
	get matrix() {
		const m = this.o._get();
		const cos = Math.cos(m.r * RAD),
			sin = Math.sin(m.r * RAD);
		return new FMatrix(cos * m.sx, sin * m.sx, -sin * m.sy, cos * m.sy, m.x, m.y);
	}
	set matrix(v: FMatrix) {
		const o = this.o._own();
		o.x = v.tx;
		o.y = v.ty;
		o.r = Math.atan2(v.b, v.a) / RAD;
		o.k = Math.atan2(-v.c, v.d) / RAD - o.r;
		o.sx = Math.hypot(v.a, v.b);
		o.sy = Math.hypot(v.c, v.d);
		this.o._apply();
	}
}

class DisplayObjectContainer extends DisplayObject {
	mouseChildren = true;
	tabChildren = true;
	/** Children added by scripts, on top of the timeline's. */
	_dyn: DisplayObject[] = [];
	/** The children in stacking order: the order of their nodes. */
	_list(): DisplayObject[] {
		const out = [...timelineChildren(this), ...this._dyn.filter((o) => !o._i || o._i.owner.items.get(o._i.it) === o._i)];
		return out.sort((a, b) => (a._node.compareDocumentPosition(b._node) & 4 ? -1 : 1));
	}
	get numChildren() {
		return this._list().length;
	}
	getChildAt(i: number) {
		const o = this._list()[i];
		if (!o) throw new RangeError("The supplied index is out of bounds.");
		return o;
	}
	getChildByName(n: string) {
		return this._list().find((o) => o.name === n) ?? null;
	}
	getChildIndex(o: DisplayObject) {
		return this._list().indexOf(o);
	}
	contains(o: DisplayObject) {
		for (let x: any = o; x; x = x._parent) if (x === this) return true;
		return false;
	}
	addChild(o: any) {
		return this.addChildAt(o, this._list().filter((x) => x !== o).length);
	}
	addChildAt(o: any, index: number) {
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
	}
	_host(): Element {
		return this._c ? this._c.node : this._node;
	}
	removeChild(o: any) {
		if (o._parent !== this) throw new Error("The supplied DisplayObject must be a child of the caller.");
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
		current.touched();
		return o;
	}
	removeChildAt(i: number) {
		return this.removeChild(this.getChildAt(i));
	}
	removeChildren(a = 0, b = 0x7fffffff) {
		for (const o of this._list().slice(a, b + 1)) this.removeChild(o);
	}
	setChildIndex(o: any, i: number) {
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
	_g: FGraphics | null = null;
	get graphics() {
		return (this._g ??= new FGraphics(this._node));
	}
	startDrag(lock = false, bounds: FRectangle | null = null) {
		const s = current;
		const p = this._parent?._node ?? this._node;
		const [px, py] = local(p, s.client[0], s.client[1]);
		const m = this._own();
		s.drag = { o: this, dx: lock ? 0 : m.x - px, dy: lock ? 0 : m.y - py, b: bounds };
	}
	stopDrag() {
		current.drag = null;
	}
	get dropTarget() {
		return current.objectAt(current.client[0], current.client[1], this);
	}
	get hitArea() {
		return null;
	}
	set hitArea(_v: unknown) {}
}

class MovieClip extends Sprite {
	override _cls = "MovieClip";
	enabled = true;
	_t(): Clip {
		return this._c as Clip;
	}
	_frame(f: number | string) {
		const c = this._t();
		return c.resolve(typeof f === "number" ? f - (current.base || 1) : f);
	}
	get currentFrame() {
		return this._c ? this._c.frame + current.base : 1;
	}
	get totalFrames() {
		return this._c ? this._c.tl.n : 1;
	}
	get framesLoaded() {
		return this.totalFrames;
	}
	get isPlaying() {
		return !!this._c?.playing;
	}
	get currentLabels() {
		const lb = this._c?.tl.lb ?? {};
		return Object.keys(lb)
			.map((name) => ({ name, frame: lb[name]! + 1 }))
			.sort((a, b) => a.frame - b.frame);
	}
	get currentFrameLabel() {
		return this._c?.labelAt(this._c.frame) ?? null;
	}
	get currentLabel() {
		const c = this._c;
		if (!c) return null;
		let best: string | null = null,
			at = -1;
		const lb = c.tl.lb ?? {};
		for (const k in lb) if (lb[k]! <= c.frame && lb[k]! > at) (best = k), (at = lb[k]!);
		return best;
	}
	play() {
		const c = this._c;
		if (!c) return;
		c.playing = true;
		c.updateAdvance();
		current.touched();
	}
	stop() {
		const c = this._c;
		if (!c) return;
		c.playing = false;
		c.updateAdvance();
		current.touched();
	}
	gotoAndPlay(f: number | string, _scene?: string) {
		if (!this._c) return;
		current.go(this._c, this._frame(f), true);
		current.touched();
	}
	gotoAndStop(f: number | string, _scene?: string) {
		if (!this._c) return;
		current.go(this._c, this._frame(f), false);
		current.touched();
	}
	nextFrame() {
		const c = this._c;
		if (c) this.gotoAndStop(Math.min(c.tl.n - 1, c.frame + 1) + current.base);
	}
	prevFrame() {
		const c = this._c;
		if (c) this.gotoAndStop(Math.max(0, c.frame - 1) + current.base);
	}
	nextScene() {}
	prevScene() {}
	addFrameScript(...a: (number | Fn)[]) {
		const c = this._c;
		if (!c) return;
		for (let i = 0; i + 1 < a.length; i += 2) (c.fs ??= {})[a[i] as number] = a[i + 1] as () => void;
	}
}

/** Shapes, bitmaps, buttons on a timeline. */
class Shape extends DisplayObject {
	override _cls = "Shape";
	_g: FGraphics | null = null;
	get graphics() {
		return (this._g ??= new FGraphics(this._node));
	}
}

class SimpleButton extends DisplayObjectContainer {
	override _cls = "SimpleButton";
	enabled = true;
}

class FStage extends DisplayObjectContainer {
	override _cls = "Stage";
	scaleMode = "showAll";
	align = "";
	quality = "high";
	displayState = "normal";
	focus: unknown = null;
	stageFocusRect = false;
	get stageWidth() {
		return current.P.w;
	}
	get stageHeight() {
		return current.P.h;
	}
	get frameRate() {
		return current.P.fps;
	}
	set frameRate(_v: number) {}
	override get mouseX() {
		return stagePoint(current.client[0], current.client[1])[0];
	}
	override get mouseY() {
		return stagePoint(current.client[0], current.client[1])[1];
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
	// (CreateJS's stage)
	enableMouseOver() {}
	update() {}
}

/** A text field: on a timeline (its drawing is live text), or made by a script. */
class TextField extends DisplayObject {
	override _cls = "TextField";
	multiline = false;
	wordWrap = false;
	selectable = true;
	autoSize = "none";
	type = "dynamic";
	maxChars = 0;
	displayAsPassword = false;
	embedFonts = false;
	_format = new FTextFormat("Arial", 12, 0);
	_text = "";
	_w = 100;
	_h = 100;
	_back: SVGElement | null = null;
	_bg = -1;
	_br = -1;
	constructor(node?: SVGElement) {
		super(node);
		if (node) this._text = this._field()?.textContent ?? "";
		else this._draw();
	}
	_field(): SVGTextElement | null {
		return this._node.querySelector("text");
	}
	_draw() {
		const n = this._node;
		let t = this._field();
		if (!t) n.appendChild((t = svgEl("text", { "xml:space": "preserve" }) as SVGTextElement));
		const f = this._format;
		t.setAttribute("font-family", f.font);
		t.setAttribute("font-size", String(f.size));
		t.setAttribute("fill", colorOf(f.color as number));
		t.setAttribute("font-weight", f.bold ? "bold" : "normal");
		t.setAttribute("font-style", f.italic ? "italic" : "normal");
		const lines = this._text.split(/\r\n|\r|\n/);
		t.replaceChildren(
			...lines.map((l, i) => {
				const s = svgEl("tspan", { x: "2", y: String(2 + f.size * (i + 1)) });
				s.textContent = l;
				return s;
			}),
		);
		if (this._bg >= 0 || this._br >= 0) {
			const r = (this._back ??= n.insertBefore(svgEl("rect"), n.firstChild) as SVGElement);
			r.setAttribute("width", String(this._w));
			r.setAttribute("height", String(this._h));
			r.setAttribute("fill", this._bg >= 0 ? colorOf(this._bg) : "none");
			r.setAttribute("stroke", this._br >= 0 ? colorOf(this._br) : "none");
		} else this._back?.remove();
	}
	get text() {
		return this._text;
	}
	set text(v: string) {
		this._text = v === null || v === undefined ? "" : String(v);
		const t = this._field();
		if (this._i && t) {
			// the field keeps its look: the first run takes the new text
			const s = t.querySelector("tspan");
			if (s) {
				for (const o of [...t.querySelectorAll("tspan")]) if (o !== s) o.remove();
				s.textContent = this._text;
			} else t.textContent = this._text;
		} else this._draw();
		current.touched();
	}
	get htmlText() {
		return this.text;
	}
	set htmlText(v: string) {
		this.text = String(v).replace(/<[^>]*>/g, "");
	}
	appendText(s: string) {
		this.text = this._text + s;
	}
	get length() {
		return this._text.length;
	}
	get textWidth() {
		return this._field()?.getComputedTextLength?.() ?? 0;
	}
	get textHeight() {
		return this._format.size * 1.2;
	}
	get textColor() {
		return this._format.color as number;
	}
	set textColor(v: number) {
		this._format.color = v;
		this._field()?.setAttribute("fill", colorOf(v));
	}
	get defaultTextFormat() {
		return this._format;
	}
	set defaultTextFormat(f: FTextFormat) {
		this.setTextFormat(f);
	}
	setTextFormat(f: FTextFormat) {
		const m = this._format;
		if (f.font !== undefined) m.font = f.font;
		if (f.size !== undefined) m.size = f.size;
		if (f.color !== undefined) m.color = f.color;
		if (f.bold !== undefined) m.bold = f.bold;
		if (f.italic !== undefined) m.italic = f.italic;
		this._draw();
	}
	get background() {
		return this._bg >= 0;
	}
	set background(v: boolean) {
		this._bg = v ? Math.max(this._bg, 0xffffff) : -1;
		this._draw();
	}
	get backgroundColor() {
		return Math.max(this._bg, 0);
	}
	set backgroundColor(v: number) {
		this._bg = v;
		this._draw();
	}
	get border() {
		return this._br >= 0;
	}
	set border(v: boolean) {
		this._br = v ? Math.max(this._br, 0) : -1;
		this._draw();
	}
	get borderColor() {
		return Math.max(this._br, 0);
	}
	set borderColor(v: number) {
		this._br = v;
		this._draw();
	}
	override get width() {
		return this._i ? super.width : this._w;
	}
	override set width(v: number) {
		if (this._i) super.width = v;
		else {
			this._w = +v;
			this._draw();
		}
	}
	override get height() {
		return this._i ? super.height : this._h;
	}
	override set height(v: number) {
		if (this._i) super.height = v;
		else {
			this._h = +v;
			this._draw();
		}
	}
}

class FTextFormat {
	font: string;
	size: number;
	color: unknown;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	align = "left";
	constructor(font = "Arial", size = 12, color: unknown = 0, bold = false, italic = false, underline = false) {
		this.font = font;
		this.size = size;
		this.color = color;
		this.bold = bold;
		this.italic = italic;
		this.underline = underline;
	}
}

class FGraphics {
	private d = "";
	private fill = "none";
	private fo = 1;
	private stroke = "none";
	private sw = 1;
	private so = 1;
	private layer: SVGElement | null = null;
	private host: SVGElement;
	constructor(host: SVGElement) {
		this.host = host;
	}
	private flush() {
		if (this.d) {
			const p = svgEl("path", { d: this.d, fill: this.fill, "fill-opacity": String(this.fo), stroke: this.stroke, "stroke-width": String(this.sw), "stroke-opacity": String(this.so), "stroke-linecap": "round", "stroke-linejoin": "round" });
			(this.layer ??= this.host.insertBefore(svgEl("g"), this.host.firstChild) as SVGElement).appendChild(p);
			this.d = "";
			current.touched();
		}
	}
	clear() {
		this.layer?.replaceChildren();
		this.d = "";
		this.fill = this.stroke = "none";
	}
	lineStyle(w = NaN, color = 0, alpha = 1) {
		this.flush();
		this.stroke = isNaN(w) ? "none" : colorOf(color);
		this.sw = Math.max(w, 0.1);
		this.so = alpha;
	}
	beginFill(color: number, alpha = 1) {
		this.flush();
		this.fill = colorOf(color);
		this.fo = alpha;
	}
	endFill() {
		this.flush();
		this.fill = "none";
	}
	moveTo(x: number, y: number) {
		this.d += `M${x} ${y}`;
	}
	lineTo(x: number, y: number) {
		this.d += `L${x} ${y}`;
	}
	curveTo(a: number, b: number, x: number, y: number) {
		this.d += `Q${a} ${b} ${x} ${y}`;
	}
	cubicCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
		this.d += `C${a} ${b} ${c} ${d} ${x} ${y}`;
	}
	drawRect(x: number, y: number, w: number, h: number) {
		this.d += `M${x} ${y}h${w}v${h}h${-w}Z`;
		return this;
	}
	drawRoundRect(x: number, y: number, w: number, h: number, ew: number, eh = ew) {
		const r = ew / 2,
			s = eh / 2;
		this.d += `M${x + r} ${y}h${w - ew}a${r} ${s} 0 0 1 ${r} ${s}v${h - eh}a${r} ${s} 0 0 1 ${-r} ${s}h${ew - w}a${r} ${s} 0 0 1 ${-r} ${-s}v${eh - h}a${r} ${s} 0 0 1 ${r} ${-s}Z`;
	}
	drawEllipse(x: number, y: number, w: number, h: number) {
		const r = w / 2,
			s = h / 2;
		this.d += `M${x} ${y + s}a${r} ${s} 0 1 0 ${w} 0a${r} ${s} 0 1 0 ${-w} 0Z`;
	}
	drawCircle(x: number, y: number, r: number) {
		this.drawEllipse(x - r, y - r, r * 2, r * 2);
	}
	_end() {
		this.flush();
	}
}

class FPoint {
	x: number;
	y: number;
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}
	static distance(a: FPoint, b: FPoint) {
		return Math.hypot(a.x - b.x, a.y - b.y);
	}
	static interpolate(a: FPoint, b: FPoint, f: number) {
		return new FPoint(b.x + (a.x - b.x) * f, b.y + (a.y - b.y) * f);
	}
	static polar(r: number, a: number) {
		return new FPoint(r * Math.cos(a), r * Math.sin(a));
	}
	get length() {
		return Math.hypot(this.x, this.y);
	}
	add(o: FPoint) {
		return new FPoint(this.x + o.x, this.y + o.y);
	}
	subtract(o: FPoint) {
		return new FPoint(this.x - o.x, this.y - o.y);
	}
	clone() {
		return new FPoint(this.x, this.y);
	}
	equals(o: FPoint) {
		return this.x === o.x && this.y === o.y;
	}
	toString() {
		return `(x=${this.x}, y=${this.y})`;
	}
}

class FRectangle {
	x: number;
	y: number;
	width: number;
	height: number;
	constructor(x = 0, y = 0, w = 0, h = 0) {
		this.x = x;
		this.y = y;
		this.width = w;
		this.height = h;
	}
	get left() {
		return this.x;
	}
	get top() {
		return this.y;
	}
	get right() {
		return this.x + this.width;
	}
	get bottom() {
		return this.y + this.height;
	}
	contains(x: number, y: number) {
		return x >= this.x && x < this.right && y >= this.y && y < this.bottom;
	}
	containsPoint(p: FPoint) {
		return this.contains(p.x, p.y);
	}
	intersects(o: FRectangle) {
		return this.x < o.right && o.x < this.right && this.y < o.bottom && o.y < this.bottom;
	}
	clone() {
		return new FRectangle(this.x, this.y, this.width, this.height);
	}
}

class FMatrix {
	a: number;
	b: number;
	c: number;
	d: number;
	tx: number;
	ty: number;
	constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
		this.a = a;
		this.b = b;
		this.c = c;
		this.d = d;
		this.tx = tx;
		this.ty = ty;
	}
}

class FColorTransform {
	redMultiplier: number;
	greenMultiplier: number;
	blueMultiplier: number;
	alphaMultiplier: number;
	redOffset: number;
	greenOffset: number;
	blueOffset: number;
	alphaOffset: number;
	constructor(r = 1, g = 1, b = 1, a = 1, ro = 0, go = 0, bo = 0, ao = 0) {
		this.redMultiplier = r;
		this.greenMultiplier = g;
		this.blueMultiplier = b;
		this.alphaMultiplier = a;
		this.redOffset = ro;
		this.greenOffset = go;
		this.blueOffset = bo;
		this.alphaOffset = ao;
	}
	get color() {
		return (this.redOffset << 16) | (this.greenOffset << 8) | this.blueOffset;
	}
	set color(v: number) {
		this.redMultiplier = this.greenMultiplier = this.blueMultiplier = 0;
		this.redOffset = (v >> 16) & 255;
		this.greenOffset = (v >> 8) & 255;
		this.blueOffset = v & 255;
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
		this._format.size = m ? +m[1]! : 12;
		this._format.font = m?.[2] || "Arial";
		this._format.bold = /bold/.test(font);
		this._format.color = parseInt(String(color).replace(/^#/, "").padEnd(6, "0"), 16) || 0;
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

class FSoundChannel extends Dispatcher {
	_v: { stop(): void; pos(): number } | null = null;
	stop() {
		this._v?.stop();
		this._v = null;
	}
	get position() {
		return (this._v?.pos() ?? 0) * 1000;
	}
	soundTransform = new FSoundTransform();
}

class FSoundTransform {
	volume: number;
	pan: number;
	constructor(v = 1, p = 0) {
		this.volume = v;
		this.pan = p;
	}
}

/** A sound of the library (by class name) or from a URL. */
class FSound extends Dispatcher {
	_id = "";
	_el: HTMLAudioElement | null = null;
	constructor(req?: { url: string }) {
		super();
		if (req) this.load(req);
	}
	load(req: { url: string }) {
		this._el = new Audio(req.url);
	}
	play(start = 0, loops = 0) {
		const c = new FSoundChannel();
		const m = current.player.mixer;
		if (this._id && m) {
			const v = m.voice([0, this._id, 0, Math.max(1, loops + 1), 0], start / 1000);
			c._v = v;
		} else if (this._el) {
			const a = this._el.cloneNode() as HTMLAudioElement;
			a.currentTime = start / 1000;
			a.loop = loops > 0;
			void a.play().catch(() => {});
			c._v = { stop: () => a.pause(), pos: () => a.currentTime };
		}
		return c;
	}
	get length() {
		return (this._el?.duration ?? 0) * 1000;
	}
}

class FLoader extends DisplayObject {
	contentLoaderInfo = new Dispatcher();
	content: unknown = null;
	load(req: { url: string }) {
		const img = svgEl("image") as SVGImageElement;
		img.setAttribute("href", req.url);
		img.addEventListener("load", () => {
			const i = new Image();
			i.onload = () => {
				img.setAttribute("width", String(i.naturalWidth));
				img.setAttribute("height", String(i.naturalHeight));
				current.safely(() => this.contentLoaderInfo.dispatchEvent(new FEvent(FEvent.COMPLETE)));
			};
			i.src = req.url;
		});
		this._node.replaceChildren(img);
		this.content = img;
	}
	unload() {
		this._node.replaceChildren();
		this.content = null;
	}
	unloadAndStop() {
		this.unload();
	}
}

// ------------------------------------------------------------------ helpers

function decompose(s: Scripts, i: Inst): Frozen {
	const it = i.it as PInst;
	const P = s.P,
		t = i.owner.frame;
	const v = (k: number, d: number) => trackValue(P, it.tr[k], t, d);
	const r = v(2, 0),
		k = v(3, 0),
		sx = v(4, 1),
		sy = v(5, 1);
	const rad = r * RAD,
		cos = Math.cos(rad),
		sin = Math.sin(rad),
		sk = Math.tan(k * RAD);
	const a = cos * sx,
		b = sin * sx,
		c = (cos * sk - sin) * sy,
		d = (sin * sk + cos) * sy;
	const tpx = v(6, 0),
		tpy = v(7, 0);
	return { x: v(0, 0) - (a * tpx + c * tpy), y: v(1, 0) - (b * tpx + d * tpy), r, k: Math.atan2(-c, d) / RAD - r, sx: Math.hypot(a, b), sy: Math.hypot(c, d) };
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

function matrixText(m: Frozen): string {
	const r = m.r * RAD,
		q = (m.r + m.k) * RAD;
	const v = [Math.cos(r) * m.sx, Math.sin(r) * m.sx, -Math.sin(q) * m.sy, Math.cos(q) * m.sy, m.x, m.y];
	return `matrix(${v.map((n) => Math.round(n * 1e4) / 1e4).join(",")})`;
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
			getDefinitionByName: (n: string) => self.classOf(n.split(".").pop()!),
			DisplayObject,
			DisplayObjectContainer,
			InteractiveObject: DisplayObject,
			Sprite,
			MovieClip,
			Shape,
			SimpleButton,
			Bitmap: Shape,
			BitmapData: Object,
			Stage: FStage,
			Graphics: FGraphics,
			StageAlign: { TOP_LEFT: "TL", TOP: "T", LEFT: "L", RIGHT: "R", BOTTOM: "B", TOP_RIGHT: "TR", BOTTOM_LEFT: "BL", BOTTOM_RIGHT: "BR" },
			StageScaleMode: { NO_SCALE: "noScale", SHOW_ALL: "showAll", EXACT_FIT: "exactFit", NO_BORDER: "noBorder" },
			StageDisplayState: { NORMAL: "normal", FULL_SCREEN: "fullScreen", FULL_SCREEN_INTERACTIVE: "fullScreenInteractive" },
			Event: FEvent,
			MouseEvent: FMouseEvent,
			KeyboardEvent: FKeyboardEvent,
			TimerEvent: FTimerEvent,
			FocusEvent: FEvent,
			TextEvent: FEvent,
			Keyboard: KEYS,
			Mouse: {
				hide: () => void (player.svg.style.cursor = "none"),
				show: () => void (player.svg.style.cursor = ""),
			},
			Timer: FTimer,
			TextField,
			TextFormat: FTextFormat,
			TextFieldAutoSize: { NONE: "none", LEFT: "left", CENTER: "center", RIGHT: "right" },
			TextFieldType: { DYNAMIC: "dynamic", INPUT: "input" },
			Sound: FSound,
			SoundChannel: FSoundChannel,
			SoundTransform: FSoundTransform,
			SoundMixer: { ["stopAll"]: () => player.mixer?.stopAll() },
			URLRequest: class {
				url: string;
				constructor(u = "") {
					this.url = u;
				}
			},
			Point: FPoint,
			Rectangle: FRectangle,
			Matrix: FMatrix,
			ColorTransform: FColorTransform,
			Transform: FTransform,
			Vector: Array,
			Dictionary: Object,
			ByteArray: Object,
			Capabilities: { playerType: "SVG", version: "WEB 32,0,0,0", os: navigator.platform, language: navigator.language, screenResolutionX: screen.width, screenResolutionY: screen.height },
			BlurFilter: Object,
			GlowFilter: Object,
			DropShadowFilter: Object,
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

	/** The class of a library symbol or sound (its linkage). */
	classOf(name: string): unknown {
		const key = this.P.cl?.[name];
		if (key === undefined) return undefined;
		const self = this;
		if (this.P.snd[key] !== undefined) {
			return class extends FSound {
				constructor() {
					super();
					this._id = key as string;
				}
			};
		}
		return function () {
			return self.newClip(self.P.tl[key]!);
		};
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
		const m = new MovieClip(c.node);
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
			if ((i.it as PInst).t === 2) m._cls = "SimpleButton";
			this.objs.set(i, o);
		}
		return o;
	}

	objOfInst(i: Inst): DisplayObject {
		let o = this.objs.get(i);
		if (o) return o;
		const it = i.it as PInst;
		if (i.clip) return this.objOfClip(i.clip);
		if ((i.it as PItem).k === "r" && i.node.querySelector("text")) o = new TextField(i.node);
		else if (it.k === "i" && it.t === 2) o = new SimpleButton(i.node);
		else o = new Shape(i.node);
		o._i = i;
		o._parent = this.objOfClip(i.owner);
		this.objs.set(i, o);
		return o;
	}

	/** A new instance on stage: mouse events find it from its node. */
	track(i: Inst) {
		this.nodes.set(i.node, i);
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
		const [lx, ly] = local(target._node, e.clientX, e.clientY);
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
					const p = d.o._parent?._node ?? d.o._node;
					const [px, py] = local(p, e.clientX, e.clientY);
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
	if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return "[object Object]";
	return String(v);
}

const KEYS: Record<string, number> = { BACKSPACE: 8, TAB: 9, ENTER: 13, SHIFT: 16, CONTROL: 17, ALTERNATE: 18, ESCAPE: 27, SPACE: 32, PAGE_UP: 33, PAGE_DOWN: 34, END: 35, HOME: 36, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, INSERT: 45, DELETE: 46 };
for (let i = 48; i <= 57; i++) KEYS[`NUMBER_${i - 48}`] = i;
for (let i = 65; i <= 90; i++) KEYS[String.fromCharCode(i)] = i;
for (let i = 1; i <= 12; i++) KEYS[`F${i}`] = 111 + i;

void num;
