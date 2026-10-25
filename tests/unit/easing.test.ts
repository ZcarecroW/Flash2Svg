import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classicEase, easePieces, evalBezier, evalEase, LINEAR, type EaseCurve } from "../../src/core/easing.ts";
import type { SceneModel } from "../../src/core/model.ts";

function model(name: string): SceneModel {
	return JSON.parse(readFileSync(new URL(`../fixtures/models/${name}.json`, import.meta.url), "utf8"));
}

describe("classic ease", () => {
	it("matches the quadratic formula", () => {
		for (const e of [-100, -50, 0, 30, 100]) {
			const k = e / 100;
			for (const t of [0.1, 0.25, 0.5, 0.9]) {
				expect(evalEase(classicEase(e), t)).toBeCloseTo(t + k * t * (1 - t), 6);
			}
		}
	});

	it("predicts Animate's own tween samples (f02-eases)", () => {
		const m = model("f02-eases");
		const root = m.timelines[m.roots[0]!]!;
		const checked: string[] = [];
		for (const layer of root.layers) {
			const kf = layer.keyframes[0]!;
			const tw = kf.tween;
			if (!tw?.samples || tw.customEase) continue;
			const next = layer.keyframes[1]!;
			const x0 = (kf.elements[0] as { matrix: number[] }).matrix[4]!;
			const x1 = (next.elements[0] as { matrix: number[] }).matrix[4]!;
			const curve = classicEase(tw.easing);
			tw.samples.forEach((s, i) => {
				const predicted = x0 + (x1 - x0) * evalEase(curve, i / kf.duration);
				expect(Math.abs(predicted - s.matrix[4])).toBeLessThan(0.06);
			});
			checked.push(layer.name);
		}
		expect(checked.sort()).toEqual(["ease50", "easeIn", "easeOut", "linear"]);
	});

	it("predicts a multi-point custom ease with overshoot", () => {
		const m = model("f02-eases");
		const layer = m.timelines[m.roots[0]!]!.layers.find((l) => l.name === "customOvershoot")!;
		const kf = layer.keyframes[0]!;
		const curve = kf.tween!.customEase!.all as EaseCurve;
		const x0 = 50,
			x1 = 420;
		let maxErr = 0;
		kf.tween!.samples!.forEach((s, i) => {
			const predicted = x0 + (x1 - x0) * evalEase(curve, i / kf.duration);
			maxErr = Math.max(maxErr, Math.abs(predicted - s.matrix[4]));
		});
		expect(maxErr).toBeLessThan(0.06);
	});
});

describe("ease pieces", () => {
	it("keeps linear as one linear piece", () => {
		const p = easePieces(LINEAR, { clampY: true });
		expect(p).toHaveLength(1);
		expect(p[0]!.bezier.map((v) => +v.toFixed(4))).toEqual([0.3333, 0.3333, 0.6667, 0.6667]);
	});

	it("splits overshoot at extrema so SMIL control points stay in 0..1, without changing the curve much", () => {
		const curve: EaseCurve = [
			{ x: 0, y: 0 },
			{ x: 0.2, y: 0.9 },
			{ x: 0.35, y: 1.25 },
			{ x: 0.5, y: 1.1 },
			{ x: 0.65, y: 0.95 },
			{ x: 0.8, y: 1 },
			{ x: 1, y: 1 },
		];
		const pieces = easePieces(curve, { clampY: true });
		expect(pieces.length).toBeGreaterThan(2);
		for (const p of pieces) {
			for (const v of p.bezier) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(1);
			}
		}
		// Re-evaluate the piecewise curve and compare
		for (let x = 0; x <= 1.0001; x += 0.02) {
			const piece = pieces.find((p) => x <= p.x1 + 1e-9) ?? pieces[pieces.length - 1]!;
			const local = (x - piece.x0) / (piece.x1 - piece.x0);
			const y = piece.y0 + (piece.y1 - piece.y0) * evalBezier(piece.bezier, local);
			expect(Math.abs(y - evalEase(curve, x))).toBeLessThan(0.01);
		}
	});
});
