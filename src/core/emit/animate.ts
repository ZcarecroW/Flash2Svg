/**
 * Declarative animated output: SMIL (<animate>, <animateTransform>) or CSS @keyframes, from the
 * baked global timeline. Both share the structure; CSS falls back to SMIL for what CSS cannot
 * animate (filter primitive attributes).
 */
import type { Context } from "../context.ts";
import { fmt, fmtMatrix, nearestAngle } from "../geom.ts";
import { simplify } from "../tracks.ts";
import type { Mat } from "../model.ts";
import { channelNumbers, channelText, channelVaries, matrixScale, type MorphChannel } from "../morph.ts";
import { fromProps, type ColorProp, type TransformProp } from "../program.ts";
import { el, serialize, walk, type XmlNode } from "../xml.ts";
import {
	bake,
	holdFrom,
	isAlways,
	isConstantTrack,
	sliceTrack,
	trackValueAt,
	type BakedInstance,
	type BakedMorph,
	type BakedNode,
	type BakedTimeline,
	type BakeOptions,
	type GTrack,
	type Horizon,
	type Interval,
} from "./bake.ts";
import { OutputDoc, svgRoot, withAcc } from "./document.ts";
import { blendHides, blendSubtract, blendWhite, colorMatrix, cssBlendMode, isAlphaOnly, matrixString, type ColorMatrixValues } from "./filters.ts";
import { alignTracks, encodeKeyframes, groupFrames, withLegacyTiming, type MKey } from "./keyframes.ts";
import { StaticRenderer } from "./static.ts";
import { outlineText, textField, textNode } from "./text.ts";
import { scrollCss, scrollScript, scrollScriptCss, visibleScript, type ScrollRange } from "./triggers.ts";
import { clickLink } from "../snippets.ts";
import { playheadFrame } from "./timing.ts";

/** "visible": when half on screen; "scroll": the scroll position runs it (see triggers.ts). */
export type BeginMode = "auto" | "click" | "hover" | "manual" | "visible" | "scroll";

export interface AnimateOptions extends BakeOptions {
	format: "smil" | "css";
	includeBackground: boolean;
	embedImages: boolean;
	textAsOutlines: boolean;
	/** Which frame to show where animation is unsupported / before it starts. */
	posterFrame: "first" | "last";
	begin: BeginMode;
	/** begin "scroll": the part of the scrolling that runs the animation (default "visible"). */
	scrollRange?: ScrollRange;
	/** Seconds to wait before starting (auto mode). */
	delay?: number;
	idPrefix?: string;
	pretty?: boolean;
	/** "Reduce motion" in the system settings shows the poster frame (default true). */
	reducedMotion?: boolean;
	/** SMIL: shape tweens as path morphs (default true; CSS can't animate paths in every browser). */
	morph?: boolean;
}

export interface AnimateResult {
	svg: string;
	assets: OutputDoc["assets"];
	drawingBytes: OutputDoc["drawingBytes"];
	horizon: Horizon;
	warnings: string[];
}

const EPS_TICK = 0.01; // width of an instantaneous jump, in ticks

export function renderAnimated(ctx: Context, rootId: string, opts: AnimateOptions): AnimateResult {
	if (opts.begin === "scroll") opts = { ...opts, loop: "never", delay: 0 };
	const smilMorph = opts.format === "smil" && opts.morph !== false;
	const { horizon, root } = bake(ctx, rootId, { ...opts, morph: smilMorph, turning: smilMorph });
	const doc = new OutputDoc(ctx, { embedImages: opts.embedImages, idPrefix: opts.idPrefix ?? "" });
	const svgId = doc.uid("anim");
	const svg = svgRoot(ctx, { id: svgId });
	const w = new Writer(ctx, doc, horizon, opts, svgId);
	if (opts.includeBackground) {
		const d = ctx.model.doc;
		svg.children.push(el("rect", { width: fmt(d.width, 2), height: fmt(d.height, 2), fill: d.backgroundColor }));
	}
	const content = w.timeline(root);
	let moves = false;
	for (const n of content) walk(n, (x) => void (/^(animate|animateTransform|set)$/.test(x.name) && (moves = true)));
	if (!w.css && moves && opts.reducedMotion !== false) {
		// "reduce motion" in the system settings: CSS can't stop SMIL, so a still copy of the poster
		// frame (sharing the drawings in <defs>) stands in for the animation
		const prog = ctx.programs[rootId]!;
		const sr = new StaticRenderer(ctx, doc, { movieClips: "play", textAsOutlines: opts.textAsOutlines });
		const still = el("g", { class: "f2s-still", display: "none" }, sr.timeline(prog, playheadFrame(prog, w.posterTick), w.posterTick, 0));
		svg.children.push(el("g", { class: "f2s-anim" }, content), still);
		doc.styles.push(`@media (prefers-reduced-motion:reduce){#${svgId}>.f2s-anim{display:none}#${svgId}>.f2s-still{display:inline}}`);
	} else svg.children.push(...content);
	w.finish(svg);
	return { svg: doc.toString(svg, { pretty: opts.pretty }), assets: doc.assets, drawingBytes: doc.drawingBytes, horizon, warnings: ctx.warnings };
}

/**
 * The length of an animation that repeats for ever. Rounding adds up loop after loop: at 4
 * decimals an 8-frame loop at 24 fps (.3333 s) runs half a frame off after 3.5 minutes, and loops
 * meant to stay in step (8 and 16 frames, rounded apart) drift a frame apart in 5 minutes. 7
 * decimals keep it under a third of a frame a day; durations that end (.5 s) stay short.
 */
const loopSeconds = (ticks: number, fps: number) => fmt(ticks / fps, 7) + "s";

