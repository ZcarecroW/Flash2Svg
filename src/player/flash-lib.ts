/**
 * The parts of the Flash API that don't touch the player: geometry, bytes, formats, filters as data,
 * errors, easing. Only in the runtime of programs with scripts. Numbers, rounding and messages are
 * Flash Player's own, measured with its debug version (scripts/e2e-as3.ts).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Mat = [number, number, number, number, number, number];

/** p after q: a point goes through q, then through p. */
export const mul = (p: Mat, q: Mat): Mat => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];

export function inverse(m: Mat): Mat {
	const d = m[0] * m[3] - m[1] * m[2];
	if (!d) return [0, 0, 0, 0, -m[4], -m[5]];
	return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}

/** Flash keeps positions in twips, a twentieth of a pixel. */
export const twips = (v: number) => Math.round(v * 20) / 20;
/** What setting a position keeps of it. */
export const toTwips = (v: number) => Math.trunc(v * 20) / 20;

/** A failure as Flash Player words it. */
export function fail(C: new (m: string) => Error, id: number, text: string): Error {
	const e = new C(`Error #${id}: ${text}`) as Error & { errorID: number };
	e.errorID = id;
	return e;
}

export class ArgumentError extends Error {
	override name = "ArgumentError";
}
export class IOError extends Error {
	override name = "IOError";
}
export class SecurityError extends Error {
	override name = "SecurityError";
}
export class EOFError extends Error {
	override name = "EOFError";
}
export class IllegalOperationError extends Error {
	override name = "IllegalOperationError";
}
export class DefinitionError extends Error {
	override name = "DefinitionError";
}

/** A JavaScript error of compiled code, as the AS3 error it stands for. */
export function asFlashError(e: any): unknown {
	if (!(e instanceof Error) || (e as any).errorID) return e;
	const m = e.message;
	if (e instanceof TypeError) {
		if (/null/.test(m)) return fail(TypeError, 1009, "Cannot access a property or method of a null object reference.");
		if (/undefined/.test(m)) return fail(TypeError, 1010, "A term is undefined and has no properties.");
		if (/not a function/.test(m)) return fail(TypeError, 1006, "value is not a function.");
	} else if (e instanceof ReferenceError) {
		return fail(ReferenceError, 1065, `Variable ${m.split(" ")[0]} is not defined.`);
	} else if (e instanceof RangeError && /call stack/.test(m)) {
		return fail(RangeError, 1023, "Stack overflow occurred.");
	}
	return e;
}

