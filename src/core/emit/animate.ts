/**
 * Declarative animated output: SMIL (<animate>, <animateTransform>) or CSS @keyframes, from the
 * baked global timeline. Both share the structure; CSS falls back to SMIL for what CSS cannot
 * animate (filter primitive attributes).
 */
import type { Context } from "../context.ts";
import { fmt, fmtMatrix } from "../geom.ts";
import type { Mat } from "../model.ts";
import { fromProps, type ColorProp, type TransformProp } from "../program.ts";
import { el, type XmlNode } from "../xml.ts";
import { bake, isAlways, isConstantTrack, trackValueAt, type BakedInstance, type BakedNode, type BakedTimeline, type BakeOptions, type GTrack, type Horizon, type Interval } from "./bake.ts";
import { OutputDoc, svgRoot } from "./document.ts";
import { colorMatrix, cssBlendMode, isAlphaOnly, matrixString, type ColorMatrixValues } from "./filters.ts";
import { textNode } from "./text.ts";

export type BeginMode = "auto" | "click" | "hover" | "manual";

export interface AnimateOptions extends BakeOptions {
	format: "smil" | "css";
	includeBackground: boolean;
	embedImages: boolean;
	textAsOutlines: boolean;
	/** Which frame to show where animation is unsupported / before it starts. */
	posterFrame: "first" | "last";
	begin: BeginMode;
	/** Seconds to wait before starting (auto mode). */
	delay?: number;
	idPrefix?: string;
	pretty?: boolean;
}

export interface AnimateResult {
	svg: string;
	assets: OutputDoc["assets"];
	horizon: Horizon;
	warnings: string[];
}

const EPS_TICK = 0.01; // width of an instantaneous jump, in ticks

export function renderAnimated(ctx: Context, rootId: string, opts: AnimateOptions): AnimateResult {
	const { horizon, root } = bake(ctx, rootId, opts);
	const doc = new OutputDoc(ctx, { embedImages: opts.embedImages, idPrefix: opts.idPrefix ?? "" });
	const svgId = doc.uid("anim");
	const svg = svgRoot(ctx, { id: svgId });
	const w = new Writer(ctx, doc, horizon, opts, svgId);
	if (opts.includeBackground) {
		const d = ctx.model.doc;
		svg.children.push(el("rect", { width: fmt(d.width, 2), height: fmt(d.height, 2), fill: d.backgroundColor }));
	}
	svg.children.push(...w.timeline(root));
	w.finish(svg);
	return { svg: doc.toString(svg, { pretty: opts.pretty }), assets: doc.assets, horizon, warnings: ctx.warnings };
}

class Writer {
	readonly ctx: Context;
	readonly doc: OutputDoc;
	readonly H: number;
	readonly opts: AnimateOptions;
	readonly svgId: string;
	readonly css: boolean;
	private shared = new Map<string, string>();
	private inlined = new Map<string, XmlNode>();
	private cssClassCount = 0;
	private buttons = false;

