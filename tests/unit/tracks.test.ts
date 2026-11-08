import { describe, expect, it } from "vitest";
import { fitCurve, fitTogether, valueAt, type Track } from "../../src/core/tracks.ts";

/** Values at frames 0..dur of 100 + 300 · ease(f / dur), rounded to twips like Animate's in-betweens. */
const frames = (dur: number, ease: (s: number) => number, twips = true) =>
	Array.from({ length: dur + 1 }, (_, f) => {
		const v = 100 + 300 * ease(f / dur);
		return twips ? Math.round(v * 20) / 20 : v;
	});

const miss = (track: Track, vals: number[], t0 = 0) => Math.max(...vals.map((v, f) => Math.abs(valueAt(track, t0 + f) - v)));

describe("fitCurve", () => {
	it("passes every frame within the tolerance", () => {
		const eases: ((s: number) => number)[] = [
			(s) => s * s,
			(s) => 1 - (1 - s) ** 5,
			(s) => -(Math.cos(Math.PI * s) - 1) / 2,
			(s) => (s < 0.5 ? 4 * s ** 3 : 1 - (-2 * s + 2) ** 3 / 2),
			(s) => Math.sin(4 * Math.PI * s) * 0.3 + s,
			(s) => Math.sqrt(1 - (s - 1) ** 2),
		];
		for (const dur of [5, 12, 24, 60])
			for (const e of eases) {
				const vals = frames(dur, e);
				const track = fitCurve(vals, 10, 0.05);
				expect(miss(track, vals, 10)).toBeLessThanOrEqual(0.05 + 1e-9);
				expect(track[0]!.t).toBe(10);
				expect(track[track.length - 1]!.t).toBe(10 + dur);
			}
	});

	it("needs one curve for a quadratic ease, two keys for a straight run", () => {
		expect(fitCurve(frames(24, (s) => s * s, false), 0, 0.05)).toHaveLength(2);
		const lin = fitCurve(frames(30, (s) => s), 0, 0.05);
		expect(lin).toHaveLength(2);
		expect(lin[0]!.ease).toBe("linear");
	});

	it("needs far fewer keys than frames for eased motion", () => {
		for (const e of [(s: number) => 1 - (1 - s) ** 2, (s: number) => -(Math.cos(Math.PI * s) - 1) / 2]) expect(fitCurve(frames(60, e), 0, 0.05).length).toBeLessThanOrEqual(4);
	});

	it("keeps every timing function inside the unit box (SMIL keySplines) and keys at turning points", () => {
		const vals = frames(48, (s) => Math.sin(2 * Math.PI * s) * 0.5);
		const track = fitCurve(vals, 0, 0.05);
		for (const k of track) if (Array.isArray(k.ease)) for (const c of k.ease) expect(c >= 0 && c <= 1).toBe(true);
		// the top and the bottom of the wave are keys
		const ts = track.map((k) => k.t);
		expect(ts).toContain(12);
		expect(ts).toContain(36);
	});

	it("writes curved pieces straight where that takes no more keys than a curve costs", () => {
		const vals = frames(6, (s) => s * s);
		const cheap = fitCurve(vals, 0, 0.05, 10);
		expect(cheap.every((k) => !Array.isArray(k.ease))).toBe(true);
		expect(miss(cheap, vals)).toBeLessThanOrEqual(0.05 + 1e-9);
	});
});

describe("fitTogether", () => {
	it("gives values moving along a line the same keys and timing functions", () => {
		const p = frames(24, (s) => 1 - (1 - s) ** 3, false);
		const xs = p.map((v) => 50 + v),
			ys = p.map((v) => 200 - v * 0.4);
		const [tx, ty] = fitTogether([xs, ys], 0, [0.1, 0.1])!;
		expect(tx!.map((k) => [k.t, k.ease])).toEqual(ty!.map((k) => [k.t, k.ease]));
		expect(miss(tx!, xs)).toBeLessThanOrEqual(0.1);
		expect(miss(ty!, ys)).toBeLessThanOrEqual(0.1);
	});

	it("breaks the line at a corner (a motion tween's position keyframe)", () => {
		const xs: number[] = [],
			ys: number[] = [];
		for (let f = 0; f <= 23; f++) {
			xs.push(f <= 11 ? 50 + (120 * f) / 11 : 170 + (260 * (f - 11)) / 12);
			ys.push(f <= 11 ? 50 + (80 * f) / 11 : 130);
		}
		const [tx, ty] = fitTogether([xs, ys], 0, [0.1, 0.1])!;
		expect(tx!.map((k) => k.t)).toEqual([0, 11, 23]);
		expect(miss(tx!, xs)).toBeLessThanOrEqual(0.1);
		expect(miss(ty!, ys)).toBeLessThanOrEqual(0.1);
	});

	it("follows a bent path within the tolerance", () => {
		const xs = Array.from({ length: 31 }, (_, f) => 100 * Math.cos((f / 30) * Math.PI)),
			ys = Array.from({ length: 31 }, (_, f) => 100 * Math.sin((f / 30) * Math.PI));
		const [tx, ty] = fitTogether([xs, ys], 0, [0.1, 0.1])!;
		for (let f = 0; f <= 30; f++) expect(Math.hypot(valueAt(tx!, f) - xs[f]!, valueAt(ty!, f) - ys[f]!)).toBeLessThanOrEqual(0.1 * 1.13);
	});
});

describe("fitCurve on the Motion Editor's curves", () => {
	/** A property curve as Animate keeps it: a cubic Bezier over (frame, value), sampled at frames, in twips. */
	const editorCurve = (p: [number, number][], frames: number) =>
		Array.from({ length: frames + 1 }, (_, f) => {
			let lo = 0,
				hi = 1;
			const at = (u: number, i: 0 | 1) => (1 - u) ** 3 * p[0]![i] + 3 * (1 - u) ** 2 * u * p[1]![i] + 3 * (1 - u) * u * u * p[2]![i] + u ** 3 * p[3]![i];
			for (let it = 0; it < 60; it++) {
				const u = (lo + hi) / 2;
				if (at(u, 0) < f) lo = u;
				else hi = u;
			}
			return Math.round(at(lo, 1) * 20) / 20;
		});

	it("takes a key per rising or falling piece, at the peak between frames", () => {
		// a bent path's y: up from 190 and back (handles 8 frames out, 200 px up)
		const arc = editorCurve(
			[
				[0, 190],
				[8, -10],
				[15, -10],
				[23, 190],
			],
			23,
		);
		const track = fitCurve(arc, 0, 0.05);
		expect(track.map((k) => k.t)).toEqual([0, 11.5, 23]);
		expect(miss(track, arc)).toBeLessThanOrEqual(0.05 + 1e-9);
		// an S: down, up past the start, back
		const s = editorCurve(
			[
				[0, 330],
				[8, 470],
				[15, 190],
				[23, 330],
			],
			23,
		);
		const st = fitCurve(s, 0, 0.05);
		expect(st).toHaveLength(4);
		expect(miss(st, s)).toBeLessThanOrEqual(0.05 + 1e-9);
	});
});
