import { describe, expect, it } from "vitest";
import type { GTrack } from "../../src/core/emit/bake.ts";
import { alignTracks, encodeKeyframes, serializeLinear, legacyTiming, linearCurve, withLegacyTiming } from "../../src/core/emit/keyframes.ts";
import { evalBezier } from "../../src/core/easing.ts";
import { fmt } from "../../src/core/geom.ts";
import { valueAt, type Track } from "../../src/core/tracks.ts";

/** linear() as CSS Easing 2 defines it: default ends, clamped inputs, even spacing, then interpolation. */
function evalLinear(fn: string, x: number): number {
	const stops = fn
		.slice(7, -1)
		.split(",")
		.map((s) => s.trim().split(/\s+/));
	const pts: { y: number; x: number | null }[] = [];
	for (const s of stops) {
		const y = parseFloat(s[0]!);
		if (s.length === 1) pts.push({ y, x: null });
		for (const p of s.slice(1)) pts.push({ y, x: parseFloat(p) / 100 });
	}
	if (pts[0]!.x === null) pts[0]!.x = 0;
	if (pts[pts.length - 1]!.x === null) pts[pts.length - 1]!.x = 1;
	let max = -Infinity;
	for (const p of pts)
		if (p.x !== null) {
			if (p.x < max) p.x = max;
			max = p.x;
		}
	for (let i = 0; i < pts.length; i++) {
		if (pts[i]!.x !== null) continue;
		let j = i;
		while (pts[j]!.x === null) j++;
		const a = pts[i - 1]!.x!,
			b = pts[j]!.x!;
		for (let k = i; k < j; k++) pts[k]!.x = a + ((b - a) * (k - i + 1)) / (j - i + 1);
		i = j;
	}
	// the last point at or before x (a jump: the later one)
	let i = 0;
	while (i < pts.length - 1 && pts[i + 1]!.x! <= x) i++;
	const p = pts[i]!,
		q = pts[i + 1];
	if (!q || q.x! === p.x!) return p.y;
	return p.y + ((q.y - p.y) * (x - p.x!)) / (q.x! - p.x!);
}

/** The value CSS shows at tick t for a one-number keyframes string over H ticks (prop "v"). */
function evalFrames(frames: string, timing: string, H: number, t: number): number {
	const keys: { at: number; v: number; tf: string }[] = [];
	for (const m of frames.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		const v = parseFloat(/v:([-.\d]+)/.exec(m[2]!)![1]!);
		const tf = /animation-timing-function:(.+)$/.exec(m[2]!)?.[1] ?? timing;
		for (const sel of m[1]!.split(",")) keys.push({ at: sel === "to" ? 1 : parseFloat(sel) / 100, v, tf });
	}
	keys.sort((a, b) => a.at - b.at);
	const x = t / H;
	let i = 0;
	while (i < keys.length - 1 && keys[i + 1]!.at <= x) i++;
	const a = keys[i]!,
		b = keys[i + 1];
	if (!b) return a.v;
	const u = (x - a.at) / (b.at - a.at);
	const p =
		a.tf === "linear"
			? u
			: a.tf === "step-end"
				? 0
				: a.tf.startsWith("linear(")
					? evalLinear(a.tf, u)
					: evalBezier(a.tf.slice(13, -1).split(",").map(Number) as [number, number, number, number], u);
	return a.v + (b.v - a.v) * p;
}

const encode1 = (track: GTrack, H: number, digits = 2) =>
	encodeKeyframes(alignTracks([track])!, H, { digits: [digits], body: (v) => `v:${fmt(v[0]!, digits)}` })!;