	private copyWithFreshIds(tpl: XmlNode): XmlNode {
		const copy = cloneNode(tpl);
		const map = new Map<string, string>();
		walkNodes(copy, (n) => {
			if (n.attrs.id) {
				const nid = this.doc.uid(n.attrs.id.replace(/_\d+$/, ""));
				map.set(n.attrs.id, nid);
				n.attrs.id = nid;
			}
		});
		if (map.size) {
			walkNodes(copy, (n) => {
				for (const k in n.attrs) {
					const v = n.attrs[k]!;
					if ((k === "xlink:href" || k === "href") && map.has(v.slice(1))) n.attrs[k] = "#" + map.get(v.slice(1));
					else if (v.indexOf("url(#") >= 0) n.attrs[k] = v.replace(/url\(#([^)]+)\)/g, (m, id: string) => (map.has(id) ? `url(#${map.get(id)})` : m));
				}
			});
		}
		return copy;
	}
	private keyframes: string[] = [];
	private rules: string[] = [];
	private animCount = 0;
	readonly posterTick: number;
	readonly dur: string;
	readonly begin: string;
	readonly repeat: string;

	constructor(ctx: Context, doc: OutputDoc, horizon: Horizon, opts: AnimateOptions, svgId: string) {
		this.ctx = ctx;
		this.doc = doc;
		this.H = horizon.ticks;
		this.opts = opts;
		this.svgId = svgId;
		this.css = opts.format === "css";
		this.posterTick = opts.posterFrame === "last" ? Math.max(0, this.H - 1) : 0;
		this.dur = fmt(this.H / horizon.fps, 4) + "s";
		const delay = opts.delay ? `+${fmt(opts.delay, 3)}s` : "";
		this.begin =
			opts.begin === "click" ? `${svgId}.click${delay}` : opts.begin === "hover" ? `${svgId}.mouseover${delay}` : opts.begin === "manual" ? "indefinite" : opts.delay ? fmt(opts.delay, 3) + "s" : "";
		this.repeat = horizon.loop ? "indefinite" : "";
	}

	warn = (m: string) => {
		if (!this.ctx.warnings.includes(m)) this.ctx.warnings.push(m);
	};

	// ------------------------------------------------------------------ structure

	timeline(bt: BakedTimeline): XmlNode[] {
		const content = this.layers(bt);
		if (!bt.view) return content;
		const v = bt.view;
		const comps: Comp[] = [
			{ type: "translate", tracks: [v.x, v.y] },
			{ type: "rotate", tracks: [v.rot] },
			{ type: "skewX", tracks: [v.skw] },
			{ type: "scale", tracks: [v.sx, v.sy] },
		];
		return [this.transformChain(comps, el("g", {}, content), v)];
	}

	private layers(bt: BakedTimeline): XmlNode[] {
		const out: XmlNode[] = [];
		const masks = new Map<number, string>();
		for (const bl of bt.layers) {
			if (bl.layer.type !== "mask") continue;
			const nodes = this.nodes(bl.nodes);
			if (!nodes.length) continue;
			const id = this.doc.uid("mask");
			// kept inside the subtree (not in <defs>) so a copied subtree carries its own masks
			out.push(el("mask", { id }, [el("g", { filter: this.doc.maskFilter() }, nodes)]));
			masks.set(bl.layer.index, id);
		}
		let group: { mask: number; nodes: XmlNode[] } | null = null;
		const flush = () => {
			if (group) {
				const id = masks.get(group.mask);
				if (id) out.push(el("g", { mask: `url(#${id})` }, group.nodes));
			}
			group = null;
		};
		for (const bl of bt.layers) {
			if (bl.layer.type === "mask") continue;
			const nodes = this.nodes(bl.nodes);
			if (bl.layer.maskedBy >= 0) {
				if (group && group.mask !== bl.layer.maskedBy) flush();
				if (!group) group = { mask: bl.layer.maskedBy, nodes: [] };
				group.nodes.push(...nodes);
			} else {
				flush();
				out.push(...nodes);
			}
		}
		flush();
		return out;
	}

	private nodes(list: BakedNode[]): XmlNode[] {
		const out: XmlNode[] = [];
		for (const n of list) {
			const x = this.node(n);
			if (x) out.push(x);
		}
		return out;
	}

	private node(n: BakedNode): XmlNode | null {
		let content: XmlNode | null;
		switch (n.kind) {
			case "art":
				content = this.doc.useArt(n.art);
				break;
			case "bitmap": {
				const it = n.item as Extract<typeof n.item, { kind: "bitmap" }>;
				content = this.doc.image(it.bitmap, it.matrix);
				break;
			}
			case "text": {
				const it = n.item as Extract<typeof n.item, { kind: "text" }>;
				content = this.opts.textAsOutlines || it.element.textType === "static" ? (it.art ? this.doc.useArt(it.art) : null) : textNode(it.element, this.ctx.digits);
				break;
			}
			case "instance":
				content = this.instance(n);
				break;
		}
		if (!content) return null;
		return this.visibility(content, n.vis);
	}

	private instance(n: BakedInstance): XmlNode | null {
		if (!n.item.visible || !n.child) return null;
		let inner: XmlNode = this.childRef(n.child);
		if (n.states?.length) {
			// Button states driven by CSS :hover / :active (works wherever the SVG is interactive)
			const names = ["up", "over", "down"];
			const parts = [el("g", { class: "f2s-up" }, [inner]), ...n.states.map((s, i) => el("g", { class: `f2s-${names[i + 1]}` }, [this.childRef(s)]))];
			inner = el("g", { class: "f2s-btn", style: "cursor:pointer" }, parts);
			this.buttons = true;
		}

		// transform components, innermost first: translate(-tp) scale skewX rotate translate(x,y)
		const t = n.transform;
		const neg = (tr: GTrack) => tr.map((k) => ({ ...k, v: -k.v }));
		const comps: Comp[] = [
			{ type: "translate", tracks: [t.x, t.y] },
			{ type: "rotate", tracks: [t.rot] },
			{ type: "skewX", tracks: [t.skw] },
			{ type: "scale", tracks: [t.sx, t.sy] },
			{ type: "translate", tracks: [neg(t.tpx), neg(t.tpy)] },
		];
		inner = this.transformChain(comps, inner, t);

		// colour, filters, blend
		const attrs: Record<string, string> = {};
		const style: string[] = [];
		const color = n.color;
		const colorAnimated = !!color && Object.values(color).some((tr) => !isConstantTrack(tr));
		const poster = colorAtTick(color, this.posterTick);
		const filterSets = n.filters;
		const m0 = matAtTick(n, this.posterTick);
		const scale = { x: Math.hypot(m0[0], m0[1]), y: Math.hypot(m0[2], m0[3]) };
		const size = { w: n.item.bounds.width / Math.max(1e-3, scale.x), h: n.item.bounds.height / Math.max(1e-3, scale.y) };
		const alphaOnly = !color || allAlphaOnly(color);
		const anims: XmlNode[] = [];

		if (color && alphaOnly) {
			if (colorAnimated) {
				this.animate(anims, style, "opacity", [color.aP], (v) => fmt(Math.max(0, v[0]!) / 100, 3), "attr");
			}
			if (poster && poster.aP !== 100) attrs.opacity = fmt(Math.max(0, poster.aP) / 100, 3);
		}
		const fixedFilters = filterSets.length ? filterSets[0]!.filters : [];
		if (color && !alphaOnly && colorAnimated && this.css) {
			// CSS cannot animate filter primitives: switch between per-frame colour filters
			const steps: { t: number; v: string }[] = [];
			let last = "";
			for (let t = 0; t < this.H; t++) {
				const c = colorAtTick(color, t)!;
				const ref = this.doc.filter(filterSets.length === 1 ? fixedFilters : [], c, scale, this.warn, size) ?? "none";
				if (ref !== last) steps.push({ t, v: ref });
				last = ref;
			}
			const wrap = el("g", { filter: steps.find((s) => s.t <= this.posterTick)?.v ?? steps[0]!.v }, [inner]);
			this.cssDiscrete(wrap, "filter", steps, "none");
			inner = wrap;
		} else if (color && !alphaOnly) {
			// colour matrix filter (animated values via SMIL)
			const fid = this.doc.uid("cx");
			const prims: XmlNode[] = [];
			const cm = el("feColorMatrix", { type: "matrix", values: matrixString(colorMatrix(poster ?? identityColor())) });
			if (colorAnimated) this.animateColorMatrix(cm, color);
			if (filterSets.length <= 1 && fixedFilters.length) {
				const ref = this.doc.filter(fixedFilters, null, scale, this.warn, size);
				// chain: animate filters wrap outside
				if (ref) inner = el("g", { filter: ref }, [inner]);
			}
			prims.push(cm);
			this.doc.defs.push(el("filter", { id: fid, "color-interpolation-filters": "sRGB" }, prims));
			attrs.filter = `url(#${fid})`;
		} else if (filterSets.length === 1 && fixedFilters.length) {
			const ref = this.doc.filter(fixedFilters, null, scale, this.warn, size);
			if (ref) attrs.filter = ref;
		}
		if (filterSets.length > 1) {
			// filters change over time: switch between filter definitions
			const refs = filterSets.map((f) => this.doc.filter(f.filters, null, scale, this.warn, size) ?? "none");
			const wrap = el("g", { filter: refs[0]! }, [inner]);
			this.discrete(wrap, "filter", filterSets.map((f, i) => ({ t: f.t, v: refs[i]! })), "none");
			inner = wrap;
		}
		const blend = cssBlendMode(n.item.blendMode, this.warn);
		if (blend) style.push(`mix-blend-mode:${blend}`);
		if (n.item.blendMode === "layer") style.push("isolation:isolate");
		if (!Object.keys(attrs).length && !style.length && !anims.length && !this.pendingCss.length) return inner;
		const g = el("g", attrs, [inner, ...anims]);
		if (style.length) g.attrs.style = style.join(";");
		this.applyCssAnimations(g);
		return g;
	}

	/** Reference to a (shared) baked child timeline. */
	private childRef(bt: BakedTimeline): XmlNode {
		if (this.css && bt.animated) {
			// CSS animations inside <use> shadow trees can't be paused/seeked reliably: inline,
			// and copy the first rendering for further uses (classes keep sharing the CSS).
			const tpl = this.inlined.get(bt.key);
			if (tpl) return this.copyWithFreshIds(tpl);
			const g = el("g", {}, this.timeline(bt));
			this.inlined.set(bt.key, g);
			return g;
		}
		let id = this.shared.get(bt.key);
		if (!id) {
			id = this.doc.uid(bt.program.name || "sym");
			this.shared.set(bt.key, id);
			this.doc.defs.push(el("g", { id }, this.timeline(bt)));
		}
		return el("use", { "xlink:href": "#" + id });
	}

	private transformChain(comps: Comp[], inner: XmlNode, t: BakedInstance["transform"]): XmlNode {
		// Fold static components into matrices; animated components get their own animation.
		// Order of application to points: last comp first (translate(-tp)) ... first comp last.
		const statics = comps.map((c) => c.tracks.every(isConstantTrack));
		if (statics.every(Boolean)) {
			const m = staticMatrix(t, this.posterTick);
			const s = fmtMatrix(m, this.ctx.digits);
			return s ? el("g", { transform: s }, [inner]) : inner;
		}
		// Build from the inside out.
		let node = inner;
		let i = comps.length - 1;
		while (i >= 0) {
			if (statics[i]) {
				// collect consecutive static comps into one matrix
				let m: Mat = [1, 0, 0, 1, 0, 0];
				while (i >= 0 && statics[i]) {
					m = mulM(compMatrix(comps[i]!, this.posterTick), m);
					i--;
				}
				const s = fmtMatrix(m, this.ctx.digits);
				if (s) node = el("g", { transform: s }, [node]);
				continue;
			}
			// animated: one element per component (each may have its own timing)
			const c = comps[i]!;
			for (const part of splitComp(c)) {
				const g = el("g", {}, [node]);
				this.animateTransform(g, part);
				node = g;
			}
			i--;
		}
		return node;
	}

	// ------------------------------------------------------------------ animation primitives

	private animateTransform(g: XmlNode, c: Comp) {
		const fmtV = (vals: number[]) => {
			switch (c.type) {
				case "rotate":
				case "skewX":
					return fmt(vals[0]!, 3);
				case "translateX":
					return `${fmt(vals[0]!, this.ctx.digits)} 0`;
				case "translateY":
					return `0 ${fmt(vals[0]!, this.ctx.digits)}`;
				case "scaleX":
					return `${fmt(vals[0]!, 4)} 1`;
				case "scaleY":
					return `1 ${fmt(vals[0]!, 4)}`;
				case "scale":
					return `${fmt(vals[0]!, 4)} ${fmt(vals[1]!, 4)}`;
				default:
					return `${fmt(vals[0]!, this.ctx.digits)} ${fmt(vals[1]!, this.ctx.digits)}`;
			}
		};
		const svgType = c.type.startsWith("translate") ? "translate" : c.type.startsWith("scale") ? "scale" : c.type;
		// poster (fallback) transform on the element itself
		const pv = c.tracks.map((tr) => trackValueAt(tr, this.posterTick));
		g.attrs.transform = `${svgType}(${fmtV(pv)})`;
		if (this.css) {
			const cssFn = (vals: number[]) => {
				switch (c.type) {
					case "rotate":
						return `rotate(${fmt(vals[0]!, 3)}deg)`;
					case "skewX":
						return `skewX(${fmt(vals[0]!, 3)}deg)`;
					case "scale":
						return `scale(${fmt(vals[0]!, 4)},${fmt(vals[1]!, 4)})`;
					case "scaleX":
						return `scale(${fmt(vals[0]!, 4)},1)`;
					case "scaleY":
						return `scale(1,${fmt(vals[0]!, 4)})`;
					case "translateX":
						return `translate(${fmt(vals[0]!, this.ctx.digits)}px,0)`;
					case "translateY":
						return `translate(0,${fmt(vals[0]!, this.ctx.digits)}px)`;
					default:
						return `translate(${fmt(vals[0]!, this.ctx.digits)}px,${fmt(vals[1]!, this.ctx.digits)}px)`;
				}
			};
			this.cssAnimation(g, "transform", c.tracks, cssFn);
			return;
		}
		const a = this.smilValues(c.tracks, fmtV);
		if (!a) return;
		g.children.push(el("animateTransform", { attributeName: "transform", type: svgType, ...a, ...this.timing() }));
	}

	/** Animates a plain attribute/property from one or more tracks sharing key times. */
	private animate(into: XmlNode[], style: string[], name: string, tracks: GTrack[], fmtV: (v: number[]) => string, _kind: "attr") {
		void style;
		if (this.css) {
			this.pendingCss.push({ prop: name, tracks, fmtV });
			return;
		}
		const a = this.smilValues(tracks, fmtV);
		if (a) into.push(el("animate", { attributeName: name, ...a, ...this.timing() }));
	}
	private pendingCss: { prop: string; tracks: GTrack[]; fmtV: (v: number[]) => string }[] = [];

	private applyCssAnimations(g: XmlNode) {
		for (const p of this.pendingCss.splice(0)) this.cssAnimation(g, p.prop, p.tracks, p.fmtV);
	}

	private animateColorMatrix(node: XmlNode, color: Record<ColorProp, GTrack>) {
		// merge the 8 colour tracks on common key times (sampled where they differ)
		const tracks = COLOR_ORDER.map((p) => color[p]);
		const fmtV = (v: number[]) => matrixString(colorMatrix(Object.fromEntries(COLOR_ORDER.map((p, i) => [p, v[i]!])) as unknown as ColorMatrixValues));
		const a = this.smilValues(tracks, fmtV);
		if (a) node.children.push(el("animate", { attributeName: "values", ...a, ...this.timing() }));
	}

	/** Discrete switch of an attribute value over time. */
	private discrete(node: XmlNode, attr: string, steps: { t: number; v: string }[], off: string) {
		const keys = steps.map((s) => ({ t: s.t, v: s.v }));
		if (keys.length < 2 && (!keys.length || keys[0]!.t === 0)) return;
		if (this.css) {
			this.cssDiscrete(node, attr, keys, off);
			return;
		}
		const times: number[] = [],
			values: string[] = [];
		if (keys[0]!.t > 0) {
			times.push(0);
			values.push(off);
		}
		for (const k of keys) {
			times.push(k.t / this.H);
			values.push(k.v);
		}
		node.children.push(el("animate", { attributeName: attr, values: values.join(";"), keyTimes: times.map(floorTime).join(";"), calcMode: "discrete", ...this.timing() }));
	}

	private visibility(node: XmlNode, vis: Interval[]): XmlNode {
		if (isAlways(vis, this.H)) return node;
		const shownAt = (t: number) => vis.some(([a, b]) => t >= a && t < b);
		// state changes over the horizon, starting with the state at tick 0
		const steps: { t: number; on: boolean }[] = [{ t: 0, on: shownAt(0) }];
		const set = (t: number, on: boolean) => {
			const last = steps[steps.length - 1]!;
			if (last.t === t) last.on = on;
			else if (last.on !== on) steps.push({ t, on });
		};
		for (const [a, b] of vis) {
			set(a, true);
			if (b < this.H) set(b, false);
		}
		const wrap = node.name === "g" && !node.attrs.display && !node.attrs.id && !hasAnim(node) ? node : el("g", {}, [node]);
		const hiddenAtPoster = !shownAt(this.posterTick);
		if (this.css) {
			if (hiddenAtPoster) wrap.attrs.visibility = "hidden";
			this.cssDiscrete(
				wrap,
				"visibility",
				steps.map((s) => ({ t: s.t, v: s.on ? "visible" : "hidden" })),
				"hidden",
			);
		} else {
			if (hiddenAtPoster) wrap.attrs.display = "none";
			wrap.children.push(
				el("animate", {
					attributeName: "display",
					values: steps.map((s) => (s.on ? "inline" : "none")).join(";"),
					keyTimes: steps.map((s) => floorTime(s.t / this.H)).join(";"),
					calcMode: "discrete",
					...this.timing(),
				}),
			);
		}
		return wrap;
	}

	private timing(): Record<string, string> {
		const t: Record<string, string> = { dur: this.dur };
		if (this.begin) t.begin = this.begin;
		if (this.repeat) t.repeatCount = this.repeat;
		else t.fill = "freeze";
		return t;
	}

	/** values/keyTimes/keySplines for SMIL from tracks with identical key times. */
	private smilValues(tracks: GTrack[], fmtV: (v: number[]) => string): Record<string, string> | null {
		const keys = mergeTracks(tracks, this.H);
		if (!keys) return null;
		const times: number[] = [],
			values: string[] = [],
			splines: string[] = [];
		let anyCurve = false;
		const add = (t: number, v: number[], spline: string) => {
			const prev = times[times.length - 1];
			let tt = t / this.H;
			if (prev !== undefined && tt <= prev) tt = prev; // equal times: an instantaneous jump
			times.push(tt);
			values.push(fmtV(v));
			splines.push(spline);
		};
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i]!;
			const next = keys[i + 1];
			if (k.ease === "hold" && next) {
				add(k.t, k.v, "0 0 1 1");
				const holdEnd = Math.max(k.t, next.t - EPS_TICK);
				if (holdEnd > k.t) add(holdEnd, k.v, "0 0 1 1");
			} else if (Array.isArray(k.ease)) {
				anyCurve = true;
				add(k.t, k.v, k.ease.map((x) => fmt(x, 4) || "0").join(" "));
			} else add(k.t, k.v, "0 0 1 1");
		}
		// keyTimes must start at 0 and end at 1
		if (times[0]! > 0) {
			times.unshift(0);
			values.unshift(values[0]!);
			splines.unshift("0 0 1 1");
		}
		if (times[times.length - 1]! < 1) {
			times.push(1);
			values.push(values[values.length - 1]!);
			splines.push("0 0 1 1");
		}
		splines.pop();
		// identical consecutive times are invalid in some engines: nudge them apart a little
		for (let i = 1; i < times.length; i++) if (times[i]! <= times[i - 1]!) times[i] = Math.min(1, times[i - 1]! + 1e-6);
		this.animCount++;
		const r: Record<string, string> = { values: values.join(";"), keyTimes: times.map((x) => fmt(x, 6) || "0").join(";") };
		if (anyCurve) {
			r.calcMode = "spline";
			r.keySplines = splines.join(";");
		}
		return r;
	}

