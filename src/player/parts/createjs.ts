/**
 * What frame scripts of HTML5 Canvas documents talk to: CreateJS, on the player's display objects.
 * Numbers stay as scripts set them, frames count from 0, events go as in EaselJS. Measured against
 * the real library by scripts/e2e-canvas.ts. Installed on the display classes when a document's
 * scripts need it (the classes come as arguments: they are defined by the module that calls this).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (...a: any[]) => any;

const RAD = Math.PI / 180;

const powers = (p: number) => ({
	in: (t: number) => t ** p,
	out: (t: number) => 1 - (1 - t) ** p,
	inOut: (t: number) => ((t *= 2) < 1 ? 0.5 * t ** p : 1 - 0.5 * Math.abs((2 - t) ** p)),
});
const bounceOut = (t: number) => {
	if (t < 1 / 2.75) return 7.5625 * t * t;
	if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
	if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
	return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
};
const backIn = (a: number) => (t: number) => t * t * ((a + 1) * t - a);
const backOut = (a: number) => (t: number) => --t * t * ((a + 1) * t + a) + 1;
const backInOut = (a: number) => (t: number) => {
	a *= 1.525;
	return (t *= 2) < 1 ? 0.5 * (t * t * ((a + 1) * t - a)) : 0.5 * ((t -= 2) * t * ((a + 1) * t + a) + 2);
};
const elasticIn = (a: number, p: number) => (t: number) => {
	if (t === 0 || t === 1) return t;
	const s = (p / (2 * Math.PI)) * Math.asin(1 / a);
	return -(a * 2 ** (10 * (t -= 1)) * Math.sin(((t - s) * 2 * Math.PI) / p));
};
const elasticOut = (a: number, p: number) => (t: number) => {
	if (t === 0 || t === 1) return t;
	const s = (p / (2 * Math.PI)) * Math.asin(1 / a);
	return a * 2 ** (-10 * t) * Math.sin(((t - s) * 2 * Math.PI) / p) + 1;
};
const elasticInOut = (a: number, p: number) => (t: number) => {
	const s = (p / (2 * Math.PI)) * Math.asin(1 / a);
	if ((t *= 2) < 1) return -0.5 * (a * 2 ** (10 * (t -= 1)) * Math.sin(((t - s) * 2 * Math.PI) / p));
	return a * 2 ** (-10 * (t -= 1)) * Math.sin(((t - s) * 2 * Math.PI) / p) * 0.5 + 1;
};

const Ease: Record<string, any> = {
	linear: (t: number) => t,
	none: (t: number) => t,
	get: (a: number) => {
		const k = Math.max(-1, Math.min(1, a));
		return (t: number) => (k === 0 ? t : k < 0 ? t * (t * -k + 1 + k) : t * ((2 - t) * k + (1 - k)));
	},
	getPowIn: (p: number) => powers(p).in,
	getPowOut: (p: number) => powers(p).out,
	getPowInOut: (p: number) => powers(p).inOut,
	sineIn: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
	sineOut: (t: number) => Math.sin((t * Math.PI) / 2),
	sineInOut: (t: number) => -0.5 * (Math.cos(Math.PI * t) - 1),
	getBackIn: backIn,
	getBackOut: backOut,
	getBackInOut: backInOut,
	backIn: backIn(1.7),
	backOut: backOut(1.7),
	backInOut: backInOut(1.7),
	circIn: (t: number) => -(Math.sqrt(1 - t * t) - 1),
	circOut: (t: number) => Math.sqrt(1 - --t * t),
	circInOut: (t: number) => ((t *= 2) < 1 ? -0.5 * (Math.sqrt(1 - t * t) - 1) : 0.5 * (Math.sqrt(1 - (t -= 2) * t) + 1)),
	bounceOut,
	bounceIn: (t: number) => 1 - bounceOut(1 - t),
	bounceInOut: (t: number) => (t < 0.5 ? (1 - bounceOut(1 - t * 2)) * 0.5 : bounceOut(t * 2 - 1) * 0.5 + 0.5),
	getElasticIn: elasticIn,
	getElasticOut: elasticOut,
	getElasticInOut: elasticInOut,
	elasticIn: elasticIn(1, 0.3),
	elasticOut: elasticOut(1, 0.3),
	elasticInOut: elasticInOut(1, 0.3 * 1.5),
};
for (const [n, p] of [["quad", 2], ["cubic", 3], ["quart", 4], ["quint", 5]] as [string, number][]) {
	const e = powers(p);
	Ease[`${n}In`] = e.in;
	Ease[`${n}Out`] = e.out;
	Ease[`${n}InOut`] = e.inOut;
}

/** What CreateJS's Event has. */
class CEvent {
	type: string;
	target: any = null;
	currentTarget: any = null;
	eventPhase = 0;
	bubbles: boolean;
	cancelable: boolean;
	timeStamp = Date.now();
	defaultPrevented = false;
	propagationStopped = false;
	immediatePropagationStopped = false;
	removed = false;
	constructor(type: string, bubbles = false, cancelable = false) {
		this.type = type;
		this.bubbles = bubbles;
		this.cancelable = cancelable;
	}
	preventDefault() {
		this.defaultPrevented = this.cancelable;
	}
	stopPropagation() {
		this.propagationStopped = true;
	}
	stopImmediatePropagation() {
		this.immediatePropagationStopped = this.propagationStopped = true;
	}
	remove() {
		this.removed = true;
	}
	clone() {
		return Object.assign(new CEvent(this.type, this.bubbles, this.cancelable), this);
	}
	set(props: object) {
		return Object.assign(this, props);
	}
	toString() {
		return `[Event (type=${this.type})]`;
	}
}

