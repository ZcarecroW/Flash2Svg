// E2E: the keyboard and the mouse against Flash Player. A steps file says what a user does; the
// keys and clicks are posted to Flash Player's own window (they can't land anywhere else, and the
// player needn't be in front), Playwright does the same in the browsers, and both must trace the same.
// Usage: node scripts/e2e-typing.ts [name,name,...] [--flash-only] [--no-flash] [--all] [--browser=msedge|firefox|webkit]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";
// @ts-expect-error (a plain module)
import { findAnimate, runJsfl } from "./lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const names = (args.find((a) => !a.startsWith("--")) ?? "f87-typing,f88-clicks").split(",");
const noFlash = args.includes("--no-flash");
const engine = args.find((a) => a.startsWith("--browser="))?.slice(10) ?? "msedge";
const out = join(repo, "tests", "out");
const uri = (p: string) => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1|");
const stepsOf = (name: string) => join(repo, "tests", "fixtures", `${name.split("-")[0]}-keys.txt`);

async function publish() {
	const script = join(out, "publish-typing.jsfl");
	const lines = names.map((n) => {
		mkdirSync(join(out, n), { recursive: true });
		return `var d = fl.openDocument(${JSON.stringify(uri(join(repo, "tests", "fixtures", "fla", `${n}.fla`)))}); d.exportSWF(${JSON.stringify(uri(join(out, n, `${n}.swf`)))}, true); fl.closeDocument(d, false);`;
	});
	writeFileSync(script, `${lines.join("\n")}\nfl.quit(false);\n`);
	await runJsfl(script, { timeoutMs: 180000 });
}

/** The traces up to the end of the test (quitting takes the focus away, which says nothing). */
const upToEnd = (lines: string[]) => lines.slice(0, lines.indexOf("END") + 1 || lines.length);

function flashTraces(name: string): string[] {
	const player = join(dirname(findAnimate()), "Players", "Debug", "FlashPlayerDebugger.exe");
	const mm = join(homedir(), "mm.cfg");
	const saved = existsSync(mm) ? `${mm}.f2s-saved` : null;
	if (saved) renameSync(mm, saved);
	writeFileSync(mm, "ErrorReportingEnable=1\nTraceOutputFileEnable=1\nMaxWarnings=0\nSuppressDebuggerExceptionDialogs=1\n");
	const log = join(process.env.APPDATA!, "Macromedia", "Flash Player", "Logs", "flashlog.txt");
	rmSync(log, { force: true });
	try {
		const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "scripts", "lib", "keys.ps1"), "-Player", player, "-Swf", join(out, name, `${name}.swf`), "-Steps", stepsOf(name)], { timeout: 60000, encoding: "utf8" });
		if (r.stderr) console.log(r.stderr.slice(0, 600));
	} finally {
		rmSync(mm, { force: true });
		if (saved) renameSync(saved, mm);
	}
	const text = existsSync(log) ? readFileSync(log, "utf8") : "";
	writeFileSync(join(out, name, "typing-expected.txt"), text);
	return upToEnd(text.split(/\r?\n/).filter((l) => l && !l.startsWith("Warning:")));
}

const KEYS: Record<string, string> = { Back: "Backspace", Left: "ArrowLeft", Right: "ArrowRight", Up: "ArrowUp", Down: "ArrowDown", Space: " " };

async function playerTraces(name: string, page: import("playwright-core").Page, alone: boolean): Promise<string[]> {
	const dir = join(out, name, "model");
	const model: SceneModel = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	const files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) };
	const res = compileScene(model, files, { format: "player", includeBackground: true });
	const file = join(out, name, alone ? "typing.svg" : "typing.html");
	writeFileSync(file, alone ? res.files[0]!.svg : `<!doctype html><html><body style="margin:0">${res.files[0]!.svg}</body></html>`);
	const lines: string[] = [];
	const onLog = (m: import("playwright-core").ConsoleMessage) => void (/^(Failed to load|\[DOM\])/.test(m.text()) || !m.text() || lines.push(m.text()));
	const onError = (e: Error) => void lines.push(`PAGE ERROR ${e.message}`);
	await page.goto("about:blank");
	page.on("console", onLog);
	page.on("pageerror", onError);
	await page.goto(`${origin}/${name}/${alone ? "typing.svg" : "typing.html"}`);
	await page.waitForTimeout(400);
	await page.bringToFront();
	for (let step of readFileSync(stepsOf(name), "utf8").split(/\r?\n/)) {
		// (a step for one side: what the same thing takes there)
		if (!step || step.startsWith("f ")) continue;
		if (step.startsWith("p ")) step = step.slice(2);
		if (step.startsWith("t ")) await page.keyboard.type(step.slice(2), { delay: 5 });
		else if (step.startsWith("row ")) {
			// (a list's rows are as high as the browser makes them)
			const [, id, i] = step.split(" ");
			const at = await page.evaluate(([id, i]) => {
				const r = document.querySelectorAll(`[data-name="${id}"] option`)[+i!]!.getBoundingClientRect();
				return [r.left + 20, r.top + r.height / 2] as const;
			}, [id, i]);
			await page.mouse.click(at[0], at[1]);
		} else if (step.startsWith("press ")) {
			// (a control with a popup of its own: the press and what it opens are gone again)
			const [, x, y] = step.split(" ");
			await page.mouse.move(+x!, +y!);
			await page.evaluate(([x, y]) => {
				const t = document.elementFromPoint(+x!, +y!)!;
				const at = { bubbles: true, clientX: +x!, clientY: +y!, button: 0, buttons: 1 };
				t.dispatchEvent(new PointerEvent("pointerdown", at));
				t.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 }));
				(t as HTMLElement).focus();
			}, [x, y]);
		} else if (step.startsWith("select ")) {
			const [, id, i] = step.split(" ");
			await page.evaluate(([id, i]) => {
				const s = document.querySelector(`[data-name="${id}"] select`) as HTMLSelectElement;
				s.selectedIndex = +i!;
				s.dispatchEvent(new Event("input", { bubbles: true }));
				s.dispatchEvent(new Event("change", { bubbles: true }));
			}, [id, i]);
		} else if (step.startsWith("value ")) {
			const [, id, v] = step.split(" ");
			await page.evaluate(([id, v]) => {
				const s = document.querySelector(`[data-name="${id}"] input`) as HTMLInputElement;
				s.value = v!;
				s.dispatchEvent(new Event("input", { bubbles: true }));
				s.dispatchEvent(new Event("change", { bubbles: true }));
			}, [id, v]);
		}
		else if (step.startsWith("click ")) {
			const [, x, y] = step.split(" ");
			await page.mouse.move(+x!, +y!);
			await page.mouse.down();
			await page.mouse.up();
		} else if (step.startsWith("drag ")) {
			const [, a, b, c, d] = step.split(" ");
			await page.mouse.move(+a!, +b!);
			await page.mouse.down();
			await page.mouse.move(+c!, +d!, { steps: 4 });
			await page.mouse.up();
		} else if (step === "Tab" && engine === "webkit") {
			// (WebKit's Tab goes to text fields only, unless the browser is set otherwise)
			await page.evaluate(() => {
				const all = [...document.querySelectorAll("button,input,select,textarea")] as HTMLElement[];
				all[all.indexOf(document.activeElement as HTMLElement) + 1]?.focus();
			});
		} else await page.keyboard.press(KEYS[step] ?? step);
		await page.waitForTimeout(15);
	}
	for (let i = 0; i < 30 && !lines.includes("END"); i++) await page.waitForTimeout(50);
	page.off("console", onLog);
	page.off("pageerror", onError);
	return upToEnd(lines);
}

