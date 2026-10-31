/**
 * JS-player output: artwork in <defs>, the timeline program as JSON, the poster frame as static
 * content (shown where scripts don't run, e.g. <img>), and the runtime script.
 */
import type { ExportSettings } from "../compile.ts";
import type { Context } from "../context.ts";
import { fmt } from "../geom.ts";
import { COLOR_PROPS, TRANSFORM_PROPS, type InstanceItem, type Item, type Program } from "../program.ts";
import { valueAt, type Track } from "../tracks.ts";
import { cdata, serialize, el, walk, type XmlNode } from "../xml.ts";
import type { PChannel, PFrameSound, PInst, PItem, PListener, PMorph, PProgram, PSeq, PTimeline, PTrack } from "../../player/format.ts";
import type { HandlerAction, InteractionEvent } from "../snippets.ts";
import { channelNumbers, channelText, channelVaries, type MorphChannel } from "../morph.ts";
import { audioMime } from "../mime.ts";
import { accAttrs, OutputDoc, svgRoot } from "./document.ts";
import { blendHides, blendSubtract, blendWhite, cssBlendMode } from "./filters.ts";
import { PLAYER_RUNTIMES } from "./runtime-code.generated.ts";
import { StaticRenderer } from "./static.ts";
import { outlineText, textNode } from "./text.ts";
import { SCROLL_RANGE_CODES } from "./triggers.ts";
import { playhead } from "./timing.ts";

const LOOP_CODES: Record<string, number> = { loop: 0, "play once": 1, "single frame": 2, "loop reverse": 3, "play once reverse": 4 };
const EVENT_CODES: Record<InteractionEvent, number> = { click: 0, over: 1, out: 2, down: 3, up: 4, dblclick: 5 };

/** A handler action in the player's format (see PListener). */
function actionCode(a: HandlerAction): (number | string)[] {
	if (a.type === "url") return [6, a.url, a.window];
	if (a.type === "visible") return [5, a.target, a.value ? 1 : 0];
	if (a.type === "goto") return [2, a.target, typeof a.frame === "number" ? a.frame - 1 : a.frame, a.play ? 1 : 0];
	return [{ stop: 0, play: 1, next: 3, prev: 4 }[a.type], a.target];
}

