import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileScene, type ExportSettings } from "../../src/core/compile.ts";
import { ColorFit, Grade, gradeModel, haldLut, parse3dl, parseCube, parseLut, type Lut } from "../../src/core/grade.ts";
import type { ColorTransform, SceneModel } from "../../src/core/model.ts";

type RGB = [number, number, number];

/** A .cube text of `size`³ steps of f (red fastest). */
function cube(size: number, f: (r: number, g: number, b: number) => RGB, header = ""): string {
	const lines = [`TITLE "test"`, header, `LUT_3D_SIZE ${size}`];
	for (let b = 0; b < size; b++)
		for (let g = 0; g < size; g++)
			for (let r = 0; r < size; r++)
				lines.push(
					f(r / (size - 1), g / (size - 1), b / (size - 1))
						.map((v) => v.toFixed(6))
						.join(" "),
				);
	return lines.join("\n");
}

const grade = (lut: Lut, strength = 1) => new Grade([{ lut, strength }]);
const identity = parseCube(
	cube(2, (r, g, b) => [r, g, b]),
	"identity.cube",
);
/** An affine colour change with channels mixed: tetrahedral interpolation is exact for it. */
const affine = (r: number, g: number, b: number): RGB => [0.1 + 0.6 * r + 0.2 * g, 0.05 + 0.3 * g + 0.5 * b + 0.1 * r, 0.2 + 0.7 * b];
/** A contrast S-curve on each channel plus a cool shift: a typical "look". */
const look = (r: number, g: number, b: number): RGB => {
	const s = (x: number) => x * x * (3 - 2 * x);
	return [s(r) * 0.95, s(g), Math.min(1, s(b) * 1.05 + 0.03)];
};
const rand = (seed: number) => () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5), (seed >>> 0) / 2 ** 32);

describe("LUT files", () => {
	it("reads a 3D .cube and interpolates it tetrahedrally (exact for an affine table)", () => {
		const g = grade(parseCube(cube(5, affine), "affine.cube"));
		const next = rand(7);
		for (let i = 0; i < 200; i++) {
			const c: RGB = [next(), next(), next()];
			const want = affine(...c);
			g.rgb(...c).forEach((v, k) => expect(v).toBeCloseTo(Math.min(1, want[k]!), 5));
		}
		expect(grade(identity).rgb(0.25, 0.5, 0.75)).toEqual([0.25, 0.5, 0.75]);
	});

	it("reads DOMAIN_MIN/MAX, a 1D LUT and a 1D shaper before a 3D table (Resolve)", () => {
		// the domain [0, 2]: input 0.5 is a quarter of the way
		const half = parseCube(
			cube(2, (r, g, b) => [r, g, b], "DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2"),
			"d.cube",
		);
		expect(grade(half).rgb(0.5, 1, 0.2)[0]).toBeCloseTo(0.25, 6);
		const ramp = Array.from({ length: 1024 }, (_, i) => ((i / 1023) ** 2).toFixed(6));
		const d1 = parseCube(["LUT_1D_SIZE 1024", ...ramp.map((v) => `${v} ${v} ${v}`)].join("\n"), "gamma.cube");
		expect(d1.d3).toBeUndefined();
		expect(grade(d1).rgb(0.5, 0.25, 1)[0]).toBeCloseTo(0.25, 5);
		const both = parseCube(
			[
				"LUT_1D_SIZE 1024",
				"LUT_3D_SIZE 2",
				...ramp.map((v) => `${v} ${v} ${v}`),
				...cube(2, (r, g, b) => [1 - r, g, b])
					.split("\n")
					.slice(3),
			].join("\n"),
			"both.cube",
		);
		// the shaper first (0.5 -> 0.25), then the 3D table (inverts red)
		expect(grade(both).rgb(0.5, 0.5, 0.5)[0]).toBeCloseTo(0.75, 5);
	});

	it("reads .3dl (blue fastest, integer output) like the same .cube", () => {
		const n = 5;
		const mesh = Array.from({ length: n }, (_, i) => Math.round((i * 1023) / (n - 1))).join(" ");
		const lines = ["3DMESH", "Mesh 2 12", mesh];
		for (let r = 0; r < n; r++)
			for (let g = 0; g < n; g++)
				for (let b = 0; b < n; b++)
					lines.push(
						affine(r / (n - 1), g / (n - 1), b / (n - 1))
							.map((v) => Math.round(Math.min(1, v) * 4095))
							.join(" "),
					);
		const a = grade(parse3dl(lines.join("\n"), "a.3dl")),
			b = grade(parseCube(cube(n, affine), "a.cube"));
		const next = rand(3);
		for (let i = 0; i < 50; i++) {
			const c: RGB = [next(), next(), next()];
			const x = a.rgb(...c),
				y = b.rgb(...c);
			for (let k = 0; k < 3; k++) expect(Math.abs(x[k]! - y[k]!)).toBeLessThan(1 / 4095);
		}
		expect(parseLut(lines.join("\n"), "look.3dl").d3?.size).toBe(n);
	});

	it("reads a Hald CLUT image (level 2: 8×8 pixels, 4 steps)", () => {
		const N = 4;
		const data = new Uint8Array(8 * 8 * 4);
		for (let p = 0; p < N ** 3; p++) {
			const r = p % N,
				g = Math.floor(p / N) % N,
				b = Math.floor(p / N / N);
			data.set([255 - Math.round((r * 255) / (N - 1)), Math.round((g * 255) / (N - 1)), Math.round((b * 255) / (N - 1)), 255], p * 4);
		}
		const g = grade(haldLut({ data, width: 8, height: 8 }, "invert-red.png"));
		expect(g.rgb(1, 0, 1 / 3).map((v) => Math.round(v * 255))).toEqual([0, 0, 85]);
		expect(() => haldLut({ data, width: 8, height: 4 }, "x.png")).toThrow(/square/);
	});

	it("says what is wrong with a broken file", () => {
		expect(() => parseCube("TITLE x\n0 0 0", "a.cube")).toThrow(/a\.cube: no LUT_3D_SIZE/);
		expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n1 1 1", "b.cube")).toThrow(/2 lines of values, expected 8/);
		expect(() => parseCube("LUT_3D_SIZE 2\n0 0 zero", "c.cube")).toThrow(/not a number/);
		expect(() => parse3dl("0 0 0\n1 1 1", "d.3dl")).toThrow(/input steps/);
	});
});

