/**
 * The SVG of a display object painted on a canvas at once, for BitmapData.draw(): a browser draws
 * SVG when it likes and can't hand back what it drew in the middle of a script, so the parts of
 * SVG this exporter writes are painted here: groups, <use>, paths and basic shapes, solid and
 * gradient fills and strokes, pictures already decoded, text, clip paths and masks (as clips),
 * colour matrices (colour effects). Blurs, shadows and other filters aren't painted.
 */

const NS = "http://www.w3.org/2000/svg";

/** What a node passes down to its children (SVG's inherited properties). */
interface Look {
	fill: string;
	stroke: string;
	strokeWidth: number;
	fillOpacity: number;
	strokeOpacity: number;
	alpha: number;
	fillRule: CanvasFillRule;
	cap: CanvasLineCap;
	join: CanvasLineJoin;
	miter: number;
	font: { family: string; size: number; weight: string; style: string };
	anchor: string;
	letterSpacing: number;
}

const START: Look = { fill: "#000", stroke: "none", strokeWidth: 1, fillOpacity: 1, strokeOpacity: 1, alpha: 1, fillRule: "nonzero", cap: "butt", join: "miter", miter: 4, font: { family: "sans-serif", size: 16, weight: "normal", style: "normal" }, anchor: "start", letterSpacing: 0 };

/** Pictures decoded so far, by their address (a picture not decoded yet isn't painted). */
const pictures = new Map<string, HTMLImageElement>();
function picture(href: string): HTMLImageElement | null {
	let img = pictures.get(href);
	if (!img) {
		img = new Image();
		img.src = href;
		pictures.set(href, img);
	}
	return img.complete && img.naturalWidth ? img : null;
}

const num = (v: string | null, d: number) => (v === null || v === "" ? d : parseFloat(v));
/** An attribute or the same property in the style attribute. */
function prop(e: Element, name: string): string | null {
	const st = (e as SVGElement).style?.getPropertyValue?.(name);
	if (st) return st.trim();
	return e.getAttribute(name);
}
const refId = (v: string | null) => /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(v ?? "")?.[1] ?? null;

function inherit(e: Element, up: Look): Look {
	const l: Look = { ...up, font: { ...up.font } };
	const v = (n: string) => prop(e, n);
	const fill = v("fill"),
		stroke = v("stroke");
	if (fill !== null) l.fill = fill;
	if (stroke !== null) l.stroke = stroke;
	if (v("stroke-width") !== null) l.strokeWidth = num(v("stroke-width"), 1);
	if (v("fill-opacity") !== null) l.fillOpacity = num(v("fill-opacity"), 1);
	if (v("stroke-opacity") !== null) l.strokeOpacity = num(v("stroke-opacity"), 1);
	if (v("fill-rule") !== null) l.fillRule = v("fill-rule") === "evenodd" ? "evenodd" : "nonzero";
	if (v("stroke-linecap") !== null) l.cap = v("stroke-linecap") as CanvasLineCap;
	if (v("stroke-linejoin") !== null) l.join = (v("stroke-linejoin") === "miter-clip" || v("stroke-linejoin") === "arcs" ? "miter" : v("stroke-linejoin")) as CanvasLineJoin;
	if (v("stroke-miterlimit") !== null) l.miter = num(v("stroke-miterlimit"), 4);
	if (v("font-family") !== null) l.font.family = v("font-family")!;
	if (v("font-size") !== null) l.font.size = num(v("font-size"), 16);
	if (v("font-weight") !== null) l.font.weight = v("font-weight")!;
	if (v("font-style") !== null) l.font.style = v("font-style")!;
	if (v("text-anchor") !== null) l.anchor = v("text-anchor")!;
	if (v("letter-spacing") !== null) l.letterSpacing = num(v("letter-spacing"), 0);
	return l;
}

/** A node's own transform. */
function matrixOf(e: Element): DOMMatrix | null {
	const list = (e as SVGGraphicsElement).transform?.baseVal;
	const m = list && list.numberOfItems ? list.consolidate()!.matrix : null;
	return m ? new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]) : null;
}

