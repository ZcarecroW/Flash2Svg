// E2E: the frame scripts of HTML5 Canvas documents against CreateJS itself. Animate publishes the
// test document (HTML and JavaScript); it runs in Edge on the createjs.min.js Animate ships. The
// JS player must log the same lines, and react to the same mouse in the same way.
// Usage: node scripts/e2e-canvas.ts [name,name,...] [--no-publish] [--all] [--browser=msedge|firefox|webkit]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, type Page } from "playwright-core";
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
		// (components are loaded from Animate's own folder, see below)
		if (existsSync(join(fla, "images"))) {
			mkdirSync(join(to, "images"), { recursive: true });
			for (const f of readdirSync(join(fla, "images"))) copyFileSync(join(fla, "images", f), join(to, "images", f));
		}
	}
}

const TYPES: Record<string, string> = { ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg" };
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
async function play(page: Page, url: string, steps?: (p: Page) => Promise<void>): Promise<string[]> {
	const lines: string[] = [];
	const onLog = (m: import("playwright-core").ConsoleMessage) => void (/^(Failed to load|\[object|Access to|Canvas2D)/.test(m.text()) || lines.push(m.text()));
	const onError = (e: Error) => void lines.push(`PAGE ERROR ${e.message}`);
	await page.goto("about:blank");
	page.on("console", onLog);
	page.on("pageerror", onError);
	await page.goto(url);
	for (let i = 0; i < 60 && !lines.includes("READY"); i++) await page.waitForTimeout(50);
	if (steps) {
		await steps(page);
		await page.waitForTimeout(100);
		page.off("console", onLog);
		page.off("pageerror", onError);
		return lines;
	}
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
const engine = args.find((a) => a.startsWith("--browser="))?.slice(10) ?? "msedge";
const browser =
	engine === "firefox"
		? await firefox.launch({ channel: "moz-firefox", headless: true, firefoxUserPrefs: { "security.sandbox.content.level": 0, "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 }, env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" } })
		: engine === "webkit"
			? await webkit.launch({ headless: true })
			: await chromium.launch({ channel: "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.route("**/createjs*.js", (r) => r.fulfill({ path: createjs, contentType: "text/javascript" }));
// (what a published document with components loads: from Animate)
const components = join(dirname(createjs), "..", "..", "..", "..", "HTML5Components");
await page.route("**/jquery-3*.min.js", (r) => r.fulfill({ path: join(components, "lib", "jquery-3.4.1.min.js"), contentType: "text/javascript" }));
// (jQuery UI, its style sheet and its icons, for the jQuery UI components)
const jqui = join(components, "jqueryui", "jquery-ui-1.12.0");
await page.route("**/ui/1.12.1/jquery-ui.min.js", (r) => r.fulfill({ path: join(jqui, "jquery-ui.min.js"), contentType: "text/javascript" }));
await page.route("**/themes/base/jquery-ui.css", (r) => r.fulfill({ path: join(jqui, "jquery-ui.min.css"), contentType: "text/css" }));
await page.route("**/ui/images/*.png", (r) => r.fulfill({ path: join(jqui, "images", new URL(r.request().url()).pathname.replace(/^.*\//, "")), contentType: "image/png" }));
await page.route("**/components/**", (r) => r.fulfill({ path: join(components, new URL(r.request().url()).pathname.replace(/^.*\/components\//, "")), contentType: "text/javascript" }));

/** What a user does to the components. */
async function useUi(p: Page) {
	await p.mouse.click(70, 31);
	await p.mouse.click(146, 31);
	await p.mouse.click(26, 61);
	await p.mouse.click(146, 61);
	await p.selectOption("#cmb", "2");
	await p.fill("#num", "5");
	await p.locator("#num").blur();
	await p.locator("#txt").click();
	await p.keyboard.press("End");
	await p.keyboard.type("ab");
	await p.keyboard.press("Tab");
	await p.mouse.click(70, 31);
}
/** What a user does to the jQuery UI components: picks a radio button by its label, types a date. */
async function useJq(p: Page) {
	await p.waitForTimeout(400);
	await p.locator("#rs label").nth(1).click();
	await p.locator("#rs label").nth(2).click();
	await p.locator("#dp").fill("12/24/2026");
	await p.locator("#dp").press("Tab");
	await p.keyboard.press("Escape");
}
const stepsFor: Record<string, (p: Page) => Promise<void>> = { "f89-canvasui": useUi, "f97-jqueryui": useJq };
for (const name of names) {
	const expected = await play(page, `${origin}/${name}/canvas/${name}.html`, stepsFor[name]);
	writeFileSync(join(out, name, "canvas-expected.txt"), expected.join("\n"));
	const dir = join(out, name, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	const files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) };
	const res = compileScene(model, files, { format: "player", includeBackground: true });
	for (const w of res.warnings) console.log(`  warning: ${w}`);
	writeFileSync(join(out, name, "canvas-player.html"), `<!doctype html><html><body style="margin:0">${res.files[0]!.svg}</body></html>`);
	writeFileSync(join(out, name, "canvas-player.svg"), res.files[0]!.svg);
	for (const form of ["html", "svg"]) {
		const got = await play(page, `${origin}/${name}/canvas-player.${form}`, stepsFor[name]);
		writeFileSync(join(out, name, "canvas-got.txt"), got.join("\n"));
		let bad = 0;
		const shown = args.includes("--all") ? 1e9 : 14;
		const n = Math.max(expected.length, got.length);
		for (let i = 0; i < n; i++) {
			if (expected[i] === got[i]) continue;
			if (bad++ < shown) console.log(`  line ${i + 1}\n    CreateJS: ${expected[i] ?? "(nothing)"}\n    player:   ${got[i] ?? "(nothing)"}`);
		}
		console.log(`${bad ? "FAIL" : "ok  "} ${name}${form === "svg" ? " (as an SVG file)" : ""}: ${expected.length} lines from CreateJS, ${bad} differ`);
		if (bad) failures++;
	}
}
await browser.close();
server.close();
console.log(failures ? `\n${failures} document(s) differ` : "\nCanvas scripts behave as on CreateJS");
process.exitCode = failures ? 1 : 0;