/** The transform of a display object as CreateJS keeps it. */
interface CTransform {
	R: number;
	kx: number;
	ky: number;
	rx: number;
	ry: number;
}

export default function createJS(L: any): Record<string, unknown> {
	const { DisplayObject, DisplayObjectContainer, Sprite, MovieClip, Shape, TextField, FGraphics, FPoint, FRectangle, FMatrix, Dispatcher, mul, svgEl, colorOf, scripts: s } = L;
	const Bitmap = L.Bitmap ?? class {};
	const FBitmapData = L.BitmapData;
	const removeOne = DisplayObjectContainer.prototype.removeChild;
	const define = (o: object, props: Record<string, PropertyDescriptor>) => {
		for (const k in props) Object.defineProperty(o, k, { configurable: true, ...props[k] });
	};
	const plain = (name: string, value: unknown) => ({
		get(this: any) {
			return this[name] === undefined ? value : this[name];
		},
		set(this: any, v: unknown) {
			this[name] = v;
		},
	});

	// ---- the transform: rotation and skews apart, a registration point
	const parts = (f: any): CTransform => {
		if (f.c) return f.c;
		const ky = f.r,
			kx = f.r + f.k;
		// (matrices from Animate are a little off: it writes a rotation as long as the two angles are this close)
		const same = Math.abs(f.k) < 0.05;
		return { R: same ? ky : 0, kx: same ? 0 : kx, ky: same ? 0 : ky, rx: 0, ry: 0 };
	};
	L.canvasMatrix((f: any) => {
		const c: CTransform = f.c;
		const r = c.R * RAD,
			cos = c.R % 360 ? Math.cos(r) : 1,
			sin = c.R % 360 ? Math.sin(r) : 0;
		let m = [cos * f.sx, sin * f.sx, -sin * f.sy, cos * f.sy, f.x, f.y];
		if (c.kx || c.ky) {
			const x = c.kx * RAD,
				y = c.ky * RAD;
			m = mul([Math.cos(y), Math.sin(y), -Math.sin(x), Math.cos(x), f.x, f.y], [m[0], m[1], m[2], m[3], 0, 0]);
		}
		return c.rx || c.ry ? mul(m, [1, 0, 0, 1, -c.rx, -c.ry]) : m;
	});
	const part = (k: keyof CTransform) => ({
		get(this: any) {
			return parts(this._get())[k];
		},
		set(this: any, v: number) {
			const f = this._own();
			(f.c ??= parts(f))[k] = +v;
			this._apply();
		},
	});
	const number = (k: string) => ({
		get(this: any) {
			return this._get()[k];
		},
		set(this: any, v: number) {
			this._own()[k] = +v;
			this._apply();
		},
	});
	define(DisplayObject.prototype, {
		x: number("x"),
		y: number("y"),
		scaleX: number("sx"),
		scaleY: number("sy"),
		rotation: part("R"),
		skewX: part("kx"),
		skewY: part("ky"),
		regX: part("rx"),
		regY: part("ry"),
		scale: {
			get(this: any) {
				return this.scaleX;
			},
			set(this: any, v: number) {
				this.scaleX = this.scaleY = v;
			},
		},
		alpha: {
			get(this: any) {
				const i = this._i;
				if (i && i.ovAlpha === undefined) return L.alphaNow(i) / 100;
				return i ? i.ovAlpha : this._alpha;
			},
			set(this: any, v: number) {
				const a = +v;
				if (this._i) {
					L.free(this._i);
					this._i.ovAlpha = a;
				} else this._alpha = a;
				this._node.setAttribute("opacity", String(Math.max(0, Math.min(1, a))));
				s.touched();
			},
		},
		name: {
			get(this: any) {
				return this._i?.it.nm || this._name;
			},
			set(this: any, v: string) {
				this._name = v;
			},
		},
		stage: {
			get(this: any) {
				return this._onStage() ? s.stage : null;
			},
		},
		mouseEnabled: plain("$_me", true),
		tickEnabled: plain("$_te", true),
		cursor: plain("$_cu", null),
		compositeOperation: {
			get(this: any) {
				return this._co ?? null;
			},
			set(this: any, v: string | null) {
				this._co = v;
				this._node.style.mixBlendMode = v === "lighter" ? "plus-lighter" : v && v !== "source-over" ? v : "";
			},
		},
		shadow: {
			get(this: any) {
				return this._sh ?? null;
			},
			set(this: any, v: any) {
				this._sh = v;
				this._node.style.filter = v ? `drop-shadow(${v.offsetX}px ${v.offsetY}px ${v.blur / 2}px ${v.color})` : "";
			},
		},
	});
	Object.assign(DisplayObject.prototype, {
		_userBounds: null,
		_ownBounds(this: any) {
			return this._rect(this, true);
		},
		getBounds(this: any) {
			if (this._userBounds) return this._userBounds.clone();
			// (a shape or text doesn't know: only symbols come with their bounds)
			return this._c ? this._ownBounds() : null;
		},
		setBounds(this: any, x: number | null, y: number, w: number, h: number) {
			this._userBounds = x === null ? null : new FRectangle(x, y, w, h);
		},
		getTransformedBounds(this: any) {
			const b = this.getBounds();
			if (!b) return null;
			const out = L.noBox();
			L.addBox(out, this._mat(), { l: b.x, t: b.y, r: b.right, b: b.bottom });
			return new FRectangle(out.l, out.t, out.r - out.l, out.b - out.t);
		},
		localToGlobal(this: any, x: number, y: number) {
			const m = this._world();
			return new FPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
		},
		globalToLocal(this: any, x: number, y: number) {
			const m = L.inverse(this._world());
			return new FPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
		},
		localToLocal(this: any, x: number, y: number, to: any) {
			const p = this.localToGlobal(x, y);
			return to.globalToLocal(p.x, p.y);
		},
		hitTest(this: any, x: number, y: number) {
			const m = this._world();
			return this._covers(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
		},
		setTransform(this: any, x = 0, y = 0, sx = 1, sy = 1, R = 0, kx = 0, ky = 0, rx = 0, ry = 0) {
			Object.assign(this._own(), { x, y, sx, sy, c: { R, kx, ky, rx, ry } });
			this._apply();
			return this;
		},
		getMatrix(this: any) {
			return new FMatrix(...this._mat());
		},
		getConcatenatedMatrix(this: any) {
			return new FMatrix(...this._world());
		},
		cache() {},
		uncache() {},
		updateCache() {},
		isVisible(this: any) {
			return this.visible && this.alpha > 0 && this.scaleX !== 0 && this.scaleY !== 0;
		},
		toString(this: any) {
			return `[${this._cls} (name=${this.name})]`;
		},
	});

	// ---- containers
	define(DisplayObjectContainer.prototype, {
		mouseChildren: plain("$_mc", true),
		tickChildren: plain("$_tc", true),
		children: {
			get(this: any) {
				return this._list().slice();
			},
		},
	});
	Object.assign(DisplayObjectContainer.prototype, {
		addChild(this: any, ...o: any[]) {
			for (const c of o) this.addChildAt(c, this._list().filter((x: unknown) => x !== c).length);
			return o[o.length - 1];
		},
		removeChild(this: any, ...o: any[]) {
			let ok = true;
			for (const c of o) {
				if (c.parent !== this) ok = false;
				else removeOne.call(this, c);
			}
			return ok;
		},
		removeChildAt(this: any, i: number) {
			const c = this._list()[i];
			if (!c) return false;
			removeOne.call(this, c);
			return true;
		},
		removeAllChildren(this: any) {
			for (const c of this._list().slice()) removeOne.call(this, c);
		},
		getChildAt(this: any, i: number) {
			return this._list()[i] ?? null;
		},
		getChildIndex(this: any, c: unknown) {
			return this._list().indexOf(c);
		},
		swapChildren(this: any, a: any, b: any) {
			const i = this.getChildIndex(a),
				j = this.getChildIndex(b);
			if (i < 0 || j < 0) return;
			this._place(a, j);
			this._place(b, i);
		},
		swapChildrenAt(this: any, i: number, j: number) {
			this.swapChildren(this._list()[i], this._list()[j]);
		},
		setChildIndex(this: any, c: any, i: number) {
			if (c.parent === this) this._place(c, i);
		},
		contains(this: any, c: any) {
			for (let x = c; x; x = x.parent) if (x === this) return true;
			return false;
		},
		hitTest: DisplayObject.prototype.hitTest,
	});

	// ---- timelines
	define(MovieClip.prototype, {
		paused: {
			get(this: any) {
				return this._c ? !this._c.playing : false;
			},
			set(this: any, v: boolean) {
				if (v) this.stop();
				else this.play();
			},
		},
		mode: plain("$_mo", "independent"),
		loop: plain("$_lo", -1),
		startPosition: plain("$_sp", 0),
		reversed: plain("$_re", false),
		actionsEnabled: plain("$_ae", true),
		autoReset: plain("$_ar", true),
		framerate: plain("$_fr", null),
		duration: {
			get(this: any) {
				return this.totalFrames;
			},
		},
		labels: {
			get(this: any) {
				const lb = this._c?.tl.lb ?? {};
				return Object.keys(lb)
					.map((label) => ({ label, position: lb[label] }))
					.sort((a, b) => a.position - b.position);
			},
		},
		timeline: {
			get(this: any) {
				return { duration: this.totalFrames, position: this.currentFrame, loop: !this.paused };
			},
		},
	});
	MovieClip.prototype.advance = function (this: any) {
		this._c?.tick();
	};

	// ---- events
	Object.assign(Dispatcher.prototype, {
		_fireAll(this: any, e: CEvent, phase: number) {
			e.eventPhase = phase;
			e.currentTarget = this;
			const l = this._on?.get(e.type);
			if (!l) return;
			for (const x of l.slice()) {
				if (e.immediatePropagationStopped) break;
				if (x.capture !== phase <= 1 && phase !== 2) continue;
				e.removed = false;
				L.run(() => (typeof x.fn === "function" ? x.fn.call(this, e) : x.fn.handleEvent(e)));
				if (e.removed) this.removeEventListener(e.type, x.fn, x.capture);
			}
		},
		dispatchEvent(this: any, e: CEvent | string, bubbles = false, cancelable = false) {
			if (typeof e === "string") {
				if (!bubbles && !this._on?.get(e)?.length) return true;
				e = new CEvent(e, bubbles, cancelable);
			} else if (e.target) e = e.clone();
			e.target = this;
			if (!e.bubbles || !this.parent) {
				this._fireAll(e, 2);
			} else {
				const list: any[] = [this];
				for (let o = this.parent; o; o = o.parent) list.push(o);
				for (let i = list.length - 1; i >= 0 && !e.propagationStopped; i--) list[i]._fireAll(e, i ? 1 : 2);
				for (let i = 1; i < list.length && !e.propagationStopped; i++) list[i]._fireAll(e, 3);
			}
			return !e.defaultPrevented;
		},
		on(this: any, type: string, fn: any, scope?: unknown, once = false, data?: unknown, capture = false) {
			const self = this;
			const handler = fn.handleEvent ? fn.handleEvent.bind(fn) : fn;
			return this.addEventListener(
				type,
				function (e: CEvent) {
					handler.call(scope ?? self, e, data);
					if (once) e.remove();
				},
				capture,
			);
		},
		off(this: any, type: string, fn: Fn, capture = false) {
			this.removeEventListener(type, fn, capture);
		},
		removeAllEventListeners(this: any, type?: string) {
			if (type) this._on?.delete(type);
			else this._on?.clear();
			if (!type || type === "tick") s.heard.get("tick")?.delete(this);
		},
	});
	DisplayObject.prototype.dispatchEvent = Dispatcher.prototype.dispatchEvent;
	s.tickEvent = () => {
		const e = new CEvent("tick");
		return Object.assign(e, { delta: 1000 / s.rate, ["time"]: performance.now(), paused: false, runTime: performance.now() });
	};

	// ---- text
	define(TextField.prototype, {
		font: {
			get(this: any) {
				return this._font ?? `${this._def.bold ? "bold " : ""}${this._def.size}px '${this._def.font}'`;
			},
			set(this: any, v: string) {
				this._font = v;
				const m = /(\d+(?:\.\d+)?)px\s*(.*)/.exec(v);
				this._def.size = m ? +m[1]! : 10;
				this._def.font = (m?.[2] || "sans-serif").replace(/['"]/g, "");
				this._def.bold = /bold/.test(v);
				this._def.italic = /italic/.test(v);
				this._again();
			},
		},
		color: {
			get(this: any) {
				return this._color ?? colorOf(this._def.color ?? 0).toUpperCase();
			},
			set(this: any, v: string) {
				this._color = v;
				this._def.color = parseInt(/^#/.test(v) ? v.slice(1).padEnd(6, "0") : "0", 16);
				this._css = v;
				this._again();
			},
		},
		textAlign: {
			get(this: any) {
				return this._def.align ?? "left";
			},
			set(this: any, v: string) {
				this._def.align = v;
				this._again();
			},
		},
		textBaseline: plain("$_bl", "top"),
		lineHeight: plain("$_lh", 0),
		lineWidth: {
			get(this: any) {
				return this._lw ?? null;
			},
			set(this: any, v: number | null) {
				this._lw = v;
				this.wordWrap = v !== null;
				if (v !== null) this._w = v + 4;
				this._again();
			},
		},
		outline: plain("$_ol", 0),
		maxWidth: plain("$_mw", null),
	});
	Object.assign(TextField.prototype, {
		_again(this: any) {
			const t = this._text;
			this._chars = Array.from({ length: t.length }, () => this._def);
			this._draw();
		},
		getMeasuredWidth(this: any) {
			return this.textWidth;
		},
		getMeasuredHeight(this: any) {
			return this.textHeight;
		},
		getMeasuredLineHeight(this: any) {
			return this._def.size * 1.2;
		},
	});

	class CText extends TextField {
		constructor(text = "", font = "10px sans-serif", color = "#000") {
			super();
			this._gutter = 0;
			this._w = 0;
			this._h = 1e4;
			this._def.size = 10;
			this._def.font = "sans-serif";
			this._def.color = 0;
			this._def.align = "left";
			if (font !== undefined) this.font = font;
			if (color !== undefined) this.color = color;
			this._text = String(text ?? "");
			this._again();
		}
		_self() {
			return { l: 0, t: 0, r: this.textWidth, b: this.textHeight };
		}
	}

	// ---- drawing
	class CGraphics {
		private g: any = null;
		private ops: ((g: any) => void)[] = [];
		private drew = false;
		static getRGB(r: number, g?: number, b?: number, a?: number) {
			if (r !== undefined && b === undefined) {
				a = g;
				b = r & 255;
				g = (r >> 8) & 255;
				r = (r >> 16) & 255;
			}
			return a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
		}
		static getHSL(h: number, s2: number, l: number, a?: number) {
			return a === undefined ? `hsl(${h % 360},${s2}%,${l}%)` : `hsla(${h % 360},${s2}%,${l}%,${a})`;
		}
		private op(f: (g: any) => void, draws = true) {
			if (draws) this.drew = true;
			if (this.g) f(this.g);
			else this.ops.push(f);
			return this;
		}
		_on(host: SVGElement) {
			this.g = new FGraphics(host);
			for (const o of this.ops) o(this.g);
			this.g._end();
		}
		_shape() {
			return this.g;
		}
		isEmpty() {
			return !this.drew;
		}
		clear() {
			this.ops.length = 0;
			this.drew = false;
			this.g?.clear();
			// (its gradients go with it: a shape drawn anew every tick would pile them up)
			for (const e of this.made.splice(0)) e.remove();
			return this;
		}
		append(c: { exec?: Fn }) {
			return this.op((g) => c.exec?.(g));
		}
		private paint(key: "fill" | "stroke", value: string) {
			return this.op((g) => {
				g._end();
				g[key] = value;
				if (key === "fill") g.fo = 1;
				else g.so = 1;
			}, false);
		}
		private made: Element[] = [];
		private gradient(linear: boolean, colors: string[], stops: number[], a: number[]) {
			const id = `${s.player.svg.id}_g${s.uid++}`;
			const e = svgEl(linear ? "linearGradient" : "radialGradient", { id, gradientUnits: "userSpaceOnUse" });
			(linear ? ["x1", "y1", "x2", "y2"] : ["fx", "fy", "fr", "cx", "cy", "r"]).forEach((n, i) => e.setAttribute(n, String(a[i])));
			colors.forEach((c, i) => e.appendChild(svgEl("stop", { offset: String(stops[i]), "stop-color": c })));
			this.made.push(s.player.defs.appendChild(e));
			return `url(#${id})`;
		}
		beginFill(c: string | null) {
			return this.paint("fill", c ?? "none");
		}
		beginStroke(c: string | null) {
			return this.paint("stroke", c ?? "none");
		}
		beginLinearGradientFill(c: string[], t: number[], x0: number, y0: number, x1: number, y1: number) {
			return this.paint("fill", this.gradient(true, c, t, [x0, y0, x1, y1]));
		}
		beginRadialGradientFill(c: string[], t: number[], x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
			return this.paint("fill", this.gradient(false, c, t, [x0, y0, r0, x1, y1, r1]));
		}
		beginLinearGradientStroke(c: string[], t: number[], x0: number, y0: number, x1: number, y1: number) {
			return this.paint("stroke", this.gradient(true, c, t, [x0, y0, x1, y1]));
		}
		beginRadialGradientStroke(c: string[], t: number[], x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
			return this.paint("stroke", this.gradient(false, c, t, [x0, y0, r0, x1, y1, r1]));
		}
		setStrokeStyle(w: number, caps: string | number = "butt", joints: string | number = "miter", miter = 10) {
			const cap = typeof caps === "number" ? ["butt", "round", "square"][caps]! : caps;
			const join = typeof joints === "number" ? ["miter", "round", "bevel"][joints]! : joints;
			return this.op((g) => {
				g._end();
				g.sw = w;
				g.cap = cap;
				g.join = join;
				g.miter = miter;
			}, false);
		}
		endFill() {
			return this.paint("fill", "none");
		}
		endStroke() {
			return this.paint("stroke", "none");
		}
		closePath() {
			return this.op((g) => (g.d += "Z"));
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
		arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false) {
			return this.op((g) => g.arc(x, y, r, a0, a1, ccw));
		}
		/** Round the corner at (a, b) toward (x, y), as canvas does. */
		arcTo(a: number, b: number, x: number, y: number, r: number) {
			return this.op((g) => g.arcCorner(a, b, x, y, r));
		}
		rect(x: number, y: number, w: number, h: number) {
			return this.drawRect(x, y, w, h);
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
			return this.op((g) => g.polyStar(x, y, r, sides, ptr, angle));
		}
	}
	const G = CGraphics.prototype as any;
	Object.assign(G, { mt: G.moveTo, lt: G.lineTo, at: G.arcTo, bt: G.bezierCurveTo, qt: G.quadraticCurveTo, a: G.arc, r: G.rect, cp: G.closePath, c: G.clear, f: G.beginFill, lf: G.beginLinearGradientFill, rf: G.beginRadialGradientFill, ef: G.endFill, ss: G.setStrokeStyle, s: G.beginStroke, ls: G.beginLinearGradientStroke, rs: G.beginRadialGradientStroke, es: G.endStroke, dr: G.drawRect, rr: G.drawRoundRect, dc: G.drawCircle, de: G.drawEllipse, dp: G.drawPolyStar });

	class CShape extends Shape {
		_cg: CGraphics;
		constructor(g?: CGraphics) {
			super();
			this._cg = g ?? new CGraphics();
			this._cg._on(this._node);
			this._g = this._cg._shape();
		}
		get graphics() {
			return this._cg;
		}
		set graphics(v: CGraphics) {
			this._cg = v;
			v._on(this._node);
			this._g = v._shape();
		}
	}
	class CContainer extends Sprite {
		constructor() {
			super();
		}
	}
	class CMovieClip extends MovieClip {
		constructor() {
			super();
		}
	}
	class CBitmap extends Bitmap {
		constructor(from?: string | HTMLImageElement) {
			super();
			const url = typeof from === "string" ? from : from?.src;
			if (!url) return;
			const img = typeof from === "string" ? new Image() : from!;
			const show = () => (this.bitmapData = FBitmapData._picture(url, img.naturalWidth, img.naturalHeight, true, FBitmapData.prototype));
			if (img.complete && img.naturalWidth) show();
			else img.addEventListener("load", show);
			if (typeof from === "string") img.src = from;
		}
		get image() {
			return this._image;
		}
	}

	// ---- tweens run on the ticker
	class CTween extends Dispatcher {
		static all = new Set<CTween>();
		static get(o: any, opts: { loop?: boolean | number; override?: boolean; paused?: boolean; useTicks?: boolean; position?: number } = {}) {
			if (opts.override) CTween.removeTweens(o);
			return new CTween(o, opts);
		}
		static removeTweens(o: unknown) {
			for (const t of CTween.all) if (t.target === o) t.quit();
		}
		static removeAllTweens() {
			for (const t of CTween.all) t.quit();
		}
		static hasActiveTweens(o?: unknown) {
			return [...CTween.all].some((t) => !o || t.target === o);
		}
		target: any;
		paused: boolean;
		private list: { ms: number; to?: Record<string, number>; ease?: (t: number) => number; call?: () => void }[] = [];
		private loops: number;
		private ticks: boolean;
		private step = 0;
		private at = 0;
		private from: Record<string, number> | null = null;
		private beat = () => this.tick();
		private last = 0;
		constructor(o: any, opts: { loop?: boolean | number; paused?: boolean; useTicks?: boolean }) {
			super();
			this.target = o;
			this.paused = !!opts.paused;
			this.loops = opts.loop === true ? -1 : +(opts.loop ?? 0);
			this.ticks = !!opts.useTicks;
			CTween.all.add(this);
			s.onTick(this.beat);
		}
		private quit() {
			CTween.all.delete(this);
			s.offTick(this.beat);
		}
		private tick() {
			if (this.paused) return;
			const now = performance.now();
			let dt = this.ticks ? 1 : this.last ? now - this.last : 1000 / s.rate;
			this.last = now;
			while (dt >= 0) {
				const e = this.list[this.step];
				if (!e) {
					if (this.loops === 0 || !this.list.length) return this.quit();
					if (this.loops > 0) this.loops--;
					this.step = 0;
					this.at = 0;
					this.from = null;
					// (a round that takes no time — only calls and sets — comes once a tick: it
					// would go round for ever inside this one, and the page would stand still)
					if (!this.list.some((x) => x.ms > 0)) return;
					continue;
				}
				if (e.to && !this.from) {
					this.from = {};
					for (const k in e.to) this.from[k] = this.target[k];
				}
				const left = e.ms - this.at;
				const use = Math.min(dt, left);
				this.at += use;
				dt -= use;
				if (e.to) {
					const u = e.ms ? this.at / e.ms : 1;
					const v = (e.ease ?? Ease.linear)(u);
					for (const k in e.to) this.target[k] = this.from![k]! + (e.to[k]! - this.from![k]!) * v;
				}
				if (this.at < e.ms) return;
				this.step++;
				this.at = 0;
				this.from = null;
				if (e.call) e.call();
				if (dt <= 0 && this.list[this.step]?.ms) return;
			}
		}
		to(props: Record<string, number>, ms = 0, ease?: (t: number) => number) {
			this.list.push({ ms, to: props, ease });
			return this;
		}
		wait(ms: number) {
			this.list.push({ ms });
			return this;
		}
		call(f: Fn, args?: unknown[], scope?: unknown) {
			this.list.push({ ms: 0, call: () => s.safely(() => f.apply(scope ?? this.target, args ?? [])) });
			return this;
		}
		set(props: Record<string, unknown>, target?: unknown) {
			this.list.push({ ms: 0, call: () => Object.assign((target ?? this.target) as object, props) });
			return this;
		}
		pause(t?: CTween) {
			const x = t ?? this;
			this.list.push({ ms: 0, call: () => (x.paused = true) });
			return this;
		}
		play(t: CTween) {
			this.list.push({ ms: 0, call: () => (t.paused = false) });
			return this;
		}
		setPaused(v: boolean) {
			this.paused = v;
			return this;
		}
	}

	// ---- the stage
	const svg = s.player.svg;
	const canvas = {
		style: svg.style,
		get width() {
			return s.P.w;
		},
		get height() {
			return s.P.h;
		},
		addEventListener: svg.addEventListener.bind(svg),
		removeEventListener: svg.removeEventListener.bind(svg),
		getBoundingClientRect: () => svg.getBoundingClientRect(),
	};
	let overs = Object.values(s.P.tl as Record<string, any>).some((t) => t.ly.some((l: any) => l.it.some((i: any) => i.k === "i" && i.t === 2)));
	Object.assign(s.stage, {
		canvas,
		enableMouseOver(n = 20) {
			overs = n > 0;
		},
		enableDOMEvents() {},
		update() {},
		clear() {},
		tick() {},
		mouseInBounds: true,
		snapToPixelEnabled: false,
		tickOnUpdate: true,
		autoClear: true,
		nextStage: null,
	});
	s.listen = function () {
		const stage = s.stage;
		const fire = (o: any, type: string, bubbles: boolean, e: any, related: unknown = null) => {
			if (!o) return;
			const [x, y] = L.stagePoint(e.clientX, e.clientY);
			const ev = Object.assign(new CEvent(type, bubbles), {
				stageX: x,
				stageY: y,
				rawX: x,
				rawY: y,
				nativeEvent: e,
				pointerID: -1,
				primary: true,
				relatedTarget: related,
				localX: 0,
				localY: 0,
			});
			if (o !== stage) {
				const p = o.globalToLocal(x, y);
				ev.localX = p.x;
				ev.localY = p.y;
			}
			o.dispatchEvent(ev);
		};
		const chain = (o: any) => {
			const out: any[] = [];
			for (let x = o; x && x !== stage; x = x.parent) out.unshift(x);
			return out;
		};
		const at = (e: any) => (svg.contains(e.target as Node) ? s.targetOf(e.target) : null);
		const same = (a: any, b: any) => a === b || (a instanceof Shape && b instanceof Shape && a._parent === b._parent && !b._node.isConnected);
		let press: any = null;
		let list: any[] = [];
		const on = (t: string, fn: (e: any) => void) => svg.addEventListener(t, (e: Event) => s.safely(() => fn(e)), true);
		on("pointerdown", (e) => {
			s.client = [e.clientX, e.clientY];
			fire(stage, "stagemousedown", false, e);
			press = at(e);
			fire(press, "mousedown", true, e);
		});
		const up = (e: PointerEvent) =>
			s.safely(() => {
				s.client = [e.clientX, e.clientY];
				fire(stage, "stagemouseup", false, e);
				const was = press;
				press = null;
				if (!was) return;
				const t = at(e);
				if (t && same(t, was)) fire(was, "click", true, e);
				fire(was, "pressup", true, e);
			});
		window.addEventListener("pointerup", up);
		on("dblclick", (e) => fire(at(e), "dblclick", true, e));
		window.addEventListener("pointermove", (e) =>
			s.safely(() => {
				s.client = [e.clientX, e.clientY];
				fire(stage, "stagemousemove", false, e);
				if (press) fire(press, "pressmove", true, e);
				if (!overs) return;
				let t = at(e);
				const old = list;
				// (a drawing that goes on over a keyframe is still the same one)
				if (t && old[old.length - 1] && same(t, old[old.length - 1])) t = old[old.length - 1];
				const now = chain(t);
				const oldT = old[old.length - 1];
				let common = -1;
				for (let i = 0; i < now.length; i++) {
					if (now[i] !== old[i]) break;
					common = i;
				}
				svg.style.cursor = now.map((o) => o.cursor).filter(Boolean).pop() ?? "";
				list = now;
				if (oldT !== t) fire(oldT, "mouseout", true, e, t);
				for (let i = old.length - 1; i > common; i--) fire(old[i], "rollout", false, e, t);
				for (let i = now.length - 1; i > common; i--) fire(now[i], "rollover", false, e, oldT);
				if (oldT !== t) fire(t, "mouseover", true, e, oldT);
			}),
		);
	};

	// (with their getters and setters: Object.assign would copy what they return at this moment)
	const mix = <T extends object, U extends object>(to: T, from: U): T & U => Object.defineProperties(to, Object.getOwnPropertyDescriptors(from)) as T & U;
	const Ticker = mix(new Dispatcher(), {
		get framerate() {
			return s.rate;
		},
		set framerate(v: number) {
			s.stage.frameRate = v;
		},
		get interval() {
			return 1000 / s.rate;
		},
		set interval(v: number) {
			s.stage.frameRate = 1000 / v;
		},
		paused: false,
		timingMode: null,
		maxDelta: 0,
		getTicks: () => s.ticks,
		getTime: () => performance.now(),
		getMeasuredFPS: () => s.rate,
		// (the names before CreateJS 1.0)
		getFPS: () => s.rate,
		setFPS: (v: number) => void (s.stage.frameRate = v),
		getInterval: () => 1000 / s.rate,
		setInterval: (v: number) => void (s.stage.frameRate = 1000 / v),
		getMeasuredTickTime: () => 0,
		getEventTime: () => performance.now(),
		init() {},
		reset() {},
		RAF: "raf",
		TIMEOUT: "timeout",
		RAF_SYNCHED: "synched",
	});
	s.ticker = Ticker;

	const instance = (e: { paused?: boolean }, c: any) =>
		mix(e, {
			stop: () => c.stop(),
			get position() {
				return c.position;
			},
			get duration() {
				return 0;
			},
			get volume() {
				return c.soundTransform.volume;
			},
			set volume(v: number) {
				const t = c.soundTransform;
				t.volume = v;
				c.soundTransform = t;
			},
		});
	const Sound = {
		play(id: string, opts: any = {}) {
			const loop = typeof opts === "object" ? (opts?.loop ?? 0) : 0;
			const C = s.classOf(id) as (new () => { play: (a: number, b: number) => unknown }) | undefined;
			const c = C ? new C().play(typeof opts === "object" ? (opts?.offset ?? 0) : 0, loop < 0 ? 99999 : loop) : null;
			return instance({ paused: false }, c ?? { stop() {}, position: 0, soundTransform: { volume: 1 } });
		},
		stop: () => s.player.mixer?.stopAll(),
		registerSound() {},
		registerSounds() {},
		removeSound() {},
		removeAllSounds() {},
		setVolume: (v: number) => {
			const out = (s.player.mixer as any)?.out;
			if (out) out.gain.value = v;
		},
		INTERRUPT_ANY: "any",
		INTERRUPT_EARLY: "early",
		INTERRUPT_LATE: "late",
		INTERRUPT_NONE: "none",
	};

	const createjs = {
		Shape: CShape,
		Graphics: CGraphics,
		Text: CText,
		Bitmap: CBitmap,
		Tween: CTween,
		Ease,
		Ticker,
		Sound,
		MovieClip: CMovieClip,
		Container: CContainer,
		DisplayObject,
		Event: CEvent,
		EventDispatcher: Dispatcher,
		Matrix2D: FMatrix,
		Point: FPoint,
		Rectangle: FRectangle,
		Touch: { enable: () => false, isSupported: () => false, disable() {} },
		Shadow: class {
			color: string;
			offsetX: number;
			offsetY: number;
			blur: number;
			constructor(color = "black", x = 0, y = 0, blur = 0) {
				this.color = color;
				this.offsetX = x;
				this.offsetY = y;
				this.blur = blur;
			}
		},
		extend: (sub: any, sup: any) => (sub.prototype = Object.create(sup.prototype, { constructor: { value: sub } })),
		promote: (c: unknown) => c,
	};
	return {
		createjs,
		canvas,
		lib: new Proxy(
			{ properties: { fps: s.P.fps, width: s.P.w, height: s.P.h, color: s.P.bg ?? "#FFFFFF", opacity: 1, manifest: [], preloads: [] }, ssMetadata: [] } as Record<string, unknown>,
			{ get: (t, k) => (k in t ? t[String(k)] : s.classOf(String(k))) },
		),
		playSound: (id: string, loop = 0, offset = 0) => Sound.play(id, { loop, offset }),
	};
}
