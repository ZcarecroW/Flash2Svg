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

/** Big-endian by default, as in Flash; indexable as an array of bytes. */
export class FByteArray extends Array<number> {
	position = 0;
	endian = "bigEndian";
	objectEncoding = 3;
	get bytesAvailable() {
		return this.length - this.position;
	}
	private view(n: number, write: boolean) {
		if (!write && this.position + n > this.length) throw fail(EOFError, 2030, "End of file was encountered.");
		return new DataView(new ArrayBuffer(n));
	}
	private put(v: DataView) {
		for (let i = 0; i < v.byteLength; i++) this[this.position++] = v.getUint8(i);
	}
	private take(v: DataView) {
		for (let i = 0; i < v.byteLength; i++) v.setUint8(i, this[this.position++]!);
		return v;
	}
	private get le() {
		return this.endian === "littleEndian";
	}
	writeByte(n: number) {
		this[this.position++] = n & 255;
	}
	writeBoolean(b: boolean) {
		this.writeByte(b ? 1 : 0);
	}
	writeShort(n: number) {
		const v = this.view(2, true);
		v.setInt16(0, n, this.le);
		this.put(v);
	}
	writeInt(n: number) {
		const v = this.view(4, true);
		v.setInt32(0, n, this.le);
		this.put(v);
	}
	writeUnsignedInt(n: number) {
		const v = this.view(4, true);
		v.setUint32(0, n, this.le);
		this.put(v);
	}
	writeFloat(n: number) {
		const v = this.view(4, true);
		v.setFloat32(0, n, this.le);
		this.put(v);
	}
	writeDouble(n: number) {
		const v = this.view(8, true);
		v.setFloat64(0, n, this.le);
		this.put(v);
	}
	writeUTFBytes(s: string) {
		for (const b of new TextEncoder().encode(s)) this.writeByte(b);
	}
	writeUTF(s: string) {
		const b = new TextEncoder().encode(s);
		this.writeShort(b.length);
		for (const x of b) this.writeByte(x);
	}
	writeBytes(o: FByteArray, at = 0, n = 0) {
		for (let i = at, e = n ? at + n : o.length; i < e; i++) this.writeByte(o[i]!);
	}
	readByte() {
		return this.take(this.view(1, false)).getInt8(0);
	}
	readUnsignedByte() {
		return this.take(this.view(1, false)).getUint8(0);
	}
	readBoolean() {
		return this.readUnsignedByte() !== 0;
	}
	readShort() {
		return this.take(this.view(2, false)).getInt16(0, this.le);
	}
	readUnsignedShort() {
		return this.take(this.view(2, false)).getUint16(0, this.le);
	}
	readInt() {
		return this.take(this.view(4, false)).getInt32(0, this.le);
	}
	readUnsignedInt() {
		return this.take(this.view(4, false)).getUint32(0, this.le);
	}
	readFloat() {
		return this.take(this.view(4, false)).getFloat32(0, this.le);
	}
	readDouble() {
		return this.take(this.view(8, false)).getFloat64(0, this.le);
	}
	readUTFBytes(n: number) {
		if (this.position + n > this.length) throw fail(EOFError, 2030, "End of file was encountered.");
		const s = new TextDecoder().decode(Uint8Array.from(this.slice(this.position, this.position + n)));
		this.position += n;
		return s;
	}
	readUTF() {
		return this.readUTFBytes(this.readUnsignedShort());
	}
	clear() {
		this.length = 0;
		this.position = 0;
	}
	override toString() {
		return new TextDecoder().decode(Uint8Array.from(this));
	}
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

// ---- filters: what they hold, the core's buildFilters draws them

export class FFilter {
	_t = "";
	clone() {
		return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { colors: (this as any).colors?.slice(), matrix: (this as any).matrix?.slice() });
	}
}
export class BlurFilter extends FFilter {
	override _t = "blurFilter";
	blurX: number;
	blurY: number;
	quality: number;
	constructor(blurX = 4, blurY = 4, quality = 1) {
		super();
		this.blurX = blurX;
		this.blurY = blurY;
		this.quality = quality;
	}
}
export class GlowFilter extends FFilter {
	override _t = "glowFilter";
	color: number;
	alpha: number;
	blurX: number;
	blurY: number;
	strength: number;
	quality: number;
	inner: boolean;
	knockout: boolean;
	constructor(color = 0xff0000, alpha = 1, blurX = 6, blurY = 6, strength = 2, quality = 1, inner = false, knockout = false) {
		super();
		this.color = color;
		this.alpha = alpha;
		this.blurX = blurX;
		this.blurY = blurY;
		this.strength = strength;
		this.quality = quality;
		this.inner = inner;
		this.knockout = knockout;
	}
}
export class DropShadowFilter extends FFilter {
	override _t = "dropShadowFilter";
	distance: number;
	angle: number;
	color: number;
	alpha: number;
	blurX: number;
	blurY: number;
	strength: number;
	quality: number;
	inner: boolean;
	knockout: boolean;
	hideObject: boolean;
	constructor(distance = 4, angle = 45, color = 0, alpha = 1, blurX = 4, blurY = 4, strength = 1, quality = 1, inner = false, knockout = false, hideObject = false) {
		super();
		this.distance = distance;
		this.angle = angle;
		this.color = color;
		this.alpha = alpha;
		this.blurX = blurX;
		this.blurY = blurY;
		this.strength = strength;
		this.quality = quality;
		this.inner = inner;
		this.knockout = knockout;
		this.hideObject = hideObject;
	}
}
export class BevelFilter extends FFilter {
	override _t = "bevelFilter";
	distance: number;
	angle: number;
	highlightColor: number;
	highlightAlpha: number;
	shadowColor: number;
	shadowAlpha: number;
	blurX: number;
	blurY: number;
	strength: number;
	quality: number;
	type: string;
	knockout: boolean;
	constructor(distance = 4, angle = 45, highlightColor = 0xffffff, highlightAlpha = 1, shadowColor = 0, shadowAlpha = 1, blurX = 4, blurY = 4, strength = 1, quality = 1, type = "inner", knockout = false) {
		super();
		this.distance = distance;
		this.angle = angle;
		this.highlightColor = highlightColor;
		this.highlightAlpha = highlightAlpha;
		this.shadowColor = shadowColor;
		this.shadowAlpha = shadowAlpha;
		this.blurX = blurX;
		this.blurY = blurY;
		this.strength = strength;
		this.quality = quality;
		this.type = type;
		this.knockout = knockout;
	}
}
export class ColorMatrixFilter extends FFilter {
	override _t = "colorMatrix";
	matrix: number[];
	constructor(matrix?: number[]) {
		super();
		this.matrix = matrix ?? [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
	}
}

// ---- fl.transitions: easing functions take (time, begin, change, duration)

type Ease = (t: number, b: number, c: number, d: number) => number;
const power = (n: number) => ({
	easeIn: ((t, b, c, d) => c * (t / d) ** n + b) as Ease,
	easeOut: ((t, b, c, d) => c * (1 - (1 - t / d) ** n) + b) as Ease,
	easeInOut: ((t, b, c, d) => {
		t /= d / 2;
		return t < 1 ? (c / 2) * t ** n + b : c - (c / 2) * (2 - t) ** n + b;
	}) as Ease,
});
const bounceOut: Ease = (t, b, c, d) => {
	t /= d;
	if (t < 1 / 2.75) return c * 7.5625 * t * t + b;
	if (t < 2 / 2.75) return c * (7.5625 * (t -= 1.5 / 2.75) * t + 0.75) + b;
	if (t < 2.5 / 2.75) return c * (7.5625 * (t -= 2.25 / 2.75) * t + 0.9375) + b;
	return c * (7.5625 * (t -= 2.625 / 2.75) * t + 0.984375) + b;
};
const S = 1.70158;
const elasticOut: Ease = (t, b, c, d) => {
	if (t <= 0) return b;
	if (t >= d) return b + c;
	const p = d * 0.3;
	return c * 2 ** (-10 * (t / d)) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + c + b;
};
export const EASINGS: Record<string, unknown> = {
	None: { easeNone: ((t, b, c, d) => (c * t) / d + b) as Ease, easeIn: ((t, b, c, d) => (c * t) / d + b) as Ease, easeOut: ((t, b, c, d) => (c * t) / d + b) as Ease, easeInOut: ((t, b, c, d) => (c * t) / d + b) as Ease },
	Regular: power(2),
	Strong: power(5),
	Back: {
		easeIn: ((t, b, c, d) => c * (t /= d) * t * ((S + 1) * t - S) + b) as Ease,
		easeOut: ((t, b, c, d) => c * ((t = t / d - 1) * t * ((S + 1) * t + S) + 1) + b) as Ease,
		easeInOut: ((t, b, c, d) => {
			const s = S * 1.525;
			return (t /= d / 2) < 1 ? (c / 2) * (t * t * ((s + 1) * t - s)) + b : (c / 2) * ((t -= 2) * t * ((s + 1) * t + s) + 2) + b;
		}) as Ease,
	},
	Bounce: {
		easeIn: ((t, b, c, d) => c - bounceOut(d - t, 0, c, d) + b) as Ease,
		easeOut: bounceOut,
		easeInOut: ((t, b, c, d) => (t < d / 2 ? (c - bounceOut(d - t * 2, 0, c, d)) * 0.5 + b : bounceOut(t * 2 - d, 0, c, d) * 0.5 + c * 0.5 + b)) as Ease,
	},
	Elastic: {
		easeIn: ((t, b, c, d) => b + c - elasticOut(d - t, 0, c, d)) as Ease,
		easeOut: elasticOut,
		easeInOut: ((t, b, c, d) => (t < d / 2 ? (c - elasticOut(d - t * 2, 0, c, d)) * 0.5 + b : elasticOut(t * 2 - d, 0, c, d) * 0.5 + c * 0.5 + b)) as Ease,
	},
};

/** The packages of the Flash classes the API has, for class names and getDefinitionByName. */
export const PACKAGES: Record<string, string> = {
	"flash.display": "MovieClip Sprite Shape Bitmap BitmapData Stage Loader SimpleButton DisplayObject DisplayObjectContainer InteractiveObject Graphics LoaderInfo FrameLabel Scene",
	"flash.geom": "Point Rectangle Matrix ColorTransform Transform",
	"flash.text": "TextField TextFormat",
	"flash.events": "Event MouseEvent KeyboardEvent TimerEvent FocusEvent TextEvent ProgressEvent IOErrorEvent EventDispatcher",
	"flash.media": "Sound SoundChannel SoundTransform Video",
	"flash.net": "URLRequest URLLoader URLVariables NetConnection NetStream SharedObject",
	"flash.utils": "Timer ByteArray Dictionary",
	"flash.filters": "BlurFilter GlowFilter DropShadowFilter BevelFilter ColorMatrixFilter",
};
