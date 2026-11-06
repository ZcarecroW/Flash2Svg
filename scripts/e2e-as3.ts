// E2E: frame scripts against Flash Player. The test documents' scripts trace what they see and quit;
// Animate's own debug Flash Player runs the SWF and writes the traces to flashlog.txt (needs an
// mm.cfg, which this script writes and takes away again); the JS player must trace the same lines.
// tests/out/<name>/as3-expected.txt keeps Flash Player's log.
// Usage: node scripts/e2e-as3.ts [name,name,...] [--flash-only] [--no-flash]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
	const onLog = (m: import("playwright-core").ConsoleMessage) => void lines.push(m.text());
	const onError = (e: Error) => void lines.push(`PAGE ERROR ${e.message}`);
	page.on("console", onLog);
	page.on("pageerror", onError);
	await page.goto(pathToFileURL(file).href);
	for (let i = 0; i < 100 && !lines.includes("END"); i++) await page.waitForTimeout(100);
	page.off("console", onLog);
	page.off("pageerror", onError);
	return lines;
}

let failures = 0;
if (!noFlash) await publish();
const browser = await chromium.launch({ channel: "msedge", headless: true });
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
	for (let i = 0; i < n; i++) {
		if (expected[i] === got[i]) continue;
		if (bad++ < 14) console.log(`  line ${i + 1}\n    Flash:  ${expected[i] ?? "(nothing)"}\n    player: ${got[i] ?? "(nothing)"}`);
	}
	console.log(`${bad ? "FAIL" : "ok  "} ${name}: ${expected.length} lines from Flash Player, ${bad} differ`);
	if (bad) failures++;
}
await browser.close();
console.log(failures ? `\n${failures} document(s) differ` : "\nScripts behave as in Flash Player");
process.exitCode = failures ? 1 : 0;
