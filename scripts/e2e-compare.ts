// E2E step 2 (Node): renders frames of each extracted fixture with the static renderer,
// rasterises them with resvg and compares against Animate's own PNG export.
// Usage: node scripts/e2e-compare.ts [name,name,...] [--every=N] [--threshold=0.01]
import { Resvg } from "@resvg/resvg-js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { createContext } from "../src/core/context.ts";
import { renderStatic } from "../src/core/emit/static.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const every = parseInt(opt("every", "6"), 10);
const threshold = parseFloat(opt("threshold", "0.01"));
const list = args.find((a) => !a.startsWith("--"));
// Known approximations: Flash's box-blur based bevel/shadow filters vs SVG Gaussian blur, and
// "add" blending that resvg can't render (browsers do).
const TOLERANCE: Record<string, number> = { "f08-filters": 0.03 };
const names = list ? list.split(",") : readdirSync(out).filter((d) => existsSync(join(out, d, "model", "scene.json")));

interface Row {
	name: string;
	frame: number;
	diff: number;
}
const rows: Row[] = [];
let failed = 0;

for (const name of names) {
	const dir = join(out, name);
	const modelDir = join(dir, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	const ctx = createContext(
		model,
		{
			readText: (rel) => readFileSync(join(modelDir, rel), "utf8"),
			readBinary: (rel) => readFileSync(join(modelDir, rel)),
		},
		{ smooth: true, includeHiddenLayers: true, includeGuides: false, digits: 2 },
	);
	const root = model.roots[0]!;
	const count = ctx.programs[root]!.frameCount;
	const cmp = join(dir, "compare");
	mkdirSync(cmp, { recursive: true });
	const frames = new Set<number>();
	for (let f = 0; f < count; f += every) frames.add(f);
	frames.add(count - 1);
	for (const f of [...frames].sort((a, b) => a - b)) {
		const refFile = join(dir, "ref", `f${String(f + 1).padStart(4, "0")}.png`);
		const single = join(dir, "ref", "f.png");
		const refPath = existsSync(refFile) ? refFile : count === 1 && existsSync(single) ? single : null;
		if (!refPath) continue;
		const { svg } = renderStatic(ctx, root, { frame: f, movieClips: "first", includeBackground: true, embedImages: true, textAsOutlines: true });
		writeFileSync(join(cmp, `f${f + 1}.svg`), svg);
		const ref = PNG.sync.read(readFileSync(refPath));
		// Animate exports PNGs with a transparent stage: composite over the stage colour
		const bg = model.doc.backgroundColor;
		const br = parseInt(bg.slice(1, 3), 16),
			bgG = parseInt(bg.slice(3, 5), 16),
			bb = parseInt(bg.slice(5, 7), 16);
		for (let i = 0; i < ref.data.length; i += 4) {
			const a = ref.data[i + 3]! / 255;
			ref.data[i] = Math.round(ref.data[i]! * a + br * (1 - a));
			ref.data[i + 1] = Math.round(ref.data[i + 1]! * a + bgG * (1 - a));
			ref.data[i + 2] = Math.round(ref.data[i + 2]! * a + bb * (1 - a));
			ref.data[i + 3] = 255;
		}
		let png: PNG;
		try {
			const r = new Resvg(svg, { fitTo: { mode: "width", value: ref.width }, background: "white" });
			png = PNG.sync.read(r.render().asPng());
		} catch (e) {
			console.log(`${name} frame ${f + 1}: render error ${(e as Error).message}`);
			failed++;
			continue;
		}
		if (png.width !== ref.width || png.height !== ref.height) {
			console.log(`${name} frame ${f + 1}: size ${png.width}x${png.height} vs ref ${ref.width}x${ref.height}`);
			failed++;
			continue;
		}
		const diffPng = new PNG({ width: ref.width, height: ref.height });
		const bad = pixelmatch(ref.data, png.data, diffPng.data, ref.width, ref.height, { threshold: 0.15, includeAA: false });
		const ratio = bad / (ref.width * ref.height);
		rows.push({ name, frame: f + 1, diff: ratio });
		if (ratio > (TOLERANCE[name] ?? threshold)) {
			failed++;
			writeFileSync(join(cmp, `f${f + 1}-ours.png`), PNG.sync.write(png));
			writeFileSync(join(cmp, `f${f + 1}-diff.png`), PNG.sync.write(diffPng));
		}
	}
	if (ctx.warnings.length) console.log(`${name} warnings: ${ctx.warnings.join(" | ")}`);
}

const byName = new Map<string, Row[]>();
for (const r of rows) (byName.get(r.name) ?? byName.set(r.name, []).get(r.name)!).push(r);
for (const [name, rs] of byName) {
	const worst = rs.reduce((a, b) => (b.diff > a.diff ? b : a));
	const okCount = rs.filter((r) => r.diff <= (TOLERANCE[name] ?? threshold)).length;
	console.log(`${name.padEnd(20)} ${okCount}/${rs.length} frames ok, worst frame ${worst.frame}: ${(worst.diff * 100).toFixed(2)}% pixels differ`);
}
process.exitCode = failed ? 1 : 0;
