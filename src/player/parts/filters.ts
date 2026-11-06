/**
 * Part of the Flash API for scripts that use filters: they are drawn by the same code as filters on
 * the timeline (src/core/emit/filters.ts).
 */
import { buildFilters } from "../../core/emit/filters.ts";
import type { FilterData } from "../../core/model.ts";
import type { XmlNode } from "../../core/xml.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function filters(L: any): Record<string, unknown> {
	const { svgEl, colorOf, scripts } = L;

class FFilter {
	_t = "";
	clone() {
		return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { colors: (this as any).colors?.slice(), matrix: (this as any).matrix?.slice() });
	}
}
class BlurFilter extends FFilter {
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
class GlowFilter extends FFilter {
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
class DropShadowFilter extends FFilter {
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
class BevelFilter extends FFilter {
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
class ColorMatrixFilter extends FFilter {
	override _t = "colorMatrix";
	matrix: number[];
	constructor(matrix?: number[]) {
		super();
		this.matrix = matrix ?? [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
	}
}


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


	scripts.filterPrims = (list: any[], w: number[], out: SVGElement[]) => {
		for (const f of list) {
			if (f._t === "colorMatrix") out.push(svgEl("feColorMatrix", { type: "matrix", values: f.matrix.map((x: number, i: number) => (i % 5 === 4 ? x / 255 : x)).join(" ") }));
		}
		const rest = list.filter((f) => f._t !== "colorMatrix");
		if (!rest.length) return 0;
		const built = buildFilters(rest.map(filterData), { x: Math.hypot(w[0]!, w[1]!), y: Math.hypot(w[2]!, w[3]!) }, () => {});
		out.push(...built.primitives.map(toDom));
		return Math.max(built.margin.x, built.margin.y);
	};
	return {
		BlurFilter,
		GlowFilter,
		DropShadowFilter,
		BevelFilter,
		ColorMatrixFilter,
		BitmapFilterQuality: { LOW: 1, MEDIUM: 2, HIGH: 3 },
		BitmapFilterType: { INNER: "inner", OUTER: "outer", FULL: "full" },
	};
}