	// ------------------------------------------------------------------ CSS

	private cssAnimation(node: XmlNode, prop: string, tracks: GTrack[], fmtV: (v: number[]) => string) {
		const keys = mergeTracks(tracks, this.H);
		if (!keys) return;
		const name = this.cssName(node);
		const frames: string[] = [];
		const pct = (t: number) => fmt((t / this.H) * 100, 4) + "%";
		if (keys[0]!.t > 0) frames.push(`0%{${prop}:${fmtV(keys[0]!.v)};animation-timing-function:step-end}`);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i]!;
			const next = keys[i + 1];
			// two keys at the same time = a jump: CSS merges equal offsets, so pull this one back a hair
			const t = next && next.t - k.t < EPS_TICK / 2 ? Math.max(0, next.t - EPS_TICK) : k.t;
			const tf = k.ease === "hold" ? "step-end" : k.ease === "linear" ? "linear" : `cubic-bezier(${k.ease.map((x) => fmt(x, 4) || "0").join(",")})`;
			frames.push(`${pct(t)}{${prop}:${fmtV(k.v)};animation-timing-function:${tf}}`);
		}
		const last = keys[keys.length - 1]!;
		if (last.t < this.H) frames.push(`100%{${prop}:${fmtV(last.v)}}`);
		this.cssRule(node, name, frames);
	}

	private cssDiscrete(node: XmlNode, prop: string, steps: { t: number; v: string }[], off: string) {
		const name = this.cssName(node);
		const frames: string[] = [];
		// switch at (or just before) the exact frame time, never after it
		const pct = (t: number) => (t <= 0 ? "0" : String(Math.floor((t / this.H) * 1e6) / 1e4)) + "%";
		if (!steps.length || steps[0]!.t > 0) frames.push(`0%{${prop}:${off}}`);
		for (const s of steps) frames.push(`${pct(s.t)}{${prop}:${s.v}}`);
		// explicit end value: without it a non-repeating animation ends ("fill: both") on the
		// element's own attribute (e.g. visibility="hidden") instead of the last step
		frames.push(`100%{${prop}:${steps.length ? steps[steps.length - 1]!.v : off}}`);
		this.cssRule(node, name, frames, "step-end");
	}

	/** Each animated element gets one class; all its animations go into that class's rule. */
	private cssClass(node: XmlNode): string {
		const existing = /(?:^|\s)(a\d+)(?:\s|$)/.exec(node.attrs.class ?? "");
		if (existing) return existing[1]!;
		const cls = `a${this.cssClassCount++}`;
		node.attrs.class = node.attrs.class ? `${node.attrs.class} ${cls}` : cls;
		return cls;
	}

	private cssName(node: XmlNode): string {
		return `${this.opts.idPrefix ?? ""}${this.cssClass(node)}_${this.animCount++}`;
	}

	private cssRule(node: XmlNode, name: string, frames: string[], timing = "linear") {
		this.keyframes.push(`@keyframes ${name}{${frames.join("")}}`);
		const cls = this.cssClass(node);
		const iter = this.repeat ? "infinite" : "1";
		const fill = this.repeat ? "" : " both";
		const delay = this.opts.delay ? ` ${fmt(this.opts.delay, 3)}s` : "";
		const sel = `#${this.svgId} .${cls}`;
		const existing = this.rules.findIndex((r) => r.startsWith(`${sel}{`));
		const decl = `${name} ${this.dur} ${timing}${delay} ${iter}${fill}`;
		if (existing >= 0) this.rules[existing] = this.rules[existing]!.replace(/animation:([^}]*)}/, (_m, a: string) => `animation:${a},${decl}}`);
		else this.rules.push(`${sel}{animation:${decl}}`);
	}

	finish(svg: XmlNode) {
		if (this.buttons) {
			const s = `#${this.svgId}`;
			this.doc.styles.push(
				`${s} .f2s-over,${s} .f2s-down{display:none}` +
					`${s} .f2s-btn:hover>.f2s-over{display:inline}${s} .f2s-btn:hover>.f2s-up{display:none}` +
					`${s} .f2s-btn:active>.f2s-down{display:inline}${s} .f2s-btn:active>.f2s-over,${s} .f2s-btn:active>.f2s-up{display:none}`,
			);
		}
		if (this.css && (this.keyframes.length || this.rules.length)) {
			const play =
				this.opts.begin === "auto"
					? ""
					: this.opts.begin === "hover"
						? `#${this.svgId}:not(:hover) *{animation-play-state:paused}`
						: `#${this.svgId}:not(.playing) *{animation-play-state:paused}`;
			this.doc.styles.push([...this.keyframes, ...this.rules, play].filter(Boolean).join("\n"));
			if (this.opts.begin === "click") this.doc.scripts.push(`document.getElementById(${JSON.stringify(this.svgId)}).addEventListener("click",function(){this.classList.add("playing")});`);
		}
		void svg;
	}
}