const server = createServer((req, res) => {
	const file = normalize(join(out, decodeURIComponent(req.url!.split("?")[0]!)));
	if (!file.startsWith(out) || !existsSync(file)) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream" }).end(readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

if (!noFlash) await publish();
let failures = 0;
const browser =
	engine === "firefox"
		? await firefox.launch({ channel: "moz-firefox", headless: true, firefoxUserPrefs: { "security.sandbox.content.level": 0 }, env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" } })
		: engine === "webkit"
			? await webkit.launch({ headless: true })
			: await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
for (const name of names) {
	const expected = noFlash ? upToEnd(readFileSync(join(out, name, "typing-expected.txt"), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("Warning:"))) : flashTraces(name);
	if (!expected.includes("END")) {
		console.log(`FAIL ${name}: Flash Player didn't reach the end: ${expected.slice(-3).join(" / ")}`);
		failures++;
	}
	if (args.includes("--flash-only")) {
		console.log(`${name}: ${expected.length} lines from Flash Player`);
		continue;
	}
	for (const alone of [false, true]) {
		const got = await playerTraces(name, page, alone);
		let bad = 0;
		const shown = args.includes("--all") ? 1e9 : 14;
		for (let i = 0; i < Math.max(expected.length, got.length); i++) {
			if (expected[i] === got[i]) continue;
			if (bad++ < shown) console.log(`  line ${i + 1}\n    Flash:  ${expected[i] ?? "(nothing)"}\n    player: ${got[i] ?? "(nothing)"}`);
		}
		console.log(`${bad ? "FAIL" : "ok  "} ${name}${alone ? " (as an SVG file)" : ""}: ${expected.length} lines from Flash Player, ${bad} differ (${engine})`);
		if (bad) failures++;
	}
}
// ---- without a script: the controls of SMIL and CSS output are the browser's own
if (names.includes("f88-clicks") && !args.includes("--flash-only")) {
	const dir = join(out, "f88-clicks", "model");
	const model: SceneModel = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	const files = { readText: (r: string) => readFileSync(join(dir, r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, r)) };
	for (const format of ["smil", "css"] as const) {
		const res = compileScene(model, files, { format, includeBackground: true });
		for (const form of ["inline", "object"]) {
			const name = `controls-${format}`;
			writeFileSync(join(out, "f88-clicks", `${name}.svg`), res.files[0]!.svg);
			writeFileSync(join(out, "f88-clicks", `${name}.html`), `<!doctype html><html><body style="margin:0">${form === "inline" ? res.files[0]!.svg : `<object data="${name}.svg" type="image/svg+xml" style="display:block;width:400px;height:400px"></object>`}</body></html>`);
			await page.goto(`${origin}/f88-clicks/${name}.html`);
			await page.waitForTimeout(300);
			await page.mouse.click(30, 60);
			await page.mouse.click(30, 90);
			await page.mouse.click(60, 230);
			await page.keyboard.press("End");
			await page.keyboard.type("ab");
			await page.waitForTimeout(50);
			const frame = page.frames()[page.frames().length - 1]!;
			const state = await frame.evaluate(() => {
				const of = (n: string, s: string) => document.querySelector(`[data-name="${n}"] ${s}`) as (HTMLInputElement & HTMLSelectElement) | null;
				return [of("tick", "input")?.checked, of("one", "input")?.checked, of("line", "input")?.value, of("pick", "select")?.options.length, of("many", "select")?.options.length].join(" ");
			});
			const good = state === "true true Hiab 3 3";
			console.log(`${good ? "ok  " : "FAIL"} ${format} ${form}: ${state} (${engine})`);
			if (!good) failures++;
		}
	}
}
await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nKeys and clicks behave as in Flash Player");
process.exit(failures ? 1 : 0);
