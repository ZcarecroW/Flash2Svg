// E2E: frame scripts against Flash Player. The test documents' scripts trace what they see and quit;
// Animate's own debug Flash Player runs the SWF and writes the traces to flashlog.txt (needs an
// mm.cfg, which this script writes and takes away again); the JS player must trace the same lines.
// tests/out/<name>/as3-expected.txt keeps Flash Player's log. Files the scripts load lie next to the
// SWF and the page.
// Usage: node scripts/e2e-as3.ts [name,name,...] [--flash-only] [--no-flash]
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";
// @ts-expect-error (a plain module)
import { findAnimate, runJsfl } from "./lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const names = (args.find((a) => !a.startsWith("--")) ?? "f74-as3lang,f75-as3timeline").split(",");
const noFlash = args.includes("--no-flash");
const out = join(repo, "tests", "out");

/** Publishes the test documents to SWF. */
async function publish() {
	const script = join(out, "publish-swf.jsfl");
	const uri = (p: string) => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1|");
	const lines = names.map((n) => {
		mkdirSync(join(out, n), { recursive: true });
		return `var d = fl.openDocument(${JSON.stringify(uri(join(repo, "tests", "fixtures", "fla", `${n}.fla`)))}); d.exportSWF(${JSON.stringify(uri(join(out, n, `${n}.swf`)))}, true); fl.closeDocument(d, false);`;
	});
	writeFileSync(script, `${lines.join("\n")}\nfl.quit(false);\n`);
	await runJsfl(script, { timeoutMs: 180000 });
}

/** What Flash Player traces. */
function flashTraces(name: string): string[] {
	const player = join(dirname(findAnimate()), "Players", "Debug", "FlashPlayerDebugger.exe");
	const mm = join(homedir(), "mm.cfg");
	const saved = existsSync(mm) ? `${mm}.f2s-saved` : null;
	if (saved) renameSync(mm, saved);
	writeFileSync(mm, "ErrorReportingEnable=1\nTraceOutputFileEnable=1\nMaxWarnings=0\n");
	const log = join(process.env.APPDATA!, "Macromedia", "Flash Player", "Logs", "flashlog.txt");
	rmSync(log, { force: true });
	try {
		spawnSync(player, [join(out, name, `${name}.swf`)], { timeout: 30000 });
	} finally {
		rmSync(mm, { force: true });
		if (saved) renameSync(saved, mm);
	}
	const text = existsSync(log) ? readFileSync(log, "utf8") : "";
	writeFileSync(join(out, name, "as3-expected.txt"), text);
	return text.split(/\r?\n/).filter((l) => l && !l.startsWith("Warning:"));
}

async function playerTraces(name: string, page: import("playwright-core").Page): Promise<string[]> {
	const dir = join(out, name, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	const files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) };
	const res = compileScene(model, files, { format: "player", includeBackground: true });
	const file = join(out, name, "as3-player.html");
	writeFileSync(file, `<!doctype html><html><body style="margin:0">${res.files[0]!.svg}</body></html>`);
	const lines: string[] = [];
	// (what isn't there on purpose: the browser says so too)
	const onLog = (m: import("playwright-core").ConsoleMessage) => void (m.text().startsWith("Failed to load") || lines.push(m.text()));
	const onError = (e: Error) => void lines.push(`PAGE ERROR ${e.message}`);
	page.on("console", onLog);
	page.on("pageerror", onError);
	await page.goto(`${origin}/${name}/as3-player.html`);
	for (let i = 0; i < 100 && !lines.includes("END"); i++) await page.waitForTimeout(100);
	page.off("console", onLog);
	page.off("pageerror", onError);
	return lines;
}

/** What the scripts load, next to the SWF and the page. */
function loadable(name: string) {
	const dir = join(out, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "note.txt"), "A note");
	writeFileSync(join(dir, "vars.txt"), "a=1&b=two%20words");
	copyFileSync(join(repo, "tests", "fixtures", "assets", "icon.png"), join(dir, "pic.png"));
}

// (a page's scripts can't load from file:)
const server = createServer((req, res) => {
	const file = normalize(join(out, decodeURIComponent(req.url!.split("?")[0]!)));
	if (!file.startsWith(out) || !existsSync(file)) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".png") ? "image/png" : "text/plain" }).end(readFileSync(file));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

let failures = 0;
for (const name of names) loadable(name);
if (!noFlash) await publish();
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
for (const name of names) {
	const expected = noFlash ? readFileSync(join(out, name, "as3-expected.txt"), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("Warning:")) : flashTraces(name);
	if (!expected.includes("END")) {
		console.log(`FAIL ${name}: Flash Player didn't reach the end: ${expected.slice(-3).join(" / ")}`);
		failures++;
	}
	if (args.includes("--flash-only")) {
		console.log(`${name}: ${expected.length} lines from Flash Player`);
		continue;
	}
	const got = await playerTraces(name, page);
	let bad = 0;
	const n = Math.max(expected.length, got.length);
	const shown = args.includes("--all") ? 1e9 : 14;
	for (let i = 0; i < n; i++) {
		if (expected[i] === got[i]) continue;
		if (bad++ < shown) console.log(`  line ${i + 1}\n    Flash:  ${expected[i] ?? "(nothing)"}\n    player: ${got[i] ?? "(nothing)"}`);
	}
	console.log(`${bad ? "FAIL" : "ok  "} ${name}: ${expected.length} lines from Flash Player, ${bad} differ`);
	if (bad) failures++;
}
await browser.close();
server.close();
console.log(failures ? `\n${failures} document(s) differ` : "\nScripts behave as in Flash Player");
process.exitCode = failures ? 1 : 0;
