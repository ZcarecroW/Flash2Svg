import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { compileScene, type ExportSettings } from "../../src/core/compile.ts";
import { evalBezier } from "../../src/core/easing.ts";
import { internals } from "../../src/core/emit/lottie.ts";
import { trackRepeats } from "../../src/core/emit/periods.ts";
import type { SceneModel } from "../../src/core/model.ts";
import { valueAt, type Track } from "../../src/core/tracks.ts";

const { bezierPaths, trackProp, sawtooth, lottieFilters, effectsJson, composeCT, applyCT } = internals;
type Json = Record<string, unknown>;

function compile(name: string, settings: Partial<ExportSettings>) {
	const model: SceneModel = JSON.parse(readFileSync(new URL(`../fixtures/models/${name}.json`, import.meta.url), "utf8"));
	// the stored models come without their atlas: every artwork is a stand-in square
	const files = {
		readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#336699" d="M0 0L5 0 5 5 0 5Z"/></svg>`,
		readBinary: () => new Uint8Array(),
	};
	return compileScene(model, files, settings);
}

const require = createRequire(import.meta.url);
const { LottieValidator, get_schema_path } = require("@lottie-animation-community/lottie-specs/src/validator-node.js");
const { Ajv2020 } = require("ajv/dist/2020");
const validator = new LottieValidator(Ajv2020, JSON.parse(readFileSync(get_schema_path(), "utf8")));

/** A Lottie property's value at frame t (keyframes with their easing handles). */
function propAt(p: Json, t: number): number[] {
	if (p.a !== 1) return ([] as number[]).concat(p.k as number[]);
	const k = p.k as Json[];
	if (t <= (k[0]!.t as number)) return k[0]!.s as number[];
	for (let i = 0; i + 1 < k.length; i++) {
		const a = k[i]!,
			b = k[i + 1]!;
		if (t >= (b.t as number)) continue;
		const s = a.s as number[],
			e = b.s as number[];
		if (a.h) return s;
		const u = (t - (a.t as number)) / ((b.t as number) - (a.t as number));
		return s.map((v, d) => {
			const pick = (h: unknown) => (Array.isArray(h) ? (h[d] as number) : (h as number));
			const o = a.o as { x: unknown; y: unknown },
				i2 = a.i as { x: unknown; y: unknown };
			const pr = evalBezier([pick(o.x), pick(o.y), pick(i2.x), pick(i2.y)], u);
			return v + (e[d]! - v) * pr;
		});
	}
	return k[k.length - 1]!.s as number[];
}