describe("alignTracks", () => {
	it("merges tracks with different key times exactly, cutting eased pieces", () => {
		const a: GTrack = [
			{ t: 0, v: 0, ease: [0.4, 0, 0.2, 1] },
			{ t: 10, v: 100, ease: "hold" },
		];
		const b: GTrack = [
			{ t: 0, v: 5, ease: "hold" },
			{ t: 10, v: 5, ease: "linear" },
			{ t: 20, v: 25, ease: "hold" },
		];
		const keys = alignTracks([a, b])!;
		expect(keys.map((k) => k.t)).toEqual([0, 10, 20]);
		for (let t = 0; t <= 20; t += 0.5) {
			// rebuild each track from the merged keys
			for (let c = 0; c < 2; c++) {
				const tr: Track = keys.map((k) => ({ t: k.t, v: k.v[c]!, ease: k.ease }));
				expect(valueAt(tr, t)).toBeCloseTo(valueAt((c ? b : a) as Track, t), 9);
			}
		}
	});

	it("cuts a bezier where another track has a key", () => {
		const a: GTrack = [
			{ t: 0, v: 0, ease: [0.3, 0.1, 0.6, 1] },
			{ t: 12, v: 60, ease: "hold" },
		];
		const b: GTrack = [
			{ t: 0, v: 0, ease: [0.3, 0.1, 0.6, 1] },
			{ t: 4, v: 1, ease: "hold" },
			{ t: 12, v: 1, ease: "hold" },
		];
		// b changes on [0, 4] with the same curve shape as a only if cut alike: they differ, so no merge
		expect(alignTracks([a, b])).toBeNull();
		// a alone, cut at 4: exact
		const c: GTrack = [
			{ t: 0, v: 7, ease: "hold" },
			{ t: 4, v: 7, ease: "hold" },
			{ t: 12, v: 7, ease: "hold" },
		];
		const keys = alignTracks([a, c])!;
		const tr: Track = keys.map((k) => ({ t: k.t, v: k.v[0]!, ease: k.ease }));
		for (let t = 0; t <= 12; t += 0.25) expect(valueAt(tr, t)).toBeCloseTo(valueAt(a as Track, t), 9);
	});

	it("keeps jumps as two keys at the same time", () => {
		const a: GTrack = [
			{ t: 0, v: 0, ease: "linear" },
			{ t: 5, v: 10, ease: "hold" },
			{ t: 5, v: 50, ease: "linear" },
			{ t: 10, v: 60, ease: "hold" },
		];
		const keys = alignTracks([a, [{ t: 0, v: 3, ease: "hold" }]])!;
		expect(keys.filter((k) => k.t === 5).map((k) => k.v[0])).toEqual([10, 50]);
	});
});

