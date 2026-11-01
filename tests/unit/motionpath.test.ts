import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileScene } from "../../src/core/compile.ts";
import { angleAtLength, fitGuided, guideCurve, pointAtLength, project, spatialKeys } from "../../src/core/motionpath.ts";
import type { InstanceElement, SceneModel } from "../../src/core/model.ts";
import { valueAt, type Track } from "../../src/core/tracks.ts";

// the user guide's motion-guide demo: a curve of six quadratic pieces, a ball and an oriented dart
const dir = new URL("../../docs/guide/demos/models/path/", import.meta.url);
const model: SceneModel = JSON.parse(readFileSync(new URL("scene.json", dir), "utf8"));
const root = model.timelines[model.roots[0]!]!;
const guide = root.layers.find((l) => l.type === "guide")!;
const svg = readFileSync(new URL(`atlas/${(guide.keyframes[0]!.elements[0] as { atlas: string }).atlas}.svg`, dir), "utf8");

function tween(name: string) {
	const layer = root.layers.find((l) => l.name === name)!;
	const i = layer.keyframes.findIndex((k) => k.tween?.samples);
	const kf = layer.keyframes[i]!,
		end = layer.keyframes[i + 1]!;
	const el = kf.elements[0] as InstanceElement,
		last = end.elements[0] as InstanceElement;
	const tp = el.transformPoint;
	const point = (m: number[]): [number, number] => [m[0]! * tp.x + m[2]! * tp.y + m[4]!, m[1]! * tp.x + m[3]! * tp.y + m[5]!];
	const mats = [...kf.tween!.samples!.map((s) => s.matrix), last.matrix];
	return {
		pos: mats.map(point),
		rot: mats.map((m) => (Math.atan2(m[1]!, m[0]!) * 180) / Math.PI),
		orient: kf.tween!.orientToPath,
		dur: kf.duration,
	};
}
const linear = (dur: number): Track => [
	{ t: 0, v: 0, ease: "linear" },
	{ t: dur, v: 1, ease: "hold" },
];