describe("Lottie output", () => {
	const names = ["f02-eases", "f03-transforms", "f06-motionobject", "f09-guide", "f10-canvas", "f12-labels", "f28-onestop", "f32-blend2"];

	it("is valid against the Lottie spec schema", () => {
		// what the schema doesn't list but players need: lottie-web reads "v" (the format version)
		// and "st" on every layer; "td" marks a track matte, "bm" a blend mode, "ef" effects
		const allowed = /unknown property '(v|st|td|bm|ef)'/;
		for (const name of names) {
			const json = compile(name, { format: "lottie" }).files[0]!.svg;
			const problems = validator.validate(JSON.parse(json), true) as { type: string; message: string; path: string }[];
			expect(
				problems.filter((p) => p.type === "error"),
				name,
			).toEqual([]);
			for (const p of problems) expect(p.message, name).toMatch(allowed);
		}
	});

	it("packs a dotLottie v2 archive with the same animation, the same bytes every time", () => {
		const json = compile("f12-labels", { format: "lottie" }).files[0]!.svg;
		const a = compile("f12-labels", { format: "dotlottie" }).files[0]!;
		const b = compile("f12-labels", { format: "dotlottie" }).files[0]!;
		expect(a.ext).toBe(".lottie");
		expect(Buffer.from(a.bytes!).equals(Buffer.from(b.bytes!))).toBe(true);
		const zip = unzipSync(a.bytes!);
		const manifest = JSON.parse(strFromU8(zip["manifest.json"]!));
		expect(manifest.version).toBe("2");
		const id = manifest.animations[0].id as string;
		expect(id).toMatch(/^[a-zA-Z0-9._\- ]+$/);
		expect(strFromU8(zip[`a/${id}.json`]!)).toBe(json);
	});

	it("turns labels into markers and writes a frame range", () => {
		const anim = JSON.parse(compile("f12-labels", { format: "lottie" }).files[0]!.svg);
		expect((anim.markers as Json[]).length).toBeGreaterThan(0);
		for (const m of anim.markers as Json[]) expect(m).toMatchObject({ cm: expect.any(String), tm: expect.any(Number), dr: expect.any(Number) });
		expect(anim.op).toBeGreaterThan(anim.ip);
	});

	it("draws a looping movie clip once and plays it again by a time remap", () => {
		// f28: the root stops on its only frame while movie clips keep running
		const anim = JSON.parse(compile("f28-onestop", { format: "lottie" }).files[0]!.svg);
		const remaps = JSON.stringify(anim).match(/"tm":\{"a":1/g) ?? [];
		expect(remaps.length).toBeGreaterThan(0);
	});
});

describe("Lottie effects", () => {
	const warnings: string[] = [];
	const warn = (m: string) => warnings.push(m);
	const effects = (filters: Json[]) => {
		const fx = lottieFilters(filters as never, warn);
		return { fx, ef: effectsJson({ a: 0, b: 10, fx, sets: [{ t: 0, fx }] }, null) };
	};
	const value = (ef: Json, name: string) => ((ef.ef as Json[]).find((v) => v.nm === name)!.v as Json).k;

	it("writes blurs as Gaussian blurs (blurriness = sigma / 0.3), two directions when they differ", () => {
		const even = effects([{ name: "blurFilter", blurX: 10, blurY: 10, quality: "high" }]);
		expect(even.ef).toHaveLength(1);
		expect(even.ef[0]).toMatchObject({ ty: 29, nm: "Gaussian Blur" });
		expect(value(even.ef[0]!, "Blurriness")).toBeCloseTo(Math.sqrt((3 * 99) / 12) / 0.3, 1);
		expect(value(even.ef[0]!, "Blur Dimensions")).toBe(1);
		const uneven = effects([{ name: "blurFilter", blurX: 10, blurY: 4, quality: "low" }]);
		expect(uneven.ef.map((e) => value(e, "Blur Dimensions"))).toEqual([2, 3]);
	});

	it("writes drop shadows with Flash's whole-pixel offset as direction and distance, glows unmoved", () => {
		const { ef } = effects([{ name: "dropShadowFilter", angle: 45, distance: 10, blurX: 4, blurY: 4, color: "#FF000080", strength: 100, quality: "low" }]);
		expect(ef[0]).toMatchObject({ ty: 25, nm: "Drop Shadow" });
		// (7, 7): clockwise from up
		expect(value(ef[0]!, "Direction")).toBe(135);
		expect(value(ef[0]!, "Distance")).toBeCloseTo(9.9, 2);
		expect(value(ef[0]!, "Opacity")).toBeCloseTo(128, 0);
		expect(value(ef[0]!, "Shadow Color")).toEqual([1, 0, 0, 1]);
		const glow = effects([{ name: "glowFilter", distance: 10, blurX: 6, blurY: 6, color: "#00FF00", strength: 50 }]).ef[0]!;
		expect(value(glow, "Distance")).toBe(0);
		expect(value(glow, "Opacity")).toBeCloseTo(127.5, 1);
	});

	it("leaves out what Lottie has no effect for, with a warning", () => {
		warnings.length = 0;
		const { fx } = effects([
			{ name: "dropShadowFilter", inner: true },
			{ name: "glowFilter", knockout: true },
			{ name: "bevelFilter" },
			{ name: "gradientGlowFilter" },
			{ name: "blurFilter", enabled: false, blurX: 9, blurY: 9 },
		]);
		expect(fx.slots).toEqual([]);
		expect(warnings.join("\n")).toMatch(/drop shadows.*left out[\s\S]*glows.*left out[\s\S]*bevel[\s\S]*gradient glow/);
	});

	it("puts colour adjustments into the paints and the colour of the shadows before them", () => {
		const { fx, ef } = effects([
			{ name: "dropShadowFilter", angle: 0, distance: 4, blurX: 0, blurY: 0, color: "#FF0000" },
			{ name: "adjustColorFilter", saturation: -100, brightness: 0, contrast: 0, hue: 0 },
		]);
		expect(fx.matrix).toHaveLength(20);
		// red without saturation: its luminance (0.3086) in every channel
		const [r, g, b] = value(ef[0]!, "Shadow Color") as number[];
		expect(r).toBeCloseTo(0.3086, 3);
		expect(g).toBeCloseTo(0.3086, 3);
		expect(b).toBeCloseTo(0.3086, 3);
	});

	it("composes colour transforms and matrices in order", () => {
		const tint = [0.5, 0.8, 1, 1, 0.1, 0, 0.2, 0];
		const m = [0.3, 0.6, 0.1, 0, 0, 0.3, 0.6, 0.1, 0, 0.05, 0.3, 0.6, 0.1, 0, 0, 0, 0, 0, 1, 0];
		const c: [number, number, number, number] = [0.2, 0.4, 0.6, 1];
		const twice = applyCT(m, applyCT(tint, c));
		const once = applyCT(composeCT(tint, m), c);
		for (let i = 0; i < 4; i++) expect(once[i]).toBeCloseTo(twice[i]!, 9);
	});

	it("puts filtered instances' effects on a layer of their own, valid otherwise", () => {
		const anim = JSON.parse(compile("f32-blend2", { format: "lottie" }).files[0]!.svg);
		const all = JSON.stringify(anim);
		expect(all).toMatch(/"ef":\[\{"ty":25/);
		expect(all).toMatch(/"ty":29/);
	});
});

describe("dotLottie state machine", () => {
	const archive = (settings: Partial<ExportSettings>) => {
		const zip = unzipSync(compile("f28-onestop", { format: "dotlottie", ...settings }).files[0]!.bytes!);
		const manifest = JSON.parse(strFromU8(zip["manifest.json"]!));
		const anim = JSON.parse(strFromU8(zip[`a/${manifest.animations[0].id}.json`]!));
		const sm = zip["s/playback.json"] ? JSON.parse(strFromU8(zip["s/playback.json"])) : null;
		return { manifest, anim, sm };
	};
	const marker = (anim: Json, name: string) => (anim.markers as Json[]).find((m) => m.cm === name)!;

	it("plays the intro once, then the tail (a stop() with movie clips running)", () => {
		const { manifest, anim, sm } = archive({});
		expect(manifest.stateMachines).toEqual([{ id: "playback", name: "Playback" }]);
		expect(manifest.initial).toEqual({ stateMachine: "playback" });
		expect(sm.initial).toBe("intro");
		const [intro, tail] = sm.states as Json[];
		expect(intro).toMatchObject({
			name: "intro",
			type: "PlaybackState",
			segment: "intro",
			loop: false,
			autoplay: true,
			entryActions: [{ type: "SetFrame", value: 0 }],
		});
		expect(intro!.transitions).toEqual([{ type: "Transition", toState: "tail", guards: [{ type: "Event", inputName: "introDone" }] }]);
		expect(tail).toMatchObject({ name: "tail", segment: "loop", loop: true });
		expect(sm.interactions).toEqual([{ type: "OnComplete", stateName: "intro", actions: [{ type: "Fire", inputName: "introDone" }] }]);
		// dotLottie players play a marker's last frame too: [tm, tm + dr]
		const json = JSON.parse(compile("f28-onestop", { format: "lottie" }).files[0]!.svg);
		const tm = marker(json, "loop").tm as number;
		expect(marker(json, "intro")).toMatchObject({ tm: 0, dr: tm });
		expect(marker(json, "loop")).toMatchObject({ dr: json.op - tm });
		expect(marker(anim, "intro")).toMatchObject({ tm: 0, dr: tm - 1 });
		expect(marker(anim, "loop")).toMatchObject({ tm, dr: anim.op - tm - 1 });
	});

	it("waits on the poster for a click, hover or the page, and starts again on the next one", () => {
		const { anim, sm } = archive({ begin: "click", posterFrame: "last" });
		expect(sm.initial).toBe("idle");
		const idle = (sm.states as Json[])[0]!;
		expect(idle).toMatchObject({ name: "idle", autoplay: false, segment: "poster" });
		expect(marker(anim, "poster")).toMatchObject({ tm: anim.op - 1, dr: 1 });
		expect(sm.inputs).toContainEqual({ type: "Event", name: "play" });
		expect(sm.interactions).toContainEqual({ type: "Click", actions: [{ type: "Fire", inputName: "play" }] });
		for (const s of sm.states as Json[])
			expect(s.transitions, s.name as string).toContainEqual({ type: "Transition", toState: "intro", guards: [{ type: "Event", inputName: "play" }] });
		const hover = archive({ begin: "hover" }).sm;
		expect(hover.interactions).toContainEqual({ type: "PointerEnter", actions: [{ type: "Fire", inputName: "play" }] });
		const manual = archive({ begin: "manual" }).sm;
		expect((manual.interactions as Json[]).map((i) => i.type)).toEqual(["OnComplete"]);
	});

	it("loops or plays once as a whole without a tail", () => {
		expect(archive({ loop: "always" }).sm.states).toEqual([expect.objectContaining({ name: "play", loop: true })]);
		const once = compile("f02-eases", { format: "dotlottie", loop: "never" }).files[0]!.bytes!;
		const sm = JSON.parse(strFromU8(unzipSync(once)["s/playback.json"]!));
		expect(sm).toMatchObject({ initial: "play", states: [{ name: "play", loop: false }] });
	});
});

describe("Lottie paths", () => {
	it("writes quadratic curves as the same cubic curves and closes contours", () => {
		const [c] = bezierPaths("M0 0Q10 10 20 0L20 10 0 10 0 0Z", true, 3);
		expect(c!.c).toBe(true);
		// the end point is the start again: dropped
		expect(c!.v).toEqual([
			[0, 0],
			[20, 0],
			[20, 10],
			[0, 10],
		]);
		// control point (10,10): out-tangent 2/3 of the way to it from (0,0), in-tangent from (20,0)
		expect(c!.o[0]).toEqual([6.667, 6.667]);
		expect(c!.i[1]).toEqual([-6.667, 6.667]);
		expect(c!.i[0]).toEqual([0, 0]);
	});

	it("keeps strokes open", () => {
		const [c] = bezierPaths("M0 0L10 0 10 10", false, 2);
		expect(c!.c).toBe(false);
		expect(c!.v.length).toBe(3);
	});
});

describe("Lottie keyframes", () => {
	it("keys two dimensions at the union of their keys, eases cut exactly", () => {
		const x: Track = [
			{ t: 0, v: 0, ease: [0.42, 0, 0.58, 1] },
			{ t: 10, v: 100, ease: "hold" },
		];
		const y: Track = [
			{ t: 0, v: 50, ease: "linear" },
			{ t: 4, v: 70, ease: [0.3, 0, 0.7, 1] },
			{ t: 12, v: 10, ease: "hold" },
		];
		const p = trackProp([x, y], [1, 1], [0, 0], 6);
		for (let t = 0; t <= 12; t += 0.25) {
			const [vx, vy] = propAt(p, t);
			expect(vx, `x at ${t}`).toBeCloseTo(valueAt(x, t), 2);
			expect(vy, `y at ${t}`).toBeCloseTo(valueAt(y, t), 2);
		}
	});

	it("lets one dimension jump while the other moves", () => {
		const x: Track = [
			{ t: 0, v: 0, ease: "hold" },
			{ t: 6, v: 30, ease: "hold" },
		];
		const y: Track = [
			{ t: 0, v: 0, ease: "linear" },
			{ t: 6, v: 60, ease: "hold" },
		];
		const p = trackProp([x, y], [1, 1], [0, 0], 6);
		const mid = propAt(p, 3);
		expect(mid[0]).toBe(0);
		expect(mid[1]).toBeCloseTo(30, 6);
		expect(propAt(p, 5.9)[0]).toBe(0);
		expect(propAt(p, 6).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([30, 60]);
	});

	it("plays a period over and over in step with the clock", () => {
		const tm = sawtooth(3, 20, 6, 24);
		const local = (t: number) => propAt(tm, t)[0]! * 24;
		for (const t of [3, 4, 5.5, 6, 7, 11.9, 12, 17, 19]) expect(local(t), `at ${t}`).toBeCloseTo(t % 6, 2);
		// never just below a frame boundary (a layer starting there would be missed)
		expect(local(10)).toBeGreaterThanOrEqual(4);
	});
});

describe("repetition", () => {
	it("compares tracks as curves: the same motion keyed differently repeats", () => {
		const flat = [0, 6, 14, 22, 30, 38].map((t) => ({ t, v: 0, ease: "linear" as const }));
		expect(trackRepeats(flat, 8, 40)).toBe(true);
		const ramp: Track = [];
		for (let c = 0; c < 40; c += 8) ramp.push({ t: c, v: 0, ease: "linear" }, { t: c + 7, v: 90, ease: "hold" });
		expect(trackRepeats(ramp, 8, 40)).toBe(true);
		expect(trackRepeats(ramp, 7, 40)).toBe(false);
	});
});