function gcd(a: number, b: number): number {
	while (b) [a, b] = [b, a % b];
	return a;
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
	/** Tick from which the end of the horizon loops after the first pass (0 = none), see Horizon. */
	readonly tail: number;
	private readonly fps: number;
	private clockId = "";

	constructor(ctx: Context, doc: OutputDoc, horizon: Horizon, opts: AnimateOptions, svgId: string) {
		this.ctx = ctx;
		this.doc = doc;
		this.H = horizon.ticks;
		this.opts = opts;
		this.svgId = svgId;
		this.css = opts.format === "css";
		this.posterTick = opts.posterFrame === "last" ? Math.max(0, this.H - 1) : 0;
		this.tail = horizon.loop ? 0 : horizon.tail;
		// with a tail, the first pass ends where the tail starts
		this.dur = horizon.loop ? loopSeconds(this.H, horizon.fps) : fmt((this.tail || this.H) / horizon.fps, 4) + "s";
		const delay = opts.delay ? `+${fmt(opts.delay, 3)}s` : "";
		this.begin =
			opts.begin === "click"
				? `${svgId}.click${delay}`
				: opts.begin === "hover"
					? `${svgId}.mouseover${delay}`
					: opts.begin === "manual"
						? "indefinite"
						: opts.delay
							? fmt(opts.delay, 3) + "s"
							: "";
		this.repeat = horizon.loop ? "indefinite" : "";
		this.fps = horizon.fps;
	}

	/** The horizon once (or looping); with a tail: the first pass up to it, then the tail looping. [from, length, isTail] */
	private windows(): [number, number, boolean][] {
		return this.tail
			? [
					[0, this.tail, false],
					[this.tail, this.H - this.tail, true],
				]
			: [[0, this.H, false]];
	}

	/** Tracks of one window. Played once without a tail, everything holds the last tick shown. */
	private windowTracks(tracks: GTrack[], from: number, tail: boolean): GTrack[] {
		if (tail) return tracks.map((tr) => sliceTrack(tr, from, this.H));
		const end = this.tail || (!this.repeat && this.H > 1 ? this.H - 1 : 0);
		return end ? tracks.map((tr) => (isConstantTrack(tr) ? tr : holdFrom(tr, end))) : tracks;
	}

	/** Discrete steps in [from, to), shifted to start at 0 (the state at `from` first). */
	private sliceSteps(steps: { t: number; v: string }[], from: number, to: number, off: string): { t: number; v: string }[] {
		if (!from && to >= this.H) return steps;
		let v0 = off;
		for (const s of steps) if (s.t <= from) v0 = s.v;
		const out = [{ t: 0, v: v0 }];
		for (const s of steps) if (s.t > from && s.t < to && s.v !== out[out.length - 1]!.v) out.push({ t: s.t - from, v: s.v });
		return out;
	}

	warn = (m: string) => {
		if (!this.ctx.warnings.includes(m)) this.ctx.warnings.push(m);
	};

	// ------------------------------------------------------------------ structure

	/** The program whose coordinate space is being written (see Precision). */
	private space = "";

	timeline(bt: BakedTimeline): XmlNode[] {
		const outer = this.space;
		this.space = bt.program.id;
		const content = this.layers(bt);
		this.space = outer;
		if (!bt.view) return content;
		const v = bt.view;
		const d = this.ctx.precision.view(bt.program.id);
		const comps: Comp[] = [
			{ type: "translate", tracks: [v.x, v.y], digits: [d.x, d.y] },
			{ type: "rotate", tracks: [v.rot], digits: [d.rot] },
			{ type: "skewX", tracks: [v.skw], digits: [d.skw] },
			{ type: "scale", tracks: [v.sx, v.sy], digits: [d.sx, d.sy] },
		];
		return [this.transformChain(comps, el("g", {}, content), v, [d.x, d.sx])];
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
			out.push(this.doc.maskElement(id, nodes, bl.layer.maskMode, bl.layer.maskBox, bt.program.inShapeAlpha));
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
				content = this.doc.image(it.bitmap, it.matrix, this.ctx.precision.space(this.space));
				break;
			}
			case "text": {
				const it = n.item as Extract<typeof n.item, { kind: "text" }>;
				content =
					this.opts.textAsOutlines || it.element.textType === "static"
						? it.art
							? outlineText(it.element, this.doc.useArt(it.art))
							: null
						: textNode(it.element, this.ctx.precision.space(this.space), this.doc.fonts);
				content = textField(
					it.element,
					content,
					this.ctx.precision.space(this.space),
					(fs, size) => this.doc.filter(fs, null, { x: 1, y: 1 }, this.warn, size),
					this.warn,
				);
				break;
			}
			case "video":
				content = this.doc.video((n.item as Extract<typeof n.item, { kind: "video" }>).element, true);
				break;
			case "instance": {
				content = this.instance(n);
				const link = content && clickLink(this.ctx.programs[this.space]?.interactions, n.item.name);
				if (link) content = el("a", { "xlink:href": link.href, target: link.target }, [content!]);
				if (content) content = withAcc(content, n.item.acc, n.item.symbolType === "button");
				break;
			}
			case "morph":
				content = this.morph(n);
				break;
		}
		if (!content) return null;
		return this.visibility(content, n.vis);
	}

	/** A shape tween's frames as one drawing whose paths, colours and gradients are animated. */
	private morph(n: BakedMorph): XmlNode {
		const p = n.part;
		const { defs, body, nodes } = this.doc.morphCopy(p.art);
		// the still state: at the poster tick if shown then, else where it first shows
		const at = n.vis.some(([a, b]) => this.posterTick >= a && this.posterTick < b) ? this.posterTick : n.vis[0]![0];
		const digits = this.ctx.precision.space(this.space);
		for (const ch of p.channels) {
			const node = nodes[ch.node]!;
			const track = ch.f ? n.frame : n.ratio;
			const text = (v: number) => channelText(ch, channelNumbers(ch, v, v), digits);
			node.attrs[ch.attr] = text(trackValueAt(track, at));
			if (!channelVaries(ch) || isConstantTrack(track)) continue;
			if (ch.kind === "matrix" && !ch.rs) {
				// a matrix that turns: translate, rotate, skewX and scale from its decomposition at every
				// frame (matrices blended linearly don't turn evenly), each cut to the keys linear
				// interpolation needs within half a printed step
				const dense = everyFrame(track);
				let last = 0;
				const parts = dense.map((k) => {
					const p = svgParts(channelNumbers(ch, k.v, k.v) as unknown as Mat);
					p[2] = last = nearestAngle(p[2], last);
					return p;
				});
				const anim =
					(type: string, extra: Record<string, string> = {}) =>
					(x: Record<string, string>) =>
						el("animateTransform", { attributeName: ch.attr, type, ...extra, ...x });
				if (dense.every((k) => k.ease === "hold")) {
					// one step per frame: the discrete writer (it repeats compactly with the loops)
					const at = new Map(dense.map((k, j) => [k.v, parts[j]!]));
					const p = (v: number) => at.get(v) ?? svgParts(channelNumbers(ch, v, v) as unknown as Mat);
					const ma = new MorphAnim(this, track);
					node.children.push(...ma.values((v) => `${fmt(p(v)[0], digits)} ${fmt(p(v)[1], digits)}`, anim("translate")));
					node.children.push(...ma.values((v) => fmt(p(v)[2], 3), anim("rotate", { additive: "sum" })));
					if (parts.some((q) => Math.abs(q[3]) > 1e-4)) node.children.push(...ma.values((v) => fmt(p(v)[3], 3), anim("skewX", { additive: "sum" })));
					node.children.push(...ma.values((v) => `${fmt(p(v)[4], 5)} ${fmt(p(v)[5], 5)}`, anim("scale", { additive: "sum" })));
					continue;
				}
				const comp = (i: number, d: number): GTrack =>
					simplify(
						dense.map((k, j) => ({ t: k.t, v: parts[j]![i]!, ease: k.ease })),
						0.5 * 10 ** -d,
					);
				// a part that doesn't change is written still (smil() leaves constant tracks out): the
				// translate always, it replaces the attribute's poster value the others add to
				const part = (tracks: GTrack[], text: (v: number[]) => string, make: (a: Record<string, string>) => XmlNode, identity: string | null) => {
					const out = this.smil(tracks, text, make);
					if (out.length) return out;
					const v = text(tracks.map((t) => t[0]!.v));
					return v === identity ? [] : this.windowTimings().map((t) => make({ values: v, ...t }));
				};
				node.children.push(...part([comp(0, digits), comp(1, digits)], (v) => `${fmt(v[0]!, digits)} ${fmt(v[1]!, digits)}`, anim("translate"), null));
				node.children.push(...part([comp(2, 3)], (v) => fmt(v[0]!, 3), anim("rotate", { additive: "sum" }), "0"));
				if (parts.some((p) => Math.abs(p[3]) > 1e-4)) node.children.push(...part([comp(3, 3)], (v) => fmt(v[0]!, 3), anim("skewX", { additive: "sum" }), "0"));
				node.children.push(...part([comp(4, 5), comp(5, 5)], (v) => `${fmt(v[0]!, 5)} ${fmt(v[1]!, 5)}`, anim("scale", { additive: "sum" }), "1 1"));
				continue;
			}
			const a = new MorphAnim(this, track);
			if (ch.kind === "matrix") {
				// SMIL has no matrix animation: translate and scale animated, the rotation and skew
				// (which both ends share, see morph.ts) added
				const m = (v: number) => channelNumbers(ch, v, v);
				const anim =
					(type: string, extra: Record<string, string> = {}) =>
					(x: Record<string, string>) =>
						el("animateTransform", { attributeName: ch.attr, type, ...extra, ...x });
				node.children.push(...a.values((v) => `${fmt(m(v)[4]!, digits)} ${fmt(m(v)[5]!, digits)}`, anim("translate")));
				const [rot, skw] = ch.rs!;
				for (const [type, v] of [
					["rotate", rot],
					["skewX", skw],
				] as const)
					if (Math.abs(v) > 1e-6) node.children.push(...a.fixed(anim(type, { values: fmt(v, 4), additive: "sum" })));
				node.children.push(
					...a.values(
						(v) =>
							matrixScale(m(v))
								.map((x) => fmt(x, 5))
								.join(" "),
						anim("scale", { additive: "sum" }),
					),
				);
			} else node.children.push(...a.values(text, (x) => el("animate", { attributeName: ch.attr, ...x })));
		}
		this.doc.defs.push(...defs);
		this.doc.addDrawingBytes(p.art.id, serialize(body).length + defs.reduce((sum, d) => sum + serialize(d).length, 0));
		return body;
	}

	/** Ticks after which `track` repeats all through the looping horizon (0: it doesn't). */
	periodOf(track: GTrack): number {
		if (!this.repeat || this.tail || track.length < 2) return 0;
		const H = this.H;
		const sig = (k: GTrack[number]) => `${k.v.toFixed(9)}|${k.ease}`;
		const keys = new Map<string, string>();
		for (const k of track) keys.set(k.t.toFixed(6), sig(k));
		for (let P = 1; P <= H / 2; P++) {
			if (H % P) continue;
			if (track.every((k) => keys.get((k.t + P < H - 1e-9 ? k.t + P : k.t + P - H).toFixed(6)) === sig(k))) return P;
		}
		return 0;
	}

	/** The period (dividing the horizon, shorter than it) all `tracks` repeat with, or 0. */
	commonPeriod(tracks: GTrack[]): number {
		if (!this.repeat || this.tail) return 0;
		let P = 1;
		for (const tr of tracks) {
			if (isConstantTrack(tr)) continue;
			const p = this.periodOf(tr);
			if (!p) return 0;
			P = (P / gcd(P, p)) * p;
			if (P >= this.H || this.H % P) return 0;
		}
		return P > 1 ? P : 0;
	}

	/** Timing of an animation that repeats every `P` ticks, in step with the horizon. */
	periodTiming(P: number): Record<string, string> {
		const t: Record<string, string> = { dur: loopSeconds(P, this.fps), repeatCount: "indefinite" };
		if (this.begin) t.begin = this.begin;
		return t;
	}

	/** The SMIL animation(s) of a track, see MorphAnim. */
	smilOf(track: GTrack, fmtV: (v: number[]) => string, make: (a: Record<string, string>) => XmlNode): XmlNode[] {
		return this.smil([track], fmtV, make);
	}

	discreteOf(steps: { t: number; v: string }[], off: string, make: (a: Record<string, string>) => XmlNode): XmlNode[] {
		return this.smilDiscrete("", steps, off, make);
	}

	windowTimings(): Record<string, string>[] {
		return this.windows().map(([, , tail]) => this.timing(tail));
	}

	private instance(n: BakedInstance): XmlNode | null {
		if (!n.item.visible || !n.child) return null;
		if (blendHides(n.item.blendMode)) {
			cssBlendMode(n.item.blendMode, this.warn);
			return null;
		}
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
		const d = this.ctx.precision.instance(n.item, this.space);
		const comps: Comp[] = [
			{ type: "translate", tracks: [t.x, t.y], digits: [d.x, d.y] },
			{ type: "rotate", tracks: [t.rot], digits: [d.rot] },
			{ type: "skewX", tracks: [t.skw], digits: [d.skw] },
			{ type: "scale", tracks: [t.sx, t.sy], digits: [d.sx, d.sy] },
			{ type: "translate", tracks: [neg(t.tpx), neg(t.tpy)], digits: [d.tpx, d.tpy] },
		];
		inner = this.transformChain(comps, inner, t, [d.x, d.sx]);

		// colour, filters, blend
		const attrs: Record<string, string> = {};
		const style: string[] = [];
		const color = n.color;
		const colorAnimated = !!color && Object.values(color).some((tr) => !isConstantTrack(tr));
		const poster = colorAtTick(color, this.posterTick);
		const filterSets = n.filters;
		// filters sit outside the transform chain: parent orientation and units, like Animate's
		const scale = { x: 1, y: 1 };
		const size = { w: n.item.bounds.width, h: n.item.bounds.height };
		const alphaOnly = !color || allAlphaOnly(color);
		const anims: XmlNode[] = [];

		if (color && alphaOnly) {
			const alpha = (v: number[]) => fmt(Math.max(0, v[0]!) / 100, 3);
			const sa = n.item.shapeAlpha ?? 0;
			if (sa) {
				// alpha of each shape inside (inherited), as in Flash: see markShapeAlpha
				const props = [sa & 1 ? "fill-opacity" : "", sa & 2 ? "stroke-opacity" : ""].filter(Boolean);
				if (colorAnimated) {
					// CSS: one animation sets both properties
					if (this.css) this.animate(anims, style, props[0]!, [color.aP], (v) => props.map((p, i) => (i ? `;${p}:` : "") + alpha(v)).join(""), "attr");
					else for (const p of props) this.animate(anims, style, p, [color.aP], alpha, "attr");
				}
				if (poster && poster.aP !== 100) for (const p of props) attrs[p] = alpha([poster.aP]);
			} else {
				if (colorAnimated) this.animate(anims, style, "opacity", [color.aP], alpha, "attr");
				if (poster && poster.aP !== 100) attrs.opacity = alpha([poster.aP]);
			}
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
			this.discrete(
				wrap,
				"filter",
				filterSets.map((f, i) => ({ t: f.t, v: refs[i]! })),
				"none",
			);
			inner = wrap;
		}
		const blend = cssBlendMode(n.item.blendMode, this.warn);
		if (blend) style.push(`mix-blend-mode:${blend}`);
		if (n.item.blendMode === "layer") style.push("isolation:isolate");
		if (!Object.keys(attrs).length && !style.length && !anims.length && !this.pendingCss.length) return inner;
		const g = el("g", attrs, [inner, ...anims]);
		this.applyCssAnimations(g);
		// invert: a white copy (after colour and filters) blended with "difference"
		if (blendWhite(n.item.blendMode)) return el("g", { filter: this.doc.whiteFilter(), style: style.join(";") }, [g]);
		if (blendSubtract(n.item.blendMode)) {
			// SMIL: <use> copies run the same animations; CSS: copies share the animation classes
			if (!this.css) g.attrs.id = this.doc.uid("sub");
			const copy = () => (this.css || hasUse(g) ? this.copyWithFreshIds(g) : el("use", { "xlink:href": "#" + g.attrs.id }));
			const white = () => el("g", { filter: this.doc.whiteFilter(false, true), style: "mix-blend-mode:difference" }, [copy()]);
			const first = white();
			g.attrs.style = style.join(";");
			return el("g", {}, [first, g, white()]);
		}
		if (style.length) g.attrs.style = style.join(";");
		return g;
	}

	/** Reference to a (shared) baked child timeline. */
	private childRef(bt: BakedTimeline): XmlNode {
		if (bt.animated) {
			// CSS animations inside <use> shadow trees can't be paused/seeked reliably, and WebKit
			// doesn't run SMIL animations there on elements holding a <use> (the shared drawings) nor
			// reliably through two <use>: inline, and copy the first rendering for further uses
			// (CSS classes keep sharing the keyframes).
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

	/** The component's values print the same all the time (changes below the printed precision). */
	private still(c: Comp): boolean {
		return c.tracks.every((tr, k) => {
			const p = 10 ** c.digits[k]!;
			const r = Math.round((tr[0]?.v ?? 0) * p);
			return tr.every((key) => Math.round(key.v * p) === r);
		});
	}

	/** `md`: decimals of a still matrix's translation and linear part. */
	private transformChain(comps: Comp[], inner: XmlNode, t: BakedInstance["transform"], md: [number, number]): XmlNode {
		if (comps.every((c) => this.still(c))) {
			const s = fmtMatrix(staticMatrix(t, this.posterTick), ...md);
			return s ? el("g", { transform: s }, [inner]) : inner;
		}
		return this.css ? this.cssTransformChain(comps, inner, md) : this.chainNodes(comps, inner, md);
	}

	/**
	 * CSS: one element carries the individual properties translate, rotate and scale plus
	 * `transform` for what follows them (a skew, the scale after it, the transformation point):
	 * a tween of position, rotation and scale is one element with one animation. The poster
	 * stays in the transform attribute (renderers without CSS); while the animations run, a
	 * `transform` value in their keyframes replaces it (WebKit lets `transform:none` fall back to
	 * the attribute, so the identity is scale(1)). A part whose two tracks can't share keyframes
	 * (x and y easing differently...) gets its own element as before.
	 */
	private cssTransformChain(comps: Comp[], inner: XmlNode, md: [number, number]): XmlNode {
		const at = this.posterTick;
		const moving = (c: Comp) => !this.still(c);
		const ident = (c: Comp) => !moving(c) && !fmtMatrix(compMatrix(c, at), ...md);
		let i = 0;
		let T: Comp | undefined, R: Comp | undefined, S: Comp | undefined;
		const outer: Comp[] = [];
		if (comps[i]?.type === "translate") {
			const c = comps[i++]!;
			if (moving(c) && !alignTracks(c.tracks)) outer.push(c);
			else if (!ident(c)) T = c;
		}
		if (comps[i]?.type === "rotate") {
			const c = comps[i++]!;
			if (!ident(c)) R = c;
		}
		if (comps[i]?.type === "skewX" && ident(comps[i]!)) i++;
		if (comps[i]?.type === "scale" && (!moving(comps[i]!) || alignTracks(comps[i]!.tracks))) {
			if (!ident(comps[i]!)) S = comps[i];
			i++;
		}
		// the rest (from a skew on) as one function list, if its tracks can share keyframes
		let X = comps.slice(i).filter((c) => !ident(c));
		let node = inner;
		if (X.some(moving) && !alignTracks(X.flatMap((c) => c.tracks))) {
			node = this.chainNodes(X, node, md);
			X = [];
		}
		const main = [T, R, S, ...X].filter((c): c is Comp => !!c);
		if (main.some(moving)) node = this.cssTransformElement(node, T, R, S, X, md);
		else if (main.length) {
			const s = fmtMatrix(
				main.reduce((m, c) => mulM(m, compMatrix(c, at)), [1, 0, 0, 1, 0, 0] as Mat),
				...md,
			);
			if (s) node = el("g", { transform: s }, [node]);
		}
		return outer.length ? this.chainNodes(outer, node, md) : node;
	}

	private cssTransformElement(inner: XmlNode, T: Comp | undefined, R: Comp | undefined, S: Comp | undefined, X: Comp[], md: [number, number]): XmlNode {
		const at = this.posterTick;
		const g = el("g", {}, [inner]);
		const all = [T, R, S, ...X].filter((c): c is Comp => !!c);
		const poster = fmtMatrix(
			all.reduce((m, c) => mulM(m, compMatrix(c, at)), [1, 0, 0, 1, 0, 0] as Mat),
			...md,
		);
		if (poster) g.attrs.transform = poster;
		interface Slot {
			tracks: GTrack[];
			digits: number[];
			body: (v: number[]) => string;
			moving: boolean;
		}
		const slots: Slot[] = [];
		const moving = (...c: Comp[]) => c.some((x) => !this.still(x));
		if (T) slots.push({ tracks: T.tracks, digits: T.digits, body: (v) => "translate:" + cssTranslate(v[0]!, v[1]!, T.digits), moving: moving(T) });
		if (R) slots.push({ tracks: R.tracks, digits: R.digits, body: (v) => `rotate:${fmt(v[0]!, R.digits[0])}deg`, moving: moving(R) });
		if (S) slots.push({ tracks: S.tracks, digits: S.digits, body: (v) => "scale:" + cssScale(v[0]!, v[1]!, S.digits, " "), moving: moving(S) });
		if (X.length)
			slots.push({
				tracks: X.flatMap((c) => c.tracks),
				digits: X.flatMap((c) => c.digits),
				body: (v) => "transform:" + cssFunctions(X, v),
				moving: moving(...X),
			});
		const moves = (s: Slot) => s.moving;
		// slots that may share keyframes
		const groups: Slot[][] = [];
		for (const s of slots.filter(moves)) {
			const g2 = groups.find((gr) => alignTracks([...gr.flatMap((x) => x.tracks), ...s.tracks]));
			if (g2) g2.push(s);
			else groups.push([s]);
		}
		// A moving `transform` in an animation of its own next to moving translate/rotate/scale:
		// Chromium (156) then runs only the `transform` animation on the compositor and draws the
		// element without the others (the banner's pulsing button sat at 0,0). Measured: one
		// animation holding them all, or the `transform` on an element inside, draw right everywhere.
		if (groups.length > 1 && X.length && slots[slots.length - 1]!.moving)
			return this.cssTransformElement(this.cssTransformElement(inner, undefined, undefined, undefined, X, md), T, R, S, [], md);
		const valuesAt = (s: Slot, tr: GTrack[]) => tr.map((x) => trackValueAt(x, 0)).slice(0, s.tracks.length);
		// constants for the first keyframes: still slots, and the identity standing in for the attribute
		const still = slots.filter((s) => !moves(s)).map((s) => s.body(s.tracks.map((x) => trackValueAt(x, 0))));
		if (poster && !X.length) still.push("transform:scale(1)");
		this.windows().forEach(([from, len, tail], w) => {
			const extra: string[] = w ? [] : [...still];
			const anims: { keys: MKey[]; group: Slot[]; period: number }[] = [];
			for (const group of groups) {
				// repeating all through the looping horizon: once, repeating on its own (see smil)
				const period = this.commonPeriod(group.flatMap((s) => s.tracks));
				const wt = group.map((s) => (period ? s.tracks.map((tr) => sliceTrack(tr, 0, period)) : this.windowTracks(s.tracks, from, tail)));
				const flatTracks = wt.flat();
				const keys = flatTracks.every(isConstantTrack) ? null : (alignTracks(flatTracks) ?? mergeTracks(flatTracks, period || len));
				if (keys) anims.push({ keys, group, period });
				else if (!w) extra.push(...group.map((s, k) => s.body(valuesAt(s, wt[k]!))));
			}
			if (!anims.length && extra.length) anims.push({ keys: [{ t: 0, v: [], ease: "hold" }], group: [], period: 0 });
			anims.forEach(({ keys, group, period }, k) => {
				const counts = group.map((s) => s.tracks.length);
				const body = (v: number[]) => {
					let o = 0;
					return group.map((s, j) => s.body(v.slice(o, (o += counts[j]!)))).join(";");
				};
				const enc = encodeKeyframes(keys, period || len, {
					digits: group.flatMap((s) => s.digits),
					body,
					extra: k === 0 && extra.length ? extra.join(";") : undefined,
				});
				if (!enc) return;
				this.cssRule(g, this.cssName(g), enc.frames, enc.timing, tail, period);
			});
		});
		return g;
	}

	/** Components as nested elements, from the inside out: still ones folded into matrices, each animated one on its own. */
	private chainNodes(comps: Comp[], inner: XmlNode, md: [number, number]): XmlNode {
		const statics = comps.map((c) => this.still(c));
		// Order of application to points: last comp first (translate(-tp)) ... first comp last.
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
				const s = fmtMatrix(m, ...md);
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
		const [d0 = 3, d1 = d0] = c.digits;
		const fmtV = (vals: number[]) => {
			switch (c.type) {
				case "rotate":
				case "skewX":
					return fmt(vals[0]!, d0);
				case "translateX":
				case "scaleX":
					return `${fmt(vals[0]!, d0)} ${c.type === "scaleX" ? 1 : 0}`;
				case "translateY":
				case "scaleY":
					return `${c.type === "scaleY" ? 1 : 0} ${fmt(vals[0]!, d0)}`;
				default:
					return `${fmt(vals[0]!, d0)} ${fmt(vals[1]!, d1)}`;
			}
		};
		const svgType = c.type.startsWith("translate") ? "translate" : c.type.startsWith("scale") ? "scale" : c.type;
		// poster (fallback) transform on the element itself
		const pv = c.tracks.map((tr) => trackValueAt(tr, this.posterTick));
		g.attrs.transform = `${svgType}(${fmtV(pv)})`;
		if (this.css) {
			this.cssAnimation(g, "transform", c.tracks, (v) => cssFunctions([c], v), c.digits);
			return;
		}
		g.children.push(...this.smil(c.tracks, fmtV, (a) => el("animateTransform", { attributeName: "transform", type: svgType, ...a })));
	}

	/** Animates a plain attribute/property from one or more tracks sharing key times. */
	private animate(into: XmlNode[], style: string[], name: string, tracks: GTrack[], fmtV: (v: number[]) => string, _kind: "attr") {
		void style;
		if (this.css) {
			this.pendingCss.push({ prop: name, tracks, fmtV });
			return;
		}
		into.push(...this.smil(tracks, fmtV, (a) => el("animate", { attributeName: name, ...a })));
	}
	private pendingCss: { prop: string; tracks: GTrack[]; fmtV: (v: number[]) => string }[] = [];

	private applyCssAnimations(g: XmlNode) {
		// alpha values have 3 decimals
		for (const p of this.pendingCss.splice(0))
			this.cssAnimation(
				g,
				p.prop,
				p.tracks,
				p.fmtV,
				p.tracks.map(() => 3),
			);
	}

	private animateColorMatrix(node: XmlNode, color: Record<ColorProp, GTrack>) {
		// merge the 8 colour tracks on common key times (sampled where they differ)
		const tracks = COLOR_ORDER.map((p) => color[p]);
		const fmtV = (v: number[]) => matrixString(colorMatrix(Object.fromEntries(COLOR_ORDER.map((p, i) => [p, v[i]!])) as unknown as ColorMatrixValues));
		node.children.push(...this.smil(tracks, fmtV, (a) => el("animate", { attributeName: "values", ...a })));
	}

	/** Discrete switch of an attribute value over time. */
	private discrete(node: XmlNode, attr: string, steps: { t: number; v: string }[], off: string) {
		const keys = steps.map((s) => ({ t: s.t, v: s.v }));
		if (keys.length < 2 && (!keys.length || keys[0]!.t === 0)) return;
		if (this.css) {
			this.cssDiscrete(node, attr, keys, off);
			return;
		}
		node.children.push(...this.smilDiscrete(attr, keys, off));
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
				...this.smilDiscrete(
					"display",
					steps.map((s) => ({ t: s.t, v: s.on ? "inline" : "none" })),
					"none",
				),
			);
		}
		return wrap;
	}

	private timing(tail = false): Record<string, string> {
		if (tail) {
			// The tail starts when the first pass ends, and stops when a click/hover restarts it (a
			// syncbase end before the begin would make browsers drop the interval).
			if (!this.clockId) this.clockId = this.doc.uid("clock");
			const restart = this.opts.begin === "click" ? `${this.svgId}.click` : this.opts.begin === "hover" ? `${this.svgId}.mouseover` : undefined;
			const t: Record<string, string> = { dur: loopSeconds(this.H - this.tail, this.fps), begin: `${this.clockId}.end`, repeatCount: "indefinite" };
			if (restart) t.end = restart;
			return t;
		}
		const t: Record<string, string> = { dur: this.dur };
		if (this.begin) t.begin = this.begin;
		if (this.repeat) t.repeatCount = this.repeat;
		else t.fill = "freeze";
		return t;
	}

	/**
	 * SMIL animations for `tracks`, one per window (`make` gets values/keyTimes + timing). Tracks
	 * that repeat all through a looping horizon (a movie clip's loop, unrolled over the root's) are
	 * written once, repeating on their own.
	 */
	private smil(tracks: GTrack[], fmtV: (v: number[]) => string, make: (a: Record<string, string>) => XmlNode): XmlNode[] {
		const P = this.commonPeriod(tracks);
		if (P) {
			const a = this.smilValues(
				tracks.map((tr) => sliceTrack(tr, 0, P)),
				fmtV,
				P,
			);
			return a ? [make({ ...a, ...this.periodTiming(P) })] : [];
		}
		const out: XmlNode[] = [];
		for (const [from, len, tail] of this.windows()) {
			const a = this.smilValues(this.windowTracks(tracks, from, tail), fmtV, len);
			if (a) out.push(make({ ...a, ...this.timing(tail) }));
		}
		return out;
	}

	/** SMIL discrete switches, one animation per window. */
	private smilDiscrete(
		attr: string,
		steps: { t: number; v: string }[],
		off: string,
		make = (a: Record<string, string>) => el("animate", { attributeName: attr, ...a }),
	): XmlNode[] {
		const out: XmlNode[] = [];
		for (const [from, len, tail] of this.windows()) {
			const keys = this.sliceSteps(steps, from, from + len, off);
			if (tail && keys.length < 2) continue;
			const times: number[] = [],
				values: string[] = [];
			if (!keys.length || keys[0]!.t > 0) {
				times.push(0);
				values.push(off);
			}
			for (const k of keys) {
				times.push(k.t / len);
				values.push(k.v);
			}
			out.push(make({ values: values.join(";"), keyTimes: times.map(floorTime).join(";"), calcMode: "discrete", ...this.timing(tail) }));
		}
		return out;
	}

	/** values/keyTimes/keySplines for SMIL from tracks with identical key times. */
	smilValues(tracks: GTrack[], fmtV: (v: number[]) => string, H = this.H): Record<string, string> | null {
		const keys = mergeTracks(tracks, H);
		if (!keys) return null;
		const times: number[] = [],
			values: string[] = [],
			splines: string[] = [];
		let anyCurve = false;
		const add = (t: number, v: number[], spline: string) => {
			const prev = times[times.length - 1];
			let tt = t / H;
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

	/** `digits`: decimals of each track's values as `fmtV` prints them. */
	private cssAnimation(node: XmlNode, prop: string, tracks: GTrack[], fmtV: (v: number[]) => string, digits: number[]) {
		// an animation that holds what the element shows anyway (the poster) is left out
		const poster = `${prop}:${fmtV(tracks.map((tr) => trackValueAt(tr, this.posterTick)))}`;
		// repeating all through the looping horizon: once, repeating on its own (see smil)
		const P = this.commonPeriod(tracks);
		if (P) {
			const wt = tracks.map((tr) => sliceTrack(tr, 0, P));
			const keys = alignTracks(wt) ?? mergeTracks(wt, P);
			const enc = keys && encodeKeyframes(keys, P, { digits, body: (v) => `${prop}:${fmtV(v)}` });
			if (enc && !enc.constant) this.cssRule(node, this.cssName(node), enc.frames, enc.timing, false, P);
			return;
		}
		this.windows().forEach(([from, len, tail]) => {
			const wt = this.windowTracks(tracks, from, tail);
			if (wt.every(isConstantTrack)) return;
			const keys = alignTracks(wt) ?? mergeTracks(wt, len);
			if (!keys) return;
			const enc = encodeKeyframes(keys, len, { digits, body: (v) => `${prop}:${fmtV(v)}` });
			if (!enc || (enc.constant && (tail || enc.frames === `0%,to{${poster}}`))) return;
			this.cssRule(node, this.cssName(node), enc.frames, enc.timing, tail);
		});
	}

	private cssDiscrete(node: XmlNode, prop: string, steps: { t: number; v: string }[], off: string) {
		for (const [from, len, tail] of this.windows()) {
			const s = this.sliceSteps(steps, from, from + len, off);
			if (!tail || s.length > 1) this.cssDiscreteWin(node, prop, s, off, len, tail);
		}
	}

	private cssDiscreteWin(node: XmlNode, prop: string, steps: { t: number; v: string }[], off: string, H: number, tail: boolean) {
		const name = this.cssName(node);
		const frames: [string, string][] = [];
		// switch at (or just before) the exact frame time, never after it
		const pct = (t: number) => (t <= 0 ? "0" : String(Math.floor((t / H) * 1e6) / 1e4)) + "%";
		if (!steps.length || steps[0]!.t > 0) frames.push(["0%", `${prop}:${off}`]);
		for (const s of steps) frames.push([pct(s.t), `${prop}:${s.v}`]);
		// explicit end value: without it a non-repeating animation ends ("fill: both") on the
		// element's own attribute (e.g. visibility="hidden") instead of the last step
		frames.push(["to", `${prop}:${steps.length ? steps[steps.length - 1]!.v : off}`]);
		this.cssRule(node, name, groupFrames(frames), "step-end", tail);
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
		this.cssClass(node);
		return `${this.opts.idPrefix ?? ""}k${this.animCount++}`;
	}

	/** Animations of each class, in the order they were added. */
	private ruleOf = new Map<string, string[]>();

	/** `period`: ticks of an animation that repeats on its own, in step with the horizon (see smil). */
	private cssRule(node: XmlNode, name: string, frames: string, timing = "linear", tail = false, period = 0) {
		this.keyframes.push(`@keyframes ${name}{${frames}}`);
		const cls = this.cssClass(node);
		// one pass: the default iteration count (1) is left out
		const iter = this.repeat ? " infinite" : "";
		const fill = this.repeat ? "" : " both";
		const delay = this.opts.delay ? ` ${fmt(this.opts.delay, 3)}s` : "";
		// the tail loops after the first pass; until then the first animation (fill: both) holds
		const decl = tail
			? `${name} ${loopSeconds(this.H - this.tail, this.fps)} ${timing} ${fmt((this.opts.delay ?? 0) + this.tail / this.fps, 4)}s infinite`
			: period
				? `${name} ${loopSeconds(period, this.fps)} ${timing}${delay} infinite`
				: `${name} ${this.dur} ${timing}${delay}${iter}${fill}`;
		let list = this.ruleOf.get(cls);
		if (!list) {
			this.ruleOf.set(cls, (list = []));
			this.rules.push(cls);
		}
		list.push(decl);
	}

	finish(svg: XmlNode) {
		if (this.clockId && !this.css) {
			// the clock of the first pass: tails start when it ends
			svg.children.push(el("animate", { id: this.clockId, attributeName: "visibility", values: "visible", ...this.timing() }));
		}
		if (this.buttons) {
			const s = `#${this.svgId}`;
			this.doc.styles.push(
				`${s} .f2s-over,${s} .f2s-down{display:none}` +
					`${s} .f2s-btn:hover>.f2s-over{display:inline}${s} .f2s-btn:hover>.f2s-up{display:none}` +
					`${s} .f2s-btn:active>.f2s-down{display:inline}${s} .f2s-btn:active>.f2s-over,${s} .f2s-btn:active>.f2s-up{display:none}`,
			);
		}
		const begin = this.opts.begin;
		const range = this.opts.scrollRange ?? "visible";
		if (this.css && (this.keyframes.length || this.rules.length)) {
			const play =
				begin === "auto"
					? ""
					: begin === "hover"
						? `#${this.svgId}:not(:hover) *{animation-play-state:paused}`
						: begin === "visible"
							? `#${this.svgId}.f2s-wait *{animation-play-state:paused}`
							: begin === "scroll"
								? scrollCss(this.svgId, range)
								: `#${this.svgId}:not(.playing) *{animation-play-state:paused}`;
			// "reduce motion" in the system settings: no animation, every element shows its poster state
			const still = this.opts.reducedMotion !== false ? `@media (prefers-reduced-motion:reduce){#${this.svgId} *{animation:none!important}}` : "";
			const rules = this.rules.map((cls) => `#${this.svgId} .${cls}{animation:${this.ruleOf.get(cls)!.join(",")}}`);
			// (browsers before linear() get the closest classic timing: keyframes.ts withLegacyTiming)
			this.doc.styles.push(withLegacyTiming([...this.keyframes, ...rules, play, still].filter(Boolean).join("\n")));
			if (begin === "click")
				this.doc.scripts.push(`document.getElementById(${JSON.stringify(this.svgId)}).addEventListener("click",function(){this.classList.add("playing")});`);
			if (begin === "visible") this.doc.scripts.push(visibleScript(this.svgId, true));
			if (begin === "scroll" && this.H > 1) this.doc.scripts.push(scrollScriptCss(this.svgId, range, this.H / this.fps));
		}
		if (!this.css && this.H > 1) {
			if (begin === "visible") this.doc.scripts.push(visibleScript(this.svgId, false));
			if (begin === "scroll") this.doc.scripts.push(scrollScript(this.svgId, range, this.H / this.fps));
		}
		void svg;
	}
}

// ---------------------------------------------------------------------- helpers

/**
 * Animations of one morph channel's track. A track that repeats (a movie clip looping a shape
 * tween) is written once, with its own repeating timing: path data is long, and the horizon may
 * hold many loops. One step per frame (no smoothing) is written as discrete values, each once.
 */
class MorphAnim {
	private readonly w: Writer;
	private readonly P: number;
	private readonly track: GTrack;
	private readonly steps: boolean;
	constructor(w: Writer, track: GTrack) {
		this.w = w;
		this.P = w.periodOf(track);
		this.track = this.P ? sliceTrack(track, 0, this.P) : track;
		this.steps = track.every((k) => k.ease === "hold");
	}

	values(text: (v: number) => string, make: (a: Record<string, string>) => XmlNode): XmlNode[] {
		const { P, track } = this;
		if (this.steps) {
			const steps = track.map((k) => ({ t: k.t, v: text(k.v) }));
			if (!P) return this.w.discreteOf(steps, text(track[0]!.v), make);
			const times = steps.map((x) => floorTime(x.t / P));
			return [make({ values: steps.map((x) => x.v).join(";"), keyTimes: times.join(";"), calcMode: "discrete", ...this.w.periodTiming(P) })];
		}
		if (!P) return this.w.smilOf(this.track, (v) => text(v[0]!), make);
		const a = this.w.smilValues([track], (v) => text(v[0]!), P);
		return a ? [make({ ...a, ...this.w.periodTiming(P) })] : [];
	}

	/** A constant part (same timing as the values, so it joins their sandwich). */
	fixed(make: (a: Record<string, string>) => XmlNode): XmlNode[] {
		return this.P ? [make(this.w.periodTiming(this.P))] : this.w.windowTimings().map(make);
	}
}

interface Comp {
	type: "translate" | "rotate" | "skewX" | "scale" | "translateX" | "translateY" | "scaleX" | "scaleY";
	tracks: GTrack[];
	/** Decimals of each track's values (see Precision). */
	digits: number[];
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
	return (
		fixed(color.rP, 100) && fixed(color.gP, 100) && fixed(color.bP, 100) && fixed(color.rA, 0) && fixed(color.gA, 0) && fixed(color.bA, 0) && fixed(color.aA, 0)
	);
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

/** Value of the CSS translate property ("10px", "0 5px", "10px 5px"). */
function cssTranslate(x: number, y: number, d: number[]): string {
	const a = fmt(x, d[0]),
		b = fmt(y, d[1]);
	const px = (s: string) => (s === "0" ? "0" : s + "px");
	return b === "0" ? px(a) : `${px(a)} ${px(b)}`;
}

/** Two scale factors, one if they are the same. */
function cssScale(x: number, y: number, d: number[], sep: string): string {
	const a = fmt(x, d[0]),
		b = fmt(y, d[1]);
	return a === b ? a : a + sep + b;
}

/** Components as a CSS transform function list, from their tracks' values in order. */
function cssFunctions(comps: Comp[], v: number[]): string {
	let i = 0;
	const px = (n: number, d: number) => {
		const s = fmt(n, d);
		return s === "0" ? "0" : s + "px";
	};
	return comps
		.map((c) => {
			const [d0 = 3, d1 = d0] = c.digits;
			switch (c.type) {
				case "rotate":
				case "skewX":
					return `${c.type}(${fmt(v[i++]!, d0)}deg)`;
				case "scale":
					return `scale(${cssScale(v[i++]!, v[i++]!, c.digits, ",")})`;
				case "scaleX":
					return `scale(${fmt(v[i++]!, d0)},1)`;
				case "scaleY":
					return `scale(1,${fmt(v[i++]!, d0)})`;
				case "translateX":
					return `translate(${px(v[i++]!, d0)})`;
				case "translateY":
					return `translate(0,${px(v[i++]!, d0)})`;
				default:
					return `translate(${px(v[i++]!, d0)},${px(v[i++]!, d1)})`;
			}
		})
		.join(" ");
}

/** Two-track components whose tracks have different key times are split in two (they commute). */
function splitComp(c: Comp): Comp[] {
	if (c.tracks.length < 2) return [c];
	const [a, b] = c.tracks as [GTrack, GTrack];
	if (sameTiming(a, b)) return [c];
	const [da, db] = c.digits as [number, number];
	if (c.type === "translate") {
		return [
			{ type: "translateX", tracks: [a], digits: [da] },
			{ type: "translateY", tracks: [b], digits: [db] },
		];
	}
	if (c.type === "scale") {
		return [
			{ type: "scaleX", tracks: [a], digits: [da] },
			{ type: "scaleY", tracks: [b], digits: [db] },
		];
	}
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

/** A matrix as SVG's translate · rotate · skewX · scale: [tx, ty, degrees, skew degrees, sx, sy]. */
function svgParts(m: Mat): [number, number, number, number, number, number] {
	const [a, b, c, d, e, f] = m;
	const r = Math.atan2(b, a);
	const sx = Math.hypot(a, b);
	// the y axis in the rotated frame: (sy · tan k, sy)
	const c1 = Math.cos(r) * c + Math.sin(r) * d,
		d1 = -Math.sin(r) * c + Math.cos(r) * d;
	return [e, f, (r * 180) / Math.PI, (Math.atan2(c1, d1) * 180) / Math.PI, sx, Math.hypot(c1, d1) * Math.sign(d1 || 1)];
}

/** A morph's ratio track with a key at every frame (holds kept). */
function everyFrame(track: GTrack): GTrack {
	if (track.length < 2 || track.every((k) => k.ease === "hold")) return track;
	const out: GTrack = [];
	const last = track[track.length - 1]!;
	for (let t = Math.ceil(track[0]!.t); t < last.t; t++) out.push({ ...track[0]!, t, v: trackValueAt(track, t), ease: "linear" });
	out.push({ ...last });
	return out;
}

function hasUse(n: XmlNode): boolean {
	return n.name === "use" || n.children.some((c) => typeof c !== "string" && hasUse(c));
}

function walkNodes(n: XmlNode, fn: (n: XmlNode) => void) {
	fn(n);
	for (const c of n.children) if (typeof c !== "string") walkNodes(c, fn);
}

function hasAnim(node: XmlNode): boolean {
	return node.children.some((c) => typeof c !== "string" && (c.name === "animate" || c.name === "animateTransform"));
}