describe("motion guides", () => {
	const c = guideCurve(svg)!;

	it("reads the guide's stroke as one curve", () => {
		expect(c.pieces.length).toBe(6);
		expect(c.length).toBeGreaterThan(900);
		expect(pointAtLength(c, 0)).toEqual([40, 210]);
		const [x, y] = pointAtLength(c, c.length);
		expect(x).toBeCloseTo(560, 6);
		expect(y).toBeCloseTo(200, 6);
		// a point on the curve projects onto itself
		const p = pointAtLength(c, 400);
		expect(project(c, p[0], p[1]).s).toBeCloseTo(400, 1);
		// the end goes straight down
		expect(angleAtLength(c, c.length)).toBeCloseTo(90, 3);
	});

	it("refuses guides that aren't one open stroke", () => {
		expect(guideCurve(svg.replace('fill="none"', 'fill="#FF0000"'))).toBeNull();
		expect(guideCurve(svg.replace(/( d="[^"]*)"/, '$1 Z"'))).toBeNull();
		expect(guideCurve(svg.replace(/(d="\s*M[^"]*)"/, '$1 M 0 0 L 10 10"'))).toBeNull();
	});

	it("reproduces Animate's frames of the ball along the curve within 0.1 px", () => {
		const t = tween("ball");
		const fit = fitGuided(c, t.pos, 0.1)!;
		expect(fit).not.toBeNull();
		// fewer keys than frames (Animate's frames wobble ~0.2 px along the curve, the tolerance is 0.1)
		expect(fit.at.length).toBeLessThan(t.dur / 2);
		for (let f = 0; f <= t.dur; f++) {
			const [x, y] = pointAtLength(c, valueAt(fit.at, f) * c.length);
			expect(Math.hypot(x - t.pos[f]![0], y - t.pos[f]![1])).toBeLessThan(0.1);
		}
		// constant speed would be up to 7 px off: the keys carry Animate's own pace
		const uniform = Math.max(
			...t.pos.map(([x, y], f) => Math.hypot(...(pointAtLength(c, (c.length * f) / t.dur).map((v, k) => v - [x, y][k]!) as [number, number]))),
		);
		expect(uniform).toBeGreaterThan(5);
		expect(fit.rot).toBeUndefined();
	});

	it("orients the dart: rotation = the curve's direction + a part that tweens", () => {
		const t = tween("arrow");
		expect(t.orient).toBe(true);
		// an end keyframe beside the curve (Animate snaps only the in-betweens): keeps the frames
		const beside = t.pos.map((p, f) => (f === t.dur ? ([p[0] + 3, p[1]] as [number, number]) : p));
		expect(fitGuided(c, beside, 0.1, { rot: t.rot, ease: linear(t.dur), tol: 0.15 })).toBeNull();
		const fit = fitGuided(c, t.pos, 0.1, { rot: t.rot, ease: linear(t.dur), tol: 0.15 })!;
		expect(fit).not.toBeNull();
		for (let f = 0; f <= t.dur; f++) {
			const s = valueAt(fit.at, f) * c.length;
			const want = angleAtLength(c, s) + valueAt(fit.rot!, f);
			const d = ((((t.rot[f]! - want) % 360) + 540) % 360) - 180;
			expect(Math.abs(d)).toBeLessThan(0.15);
		}
		// Animate's rule: the rest of the rotation tweens linearly (two keys)
		expect(fit.rot!.length).toBe(2);
		// rotations that don't follow it are taken from the frames
		const odd = t.rot.map((r, f) => r + 20 * Math.sin(f / 5));
		const fit2 = fitGuided(c, t.pos, 0.1, { rot: odd, ease: linear(t.dur), tol: 0.15 })!;
		expect(fit2.rot!.length).toBeGreaterThan(2);
		for (let f = 0; f <= t.dur; f++) {
			const want = angleAtLength(c, valueAt(fit2.at, f) * c.length) + valueAt(fit2.rot!, f);
			expect(Math.abs(((((odd[f]! - want) % 360) + 540) % 360) - 180)).toBeLessThan(0.15);
		}
	});

	it("refuses points off the curve and turning back", () => {
		const t = tween("ball");
		const off = t.pos.map(([x, y], f) => [x, y + (f === 40 ? 0.5 : 0)] as [number, number]);
		expect(fitGuided(c, off, 0.1)).toBeNull();
		const back = [...t.pos.slice(0, 50), ...t.pos.slice(0, 40).reverse()];
		expect(fitGuided(c, back, 0.1)).toBeNull();
	});

	it("gives Lottie keys whose cubics are the curve, moving by arc length", () => {
		const fit = fitGuided(c, tween("ball").pos, 0.1)!;
		const keys = spatialKeys(c, fit.at);
		// a key at every piece boundary passed, each stretch inside one piece
		expect(keys.length).toBeGreaterThanOrEqual(fit.at.length + c.pieces.length - 1);
		for (let i = 0; i < keys.length - 1; i++) {
			const k = keys[i]!,
				n = keys[i + 1]!;
			if (k.ease === "hold") continue;
			const P = [k.s, [k.s[0] + k.to![0], k.s[1] + k.to![1]], [n.s[0] + k.ti![0], n.s[1] + k.ti![1]], n.s];
			const s0 = project(c, ...k.s).s,
				s1 = project(c, ...n.s).s;
			// points of the cubic (by its own arc length) lie where the curve is at that distance
			const pts: number[][] = [];
			for (let j = 0; j <= 200; j++) {
				const u = j / 200,
					v = 1 - u;
				pts.push([0, 1].map((d) => v * v * v * P[0]![d]! + 3 * v * v * u * P[1]![d]! + 3 * v * u * u * P[2]![d]! + u * u * u * P[3]![d]!));
			}
			let len = 0;
			const acc = [0];
			for (let j = 1; j < pts.length; j++) acc.push((len += Math.hypot(pts[j]![0]! - pts[j - 1]![0]!, pts[j]![1]! - pts[j - 1]![1]!)));
			expect(Math.abs(len - Math.abs(s1 - s0))).toBeLessThan(0.05);
			for (const q of [0.25, 0.5, 0.75]) {
				const j = Math.max(
					1,
					acc.findIndex((a) => a >= q * len),
				);
				const w = (q * len - acc[j - 1]!) / (acc[j]! - acc[j - 1]!);
				const at = [0, 1].map((d) => pts[j - 1]![d]! + (pts[j]![d]! - pts[j - 1]![d]!) * w);
				const want = pointAtLength(c, s0 + (s1 - s0) * q);
				expect(Math.hypot(at[0]! - want[0], at[1]! - want[1])).toBeLessThan(0.05);
			}
		}
	});

	it("writes the motion along the curve in SMIL, CSS and Lottie (stepped output keeps frames)", () => {
		const files = { readText: (r: string) => readFileSync(new URL(r, dir), "utf8"), readBinary: (r: string) => readFileSync(new URL(r, dir)) };
		const smil = compileScene(model, files, { format: "smil" }).files[0]!.svg;
		expect(smil).toContain(`<animateMotion path="${c.d}"`);
		expect(smil).toMatch(/<animateMotion [^>]*rotate="auto"/);
		expect(smil).toMatch(/<animateMotion [^>]*calcMode="linear"/);
		const css = compileScene(model, files, { format: "css" }).files[0]!.svg;
		expect(css).toContain(`offset-path:path("${c.d}")`);
		expect(css).toContain("offset-rotate:auto");
		expect(css).toContain("offset-rotate:0deg");
		const lottie = JSON.parse(compileScene(model, files, { format: "lottie" }).files[0]!.svg);
		expect(JSON.stringify(lottie)).toMatch(/"to":\[/);
		const steps = compileScene(model, files, { format: "smil", smooth: false }).files[0]!.svg;
		expect(steps).not.toContain("animateMotion");
	});
});
