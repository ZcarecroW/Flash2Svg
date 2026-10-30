/**
 * JS-player output: artwork in <defs>, the timeline program as JSON, the poster frame as static
 * content (shown where scripts don't run, e.g. <img>), and the runtime script.
 */
import type { ExportSettings } from "../compile.ts";
import type { Context } from "../context.ts";
import { fmt } from "../geom.ts";
import { COLOR_PROPS, TRANSFORM_PROPS, type InstanceItem, type Item, type Program } from "../program.ts";
import type { Track } from "../tracks.ts";
import { cdata, serialize, el, type XmlNode } from "../xml.ts";
import type { PInst, PItem, PProgram, PTimeline, PTrack } from "../../player/format.ts";
import { OutputDoc, svgRoot } from "./document.ts";
import { blendHides, blendSubtract, blendWhite, cssBlendMode } from "./filters.ts";
import { PLAYER_RUNTIME } from "./runtime-code.generated.ts";
import { StaticRenderer } from "./static.ts";
import { textNode } from "./text.ts";
import { playhead } from "./timing.ts";

const LOOP_CODES: Record<string, number> = { loop: 0, "play once": 1, "single frame": 2, "loop reverse": 3, "play once reverse": 4 };

export function renderPlayer(ctx: Context, rootId: string, s: ExportSettings): { svg: string; assets: OutputDoc["assets"] } {
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

	const filterRefs = new Map<string, string>();
	const item = (it: Item): PItem | null => {
		switch (it.kind) {
			case "art": {
				const a = ctx.art(it.art);
				return a ? { k: "a", s: it.start, e: it.end, r: doc.artwork(a) } : null;
			}
			case "artSeq": {
				const rs = it.arts.map((id) => {
					const a = ctx.art(id);
					return a ? doc.artwork(a) : "";
				});
				return { k: "q", s: it.start, e: it.end, rs };
			}
			case "bitmap": {
				const node = doc.image(it.bitmap, it.matrix);
				if (!node) return null;
				const id = doc.uid("bmp");
				doc.defs.push(el("g", { id }, [node]));
				return { k: "a", s: it.start, e: it.end, r: id };
			}
			case "text": {
				if (s.textAsOutlines || it.element.textType === "static") {
					const a = it.art ? ctx.art(it.art) : null;
					return a ? { k: "a", s: it.start, e: it.end, r: doc.artwork(a) } : null;
				}
				return { k: "r", s: it.start, e: it.end, x: serialize(textNode(it.element, ctx.digits)) };
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
			tr: TRANSFORM_PROPS.map((k) => track(it.transform[k], k === "sx" || k === "sy" ? 4 : k === "rot" || k === "skw" ? 3 : ctx.digits)),
		};
		if (it.name) p.nm = it.name;
		if (!it.visible || blendHides(it.blendMode)) p.hd = 1;
		if (it.color) {
			p.c = COLOR_PROPS.map((k) => track(it.color![k], 2));
			const fixed = (k: (typeof COLOR_PROPS)[number], v: number) => it.color![k].every((key) => Math.abs(key.v - v) < 1e-9);
			const alphaOnly = fixed("rP", 100) && fixed("gP", 100) && fixed("bP", 100) && fixed("rA", 0) && fixed("gA", 0) && fixed("bA", 0) && fixed("aA", 0);
			if (!alphaOnly) p.cm = 1;
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
		if (prog.view) t.vw = (["x", "y", "rot", "skw", "sx", "sy"] as const).map((k) => track(prog.view![k], k === "sx" || k === "sy" ? 4 : 3));
		const indexOfLayer = new Map(prog.layers.map((l, i) => [l.index, i]));
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
	// frame sounds
	for (const id in ctx.programs) {
		const tl = ctx.model.timelines[ctx.programs[id]!.source ?? id];
		if (!tl) continue;
		const sd: NonNullable<PTimeline["sd"]> = [];
		for (const layer of tl.layers)
			for (const kf of layer.keyframes)
				if (kf.sound) {
					const sync = { event: 0, start: 1, stop: 2, stream: 3 }[kf.sound.sync] ?? 0;
					sd.push([kf.index, kf.sound.sound, sync, kf.sound.loopMode === "loop" ? 9999 : kf.sound.loops || 1, kf.duration]);
				}
		if (sd.length && P.tl[id]) P.tl[id]!.sd = sd;
	}
	for (const sid in ctx.model.sounds) {
		const snd = ctx.model.sounds[sid]!;
		if (s.embedImages) {
			const bytes = ctx.files.readBinary(snd.file);
			const mime = snd.file.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
			P.snd[sid] = `data:${mime};base64,${toBase64(bytes)}`;
		} else {
			P.snd[sid] = snd.file;
			doc.assets.push({ path: snd.file, source: snd.file });
		}
	}
	P.mf = doc.maskFilter().slice(5, -1);

	// Poster: the static frame, removed by the runtime when it starts
	const root = ctx.programs[rootId]!;
	const ph = playhead(root);
	const posterFrame = s.posterFrame === "last" ? (ph.cycle.length ? root.frameCount - 1 : (ph.prefix[ph.prefix.length - 1] ?? 0)) : 0;
	const sr = new StaticRenderer(ctx, doc, { movieClips: "first", textAsOutlines: s.textAsOutlines });
	const poster = el("g", { class: "f2s-poster" }, sr.timeline(root, posterFrame, posterFrame, 0));

	const svg = svgRoot(ctx, {
		id: svgId,
		"data-f2s": "1",
		"data-begin": s.begin,
		"data-loop": s.loop === "never" ? "0" : "1",
		"data-delay": s.delay ? fmt(s.delay, 3) : "",
	});
	if (s.includeBackground) svg.children.push(el("rect", { width: fmt(d.width, 2), height: fmt(d.height, 2), fill: d.backgroundColor }));
	svg.children.push(poster);
	svg.children.push(el("script", { type: "application/json" }, [cdata(JSON.stringify(P).replace(/</g, "\\u003c"))]));
	doc.scripts.push(PLAYER_RUNTIME);
	return { svg: doc.toString(svg, { pretty: s.pretty }), assets: doc.assets };
}

function toBase64(bytes: Uint8Array): string {
	const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
	if (B) return B.from(bytes).toString("base64");
	let str = "";
	for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
	return btoa(str);
}

export type { XmlNode };