export class FPoint {
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
	copyFrom(o: FPoint) {
		this.x = o.x;
		this.y = o.y;
	}
	setTo(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
	equals(o: FPoint) {
		return this.x === o.x && this.y === o.y;
	}
	normalize(n: number) {
		const l = this.length;
		if (!l) return;
		this.x *= n / l;
		this.y *= n / l;
	}
	offset(x: number, y: number) {
		this.x += x;
		this.y += y;
	}
	toString() {
		return `(x=${this.x}, y=${this.y})`;
	}
}

export class FRectangle {
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
	set left(v: number) {
		this.width += this.x - v;
		this.x = v;
	}
	get top() {
		return this.y;
	}
	set top(v: number) {
		this.height += this.y - v;
		this.y = v;
	}
	get right() {
		return this.x + this.width;
	}
	set right(v: number) {
		this.width = v - this.x;
	}
	get bottom() {
		return this.y + this.height;
	}
	set bottom(v: number) {
		this.height = v - this.y;
	}
	get topLeft() {
		return new FPoint(this.x, this.y);
	}
	set topLeft(p: FPoint) {
		this.left = p.x;
		this.top = p.y;
	}
	get bottomRight() {
		return new FPoint(this.right, this.bottom);
	}
	set bottomRight(p: FPoint) {
		this.right = p.x;
		this.bottom = p.y;
	}
	get size() {
		return new FPoint(this.width, this.height);
	}
	set size(p: FPoint) {
		this.width = p.x;
		this.height = p.y;
	}
	contains(x: number, y: number) {
		return x >= this.x && x < this.right && y >= this.y && y < this.bottom;
	}
	containsPoint(p: FPoint) {
		return this.contains(p.x, p.y);
	}
	containsRect(o: FRectangle) {
		return !o.isEmpty() && o.x >= this.x && o.y >= this.y && o.right <= this.right && o.bottom <= this.bottom;
	}
	intersects(o: FRectangle) {
		return !this.isEmpty() && !o.isEmpty() && this.x < o.right && o.x < this.right && this.y < o.bottom && o.y < this.bottom;
	}
	intersection(o: FRectangle) {
		if (!this.intersects(o)) return new FRectangle();
		const x = Math.max(this.x, o.x),
			y = Math.max(this.y, o.y);
		return new FRectangle(x, y, Math.min(this.right, o.right) - x, Math.min(this.bottom, o.bottom) - y);
	}
	union(o: FRectangle) {
		if (this.isEmpty()) return o.clone();
		if (o.isEmpty()) return this.clone();
		const x = Math.min(this.x, o.x),
			y = Math.min(this.y, o.y);
		return new FRectangle(x, y, Math.max(this.right, o.right) - x, Math.max(this.bottom, o.bottom) - y);
	}
	inflate(dx: number, dy: number) {
		this.x -= dx;
		this.y -= dy;
		this.width += 2 * dx;
		this.height += 2 * dy;
	}
	inflatePoint(p: FPoint) {
		this.inflate(p.x, p.y);
	}
	offset(dx: number, dy: number) {
		this.x += dx;
		this.y += dy;
	}
	offsetPoint(p: FPoint) {
		this.offset(p.x, p.y);
	}
	isEmpty() {
		return this.width <= 0 || this.height <= 0;
	}
	setEmpty() {
		this.x = this.y = this.width = this.height = 0;
	}
	setTo(x: number, y: number, w: number, h: number) {
		this.x = x;
		this.y = y;
		this.width = w;
		this.height = h;
	}
	copyFrom(o: FRectangle) {
		this.setTo(o.x, o.y, o.width, o.height);
	}
	equals(o: FRectangle) {
		return this.x === o.x && this.y === o.y && this.width === o.width && this.height === o.height;
	}
	clone() {
		return new FRectangle(this.x, this.y, this.width, this.height);
	}
	toString() {
		return `(x=${this.x}, y=${this.y}, w=${this.width}, h=${this.height})`;
	}
}

export class FMatrix {
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
	_m(): Mat {
		return [this.a, this.b, this.c, this.d, this.tx, this.ty];
	}
	_set(m: Mat) {
		[this.a, this.b, this.c, this.d, this.tx, this.ty] = m;
		return this;
	}
	identity() {
		this._set([1, 0, 0, 1, 0, 0]);
	}
	clone() {
		return new FMatrix(...this._m());
	}
	concat(o: FMatrix) {
		this._set(mul(o._m(), this._m()));
	}
	invert() {
		this._set(inverse(this._m()));
	}
	translate(x: number, y: number) {
		this.tx += x;
		this.ty += y;
	}
	rotate(r: number) {
		const c = Math.cos(r),
			s = Math.sin(r);
		this._set(mul([c, s, -s, c, 0, 0], this._m()));
	}
	scale(x: number, y: number) {
		this._set(mul([x, 0, 0, y, 0, 0], this._m()));
	}
	createBox(sx: number, sy: number, r = 0, tx = 0, ty = 0) {
		const c = Math.cos(r),
			s = Math.sin(r);
		this._set([sx * c, sy * s, -sx * s, sy * c, tx, ty]);
	}
	createGradientBox(w: number, h: number, r = 0, tx = 0, ty = 0) {
		this.createBox(w / 1638.4, h / 1638.4, r, tx + w / 2, ty + h / 2);
	}
	transformPoint(p: FPoint) {
		return new FPoint(this.a * p.x + this.c * p.y + this.tx, this.b * p.x + this.d * p.y + this.ty);
	}
	deltaTransformPoint(p: FPoint) {
		return new FPoint(this.a * p.x + this.c * p.y, this.b * p.x + this.d * p.y);
	}
	toString() {
		return `(a=${this.a}, b=${this.b}, c=${this.c}, d=${this.d}, tx=${this.tx}, ty=${this.ty})`;
	}
}

export class FColorTransform {
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
	concat(o: FColorTransform) {
		this.redOffset += this.redMultiplier * o.redOffset;
		this.greenOffset += this.greenMultiplier * o.greenOffset;
		this.blueOffset += this.blueMultiplier * o.blueOffset;
		this.alphaOffset += this.alphaMultiplier * o.alphaOffset;
		this.redMultiplier *= o.redMultiplier;
		this.greenMultiplier *= o.greenMultiplier;
		this.blueMultiplier *= o.blueMultiplier;
		this.alphaMultiplier *= o.alphaMultiplier;
	}
	_copy() {
		return new FColorTransform(this.redMultiplier, this.greenMultiplier, this.blueMultiplier, this.alphaMultiplier, this.redOffset, this.greenOffset, this.blueOffset, this.alphaOffset);
	}
	/** Whether it leaves the colours alone (alpha goes by itself). */
	_plain() {
		return this.redMultiplier === 1 && this.greenMultiplier === 1 && this.blueMultiplier === 1 && !this.redOffset && !this.greenOffset && !this.blueOffset && !this.alphaOffset;
	}
	/** As feColorMatrix values (alpha multiplies by itself, on the object's opacity). */
	_values() {
		return [this.redMultiplier, 0, 0, 0, this.redOffset / 255, 0, this.greenMultiplier, 0, 0, this.greenOffset / 255, 0, 0, this.blueMultiplier, 0, this.blueOffset / 255, 0, 0, 0, 1, this.alphaOffset / 255].join(" ");
	}
	toString() {
		return `(redMultiplier=${this.redMultiplier}, greenMultiplier=${this.greenMultiplier}, blueMultiplier=${this.blueMultiplier}, alphaMultiplier=${this.alphaMultiplier}, redOffset=${this.redOffset}, greenOffset=${this.greenOffset}, blueOffset=${this.blueOffset}, alphaOffset=${this.alphaOffset})`;
	}
}

export class FTextFormat {
	font: string | null;
	size: number | null;
	color: number | null;
	bold: boolean | null;
	italic: boolean | null;
	underline: boolean | null;
	url: string | null;
	target: string | null;
	align: string | null;
	leftMargin: number | null;
	rightMargin: number | null;
	indent: number | null;
	leading: number | null;
	letterSpacing: number | null = null;
	blockIndent: number | null = null;
	kerning: boolean | null = null;
	bullet: boolean | null = null;
	tabStops: number[] | null = null;
	display: string | null = "block";
	constructor(font: string | null = null, size: number | null = null, color: number | null = null, bold: boolean | null = null, italic: boolean | null = null, underline: boolean | null = null, url: string | null = null, target: string | null = null, align: string | null = null, leftMargin: number | null = null, rightMargin: number | null = null, indent: number | null = null, leading: number | null = null) {
		this.font = font;
		this.size = size;
		this.color = color;
		this.bold = bold;
		this.italic = italic;
		this.underline = underline;
		this.url = url;
		this.target = target;
		this.align = align;
		this.leftMargin = leftMargin;
		this.rightMargin = rightMargin;
		this.indent = indent;
		this.leading = leading;
	}
	_copy() {
		return Object.assign(new FTextFormat(), this);
	}
	/** This one with what `o` sets. */
	_with(o: FTextFormat) {
		const c = this._copy() as any;
		for (const k in o) if ((o as any)[k] !== null) c[k] = (o as any)[k];
		return c as FTextFormat;
	}
}

const CONVERT: Record<string, (v: any) => unknown> = { int: (v) => v | 0, uint: (v) => v >>> 0, Number: (v) => +v, Boolean: (v) => !!v, String: (v) => (v === null || v === undefined ? null : String(v)) };
const none = (t: string) => (t === "int" || t === "uint" || t === "Number" ? 0 : null);

/** Vector.<T>: an array that converts what goes in and watches its bounds. */
export class FVector extends Array<any> {
	static override get [Symbol.species]() {
		return Array;
	}
	fixed = false;
	_t = "*";
	_in(v: unknown) {
		const c = CONVERT[this._t];
		return c ? c(v) : v;
	}
	private same(list: unknown[]) {
		return makeVector(this._t, list);
	}
	private open() {
		if (this.fixed) throw fail(RangeError, 1126, "Cannot change the length of a fixed Vector.");
	}
	override push(...v: unknown[]) {
		this.open();
		return super.push(...v.map((x) => this._in(x)));
	}
	override unshift(...v: unknown[]) {
		this.open();
		return super.unshift(...v.map((x) => this._in(x)));
	}
	override pop() {
		this.open();
		return super.pop();
	}
	override shift() {
		this.open();
		return super.shift();
	}
	override splice(a: number, n?: number, ...v: unknown[]) {
		this.open();
		return this.same(super.splice(a, n as number, ...v.map((x) => this._in(x))));
	}
	override slice(a?: number, b?: number) {
		return this.same(super.slice(a, b));
	}
	override concat(...v: any[]) {
		return this.same(super.concat(...v));
	}
	override filter(f: any, t?: unknown) {
		return this.same(super.filter(f, t)) as any;
	}
	override map(f: any, t?: unknown) {
		return this.same(super.map(f, t)) as any;
	}
	override join(s = ",") {
		return Array.prototype.map.call(this, (v) => String(v)).join(s);
	}
	override toString() {
		return this.join();
	}
}

export function makeVector(t: string, a?: unknown, fixed?: boolean): FVector {
	const v = new FVector();
	v._t = t;
	if (typeof a === "number") for (let i = 0; i < a; i++) Array.prototype.push.call(v, none(t));
	else if (a) for (const x of a as unknown[]) Array.prototype.push.call(v, v._in(x));
	v.fixed = !!fixed;
	return v;
}

export function vectorGet(v: FVector, i: number) {
	if (i >= v.length || i < 0) throw fail(RangeError, 1125, `The index ${i} is out of range ${v.length}.`);
	return v[i];
}

/** v.length = n: the new places get the type's default value (0, null, false), as in Flash. */
export function vectorLength(v: FVector, n: number) {
	if (v.fixed) throw fail(RangeError, 1126, "Cannot change the length of a fixed Vector.");
	const old = v.length;
	v.length = n >>> 0;
	for (let i = old; i < v.length; i++) v[i] = none(v._t);
	return n;
}

export function vectorSet(v: FVector, i: number, x: unknown) {
	if (i > v.length || i < 0 || (i === v.length && v.fixed)) throw fail(RangeError, 1125, `The index ${i} is out of range ${v.length}.`);
	return (v[i] = v._in(x));
}

/** Name-value pairs of a URL's query. */
export class URLVariables {
	constructor(s?: string) {
		if (s) this.decode(s);
	}
	decode(s: string) {
		for (const part of s.split("&")) {
			const i = part.indexOf("=");
			if (i < 0) throw fail(Error, 2101, "The String passed to URLVariables.decode() must be a URL-encoded query string containing name/value pairs.");
			(this as any)[decodeURIComponent(part.slice(0, i).replace(/\+/g, " "))] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, " "));
		}
	}
	toString() {
		return Object.keys(this)
			.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent((this as any)[k])}`)
			.join("&");
	}
}

export class URLRequest {
	url: string;
	method = "GET";
	data: unknown = null;
	contentType: string | null = null;
	requestHeaders: { name: string; value: string }[] = [];
	constructor(u: string | null = null) {
		this.url = u as string;
	}
}

/** The packages of the Flash classes the API has, for class names and getDefinitionByName. */
export const PACKAGES: Record<string, string> = {
	"flash.display": "MovieClip Sprite Shape Bitmap BitmapData Stage Loader SimpleButton DisplayObject DisplayObjectContainer InteractiveObject Graphics LoaderInfo FrameLabel Scene",
	"flash.geom": "Point Rectangle Matrix ColorTransform Transform",
	"flash.text": "TextField TextFormat",
	"flash.events": "Event MouseEvent KeyboardEvent TimerEvent FocusEvent TextEvent ProgressEvent IOErrorEvent EventDispatcher",
	"flash.media": "Sound SoundChannel SoundTransform Video",
	"flash.net": "URLRequest URLLoader URLVariables NetConnection NetStream SharedObject",
	"flash.utils": "Timer ByteArray Dictionary",
	"flash.errors": "IOError EOFError IllegalOperationError",
	"flash.filters": "BlurFilter GlowFilter DropShadowFilter BevelFilter ColorMatrixFilter",
};
