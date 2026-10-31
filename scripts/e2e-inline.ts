// E2E step 5: several exports inlined into one HTML page must not disturb each other (ids of
// artwork, filters, masks, CSS selectors and keyframes, player runtime ids). Each inlined SVG is
// seeked and compared with the same file opened on its own.
// Usage: node scripts/e2e-inline.ts [name,name,...] [--browser=msedge]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium, type Locator, type Page } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene, type OutputFormat } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const list = args.find((a) => !a.startsWith("--"));
// fixtures with overlapping ids: artwork, gradients, filters, masks, nested symbols
const names = (list ?? "f01-shapes,f02-eases,f04-nested,f07-mask,f08-filters,f12-labels")
	.split(",")
	.filter((n) => existsSync(join(out, n, "model", "scene.json")));
const formats: OutputFormat[] = ["static", "smil", "css", "player"];
const time = 0.55;

const browser = await chromium.launch({ channel: opt("browser", "msedge"), headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const dir = join(out, "inline");
mkdirSync(dir, { recursive: true });

function compile(name: string, format: OutputFormat) {
	const modelDir = join(out, name, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	const frame = Math.min(model.timelines[model.roots[0]!]!.frameCount - 1, Math.floor(time * model.doc.frameRate));
	const r = compileScene(model, files, { format, includeBackground: true, ...(format === "static" ? { startFrame: frame, endFrame: frame + 1 } : {}) });
	return { svg: r.files[0]!.svg, model };
}

/** Pauses and seeks every animation inside `root` (an <svg>, or the document). */
async function seek(page: Page, format: OutputFormat, index: number | null) {
	await page.evaluate(
		({ format, index, time }) => {
			const svgs = index === null ? [document.documentElement] : [document.querySelectorAll("body > svg")[index]!];
			for (const svg of svgs as unknown as (SVGSVGElement & { flash2svg?: { pause(): void; seek(t: number): void } })[]) {
				if (format === "smil") {
					svg.pauseAnimations();
					svg.setCurrentTime(time);
				} else if (format === "css") {
					for (const a of svg.getAnimations({ subtree: true })) {
						a.pause();
						a.currentTime = time * 1000;
					}
				} else if (format === "player") {
					svg.flash2svg?.pause();
					svg.flash2svg?.seek(time);
					svg.flash2svg?.pause();
				}
			}
		},
		{ format, index, time },
	);
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function grab(target: Page | Locator, w: number, h: number): Promise<PNG> {
	const buf = "goto" in target ? await target.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }) : await target.screenshot();
	return PNG.sync.read(buf);
}

let failures = 0;
for (const format of formats) {
	const parts = names.map((n) => ({ name: n, ...compile(n, format) }));
	// alone
	const refs: PNG[] = [];
	for (const p of parts) {
		const file = join(dir, `${p.name}-${format}.svg`);
		writeFileSync(file, p.svg);
		const w = Math.ceil(p.model.doc.width),
			h = Math.ceil(p.model.doc.height);
		await page.setViewportSize({ width: w, height: h });
		await page.goto(pathToFileURL(file).href);
		await page.waitForLoadState("load");
		await seek(page, format, null);
		refs.push(await grab(page, w, h));
	}
	// together, inlined (the XML prolog is not allowed inside HTML)
	const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0}body>svg{display:block}</style><body>${parts.map((p) => p.svg.replace(/^<\?xml[^>]*>\s*/, "")).join("\n")}</body>`;
	const htmlFile = join(dir, `together-${format}.html`);
	writeFileSync(htmlFile, html);
	await page.setViewportSize({ width: 800, height: 600 });
	await page.goto(pathToFileURL(htmlFile).href);
	await page.waitForLoadState("load");
	const results: string[] = [];
	let bad = 0;
	for (let i = 0; i < parts.length; i++) {
		await seek(page, format, i);
		const got = await grab(page.locator("body > svg").nth(i), 0, 0);
		const ref = refs[i]!;
		const ratio =
			got.width !== ref.width || got.height !== ref.height
				? 1
				: pixelmatch(ref.data, got.data, null, ref.width, ref.height, { threshold: 0.15, includeAA: false }) / (ref.width * ref.height);
		if (ratio > 0.01) {
			bad++;
			writeFileSync(join(dir, `together-${format}-${parts[i]!.name}-got.png`), PNG.sync.write(got));
		}
		results.push(`${parts[i]!.name} ${ratio > 0.01 ? "FAIL" : "ok"} ${(ratio * 100).toFixed(2)}%`);
	}
	if (bad) failures++;
	console.log(`inline ${format.padEnd(6)} ${bad ? "FAIL" : "ok  "}  ${results.join(", ")}`);
}
await browser.close();
process.exitCode = failures ? 1 : 0;