// ---------------------------------------------------------------------- helpers

interface Comp {
	type: "translate" | "rotate" | "skewX" | "scale" | "translateX" | "translateY" | "scaleX" | "scaleY";
	tracks: GTrack[];
}

const COLOR_ORDER: ColorProp[] = ["rP", "gP", "bP", "aP", "rA", "gA", "bA", "aA"];

/** keyTimes value rounded down to 6 decimals, so discrete switches never come late. */
function floorTime(x: number): string {
	if (x <= 0) return "0";
	if (x >= 1) return "1";
	return fmt(Math.floor(x * 1e6) / 1e6, 6);
}

function identityColor(): ColorMatrixValues {
	return { rP: 100, gP: 100, bP: 100, aP: 100, rA: 0, gA: 0, bA: 0, aA: 0 };
}

function colorAtTick(color: Record<ColorProp, GTrack> | null, tick: number): ColorMatrixValues | null {
	if (!color) return null;
	const c = {} as ColorMatrixValues;
	for (const p of COLOR_ORDER) c[p] = trackValueAt(color[p], tick);
	return c;
}

function allAlphaOnly(color: Record<ColorProp, GTrack>): boolean {
	const fixed = (tr: GTrack, v: number) => tr.every((k) => Math.abs(k.v - v) < 1e-9);
	return fixed(color.rP, 100) && fixed(color.gP, 100) && fixed(color.bP, 100) && fixed(color.rA, 0) && fixed(color.gA, 0) && fixed(color.bA, 0) && fixed(color.aA, 0);
}

