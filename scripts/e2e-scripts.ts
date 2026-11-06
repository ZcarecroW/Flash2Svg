// E2E: a small game (f77-game), played with a real mouse and keyboard in every engine: dragging,
// buttons, keys, roll over and out, a timer, text, a library symbol added and removed. Its handlers
// trace what happens; the pixels are looked at too.
// Usage: node scripts/e2e-scripts.ts [--browser=msedge|firefox|webkit]   (default: all three)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, firefox, webkit, type Browser, type Page } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";
import { withFonts } from "./lib/fonts.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(repo, "tests", "out", "f77-game");
const out = join(dir, "game");
mkdirSync(out, { recursive: true });
const engineArg = process.argv.find((a) => a.startsWith("--browser="))?.slice(10);
const engines = engineArg ? [engineArg] : ["msedge", "firefox", "webkit"];
const model: SceneModel = await withFonts(JSON.parse(readFileSync(join(dir, "model", "scene.json"), "utf8")));
const files = { readText: (r: string) => readFileSync(join(dir, "model", r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, "model", r)) };

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const launch = (e: string): Promise<Browser> =>
	e === "firefox"
		? firefox.launch({ channel: "moz-firefox", headless: true, firefoxUserPrefs: { "security.sandbox.content.level": 0 }, env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" } })
		: e === "webkit"
			? webkit.launch({ headless: true })
			: chromium.launch({ channel: e, headless: true });

const res = compileScene(model, files, { format: "player", includeBackground: true });
const file = join(out, "game.html");
writeFileSync(file, `<!doctype html><html><body style="margin:0;background:#fff">${res.files[0]!.svg}</body></html>`);

async function pixel(page: Page, x: number, y: number) {
	const p = PNG.sync.read(await page.screenshot({ clip: { x, y, width: 1, height: 1 } }));
	return [p.data[0]!, p.data[1]!, p.data[2]!];
}
const near = (a: number[], b: number[], tol = 40) => a.every((v, i) => Math.abs(v - b[i]!) < tol);

for (const engine of engines) {
	const browser = await launch(engine);
	const page = await browser.newPage({ viewport: { width: 500, height: 400 }, deviceScaleFactor: 1 });
	const log: string[] = [];
	page.on("console", (m) => void log.push(m.text()));
	page.on("pageerror", (e) => void log.push(`PAGE ERROR ${e.message}`));
	await page.goto(pathToFileURL(file).href);
	await page.waitForTimeout(300);
	const has = (s: string) => log.some((l) => l === s || l.startsWith(s));
	const at = (s: string) => `${engine}: ${s}`;
	check(at("the first frame's script ran"), has("ready"), log.slice(0, 3).join(" / "));

	// dragging the ball onto the crate
	await page.mouse.move(80, 80);
	await page.mouse.down();
	await page.mouse.move(120, 90, { steps: 3 });
	await page.mouse.move(165, 85, { steps: 3 });
	await page.waitForTimeout(100);
	check(at("the ball follows the mouse"), near(await pixel(page, 165, 85), [0xcc, 0x33, 0x66]), String(await pixel(page, 165, 85)));
	await page.mouse.up();
	await page.waitForTimeout(100);
	check(at("mouse down reaches the ball"), has("down true 80 80"), log.filter((l) => l.startsWith("down")).join());
	check(at("the drop is where the mouse went, on the crate"), has("dropped 165 85 true"), log.filter((l) => l.startsWith("dropped")).join());
	await page.mouse.move(80, 80);
	await page.waitForTimeout(100);
	check(at("the spot it left is empty"), near(await pixel(page, 80, 80), [255, 255, 255]), String(await pixel(page, 80, 80)));

	// the button changes a text field
	await page.mouse.click(320, 80);
	await page.waitForTimeout(100);
	check(at("a click on the button"), has("score 10 Score 10"), log.filter((l) => l.startsWith("score")).join());
	const text = await page.evaluate(() => document.querySelector("svg text")?.textContent ?? "");
	check(at("the text field shows it"), text.includes("Score 10"), text);

	// keys
	await page.mouse.move(5, 5);
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowLeft");
	await page.waitForTimeout(80);
	check(at("keys move the crate"), has("key 37 210"), log.filter((l) => l.startsWith("key")).join(" | "));

	// roll over and out, a click starts it turning on ENTER_FRAME
	await page.mouse.move(245, 110);
	await page.mouse.move(225, 85, { steps: 2 });
	await page.waitForTimeout(80);
	check(at("roll over"), has("over 0.5"), log.filter((l) => l.startsWith("over")).join());
	const before = await page.evaluate(() => getComputedStyle(document.elementFromPoint(225, 85)!).cursor);
	check(at("a click target has the hand"), before === "pointer", before);
	await page.mouse.down();
	await page.mouse.up();
	await page.waitForTimeout(250);
	check(at("click on a movie clip"), has("turning true"), log.filter((l) => l.startsWith("turning")).join());
	await page.mouse.move(5, 5, { steps: 2 });
	await page.waitForTimeout(80);
	check(at("roll out"), has("out 1"), log.filter((l) => l.startsWith("out")).join());
	check(at("the timer fired"), has("clock 3"), log.filter((l) => l.startsWith("clock")).join());

	// a library symbol nobody placed
	await page.keyboard.press(" ");
	await page.waitForTimeout(150);
	check(at("new Star(): its first frame runs, it is on stage"), has("star made") && log.some((l) => l.startsWith("spawned")), log.slice(-3).join(" / "));
	const spawned = log.find((l) => l.startsWith("spawned"))!;
	const n = +spawned.split(" ")[1]!;
	const x = 40 + (n - 1) * 30;
	check(at("it shows"), near(await pixel(page, x, 200), [0xff, 0xcc, 0x00]), String(await pixel(page, x, 200)));
	await page.mouse.click(x, 200);
	await page.waitForTimeout(150);
	check(at("clicked away"), has(`popped ${n - 1}`), log.slice(-2).join(" / "));
	check(at("gone"), near(await pixel(page, x, 200), [255, 255, 255]), String(await pixel(page, x, 200)));
	check(at("no script errors"), !log.some((l) => /error/i.test(l)), log.filter((l) => /error/i.test(l)).join(" | "));
	await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nThe game plays");
process.exitCode = failures ? 1 : 0;
