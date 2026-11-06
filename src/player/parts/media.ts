/**
 * Part of the Flash API for scripts that use it: pixels, sounds, loading, video, tweens, bytes. It
 * comes with a document only if its scripts name any of this (src/core/emit/scripts.ts).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function media(L: any): Record<string, unknown> {
	const { Dispatcher, DisplayObject, DisplayObjectContainer, FEvent, FLoaderInfo, FRectangle, FPoint, FSoundTransform, URLVariables, fail, ArgumentError, EOFError, svgEl, htmlEl, scripts: current } = L;
	type URLRequest = any;
	type FEvent = any;
	type DisplayObject = any;
	type FSoundTransform = any;
	type FRectangle = any;
	type FPoint = any;
	type FColorTransform = any;
	type Box = { l: number; t: number; r: number; b: number };

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
const EASINGS: Record<string, unknown> = {
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


/** Big-endian by default, as in Flash; indexable as an array of bytes. */
class FByteArray extends Array<number> {
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
		const c = htmlEl("canvas") as HTMLCanvasElement;
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
		const c = htmlEl("canvas") as HTMLCanvasElement;
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
	_cls = "Bitmap";
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
	_self(): Box | null {
		return this._bd ? { l: 0, t: 0, r: this._bd.width, b: this._bd.height } : null;
	}
	_covers(x: number, y: number) {
		const b = this._boxIn(this._world(), false);
		return !!b && x >= b.l && x <= b.r && y >= b.t && y <= b.b;
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
	constructor(type: string) {
		super(type);
	}
	static IO_ERROR = "ioError";
	text = "";
	errorID = 0;
}

class FProgressEvent extends FEvent {
	constructor(type: string) {
		super(type);
	}
	static PROGRESS = "progress";
	static SOCKET_DATA = "socketData";
	bytesLoaded = 0;
	bytesTotal = 0;
}

class FNetStatusEvent extends FEvent {
	constructor(type: string) {
		super(type);
	}
	static NET_STATUS = "netStatus";
	info: unknown = null;
}

class FHTTPStatusEvent extends FEvent {
	constructor(type: string) {
		super(type);
	}
	static HTTP_STATUS = "httpStatus";
	status = 0;
}

function ioError(type: string, id: number, text: string) {
	const e = new FIOErrorEvent(type);
	e.errorID = id;
	e.text = `Error #${id}: ${text}`;
	return e;
}


const MIME: Record<string, string> = { png: "image/png", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp" };

class FLoader extends DisplayObjectContainer {
	_cls = "Loader";
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
				init.headers = { "content-type": req.contentType ?? "application/x-www-form-urlencoded", ...Object.fromEntries(req.requestHeaders.map((h: { name: string; value: string }) => [h.name, h.value])) };
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
	_el = htmlEl("video") as HTMLVideoElement;
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
	_cls = "Video";
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
	_self(): Box {
		return { l: 0, t: 0, r: this.w, b: this.h };
	}
}

class FTweenEvent extends FEvent {
	constructor(type: string) {
		super(type);
	}
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


	return {
		Bitmap,
		BitmapData: FBitmapData,
		ByteArray: FByteArray,
		Sound: FSound,
		SoundChannel: FSoundChannel,
		SoundMixer: soundMixer,
		Video,
		URLLoader,
		NetConnection,
		NetStream,
		SharedObject: sharedObject,
		Tween: FTween,
		TweenEvent: FTweenEvent,
		...EASINGS,
		Loader: FLoader,
		ProLoader: FLoader,
		ProgressEvent: FProgressEvent,
		IOErrorEvent: FIOErrorEvent,
		HTTPStatusEvent: FHTTPStatusEvent,
		NetStatusEvent: FNetStatusEvent,
	};
}