/** The outline of a shape element. */
function outline(e: Element): Path2D | null {
	const a = (n: string) => num(e.getAttribute(n), 0);
	switch (e.localName) {
		case "path":
			return new Path2D(e.getAttribute("d") ?? "");
		case "rect": {
			const p = new Path2D();
			const rx = a("rx") || a("ry"),
				ry = a("ry") || a("rx");
			if (rx || ry) p.roundRect(a("x"), a("y"), a("width"), a("height"), [Math.min(rx, ry)]);
			else p.rect(a("x"), a("y"), a("width"), a("height"));
			return p;
		}
		case "circle":
		case "ellipse": {
			const p = new Path2D();
			const r = a("r");
			p.ellipse(a("cx"), a("cy"), r || a("rx"), r || a("ry"), 0, 0, Math.PI * 2);
			return p;
		}
		case "line": {
			const p = new Path2D();
			p.moveTo(a("x1"), a("y1"));
			p.lineTo(a("x2"), a("y2"));
			return p;
		}
		case "polygon":
		case "polyline": {
			const n = (e.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
			const p = new Path2D();
			for (let i = 0; i + 1 < n.length; i += 2) (i ? p.lineTo : p.moveTo).call(p, n[i]!, n[i + 1]!);
			if (e.localName === "polygon") p.closePath();
			return p;
		}
	}
	return null;
}

/** A colour of SVG with its opacity, as canvas takes it. */
function rgba(c: string, a: number): string {
	if (a >= 1) return c;
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
	if (!m) return c;
	const h = m[1]!.length === 3 ? [...m[1]!].map((x) => x + x).join("") : m[1]!;
	return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/**
 * What the player knows of a node better than its attributes say (a timeline instance's matrix and
 * alpha now, before the frame is drawn): `m` its matrix (null: none of its own), `a` its alpha.
 */
export type NodeInfo = (e: Element) => { m?: number[] | null; a?: number } | null;

export class Painter {
	private root: ParentNode;
	private info: NodeInfo | null;
	constructor(root: ParentNode, info: NodeInfo | null = null) {
		this.root = root;
		this.info = info;
	}
	private byId(id: string): Element | null {
		return (this.root as Element).querySelector?.(`#${CSS.escape(id)}`) ?? document.getElementById(id);
	}

	/** Paints the children of `node` (not its own transform, colour or blend: draw() leaves those out). */
	paintInside(x: CanvasRenderingContext2D, node: Element) {
		const look = inherit(node, START);
		for (const k of node.children) this.paint(x, k, look);
	}

	paint(x: CanvasRenderingContext2D, e: Element, up: Look) {
		if (e.namespaceURI !== NS) return;
		const name = e.localName;
		if (name === "defs" || name === "mask" || name === "clipPath" || name === "filter" || name === "style" || name === "title" || name === "desc" || name === "foreignObject" || /Gradient$|^pattern$|^symbol$|^marker$/.test(name)) return;
		if (prop(e, "display") === "none" || prop(e, "visibility") === "hidden") return;
		const look = inherit(e, up);
		const known = this.info?.(e) ?? null;
		const op = known?.a ?? num(prop(e, "opacity"), 1);
		look.alpha = up.alpha * op;
		if (look.alpha <= 0) return;
		x.save();
		const m = known && "m" in known ? (known.m ? new DOMMatrix(known.m) : null) : matrixOf(e);
		if (m) x.transform(m.a, m.b, m.c, m.d, m.e, m.f);
		if (name === "use") {
			const ux = num(e.getAttribute("x"), 0),
				uy = num(e.getAttribute("y"), 0);
			if (ux || uy) x.translate(ux, uy);
		}
		this.clips(x, e);
		const matrix = this.colorMatrix(e);
		if (matrix) this.filtered(x, e, look, matrix);
		else this.own(x, e, look);
		x.restore();
	}

	/** What the element itself is: a group's children, a shape, a picture, text. */
	private own(x: CanvasRenderingContext2D, e: Element, look: Look) {
		switch (e.localName) {
			case "g":
			case "svg":
			case "a":
			case "switch":
				for (const k of e.children) this.paint(x, k, look);
				return;
			case "use": {
				const id = (e.getAttribute("href") ?? e.getAttribute("xlink:href") ?? "").slice(1);
				const to = id ? this.byId(id) : null;
				if (!to) return;
				// (a symbol is its children; anything else is painted as itself, its own transform too)
				if (to.localName === "symbol") for (const k of to.children) this.paint(x, k, inherit(to, look));
				else this.paint(x, to, look);
				return;
			}
			case "image": {
				const href = e.getAttribute("href") ?? e.getAttribute("xlink:href");
				const img = href ? picture(href) : null;
				if (!img) return;
				x.globalAlpha = look.alpha;
				const w = num(e.getAttribute("width"), img.naturalWidth),
					h = num(e.getAttribute("height"), img.naturalHeight);
				x.imageSmoothingEnabled = prop(e, "image-rendering") !== "pixelated" && prop(e, "image-rendering") !== "optimizeSpeed";
				x.drawImage(img, num(e.getAttribute("x"), 0), num(e.getAttribute("y"), 0), w, h);
				return;
			}
			case "text":
				this.text(x, e, look, { x: 0, y: 0 });
				return;
		}
		const p = outline(e);
		if (!p) return;
		this.fill(x, p, look, e);
		this.stroke(x, p, look);
	}

	private fill(x: CanvasRenderingContext2D, p: Path2D, l: Look, e: Element) {
		if (!l.fill || l.fill === "none") return;
		const a = l.alpha * l.fillOpacity;
		const g = refId(l.fill);
		if (g) return this.gradient(x, p, g, a, l.fillRule, e);
		x.globalAlpha = 1;
		x.fillStyle = rgba(l.fill === "currentColor" ? "#000" : l.fill, a);
		x.fill(p, l.fillRule);
	}

	private stroke(x: CanvasRenderingContext2D, p: Path2D, l: Look) {
		if (!l.stroke || l.stroke === "none" || l.strokeWidth <= 0) return;
		const g = refId(l.stroke);
		let c = l.stroke;
		if (g) c = this.byId(g)?.querySelector("stop")?.getAttribute("stop-color") ?? "#000";
		x.globalAlpha = 1;
		x.strokeStyle = rgba(c, l.alpha * l.strokeOpacity);
		x.lineWidth = l.strokeWidth;
		x.lineCap = l.cap;
		x.lineJoin = l.join;
		x.miterLimit = l.miter;
		x.stroke(p);
	}

	/** A gradient fill: the shape clips, the gradient fills its own space (SVG's gradientTransform). */
	private gradient(x: CanvasRenderingContext2D, p: Path2D, id: string, alpha: number, rule: CanvasFillRule, e: Element) {
		let g = this.byId(id);
		if (!g) return;
		// (stops may come from a gradient it refers to)
		let stopsAt: Element = g;
		for (let k = 0; k < 8 && !stopsAt.querySelector("stop"); k++) {
			const r = (stopsAt.getAttribute("href") ?? stopsAt.getAttribute("xlink:href") ?? "").slice(1);
			const t = r ? this.byId(r) : null;
			if (!t) break;
			stopsAt = t;
		}
		const at = (n: string, d: number) => num(g!.getAttribute(n), d);
		x.save();
		x.clip(p, rule);
		const tm = matrixOf(g);
		if (g.getAttribute("gradientUnits") !== "userSpaceOnUse") {
			const b = (e as SVGGraphicsElement).getBBox?.() ?? { x: 0, y: 0, width: 1, height: 1 };
			x.transform(b.width, 0, 0, b.height, b.x, b.y);
		}
		if (tm) x.transform(tm.a, tm.b, tm.c, tm.d, tm.e, tm.f);
		const linear = g.localName === "linearGradient";
		const cg = linear ? x.createLinearGradient(at("x1", 0), at("y1", 0), at("x2", 1), at("y2", 0)) : x.createRadialGradient(at("fx", at("cx", 0.5)), at("fy", at("cy", 0.5)), 0, at("cx", 0.5), at("cy", 0.5), at("r", 0.5));
		for (const s of stopsAt.querySelectorAll("stop")) {
			const o = s.getAttribute("offset") ?? "0";
			const off = Math.max(0, Math.min(1, o.endsWith("%") ? parseFloat(o) / 100 : parseFloat(o)));
			cg.addColorStop(off, rgba(prop(s, "stop-color") ?? "#000", num(prop(s, "stop-opacity"), 1)));
		}
		x.globalAlpha = alpha;
		x.fillStyle = cg;
		x.fillRect(-1e6, -1e6, 2e6, 2e6);
		x.restore();
	}

	/** clip-path and mask (a mask clips to its shapes: its softness isn't painted). */
	private clips(x: CanvasRenderingContext2D, e: Element) {
		for (const attr of ["clip-path", "mask"]) {
			const id = refId(prop(e, attr));
			const c = id ? this.byId(id) : null;
			if (!c) continue;
			const path = new Path2D();
			const add = (n: Element, m: DOMMatrix) => {
				const own = matrixOf(n);
				const at = own ? m.multiply(own) : m;
				if (n.localName === "use") {
					const r = this.byId((n.getAttribute("href") ?? n.getAttribute("xlink:href") ?? "").slice(1));
					if (r) add(r, at.translate(num(n.getAttribute("x"), 0), num(n.getAttribute("y"), 0)));
					return;
				}
				const o = outline(n);
				if (o) path.addPath(o, at);
				for (const k of n.children) add(k, at);
			};
			for (const k of c.children) add(k, new DOMMatrix());
			x.clip(path);
		}
	}

	/** A filter that is one colour matrix (a colour effect), or null. */
	private colorMatrix(e: Element): number[] | null {
		const id = refId(prop(e, "filter"));
		const f = id ? this.byId(id) : null;
		if (!f) return null;
		const prims = [...f.children].filter((k) => k.localName.startsWith("fe"));
		if (prims.length !== 1 || prims[0]!.localName !== "feColorMatrix") return null;
		const p = prims[0]!;
		const type = p.getAttribute("type") ?? "matrix";
		if (type !== "matrix") return null;
		const v = (p.getAttribute("values") ?? "").trim().split(/[\s,]+/).map(Number);
		return v.length === 20 ? v : null;
	}

	/** Paints a part with a colour matrix: on a canvas of its own, then the matrix on its pixels. */
	private filtered(x: CanvasRenderingContext2D, e: Element, look: Look, mx: number[]) {
		const c = x.canvas;
		const layer = document.createElement("canvas");
		layer.width = c.width;
		layer.height = c.height;
		const y = layer.getContext("2d")!;
		y.setTransform(x.getTransform());
		this.own(y, e, look);
		const img = y.getImageData(0, 0, layer.width, layer.height);
		const d = img.data;
		for (let i = 0; i < d.length; i += 4) {
			const a = d[i + 3]!;
			if (!a) continue;
			const r = d[i]! / 255,
				g = d[i + 1]! / 255,
				b = d[i + 2]! / 255,
				al = a / 255;
			for (let k = 0; k < 4; k++) d[i + k] = Math.max(0, Math.min(255, Math.round((mx[k * 5]! * r + mx[k * 5 + 1]! * g + mx[k * 5 + 2]! * b + mx[k * 5 + 3]! * al + mx[k * 5 + 4]!) * 255)));
		}
		y.putImageData(img, 0, 0);
		x.save();
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.drawImage(layer, 0, 0);
		x.restore();
	}

	/** Text: each tspan where it says, in its font. */
	private text(x: CanvasRenderingContext2D, e: Element, look: Look, at: { x: number; y: number }) {
		const px = e.getAttribute("x"),
			py = e.getAttribute("y");
		if (px !== null) at.x = parseFloat(px);
		if (py !== null) at.y = parseFloat(py);
		for (const n of e.childNodes) {
			if (n.nodeType === 3) {
				const s = n.textContent ?? "";
				if (!s || !look.fill || look.fill === "none") continue;
				const f = look.font;
				x.font = `${f.style} ${f.weight} ${f.size}px ${f.family}`;
				x.textAlign = look.anchor === "middle" ? "center" : look.anchor === "end" ? "right" : "left";
				(x as unknown as { letterSpacing: string }).letterSpacing = `${look.letterSpacing}px`;
				x.globalAlpha = 1;
				x.fillStyle = rgba(look.fill, look.alpha * look.fillOpacity);
				x.fillText(s, at.x, at.y);
				at.x += x.measureText(s).width;
			} else if (n.nodeType === 1 && (n as Element).localName === "tspan") this.text(x, n as Element, inherit(n as Element, look), at);
		}
	}
}
