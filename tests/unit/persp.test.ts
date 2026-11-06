import { describe, expect, it } from "vitest";
import { apply } from "../../src/core/geom.ts";
import { cssMatrix, DEFAULT_FOCAL, focalOf, fromCorner, homographyOf, isFlat, project, residual, tangentAt, unproject } from "../../src/core/persp.ts";

const view = { focal: DEFAULT_FOCAL, x: 200, y: 150 };
const turn = (deg: number): number[] => {
	const a = (deg * Math.PI) / 180;
	return [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a), 130, 150, 0];
};

describe("perspective", () => {
	it("has the focal length of the document's view angle", () => {
		// (a stage 400 wide stores 41.47 degrees for the default)
		expect(focalOf(41.472752, 400)).toBeCloseTo(528.25, 1);
		expect(focalOf(null, 400)).toBe(DEFAULT_FOCAL);
		expect(focalOf(80, 400)).toBeCloseTo(238.35, 1);
	});

	it("projects depth as Animate does: towards the vanishing point", () => {
		// a card at z -200 on a stage 400 wide, measured in Animate's frames: centre 39, 246.5
		const h = homographyOf([1, 0, 0, 0, 1, 0, 0, 0, 1, 100, 210, -200], view);
		const [x, y] = project(h, 0, 0);
		expect(x).toBeCloseTo(39.07, 1);
		expect(y).toBeCloseTo(246.56, 1);
		expect(isFlat(h)).toBe(true);
	});

	it("finds the point again", () => {
		const h = homographyOf(turn(50), view);
		const [u, v] = project(h, 20, -10);
		const [x, y] = unproject(h, u, v);
		expect(x).toBeCloseTo(20, 6);
		expect(y).toBeCloseTo(-10, 6);
	});

	it("splits a homography into the flat part and what is left", () => {
		const h = homographyOf(turn(70), view);
		const flat = tangentAt(h, 0, 0);
		const rest = residual(h, flat);
		expect(isFlat(h)).toBe(false);
		for (const [x, y] of [[0, 0], [60, 40], [-60, 40], [30, -40]] as const) {
			const [rx, ry] = project(rest, x, y);
			const p = apply(flat, { x: rx, y: ry });
			const [u, v] = project(h, x, y);
			expect(p.x).toBeCloseTo(u, 6);
			expect(p.y).toBeCloseTo(v, 6);
		}
		// around the middle next to nothing is left: where perspective isn't honoured, this is the best
		const [mx, my] = project(rest, 0, 0);
		expect(mx).toBeCloseTo(0, 6);
		expect(my).toBeCloseTo(0, 6);
	});

	it("moves its origin to a box's corner, as an element has it", () => {
		const rest = residual(homographyOf(turn(40), view), tangentAt(homographyOf(turn(40), view), 0, 0));
		const c = fromCorner(rest, -60, -40);
		const [x, y] = project(rest, 60, 40);
		const [cx, cy] = project(c, 120, 80);
		expect(cx - 60).toBeCloseTo(x, 6);
		expect(cy - 40).toBeCloseTo(y, 6);
	});

	it("writes CSS by columns", () => {
		expect(cssMatrix([1, 0, 5, 0, 1, 6, 0.5, 0, 1])).toBe("matrix3d(1,0,0,0.5,0,1,0,0,0,0,1,0,5,6,0,1)");
	});
});