export function renderPlayer(ctx: Context, rootId: string, s: ExportSettings): { svg: string; assets: OutputDoc["assets"]; drawingBytes: OutputDoc["drawingBytes"] } {
	const doc = new OutputDoc(ctx, { embedImages: s.embedImages, idPrefix: s.idPrefix ?? "" });
	const svgId = doc.uid("player");
	const d = ctx.model.doc;
	const P: PProgram = { v: 1, fps: d.frameRate || 24, w: d.width, h: d.height, root: rootId, bz: [], tl: {}, snd: {}, mf: "" };
	const bzIndex = new Map<string, number>();
	const warn = (m: string) => {
		if (!ctx.warnings.includes(m)) ctx.warnings.push(m);
	};

	const track = (t: Track, digits: number): PTrack => {
		if (!t.length) return 0;
		const r = (v: number) => Math.round(v * 10 ** digits) / 10 ** digits;
		if (t.every((k) => Math.abs(k.v - t[0]!.v) < 1e-9)) return r(t[0]!.v);
		const out: number[] = [];
		for (const k of t) {
			let e: number;
			if (k.ease === "hold") e = 0;
			else if (k.ease === "linear") e = 1;
			else {
				const b = k.ease.map((x) => Math.round(x * 10000) / 10000) as [number, number, number, number];
				const key = b.join(",");
				let i = bzIndex.get(key);
				if (i === undefined) {
					i = P.bz.length;
					P.bz.push(b);
					bzIndex.set(key, i);
				}
				e = i + 2;
			}
			out.push(Math.round(k.t * 10000) / 10000, r(k.v), e);
		}
		return out;
	};

	/** A morph channel for the program, its numbers rounded. */
	const channel = (ch: MorphChannel, node: number): PChannel => {
		const kind = ch.kind === "d" ? 0 : ch.kind === "color" ? 1 : ch.kind === "num" ? 2 : 3;
		const D = ctx.precision.space(space);
		const dig = (i: number) => (kind === 0 ? D : kind === 1 ? 1 : kind === 2 ? 4 : i % 6 < 4 ? 5 : D);
		const round = (v: number[]) => v.map((x, i) => Math.round(x * 10 ** dig(i)) / 10 ** dig(i));
		const cmds = ch.cmds ?? "";
		return ch.s ? [node, ch.attr, kind, cmds, round(ch.s), round(ch.e!)] : [node, ch.attr, kind, cmds, ch.f!.map(round)];
	};

	const filterRefs = new Map<string, string>();
	// the program whose items are being written (its coordinate space, see Precision)
	let space = "";
	const item = (it: Item): PItem | null => {
		switch (it.kind) {
			case "art": {
				const a = ctx.art(it.art);
				return a ? { k: "a", s: it.start, e: it.end, r: doc.artwork(a) } : null;
			}
			case "artSeq": {
				// shape tweens: frames blended by a morph drawing, see morph.ts
				const morph = s.morph !== false ? ctx.morph(it) : null;
				const parts = morph?.parts ?? [];
				const rs = it.arts.map((id, k) => {
					if (parts.some((p) => k >= p.from && k < p.to)) return "";
					const a = ctx.art(id);
					return a ? doc.artwork(a) : "";
				});
				const q: PSeq = { k: "q", s: it.start, e: it.end, rs };
				if (morph && parts.length) {
					q.rt = track(morph.ratio, 4);
					if (!s.smooth) q.st = 1;
					q.mp = parts.map((p) => {
						const copy = doc.morphCopy(p.art);
						const c: PChannel[] = [];
						const at = copy.defs.length ? 1 : 0;
						for (const ch of p.channels) {
							// the first frame's values in the drawing; what changes in the program
							copy.nodes[ch.node]!.attrs[ch.attr] = channelText(ch, channelNumbers(ch, p.ratio ? 0 : valueAt(morph.ratio, it.start + p.from), 0), ctx.precision.space(space));
							if (channelVaries(ch)) c.push(channel(ch, ch.node + at));
						}
						const m: PMorph = { a: p.from, b: p.to, r: doc.morphTemplate(p.art.id, copy.defs, copy.body), c };
						if (p.ratio) m.rt = track(p.ratio, 4);
						return m;
					});
				}
				return q;
			}
			case "bitmap": {
				const node = doc.image(it.bitmap, it.matrix, ctx.precision.space(space));
				if (!node) return null;
				const id = doc.uid("bmp");
				doc.defs.push(el("g", { id }, [node]));
				return { k: "a", s: it.start, e: it.end, r: id };
			}
			case "text": {
				if (s.textAsOutlines || it.element.textType === "static") {
					const a = it.art ? ctx.art(it.art) : null;
					if (!a) return null;
					const id = doc.artwork(a);
					// its words as ARIA attributes on the <use>
					const labelled = outlineText(it.element, el("use", {}));
					return { k: "a", s: it.start, e: it.end, r: id, ...(labelled.name === "g" ? { ac: labelled.attrs as Record<string, string> } : {}) };
				}
				return { k: "r", s: it.start, e: it.end, x: serialize(textNode(it.element, ctx.precision.space(space))) };
			}
			case "instance":
				return instance(it);
		}
	};

	const instance = (it: InstanceItem): PInst => {
		const p: PInst = {
			k: "i",
			s: it.start,
			e: it.end,
			y: it.symbol,
			t: it.symbolType === "graphic" ? 1 : it.symbolType === "button" ? 2 : 0,
			tr: TRANSFORM_PROPS.map((k) => track(it.transform[k], ctx.precision.instance(it, space)[k])),
		};
		if (it.name) p.nm = it.name;
		const acc = accAttrs(it.acc, it.symbolType === "button");
		if (acc) {
			p.ac = acc;
			if (it.acc!.description && !it.acc!.silent) p.ad = it.acc!.description;
		}
		if (!it.visible || blendHides(it.blendMode)) p.hd = 1;
		if (it.color) {
			p.c = COLOR_PROPS.map((k) => track(it.color![k], 2));
			const fixed = (k: (typeof COLOR_PROPS)[number], v: number) => it.color![k].every((key) => Math.abs(key.v - v) < 1e-9);
			const alphaOnly = fixed("rP", 100) && fixed("gP", 100) && fixed("bP", 100) && fixed("rA", 0) && fixed("gA", 0) && fixed("bA", 0) && fixed("aA", 0);
			if (!alphaOnly) p.cm = 1;
			else if (it.shapeAlpha) p.sa = it.shapeAlpha;
		}
		if (it.filters.length) {
			// applied outside the instance transform, in the parent's units (see the runtime)
			const size = { w: it.bounds.width, h: it.bounds.height };
			p.f = it.filters.map((f) => {
				const key = JSON.stringify(f.filters);
				let ref = filterRefs.get(key);
				if (ref === undefined) {
					const url = doc.filter(f.filters, null, { x: 1, y: 1 }, warn, size);
					ref = url ? url.slice(5, -1) : "";
					filterRefs.set(key, ref);
				}
				return [f.t, ref] as [number, string];
			});
		}
		const blend = cssBlendMode(it.blendMode, warn);
		if (blend) p.b = blend;
		if (blendWhite(it.blendMode)) p.w = doc.whiteFilter().slice(5, -1);
		if (blendSubtract(it.blendMode)) p.su = doc.whiteFilter(false, true).slice(5, -1);
		if (it.graphic) p.g = it.graphic.map((g) => [g.start, g.end, LOOP_CODES[g.loop] ?? 0, g.firstFrame, g.lastFrame]);
		return p;
	};

	const timeline = (prog: Program): PTimeline => {
		const t: PTimeline = { n: prog.frameCount, ly: [] };
		if (prog.labels.length) t.lb = Object.fromEntries(prog.labels.map((l) => [l.name, l.frame]));
		const acts = Object.entries(prog.actions);
		if (acts.length) {
			t.ac = {};
			for (const [f, list] of acts) {
				t.ac[+f] = list.map((a) => {
					const code = a.type === "stop" ? [0] : a.type === "play" ? [1] : [2, typeof a.target === "number" ? a.target - 1 : a.target, a.play ? 1 : 0];
					return a.passes ? [9, a.passes.from, a.passes.before, ...code] : code;
				});
			}
		}
		if (prog.interactions?.length) t.ev = prog.interactions.map((i): PListener => [i.frame, i.on, EVENT_CODES[i.event], ...i.actions.map(actionCode)]);
		if (prog.inShapeAlpha) t.ia = 1;
		if (prog.view) {
			const d = ctx.precision.view(prog.id);
			t.vw = (["x", "y", "rot", "skw", "sx", "sy"] as const).map((k) => track(prog.view![k], d[k]));
		}
		const indexOfLayer = new Map(prog.layers.map((l, i) => [l.index, i]));
		space = prog.id;
		for (const l of prog.layers) {
			const items = l.items.map(item).filter((x): x is PItem => !!x);
			const pl: PTimeline["ly"][number] = { it: items };
			if (l.type === "mask") pl.m = 1;
			if (l.maskMode === "alpha") {
				pl.mm = 1;
				if (l.maskBox) pl.mx = [l.maskBox.left, l.maskBox.top, l.maskBox.width, l.maskBox.height].map((v) => Math.round(v * 100) / 100);
				P.wf = doc.whiteFilter().slice(5, -1);
			} else if (l.maskMode === "erase") {
				pl.mm = 2;
				P.bf = doc.whiteFilter(true).slice(5, -1);
			}
			if (l.maskedBy >= 0 && indexOfLayer.has(l.maskedBy)) pl.mb = indexOfLayer.get(l.maskedBy)!;
			t.ly.push(pl);
		}
		return t;
	};

	for (const id in ctx.programs) P.tl[id] = timeline(ctx.programs[id]!);
	// hairlines (non-scaling strokes) here or in a symbol inside: see PTimeline.hl
	const artHairline = new Map<string, boolean>();
	const hasHairline = (artId: string) => {
		let r = artHairline.get(artId);
		if (r === undefined) {
			const a = ctx.art(artId);
			r = false;
			if (a) for (const n of [a.body, ...a.defs]) walk(n, (x) => void (x.attrs["vector-effect"] && (r = true)));
			artHairline.set(artId, r);
		}
		return r;
	};
	const hairlines = new Map<string, boolean>();
	const drawsHairlines = (id: string): boolean => {
		let r = hairlines.get(id);
		if (r !== undefined) return r;
		hairlines.set(id, false); // (cycle guard)
		const prog = ctx.programs[id];
		r =
			!!prog &&
			prog.layers.some((l) =>
				l.items.some((it) =>
					it.kind === "art" ? hasHairline(it.art) : it.kind === "artSeq" ? it.arts.some(hasHairline) : it.kind === "text" ? !!it.art && hasHairline(it.art) : it.kind === "instance" ? drawsHairlines(it.symbol) : false,
				),
			);
		hairlines.set(id, r);
		return r;
	};
	for (const id in P.tl) if (drawsHairlines(id)) P.tl[id]!.hl = 1;
	// frame sounds
	for (const id in ctx.programs) {
		const tl = ctx.model.timelines[ctx.programs[id]!.source ?? id];
		if (!tl) continue;
		const sd: NonNullable<PTimeline["sd"]> = [];
		for (const layer of tl.layers)
			for (const kf of layer.keyframes) {
				const fs = kf.sound;
				if (!fs) continue;
				const sync = { event: 0, start: 1, stop: 2, stream: 3 }[fs.sync] ?? 0;
				const e: PFrameSound = [kf.index, fs.sound, sync, fs.loopMode === "loop" ? 9999 : fs.loops || 1, kf.duration];
				const snd = ctx.model.sounds[fs.sound];
				// in and out point in the file (encodeSounds cut off what no frame plays)
				const trim = snd?.trim ?? 0;
				const length = snd?.seconds;
				const lim = fs.limits;
				const inPt = lim ? Math.max(0, (lim.start - trim) / 44100) : 0;
				const outPt = lim && lim.end < 1073741823 ? (lim.end - trim) / 44100 : undefined;
				const hasOut = outPt !== undefined && (length === undefined || outPt < length - 1e-4);
				if (inPt > 1e-4 || hasOut) e.push(round(inPt, 4), hasOut ? round(outPt, 4) : undefined);
				if (fs.envelope?.length) {
					while (e.length < 7) e.push(undefined);
					e.push(fs.envelope.flatMap(([t, l, r]) => [round(t / 44100, 4), round(l / 32768, 3), round(r / 32768, 3)]));
				}
				sd.push(e);
			}
		if (sd.length && tl.kind === "graphic") warn(`Sounds inside graphic symbols don't play (as in Flash): ${tl.name}`);
		if (sd.length && P.tl[id]) P.tl[id]!.sd = sd;
	}
	for (const sid in ctx.model.sounds) {
		const snd = ctx.model.sounds[sid]!;
		let url = snd.file;
		if (s.embedImages) url = `data:${audioMime(snd.file)};base64,${toBase64(ctx.files.readBinary(snd.file))}`;
		else doc.assets.push({ path: snd.file, source: snd.file });
		P.snd[sid] = snd.seconds !== undefined ? [url, round(snd.seconds, 4), round(snd.lead ?? 0, 5)] : url;
	}
	P.mf = doc.maskFilter().slice(5, -1);

	// Poster: the static frame, removed by the runtime when it starts
	const root = ctx.programs[rootId]!;
	const ph = playhead(root);
	// the first pass: the prefix and one round of the cycle (frame scripts may loop to any frame)
	const pass = [...ph.prefix, ...ph.cycle];
	if (ph.cycle.length && (ph.prefix.length || pass.some((f, i) => f !== i))) P.on = pass.length;
	const posterFrame = s.posterFrame === "last" ? (pass[pass.length - 1] ?? 0) : 0;
	// (also the still frame for "reduce motion")
	if (posterFrame) P.pf = posterFrame;
	const sr = new StaticRenderer(ctx, doc, { movieClips: "first", textAsOutlines: s.textAsOutlines });
	const poster = el("g", { class: "f2s-poster" }, sr.timeline(root, posterFrame, posterFrame, 0));

	const svg = svgRoot(ctx, {
		id: svgId,
		"data-f2s": "1",
		"data-begin": s.begin,
		"data-loop": s.loop === "never" || s.begin === "scroll" ? "0" : "1",
		"data-delay": s.delay && s.begin !== "scroll" ? fmt(s.delay, 3) : "",
		...(s.begin === "scroll" ? { "data-scroll": String(SCROLL_RANGE_CODES[s.scrollRange ?? "visible"]) } : {}),
		...(s.reducedMotion === false ? { "data-reduce": "0" } : {}),
	});
	if (s.includeBackground) svg.children.push(el("rect", { width: fmt(d.width, 2), height: fmt(d.height, 2), fill: d.backgroundColor }));
	svg.children.push(poster);
	svg.children.push(el("script", { type: "application/json" }, [cdata(JSON.stringify(P).replace(/</g, "\\u003c"))]));
	const morphs = Object.values(P.tl).some((t) => t.ly.some((l) => l.it.some((i) => i.k === "q" && i.mp)));
	// mouse handlers and the start triggers share a build
	const events = s.begin === "visible" || s.begin === "scroll" || Object.values(P.tl).some((t) => t.ev);
	doc.scripts.push(PLAYER_RUNTIMES[(Object.keys(P.snd).length ? 1 : 0) + (morphs ? 2 : 0) + (events ? 4 : 0)]!);
	return { svg: doc.toString(svg, { pretty: s.pretty }), assets: doc.assets, drawingBytes: doc.drawingBytes };
}

function round(v: number, digits: number): number {
	const k = 10 ** digits;
	return Math.round(v * k) / k;
}

function toBase64(bytes: Uint8Array): string {
	const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
	if (B) return B.from(bytes).toString("base64");
	let str = "";
	for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
	return btoa(str);
}

export type { XmlNode };
