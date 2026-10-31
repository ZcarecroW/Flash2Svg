// E2E: the start triggers "visible" and "scroll" (SMIL, CSS, player) in a real browser, with the SVG
// inline in a page and in an <object> (served over HTTP, same origin).
// - scroll: the page is scrolled so the SVG's progress through its range puts the animation on
//   a frame; the SVG is screenshotted there and compared with the static renderer's frame.
// - visible: below the fold the animation must hold at its start; scrolled into view, it runs.
// Usage: node scripts/e2e-triggers.ts [name,...] [--browser=msedge|firefox|webkit] [--every=6]
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium, firefox, webkit, type Page } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene, type ExportSettings } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const every = parseInt(opt("every", "6"), 10);
const names = (args.find((a) => !a.startsWith("--")) ?? "f03-transforms,f04-nested,f27-stop").split(",");
const THRESHOLD = 0.0015;
const dir = join(out, "triggers");
mkdirSync(dir, { recursive: true });

// one origin for pages and SVGs: <object> scripts can then see the page around them
const server = createServer((req, res) => {
	const file = join(dir, decodeURIComponent((req.url ?? "/").split("?")[0]!.slice(1)));
	if (!file.startsWith(dir) || !existsSync(file)) return void res.writeHead(404).end();
	res.writeHead(200, { "content-type": file.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8" }).end(readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

const engine = opt("browser", "msedge");
const browser =
	engine === "firefox"
		? await firefox.launch({ channel: "moz-firefox", headless: true, firefoxUserPrefs: { "security.sandbox.content.level": 0 }, env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" } })
		: engine === "webkit"
			? await webkit.launch({ headless: true })
			: await chromium.launch({ channel: engine, headless: true });
// a tall viewport: the range "visible" (contain) is viewport - svg height pixels long, so a pixel
// of rounding is a small share of a frame
const VIEW = 1300;
const TOP = 1500;
const page = await browser.newPage({ viewport: { width: 800, height: VIEW }, deviceScaleFactor: 1 });
let failures = 0;

const frameOf = async (p: Page, file: string, w: number, h: number) => {
	await p.goto(base + file);
	await p.waitForLoadState("load");
	return PNG.sync.read(await p.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
};
const diff = (a: PNG, b: PNG) => pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.15, includeAA: false }) / (a.width * a.height);
const html = (body: string) => `<!doctype html><html><body style="margin:0;background:#fff"><div style="height:${TOP}px"></div>${body}<div style="height:3000px"></div></body></html>`;
const embed = (how: string, file: string, svg: string, w: number, h: number) =>
	how === "inline" ? svg.replace(/^<\?xml[^>]*>\s*/, "").replace("<svg ", '<svg style="display:block" ') : `<object data="${file}" type="image/svg+xml" width="${w}" height="${h}" style="display:block"></object>`;

for (const name of names) {
	const modelDir = join(out, name, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	const { width: w, height: h, frameRate: fps } = model.doc;
	const W = Math.ceil(w),
		Hh = Math.ceil(h);
	const statics = compileScene(model, files, { format: "static", includeBackground: true });
	for (const format of ["smil", "css", "player"] as const) {
		// SMIL/CSS one step per frame (checked mid-frame); the player tweens smoothly: just after the frame
		const stepped = format !== "player";
		const s: Partial<ExportSettings> = { format, includeBackground: true, smooth: !stepped, begin: "scroll", scrollRange: "visible" };
		const anim = compileScene(model, files, s);
		const frames = anim.stats.frames;
		const file = `${name}-${format}-scroll.svg`;
		writeFileSync(join(dir, file), anim.files[0]!.svg);
		for (const how of format === "css" ? ["inline"] : ["inline", "object"]) {
			const pageFile = `${name}-${format}-scroll-${how}.html`;
			writeFileSync(join(dir, pageFile), html(embed(how, file, anim.files[0]!.svg, W, Hh)));
			let ok = 0,
				n = 0,
				worst = 0,
				worstFrame = -1;
			const checks = [...new Set([0, ...Array.from({ length: Math.ceil(frames / every) }, (_, i) => i * every), frames - 1])].filter((f) => f < frames);
			for (const f of checks) {
				const sfile = `${name}-static-${f + 1}.svg`;
				if (!existsSync(join(dir, sfile))) writeFileSync(join(dir, sfile), statics.files[f]!.svg);
				const ref = await frameOf(page, sfile, W, Hh);
				await page.goto(base + pageFile);
				await page.waitForLoadState("load");
				// progress p puts the time at (f + off) / fps; contain: top runs from VIEW - h to 0
				const p = f === frames - 1 ? 1 : (f + (stepped ? 0.5 : 0.05)) / frames;
				await page.evaluate((y) => scrollTo(0, y), Math.round(TOP - (1 - p) * (VIEW - Hh)));
				await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
				// (a clip of the page: Firefox over BiDi waits forever for an <object> element screenshot)
				const box = await page.evaluate((sel) => {
					const r = document.querySelector(sel)!.getBoundingClientRect();
					return { x: r.left, y: r.top, width: r.width, height: r.height };
				}, how === "inline" ? "svg" : "object");
				const got = PNG.sync.read(await page.screenshot({ clip: box }));
				const ratio = got.width === ref.width && got.height === ref.height ? diff(ref, got) : 1;
				n++;
				if (ratio <= THRESHOLD) ok++;
				else writeFileSync(join(dir, `${name}-${format}-${how}-f${f + 1}-got.png`), PNG.sync.write(got));
				if (ratio > worst) [worst, worstFrame] = [ratio, f + 1];
			}
			if (ok < n) failures++;
			console.log(`${name.padEnd(16)} ${format.padEnd(6)} scroll ${how.padEnd(6)} ${ok}/${n} frames ok, worst frame ${worstFrame}: ${(worst * 100).toFixed(2)}%`);
		}

		// visible: held below the fold, running once half on screen
		const v = compileScene(model, files, { format, includeBackground: true, begin: "visible" });
		const vfile = `${name}-${format}-visible.svg`;
		writeFileSync(join(dir, vfile), v.files[0]!.svg);
		for (const how of format === "css" ? ["inline"] : ["inline", "object"]) {
			const pageFile = `${name}-${format}-visible-${how}.html`;
			writeFileSync(join(dir, pageFile), html(embed(how, vfile, v.files[0]!.svg, W, Hh)));
			await page.goto(base + pageFile);
			await page.waitForLoadState("load");
			const clock = () =>
				page.evaluate(
					({ format, how }) => {
						const root = how === "inline" ? document : (document.querySelector("object")!.contentDocument as Document);
						const svg = root.querySelector("svg") as SVGSVGElement & { flash2svg?: { currentFrame: number } };
						if (format === "smil") return svg.getCurrentTime();
						if (format === "css") return Math.max(0, ...svg.getAnimations({ subtree: true }).map((a) => Number(a.currentTime ?? 0) / 1000));
						return (svg.flash2svg!.currentFrame - 1) / 1000;
					},
					{ format, how },
				);
			await page.waitForTimeout(700);
			const before = await clock();
			await page.evaluate((y) => scrollTo(0, y), TOP - 200);
			await page.waitForTimeout(700);
			const after = await clock();
			// player: frames (scaled by 1000 above to share the check); others: seconds
			const moved = format === "player" ? after * 1000 >= 0.4 * fps : after >= 0.4;
			const held = before < 0.05 || (format === "player" && before === 0);
			if (!held || !moved) failures++;
			console.log(`${name.padEnd(16)} ${format.padEnd(6)} visible ${how.padEnd(6)} ${held && moved ? "ok" : "FAIL"} (below the fold ${before.toFixed(3)}, in view ${after.toFixed(3)}${format === "player" ? " frames/1000" : " s"})`);
		}
	}
}
await browser.close();
server.close();
console.log(failures ? `\nTriggers: ${failures} FAILED` : "\nTriggers: all good");
process.exit(failures ? 1 : 0);