describe("grading colours", () => {
	it("mixes by strength and applies LUTs in order", () => {
		const invert = parseCube(
			cube(2, (r, g, b) => [1 - r, 1 - g, 1 - b]),
			"invert.cube",
		);
		expect(grade(invert, 0.5).rgb(1, 0, 0.2)).toEqual([0.5, 0.5, 0.5]);
		// twice inverted is the colour itself; a strength of 0 leaves the LUT out
		const two = new Grade([
			{ lut: invert, strength: 1 },
			{ lut: invert, strength: 1 },
		]);
		two.rgb(0.3, 0.6, 0.9).forEach((v, k) => expect(v).toBeCloseTo([0.3, 0.6, 0.9][k]!, 6));
		expect(new Grade([{ lut: invert, strength: 0 }]).empty).toBe(true);
		expect(grade(invert).hex("#FF000080")).toBe("#00FFFF80");
		expect(grade(invert).hex("none")).toBe("none");
		// the id changes with the table and the strength, and is what JSON shows
		expect(JSON.stringify({ g: grade(invert) })).toBe(`{"g":"${grade(invert).id}"}`);
		expect(grade(invert, 0.5).id).not.toBe(grade(invert).id);
	});

	it("grades pixels like single colours, leaving alpha and transparent pixels", () => {
		const g = grade(parseCube(cube(17, look), "look.cube"));
		const next = rand(11);
		const data = new Uint8ClampedArray(64 * 64 * 4);
		// few colours (the cache) and many
		for (let i = 0; i < data.length; i += 4) {
			const few = i < data.length / 2;
			data.set(few ? [(i >> 6) & 3 ? 200 : 10, 99, 7, 255] : [next() * 255, next() * 255, next() * 255, 1 + next() * 254], i);
		}
		data.set([12, 34, 56, 0], 0);
		const before = data.slice();
		g.pixels(data);
		expect([...data.slice(0, 4)]).toEqual([12, 34, 56, 0]);
		for (let i = 4; i < data.length; i += 4) {
			const want = g.rgb(before[i]! / 255, before[i + 1]! / 255, before[i + 2]! / 255).map((v) => Math.round(v * 255));
			expect([data[i], data[i + 1], data[i + 2], data[i + 3]]).toEqual([...want, before[i + 3]]);
		}
	});

	it("adds gradient stops where the LUT bends the colour between two, within a level", () => {
		const g = grade(parseCube(cube(33, look), "look.cube"));
		const black = { off: 0, rgb: [0, 0, 0] as RGB, a: 1 },
			white = { off: 1, rgb: [1, 1, 1] as RGB, a: 0.5 };
		const out = g.stops([black, white], false);
		expect(out.length).toBeGreaterThan(2);
		expect(out[0]!.off).toBe(0);
		expect(out[out.length - 1]!.off).toBe(1);
		// what plain interpolation of the new stops shows, against the graded gradient
		for (let u = 0; u <= 1; u += 1 / 512) {
			let i = 0;
			while (i < out.length - 2 && out[i + 1]!.off < u) i++;
			const a = out[i]!,
				b = out[i + 1]!;
			const t = (u - a.off) / (b.off - a.off);
			const want = g.rgb(u, u, u);
			for (let k = 0; k < 3; k++) expect(Math.abs(a.rgb[k]! + (b.rgb[k]! - a.rgb[k]!) * t - want[k]!)).toBeLessThan(1.5 / 255);
			expect(a.a + (b.a - a.a) * t).toBeCloseTo(1 - u / 2, 6);
		}
		// a LUT that is a straight line adds nothing; nor do equal stops
		expect(grade(identity).stops([black, white], false)).toHaveLength(2);
		expect(g.stops([black, { ...black, off: 1 }], false)).toHaveLength(2);
	});

	it("fits colour effects: unchanged by an identity LUT, a full tint becomes the graded tint colour", () => {
		const ct = (o: Partial<ColorTransform>): ColorTransform => ({ mode: "advanced", rP: 100, gP: 100, bP: 100, aP: 100, rA: 0, gA: 0, bA: 0, aA: 0, ...o });
		const same = new ColorFit(grade(identity));
		for (const c of [ct({ rP: 50, gP: 50, bP: 50, rA: 127.5, gA: 0, bA: 25 }), ct({ rP: 150, gP: 80, bP: 20, rA: -40, gA: 30, bA: 255, aP: 40 })]) {
			const f = same.fit(c);
			for (const k of ["rP", "gP", "bP", "aP", "rA", "gA", "bA", "aA"] as const) expect(f[k]).toBeCloseTo(c[k], 2);
		}
		const g = grade(parseCube(cube(17, look), "look.cube"));
		const fit = new ColorFit(g);
		const tint = fit.fit(ct({ mode: "tint", rP: 0, gP: 0, bP: 0, rA: 255, gA: 64, bA: 0, aP: 70 }));
		const red = g.rgb(1, 64 / 255, 0);
		expect([tint.rP, tint.gP, tint.bP]).toEqual([0, 0, 0]);
		[tint.rA, tint.gA, tint.bA].forEach((v, k) => expect(v / 255).toBeCloseTo(red[k]!, 3));
		expect(tint.aP).toBe(70);
		// a half tint keeps one multiplier for all channels (a tint stays a tint)
		const half = fit.fit(ct({ mode: "tint", rP: 50, gP: 50, bP: 50, rA: 0, gA: 0, bA: 127.5 }));
		expect(half.rP).toBe(half.gP);
		expect(half.gP).toBe(half.bP);
		// alpha only: as it was
		const alpha = ct({ aP: 30 });
		expect(fit.fit(alpha)).toBe(alpha);
	});
});