function matAtTick(n: BakedInstance, tick: number): Mat {
	const p = {} as Record<TransformProp, number>;
	for (const k of Object.keys(n.transform) as TransformProp[]) p[k] = trackValueAt(n.transform[k], tick);
	return fromProps(p);
}

function staticMatrix(t: BakedInstance["transform"], tick: number): Mat {
	const p = {} as Record<TransformProp, number>;
	for (const k of Object.keys(t) as TransformProp[]) p[k] = trackValueAt(t[k], tick);
	return fromProps(p);
}

const RAD = Math.PI / 180;
function compMatrix(c: Comp, tick: number): Mat {
	const v = c.tracks.map((tr) => trackValueAt(tr, tick));
	switch (c.type) {
		case "translate":
			return [1, 0, 0, 1, v[0]!, v[1]!];
		case "translateX":
			return [1, 0, 0, 1, v[0]!, 0];
		case "translateY":
			return [1, 0, 0, 1, 0, v[0]!];
		case "rotate": {
			const r = v[0]! * RAD;
			return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
		}
		case "skewX":
			return [1, 0, Math.tan(v[0]! * RAD), 1, 0, 0];
		case "scale":
			return [v[0]!, 0, 0, v[1]!, 0, 0];
		case "scaleX":
			return [v[0]!, 0, 0, 1, 0, 0];
		case "scaleY":
			return [1, 0, 0, v[0]!, 0, 0];
	}
}

