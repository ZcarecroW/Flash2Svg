// E2E: the frame scripts of HTML5 Canvas documents against CreateJS itself. Animate publishes the
// test document (HTML and JavaScript); it runs in Edge on the createjs.min.js Animate ships. The
// JS player must log the same lines, and react to the same mouse in the same way.
// Usage: node scripts/e2e-canvas.ts [name,name,...] [--no-publish] [--all]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";
// @ts-expect-error (a plain module)
import { findAnimate, runJsfl } from "./lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const names = (args.find((a) => !a.startsWith("--")) ?? "f79-canvas").split(",");
const out = join(repo, "tests", "out");
const createjs = join(dirname(findAnimate()), "Common", "Configuration", "Publish", "Canvas", "libs", "1.0.0", "createjs.min.js");

/** Animate publishes next to the FLA: the results are moved next to the rest of the test's files. */
async function publish() {
	const script = join(out, "publish-canvas.jsfl");
	const uri = (p: string) => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1|");
	const lines = names.map((n) => `var d = fl.openDocument(${JSON.stringify(uri(join(repo, "tests", "fixtures", "fla", `${n}.fla`)))}); d.publish(); d.close(false);`);
	writeFileSync(script, `${lines.join("\n")}\nfl.quit(false);\n`);
	await runJsfl(script, { timeoutMs: 180000 });
	const fla = join(repo, "tests", "fixtures", "fla");
	for (const n of names) {
		const to = join(out, n, "canvas");
		mkdirSync(to, { recursive: true });
		for (const f of readdirSync(fla)) if (f.startsWith(`${n}.`) && !f.endsWith(".fla")) copyFileSync(join(fla, f), join(to, f));
		if (existsSync(join(fla, "images"))) {
			mkdirSync(join(to, "images"), { recursive: true });
			for (const f of readdirSync(join(fla, "images"))) copyFileSync(join(fla, "images", f), join(to, "images", f));
		}
	}
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg" };
const server = createServer((req, res) => {
	const path = decodeURIComponent(req.url!.split("?")[0]!);
	const file = normalize(join(out, path));
	if (!file.startsWith(out) || !existsSync(file)) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/plain" }).end(readFileSync(file));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

/** What a page logs, its scripts left alone for a moment, then with the mouse. */
async function play(page: Page, url: string): Promise<string[]> {
	const lines: string[] = [];
	const onLog = (m: import("playwright-core").ConsoleMessage) => void (/^(Failed to load|\[object|Access to|Canvas2D)/.test(m.text()) || lines.push(m.text()));
	const onError = (e: Error) => void lines.push(`PAGE ERROR ${e.message}`);
	page.on("console", onLog);
	page.on("pageerror", onError);
	await page.goto(url);
	for (let i = 0; i < 60 && !lines.includes("READY"); i++) await page.waitForTimeout(50);
	await page.mouse.move(300, 200);
	await page.waitForTimeout(100);
	await page.mouse.click(300, 200);
	await page.waitForTimeout(100);
	await page.mouse.move(5, 5);
	await page.waitForTimeout(100);
	await page.mouse.move(300, 100);
	await page.mouse.down();
	await page.mouse.move(310, 110, { steps: 2 });
	await page.mouse.up();
	await page.waitForTimeout(150);
	page.off("console", onLog);
	page.off("pageerror", onError);
	return lines;
}

let failures = 0;
if (!args.includes("--no-publish")) await publish();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.route("**/createjs*.js", (r) => r.fulfill({ path: createjs, contentType: "text/javascript" }));
for (const name of names) {
	const expected = await play(page, `${origin}/${name}/canvas/${name}.html`);
	writeFileSync(join(out, name, "canvas-expected.txt"), expected.join("\n"));
	const dir = join(out, name, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	const files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) };
	const res = compileScene(model, files, { format: "player", includeBackground: true });
	for (const w of res.warnings) console.log(`  warning: ${w}`);
	writeFileSync(join(out, name, "canvas-player.html"), `<!doctype html><html><body style="margin:0">${res.files[0]!.svg}</body></html>`);
	const got = await play(page, `${origin}/${name}/canvas-player.html`);
	writeFileSync(join(out, name, "canvas-got.txt"), got.join("\n"));
	let bad = 0;
	const shown = args.includes("--all") ? 1e9 : 14;
	const n = Math.max(expected.length, got.length);
	for (let i = 0; i < n; i++) {
		if (expected[i] === got[i]) continue;
		if (bad++ < shown) console.log(`  line ${i + 1}\n    CreateJS: ${expected[i] ?? "(nothing)"}\n    player:   ${got[i] ?? "(nothing)"}`);
	}
	console.log(`${bad ? "FAIL" : "ok  "} ${name}: ${expected.length} lines from CreateJS, ${bad} differ`);
	if (bad) failures++;
}
await browser.close();
server.close();
console.log(failures ? `\n${failures} document(s) differ` : "\nCanvas scripts behave as on CreateJS");
process.exitCode = failures ? 1 : 0;