describe("graded exports", () => {
	const demo = (name: string) => {
		const dir = new URL(`../../docs/guide/demos/models/${name}/`, import.meta.url);
		const model: SceneModel = JSON.parse(readFileSync(new URL("scene.json", dir), "utf8"));
		const files = {
			readText: (rel: string) => readFileSync(new URL(rel, dir), "utf8"),
			readBinary: (rel: string) => new Uint8Array(readFileSync(new URL(rel, dir))),
		};
		return { model, files };
	};
	const compile = (name: string, s: Partial<ExportSettings>) => {
		const { model, files } = demo(name);
		const before = JSON.stringify(model);
		const out = compileScene(model, files, { idPrefix: "t_", ...s });
		// the model is not changed on the way
		expect(JSON.stringify(model)).toBe(before);
		return out.files[0]!.svg;
	};

	// "Linear RGB" gradients get their in-between stops where they are needed then, not at 8 steps
	// (gradient glows and bevels: their ramp is read from 8-bit stops then, within a level)
	const tables = (svg: string) => [...svg.matchAll(/tablevalues="([^"]*)"/gi)].flatMap((m) => m[1]!.split(" ").map(Number));
	const withoutGradients = (svg: string) =>
		svg
			.toLowerCase()
			.replace(/<(linear|radial)gradient\b[\s\S]*?<\/\1gradient>/g, "")
			.replace(/tablevalues="[^"]*"/g, "");

	it("an identity LUT changes nothing (but the case of colours, and where Linear RGB stops are)", () => {
		for (const name of ["filters", "banner", "text", "photo", "hero"])
			for (const format of ["smil", "css", "player"] as const) {
				const plain = compile(name, { format });
				const graded = compile(name, { format, grade: grade(identity) });
				expect(withoutGradients(graded), `${name} ${format}`).toBe(withoutGradients(plain));
				const a = tables(plain),
					b = tables(graded);
				expect(b.length).toBe(a.length);
				a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(1.5 / 255));
			}
		for (const name of ["banner", "text"]) expect(compile(name, { format: "lottie", grade: grade(identity) }), name).toBe(compile(name, { format: "lottie" }));
	});

	it("an inverting LUT inverts every colour of the drawings, filters and stage", () => {
		const invert = grade(
			parseCube(
				cube(2, (r, g, b) => [1 - r, 1 - g, 1 - b]),
				"invert.cube",
			),
		);
		for (const name of ["hero", "filters"]) {
			// (gradient stops: see the stops test)
			const colours = (svg: string) => [...svg.matchAll(/(?:fill|stroke|flood-color)="(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]!.toUpperCase());
			const plain = colours(compile(name, { format: "smil", includeBackground: true }));
			const graded = colours(compile(name, { format: "smil", includeBackground: true, grade: invert }));
			expect(plain.length).toBeGreaterThan(3);
			expect(graded).toEqual(plain.map((c) => invert.hex(c)));
		}
	});

	it("keeps tweens of colour effects as tweens", () => {
		const { model } = demo("hero");
		const g = grade(parseCube(cube(17, look), "look.cube"));
		const graded = gradeModel(model, g);
		const tweened = Object.values(graded.timelines).flatMap((t) => t.layers.flatMap((l) => l.keyframes.filter((k) => k.tween?.samples?.some((s) => s.color))));
		expect(tweened.length).toBeGreaterThan(0);
		for (const kf of tweened) {
			const s = kf.tween!.samples!.map((x) => x.color?.rA ?? 0);
			// the fitted in-betweens still lie on a line between the ends, as the original's do
			const orig = Object.values(model.timelines)
				.flatMap((t) => t.layers.flatMap((l) => l.keyframes))
				.find((k) => k.index === kf.index && k.tween?.samples?.length === kf.tween!.samples!.length && k.tween?.samples?.some((x) => x.color))!;
			const o = orig.tween!.samples!.map((x) => x.color?.rA ?? 0);
			const span = (v: number[]) => v[v.length - 1]! - v[0]!;
			if (Math.abs(span(o)) < 1e-6) continue;
			for (let i = 0; i < s.length; i++) expect((s[i]! - s[0]!) / span(s)).toBeCloseTo((o[i]! - o[0]!) / span(o), 3);
		}
	});
});

describe("graded pixels", () => {
	const invert = grade(
		parseCube(
			cube(2, (r, g, b) => [1 - r, 1 - g, 1 - b]),
			"invert.cube",
		),
	);

	it("grades every bitmap before it is encoded, but not for formats that grade their pictures", async () => {
		const { nodeWasmLoader } = await import("../../src/cli/wasm.ts");
		const { createCodecs } = await import("../../src/core/codecs.ts");
		const { encodeImages } = await import("../../src/core/images.ts");
		const codecs = createCodecs(nodeWasmLoader());
		const asset = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/assets/${name}`, import.meta.url)));
		const FILES: Record<string, Uint8Array> = {
			"bitmaps/icon.png": asset("icon.png"),
			"bitmaps/photo.png": asset("photo-as-png.png"),
			"bitmaps/photo.jpg": asset("photo.jpg"),
		};
		const files = { readText: () => "", readBinary: (rel: string) => FILES[rel]! };
		const model = {
			version: 1,
			doc: { name: "t.fla", type: "Flash", width: 400, height: 300, frameRate: 24, backgroundColor: "#ffffff" },
			roots: ["scene"],
			timelines: {
				scene: {
					id: "scene",
					name: "Scene 1",
					kind: "scene",
					frameCount: 1,
					layers: [
						{
							name: "b",
							type: "normal",
							visible: true,
							parent: -1,
							frameCount: 1,
							keyframes: [
								{
									index: 0,
									duration: 1,
									elements: ["icon", "photo"].map((id) => ({
										kind: "bitmap",
										bitmap: id,
										matrix: [1, 0, 0, 1, 0, 0],
										bounds: { left: 0, top: 0, width: 1, height: 1 },
									})),
								},
							],
						},
					],
				},
			},
			atlas: {},
			sounds: {},
			warnings: [],
			bitmaps: {
				icon: { name: "icon.png", file: "bitmaps/icon.png", width: 1, height: 1, smoothing: true, compression: "lossless" },
				photo: {
					name: "photo.jpg",
					file: "bitmaps/photo.png",
					width: 1,
					height: 1,
					smoothing: true,
					compression: "photo",
					quality: -1,
					jpeg: "bitmaps/photo.jpg",
				},
			},
		} as unknown as SceneModel;
		const r = await encodeImages(model, files, { grade: invert }, codecs);
		const src = await codecs.decodePng(FILES["bitmaps/icon.png"]!);
		const out = await codecs.decodePng(r.files.readBinary(r.model.bitmaps.icon!.file));
		const want = src.data.slice();
		invert.pixels(want);
		expect([...out.data]).toEqual([...want]);
		// Animate's JPEG has the old colours: written anew
		expect(r.report.find((i) => i.name === "photo.jpg")!.format).toBe("jpeg");
		expect(r.files.readBinary(r.model.bitmaps.photo!.file)).not.toEqual(FILES["bitmaps/photo.jpg"]);
		expect(r.model.bitmaps.icon!.master).toBeUndefined();
		// a GIF grades its finished frames instead
		const gif = await encodeImages(model, files, { grade: invert, format: "gif" }, codecs);
		expect(gif.files.readBinary(gif.model.bitmaps.photo!.file)).toEqual(FILES["bitmaps/photo.jpg"]);
		// scripts that read pixels get them graded, at full size and without loss (the player's master)
		const { MASTER } = await import("../../src/core/images.ts");
		const scripted = structuredClone(model);
		scripted.timelines.scene!.layers[0]!.keyframes[0]!.script = "var c = bmp.getPixel(1, 1);";
		const withScript = await encodeImages(scripted, files, { grade: invert }, codecs);
		const m = withScript.model.bitmaps.photo!.master!;
		expect(m).toMatch(/\.graded\.png$/);
		const read = await codecs.decodePng(withScript.files.readBinary(MASTER + m));
		const photo = await codecs.decodePng(FILES["bitmaps/photo.png"]!);
		const graded = photo.data.slice();
		invert.pixels(graded);
		expect([read.width, read.height]).toEqual([photo.width, photo.height]);
		expect([...read.data]).toEqual([...graded]);
	});

	it("grades the finished frames of GIF, WebP, APNG and video", async () => {
		const { tickSource } = await import("../../src/core/raster.ts");
		const model = JSON.parse(readFileSync(new URL("../fixtures/models/f28-onestop.json", import.meta.url), "utf8"));
		const files = {
			readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#c30" d="M0 0L9 0 9 9 0 9Z"/></svg>`,
			readBinary: () => new Uint8Array(),
		};
		let drawn = "";
		const src = tickSource(
			model,
			files,
			{ ...(await import("../../src/core/compile.ts")).DEFAULT_SETTINGS, format: "gif", grade: invert },
			async (svg, w, h) => ((drawn = svg), { data: new Uint8ClampedArray(w * h * 4).fill(200), width: w, height: h }),
			() => {},
			0,
		);
		const px = await src.draw(0);
		expect([...px.data.slice(0, 4)]).toEqual([55, 55, 55, 200]);
		// the drawing itself keeps Animate's colours (graded once, as a picture)
		expect(drawn).toContain("#c30");
	});
});