/** Matrix product a·b (b applied first). */
function mulM(a: Mat, b: Mat): Mat {
	return [
		a[0] * b[0] + a[2] * b[1],
		a[1] * b[0] + a[3] * b[1],
		a[0] * b[2] + a[2] * b[3],
		a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4],
		a[1] * b[4] + a[3] * b[5] + a[5],
	];
}

/** Two-track components whose tracks have different key times are split in two (they commute). */
function splitComp(c: Comp): Comp[] {
	if (c.tracks.length < 2) return [c];
	const [a, b] = c.tracks as [GTrack, GTrack];
	if (sameTiming(a, b)) return [c];
	if (c.type === "translate") {
		const out: Comp[] = [];
		if (!isConstantTrack(a) || true) out.push({ type: "translateX", tracks: [a] });
		out.push({ type: "translateY", tracks: [b] });
		return out;
	}
	if (c.type === "scale") return [{ type: "scaleX", tracks: [a] }, { type: "scaleY", tracks: [b] }];
	return [c];
}

function sameTiming(a: GTrack, b: GTrack): boolean {
	if (isConstantTrack(a) || isConstantTrack(b)) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const x = a[i]!,
			y = b[i]!;
		if (Math.abs(x.t - y.t) > 1e-9) return false;
		if (String(x.ease) !== String(y.ease)) return false;
	}
	return true;
}

