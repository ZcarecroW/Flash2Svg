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

const { bezierPaths, trackProp, sawtooth } = internals;
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
		// and "st" on every layer; "td" marks a track matte, "bm" a blend mode
		const allowed = /unknown property '(v|st|td|bm)'/;
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