describe("review fixes", () => {
	const look17 = () => grade(parseCube(cube(17, look), "look.cube"));

	it("keeps a graded shape tween one morph: its frames share their gradients' added stops", async () => {
		const { createContext } = await import("../../src/core/context.ts");
		// a gradient whose colours change over the tween; Animate numbers the ids across its export
		const frameSvg = (k: number) => {
			const u = k / 10;
			const mix = (a: number, b: number) =>
				Math.round(a + (b - a) * u)
					.toString(16)
					.padStart(2, "0");
			const c0 = "#" + mix(0, 0x20) + mix(0, 0x30) + mix(0, 0x40),
				c1 = "#" + mix(255, 0xe0) + mix(255, 0xc0) + mix(255, 0xa0);
			return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="100"><defs><linearGradient id="Gradient_${7 + k}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="0"><stop offset="0%" stop-color="${c0}"/><stop offset="100%" stop-color="${c1}"/></linearGradient><g id="Layer0_0_FILL"><path fill="url(#Gradient_${7 + k})" stroke="none" d="M 0 0 L 200 0 200 100 0 100 0 0 Z"/></g></defs><g><use xlink:href="#Layer0_0_FILL"/></g></svg>`;
		};
		const texts: Record<string, string> = {};
		const atlas: Record<string, { file: string; source: string }> = {};
		const ids = ["k0", ...Array.from({ length: 10 }, (_, k) => `f${k}`), "k1"];
		ids.forEach((id, i) => {
			const k = id === "k0" ? 0 : id === "k1" ? 10 : i - 1;
			texts[`atlas/${id}.svg`] = frameSvg(k);
			atlas[id] = { file: `atlas/${id}.svg`, source: `scene:0 layer 0 frame ${k}` };
		});
		const shape = (a: string) => ({ kind: "shape", atlas: a, bounds: { left: 0, top: 0, width: 200, height: 100 } });
		const model = {
			version: 1,
			doc: { name: "t.fla", type: "Flash", width: 200, height: 100, frameRate: 24, backgroundColor: "#FFFFFF" },
			roots: ["scene:0"],
			timelines: {
				"scene:0": {
					id: "scene:0",
					name: "Scene 1",
					kind: "scene",
					frameCount: 11,
					layers: [
						{
							name: "morph",
							type: "normal",
							visible: true,
							parent: -1,
							frameCount: 11,
							keyframes: [
								{
									index: 0,
									duration: 10,
									elements: [shape("k0")],
									tween: {
										type: "shape",
										easing: 0,
										rotate: "none",
										rotateTimes: 0,
										orientToPath: false,
										scale: true,
										snap: false,
										sync: false,
										guided: false,
										shapeFrames: ids.slice(1, 11),
									},
								},
								{ index: 10, duration: 1, elements: [shape("k1")] },
							],
						},
					],
				},
			},
			atlas,
			bitmaps: {},
			sounds: {},
			warnings: [],
		} as unknown as SceneModel;
		const files = { readText: (rel: string) => texts[rel]!, readBinary: () => new Uint8Array() };
		const g = look17();
		const ctx = createContext(model, files, { smooth: true, includeHiddenLayers: true, includeGuides: false, digits: 2, grade: g });
		const item = ctx.programs["scene:0"]!.layers.flatMap((l) => l.items).find((it) => it.kind === "artSeq" && it.ratio)! as { arts: string[] } & Parameters<
			typeof ctx.morph
		>[0];
		const stops = item.arts.map((id) => ctx.art(id)!.defs.flatMap((d) => d.children.filter((c) => typeof c !== "string" && c.name === "stop")).length);
		// the LUT bends the colours: stops were added, the same number in every frame
		expect(stops[0]).toBeGreaterThan(2);
		expect(new Set(stops).size).toBe(1);
		const morph = ctx.morph(item)!;
		expect(morph.parts.reduce((n, p) => n + p.to - p.from, 0)).toBe(item.arts.length);
	});

	it("keeps a gradient filter's hard edge, and grades the colours the writers fill in", () => {
		const invert = grade(
			parseCube(
				cube(2, (r, g, b) => [1 - r, 1 - g, 1 - b]),
				"invert.cube",
			),
		);
		const shadow = (filters: Record<string, unknown>[]) =>
			({
				version: 1,
				doc: { name: "t", type: "Flash", width: 10, height: 10, frameRate: 24, backgroundColor: "#000000" },
				roots: ["s"],
				timelines: {
					s: {
						id: "s",
						name: "s",
						kind: "scene",
						frameCount: 1,
						layers: [
							{
								name: "l",
								type: "normal",
								visible: true,
								parent: -1,
								frameCount: 1,
								keyframes: [
									{
										index: 0,
										duration: 1,
										elements: [
											{
												kind: "instance",
												symbol: "x",
												symbolType: "movie clip",
												name: "",
												matrix: [1, 0, 0, 1, 0, 0],
												transformPoint: { x: 0, y: 0 },
												color: null,
												filters,
												blendMode: "normal",
												visible: true,
												cacheAsBitmap: false,
												bounds: { left: 0, top: 0, width: 1, height: 1 },
											},
										],
									},
								],
							},
						],
					},
				},
				atlas: {},
				bitmaps: {},
				sounds: {},
				warnings: [],
			}) as unknown as SceneModel;
		const out = gradeModel(
			shadow([
				{ name: "gradientGlowFilter", enabled: true, colorArray: ["#FF000000", "#FF0000FF", "#0000FFFF"], posArray: [0, 100, 100] },
				{ name: "bevelFilter", enabled: true },
				{ name: "gradientBevelFilter", enabled: true },
			]),
			invert,
		);
		const [glow, bevel, gbevel] = (out.timelines.s!.layers[0]!.keyframes[0]!.elements[0] as { filters: Record<string, unknown>[] }).filters as [
			{ colorArray: string[]; posArray: number[] },
			Record<string, unknown>,
			{ colorArray: string[] },
		];
		// both stops at 100 stay, inverted: red | blue becomes cyan | yellow, a hard edge
		const at100 = glow.posArray.map((p, i) => (p === 100 ? glow.colorArray[i] : null)).filter(Boolean);
		expect(at100).toEqual(["#00FFFFFF", "#FFFF00FF"]);
		expect(bevel.highlightColor).toBe("#000000");
		expect(bevel.shadowColor).toBe("#FFFFFF");
		expect(gbevel.colorArray[gbevel.colorArray.length - 1]).toBe("#000000FF");
	});

	it("tells pen strokes apart by Animate's colour, also when a LUT makes two colours one", async () => {
		const { importArtwork, sourceStroke } = await import("../../src/core/artwork.ts");
		const flat = grade(parseCube(["LUT_3D_SIZE 2", ...Array(8).fill("0.5 0.5 0.5")].join("\n"), "flat.cube"));
		const a = importArtwork(
			`<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#FF0000" stroke-width="2" fill="none" d="M0 0L9 9"/><path stroke="#0000FF" stroke-width="2" fill="none" d="M0 9L9 0"/></svg>`,
			"t",
			{ digits: 2, grade: flat },
		);
		const paths: { attrs: Record<string, string> }[] = [];
		const walk = (n: { name?: string; attrs?: Record<string, string>; children?: unknown[] }) => {
			if (n.name === "path") paths.push(n as { attrs: Record<string, string> });
			for (const c of n.children ?? []) if (typeof c !== "string") walk(c as never);
		};
		walk(a.body as never);
		expect(paths.map((p) => p.attrs.stroke)).toEqual(["#808080", "#808080"]);
		expect(paths.map((p) => sourceStroke.get(p as never))).toEqual(["#FF0000", "#0000FF"]);
	});

	it("keeps only the keys straight lines need, within the tolerance", async () => {
		const { keepWithin } = await import("../../src/core/tracks.ts");
		const times = Array.from({ length: 21 }, (_, i) => i);
		// a line, then a bend: the ends and the corner stay
		const values = times.map((t) => [t < 10 ? t : 10 + (t - 10) * 3]);
		const keep = keepWithin(
			times,
			values,
			times.map(() => true),
			0.01,
		);
		expect(times.filter((_, i) => keep[i])).toEqual([0, 10, 20]);
		// a hold in between is never crossed
		const hold = keepWithin(
			times,
			values,
			times.map((t) => t !== 5),
			0.01,
		);
		expect(hold[5] && hold[6]).toBe(true);
	});
});