interface MKey {
	t: number;
	v: number[];
	ease: GTrack[number]["ease"];
}

/** Combines tracks with the same timing into multi-value keys; samples linearly if timings differ. */
function mergeTracks(tracks: GTrack[], H: number): MKey[] | null {
	if (tracks.every(isConstantTrack)) return null;
	const animated = tracks.filter((t) => !isConstantTrack(t));
	const ref = animated[0]!;
	if (animated.every((t) => sameTiming(ref, t))) {
		return ref.map((k, i) => ({ t: k.t, v: tracks.map((tr) => (isConstantTrack(tr) ? (tr[0]?.v ?? 0) : tr[i]!.v)), ease: k.ease }));
	}
	// different timings: sample at the union of key times and every half tick (linear)
	const times = new Set<number>();
	for (const tr of animated) for (const k of tr) times.add(k.t);
	for (let t = 0; t <= H; t += 0.5) times.add(t);
	const sorted = [...times].filter((t) => t >= 0 && t <= H).sort((a, b) => a - b);
	return sorted.map((t) => ({ t, v: tracks.map((tr) => trackValueAt(tr, t)), ease: "linear" as const }));
}

function cloneNode(n: XmlNode): XmlNode {
	return { name: n.name, attrs: { ...n.attrs }, children: n.children.map((c) => (typeof c === "string" ? c : cloneNode(c))) };
}

function walkNodes(n: XmlNode, fn: (n: XmlNode) => void) {
	fn(n);
	for (const c of n.children) if (typeof c !== "string") walkNodes(c, fn);
}

function hasAnim(node: XmlNode): boolean {
	return node.children.some((c) => typeof c !== "string" && (c.name === "animate" || c.name === "animateTransform"));
}
