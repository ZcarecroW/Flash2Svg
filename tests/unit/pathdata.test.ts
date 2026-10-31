import { describe, expect, it } from "vitest";
import { minifyPath } from "../../src/core/pathdata.ts";

/**
 * Any path data (absolute or relative, H/V, T/S, implicit commands) as absolute segments with
 * explicit control points: what a renderer draws.
 */
function absolute(d: string): string[] {
	const t = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
	const out: string[] = [];
	let i = 0,
		cmd = "",
		x = 0,
		y = 0,
		sx = 0,
		sy = 0,
		cx = 0,
		cy = 0,
		prev = "";
	const n = () => parseFloat(t[i++]!);
	const r = (v: number) => Math.round(v * 1e6) / 1e6;
	while (i < t.length) {
		if (/[a-zA-Z]/.test(t[i]!)) cmd = t[i++]!;
		const rel = cmd === cmd.toLowerCase();
		const ox = rel ? x : 0,
			oy = rel ? y : 0;
		switch (cmd.toUpperCase()) {
			case "M":
				x = sx = n() + ox;
				y = sy = n() + oy;
				out.push(`M${r(x)},${r(y)}`);
				cmd = rel ? "l" : "L";
				prev = "";
				break;
			case "L":
				x = n() + ox;
				y = n() + oy;
				out.push(`L${r(x)},${r(y)}`);
				prev = "";
				break;
			case "H":
				x = n() + ox;
				out.push(`L${r(x)},${r(y)}`);
				prev = "";
				break;
			case "V":
				y = n() + oy;
				out.push(`L${r(x)},${r(y)}`);
				prev = "";
				break;
			case "Q":
			case "T": {
				let qx, qy;
				if (cmd.toUpperCase() === "T") [qx, qy] = prev === "Q" ? [2 * x - cx, 2 * y - cy] : [x, y];
				else [qx, qy] = [n() + ox, n() + oy];
				const ex = n() + ox,
					ey = n() + oy;
				out.push(`Q${r(qx)},${r(qy)} ${r(ex)},${r(ey)}`);
				[cx, cy, x, y, prev] = [qx, qy, ex, ey, "Q"];
				break;
			}
			case "C":
			case "S": {
				let ax, ay;
				if (cmd.toUpperCase() === "S") [ax, ay] = prev === "C" ? [2 * x - cx, 2 * y - cy] : [x, y];
				else [ax, ay] = [n() + ox, n() + oy];
				const bx = n() + ox,
					by = n() + oy,
					ex = n() + ox,
					ey = n() + oy;
				out.push(`C${r(ax)},${r(ay)} ${r(bx)},${r(by)} ${r(ex)},${r(ey)}`);
				[cx, cy, x, y, prev] = [bx, by, ex, ey, "C"];
				break;
			}
			case "Z":
				// a straight line back to the start before Z is what Z draws anyway
				if (out.length > 1 && out[out.length - 1] === `L${r(sx)},${r(sy)}`) out.pop();
				out.push("Z");
				x = sx;
				y = sy;
				prev = "";
				break;
			default:
				throw new Error("bad command " + cmd);
		}
	}
	return out;
}

describe("path data", () => {
	it("is shorter and draws the same", () => {
		const cases = [
			"M60 150Q39.3 150 24.65 164.65 10 179.3 10 200 10 220.7 24.65 235.35 39.3 250 60 250 80.7 250 95.35 235.35 110 220.7 110 200 110 179.3 95.35 164.65 80.7 150 60 150Z",
			"M110 80L110 10 10 10 10 80 110 80Z",
			"M380 22Q380 10 368 10L282 10Q270 10 270 22L270 78Q270 90 282 90L368 90Q380 90 380 78L380 22Z",
			"M0 0L10 0 10 10Z M20 20L30 20 30 30 20 20Z",
			"M-5.5 -.25L-5.5 .75 .5 .75Q1.25 .75 1.25 -.5Z",
			"M0 0C10 0 20 10 20 20 20 30 10 40 0 40Z",
			"M1 1L1 1",
		];
		for (const d of cases) {
			const m = minifyPath(d);
			expect(m.length, d).toBeLessThanOrEqual(d.length);
			expect(absolute(m), `${d}\n${m}`).toEqual(absolute(d));
		}
		expect(minifyPath(cases[1]!)).toBe("M110 80V10H10V80z");
	});

	it("leaves data it doesn't write alone", () => {
		for (const d of ["", "m0 0l5 5", "M0 0A5 5 0 0 1 10 10", "M0 0H10", "M1e-7 0L5 5", "5 5", "M0 0L5"]) expect(minifyPath(d)).toBe(d);
	});

	it("keeps a zero-length line (a dot with round caps) and short subpaths", () => {
		expect(absolute(minifyPath("M5 5L5 5"))).toEqual(["M5,5", "L5,5"]);
		// there and back: the line before Z stays
		expect(minifyPath("M0 0L10 0 0 0Z")).toBe("M0 0H10 0z");
	});

	it("draws the same as the input for thousands of random paths", () => {
		let seed = 7;
		const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
		for (let n = 0; n < 3000; n++) {
			const digits = Math.floor(rnd() * 4);
			const v = () => {
				// often on a grid, sometimes repeating the previous value (H/V, mirrored points)
				const x = (rnd() - 0.5) * 2000;
				return Number(x.toFixed(digits));
			};
			const f = (x: number) => String(x).replace(/^0\./, ".").replace(/^-0\./, "-.");
			let d = "";
			let x = v(),
				y = v();
			const sx = x,
				sy = y;
			let cx = x,
				cy = y;
			d += `M${f(x)} ${f(y)}`;
			const segs = 1 + Math.floor(rnd() * 12);
			for (let s = 0; s < segs; s++) {
				const kind = rnd();
				const nx = rnd() < 0.3 ? x : v(),
					ny = rnd() < 0.3 ? y : v();
				if (kind < 0.4) d += `L${f(nx)} ${f(ny)}`;
				else if (kind < 0.8) {
					// mirrored control point half of the time
					const qx = rnd() < 0.5 ? Number((2 * x - cx).toFixed(digits)) : v(),
						qy = rnd() < 0.5 ? Number((2 * y - cy).toFixed(digits)) : v();
					d += `Q${f(qx)} ${f(qy)} ${f(nx)} ${f(ny)}`;
					[cx, cy] = [qx, qy];
				} else d += `C${f(v())} ${f(v())} ${f(v())} ${f(v())} ${f(nx)} ${f(ny)}`;
				x = nx;
				y = ny;
			}
			if (rnd() < 0.5) d += `L${f(sx)} ${f(sy)}`;
			if (rnd() < 0.6) d += "Z";
			const m = minifyPath(d);
			expect(absolute(m), `${d}\n${m}`).toEqual(absolute(d));
			expect(m.length).toBeLessThanOrEqual(d.length);
		}
	});
});