describe("encodeKeyframes", () => {
	it("leaves the animation's own timing out of the keyframes and groups equal ones", () => {
		const tr: GTrack = [
			{ t: 0, v: 0, ease: [0.42, 0, 0.58, 1] },
			{ t: 10, v: 100, ease: [0.42, 0, 0.58, 1] },
			{ t: 20, v: 0, ease: "hold" },
		];
		const k = encode1(tr, 30);
		expect(k.timing).toBe("cubic-bezier(.42,0,.58,1)");
		// offsets rounded down (a jump never comes late)
		expect(k.frames).toBe("0%,66.6666%,to{v:0}33.3333%{v:100}");
	});

	it("writes frame-by-frame samples on one line as a single linear() without positions", () => {
		// an ease Animate computes itself: one sample per frame
		const tr: GTrack = Array.from({ length: 25 }, (_, i) => ({ t: i, v: 300 * (i / 24) ** 2, ease: i < 24 ? ("linear" as const) : ("hold" as const) }));
		const k = encode1(tr, 24);
		expect(k.frames).toBe("0%{v:0}to{v:300}");
		expect(k.timing).toMatch(/^linear\(0,[^%]*,1\)$/);
		for (let t = 0; t <= 24; t += 0.125) expect(Math.abs(evalFrames(k.frames, k.timing, 24, t) - valueAt(tr as Track, t))).toBeLessThan(0.01);
	});

	it("writes steps as flat stretches in linear() where the keyframes are longer", () => {
		// a stepped move along a line: x and y follow one progress
		const p = (i: number) => (i / 12) ** 1.5;
		const x: GTrack = Array.from({ length: 13 }, (_, i) => ({ t: i * 2, v: 40 + 360 * p(i), ease: "hold" as const }));
		const y: GTrack = x.map((k, i) => ({ ...k, v: 300 - 120 * p(i) }));
		const k = encodeKeyframes(alignTracks([x, y])!, 24, { digits: [2, 2], body: (v) => `v:${fmt(v[0]!, 2)};w:${fmt(v[1]!, 2)};rotate:0deg;scale:1.5` })!;
		expect(k.timing).toMatch(/^linear\(.* 0% /);
		for (let t = 0; t < 24; t += 0.25) expect(Math.abs(evalFrames(k.frames, k.timing, 24, t) - valueAt(x as Track, t))).toBeLessThan(0.011);
		// a short body: the stepped keyframes (no timing each) stay shorter
		const tr: GTrack = Array.from({ length: 13 }, (_, i) => ({ t: i * 2, v: 10 + 5 * Math.sin(i / 3) * i, ease: "hold" as const }));
		const s = encode1(tr, 24);
		expect(s.timing).toBe("step-end");
		for (let t = 0; t < 24; t += 0.25) expect(Math.abs(evalFrames(s.frames, s.timing, 24, t) - valueAt(tr as Track, t))).toBeLessThan(0.006);
	});

	it("keeps exact eases where linear() would be longer", () => {
		const tr: GTrack = [
			{ t: 0, v: 0, ease: [0.39, 0.68, 0.7, 1] },
			{ t: 6, v: 150, ease: [0.33, 0, 0.67, 0.33] },
			{ t: 8, v: 140, ease: [0.32, 0.83, 0.64, 1] },
			{ t: 12, v: 100, ease: "hold" },
		];
		const k = encode1(tr, 12);
		expect(k.frames).not.toMatch(/linear\(/);
		for (let t = 0; t <= 12; t += 0.1) expect(Math.abs(evalFrames(k.frames, k.timing, 12, t) - valueAt(tr as Track, t))).toBeLessThan(0.006);
	});

	it("adds constant declarations to the first and last keyframes", () => {
		const k = encodeKeyframes(
			alignTracks([
				[
					{ t: 0, v: 0, ease: "linear" },
					{ t: 5, v: 10, ease: "hold" },
				],
			])!,
			10,
			{ digits: [2], body: (v) => `translate:${fmt(v[0]!, 2)}px`, extra: "transform:scale(1)" },
		)!;
		expect(k.frames).toBe("0%{translate:0px;transform:scale(1)}50%,to{translate:10px;transform:scale(1)}");
	});
});

describe("serializeLinear", () => {
	it("leaves out evenly spaced positions and writes jumps as 0%", () => {
		expect(
			serializeLinear(
				[
					{ p: 0, x: 0 },
					{ p: 0.25, x: 1 / 3 },
					{ p: 0.5, x: 2 / 3 },
					{ p: 1, x: 1 },
				],
				2,
				1,
			),
		).toBe("linear(0,.25,.5,1)");
		// .25 lands at 25% between 0 and the written 50%
		const uneven = serializeLinear(
			[
				{ p: 0, x: 0 },
				{ p: 0.25, x: 0.25 },
				{ p: 0.5, x: 0.5 },
				{ p: 1, x: 1 },
			],
			2,
			1,
		);
		expect(uneven).toBe("linear(0,.25,.5 50%,1)");
		expect(evalLinear(uneven, 0.25)).toBeCloseTo(0.25, 9);
		const steps = serializeLinear(
			[
				{ p: 0, x: 0 },
				{ p: 0, x: 0.5 },
				{ p: 1, x: 0.5 },
				{ p: 1, x: 1 },
			],
			2,
			1,
		);
		expect(steps).toBe("linear(0 0% 50%,1 0% 100%)");
		expect(evalLinear(steps, 0.49)).toBe(0);
		expect(evalLinear(steps, 0.5)).toBe(1);
	});
});

describe("linear() fallbacks for older browsers", () => {
	it("reads linear() as the spec fills in positions", () => {
		const f = linearCurve("0, .25 50%, 1")!;
		expect(f(0.25)).toBeCloseTo(0.125);
		expect(f(0.75)).toBeCloseTo(0.625);
		// positions before an earlier one move up to it: a jump
		const j = linearCurve("0 0% 40%, 1 10%, 1")!;
		expect(j(0.39)).toBe(0);
		expect(j(0.41)).toBe(1);
		// missing positions spread evenly
		const e = linearCurve("0, .5, .75, 1")!;
		expect(e(1 / 3)).toBeCloseTo(0.5);
		expect(linearCurve("nonsense")).toBeNull();
	});

	it("picks the closest classic timing", () => {
		expect(legacyTiming("linear(0, 1)")).toBe("linear");
		expect(legacyTiming("linear(0, 1 1%, 1)")).toBe("step-start");
		expect(legacyTiming("linear(0, 0 99%, 1)")).toBe("step-end");
		expect(legacyTiming("linear(0, .5 20%, .8 40%, .95 60%, 1)")).toBe("ease");
		expect(legacyTiming("linear(0, .3 20%, .6 40%, .85 70%, 1)")).toBe("ease-out");
		expect(legacyTiming("linear(0,.1 40%,.9 60%,1)")).toBe("ease-in-out");
	});

	it("writes a fallback before each declaration with linear(), which old browsers keep", () => {
		const css = "#a .b{animation:k1 2s linear(0,1 1%,1) infinite,k2 2s step-end infinite}@keyframes k{50%{x:1;animation-timing-function:linear(0,0 99%,1)}}";
		const out = withLegacyTiming(css);
		expect(out).toBe(
			"#a .b{animation:k1 2s step-start infinite,k2 2s step-end infinite;animation:k1 2s linear(0,1 1%,1) infinite,k2 2s step-end infinite}@keyframes k{50%{x:1;animation-timing-function:step-end;animation-timing-function:linear(0,0 99%,1)}}",
		);
		// a browser that can't read linear() drops those declarations: an animation is left
		const old = out.replace(/[^;{}]*linear\([^;{}]*;?/g, "");
		expect(old).toContain("animation:k1 2s step-start infinite,k2 2s step-end infinite");
		expect(withLegacyTiming("#a{animation:k 1s linear infinite}")).toBe("#a{animation:k 1s linear infinite}");
	});
});
