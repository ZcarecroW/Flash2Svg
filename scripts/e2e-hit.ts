// E2E: the Hit frame of buttons with a real mouse (SMIL, CSS, player; inline; every engine). f66-hit:
//  - "wide hit" at (90, 100): 40x40 art (up red, over green, down blue), Hit 140x120
//  - "invisible" at (210, 100): only a Hit frame, 80x80
//  - "own hit" at (320, 100): a 60 px disc, no Hit frame: its shape is the hit area, not its box
// Usage: node scripts/e2e-hit.ts [--browser=msedge|firefox|webkit]   (default: all three)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, firefox, webkit, type Browser } from "playwright-core";
import { PNG } from "pngjs";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(repo, "tests", "out", "f66-hit");
const out = join(dir, "hit");
mkdirSync(out, { recursive: true });
const engineArg = process.argv.find((a) => a.startsWith("--browser="))?.slice(10);
const engines = engineArg ? [engineArg] : ["msedge", "firefox", "webkit"];

const model: SceneModel = JSON.parse(readFileSync(join(dir, "model", "scene.json"), "utf8"));
const files = { readText: (r: string) => readFileSync(join(dir, "model", r), "utf8"), readBinary: (r: string) => readFileSync(join(dir, "model", r)) };

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
	if (!ok) failures++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const launch = (e: string): Promise<Browser> =>
	e === "firefox"
		? firefox.launch({
				channel: "moz-firefox",
				headless: true,
				firefoxUserPrefs: { "security.sandbox.content.level": 0 },
				env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" },
			})
		: e === "webkit"
			? webkit.launch({ headless: true })
			: chromium.launch({ channel: e, headless: true });

const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 24);
const RED = [0xcc, 0x33, 0x33],
	GREEN = [0x33, 0xcc, 0x33],
	BLUE = [0x33, 0x33, 0xcc],
	WHITE = [255, 255, 255];

for (const engine of engines) {
	const browser = await launch(engine);
	const page = await browser.newPage({ viewport: { width: 500, height: 300 }, deviceScaleFactor: 1 });
	for (const format of ["smil", "css", "player"] as const) {
		const res = compileScene(model, files, { format, loop: "always" });
		const file = join(out, `${format}.html`);
		writeFileSync(file, `<!doctype html><html><body style="margin:0;background:#fff">${res.files[0]!.svg}</body></html>`);
		await page.goto(pathToFileURL(file).href);
		await page.waitForTimeout(150);
		const pixel = async (x: number, y: number) => {
			const png = PNG.sync.read(await page.screenshot({ clip: { x, y, width: 1, height: 1 } }));
			return [png.data[0]!, png.data[1]!, png.data[2]!];
		};
		const cursor = (x: number, y: number) => page.evaluate(([px, py]) => getComputedStyle(document.elementFromPoint(px!, py!) ?? document.body).cursor, [x, y]);
		const at = `${engine} ${format}`;
		const move = async (x: number, y: number) => {
			await page.mouse.move(x, y);
			await page.waitForTimeout(80);
		};

		await move(450, 280);
		check(`${at}: up state`, near(await pixel(90, 100), RED), String(await pixel(90, 100)));
		check(`${at}: nothing shows of the invisible button`, near(await pixel(210, 100), WHITE), String(await pixel(210, 100)));
		// beside the art, inside the Hit frame
		await move(35, 60);
		check(`${at}: the wide Hit frame takes the pointer`, near(await pixel(90, 100), GREEN), String(await pixel(90, 100)));
		check(`${at}: hand cursor over the Hit frame`, (await cursor(35, 60)) === "pointer", await cursor(35, 60));
		check(`${at}: the Hit frame isn't drawn`, near(await pixel(35, 60), WHITE), String(await pixel(35, 60)));
		await page.mouse.down();
		await page.waitForTimeout(80);
		check(`${at}: down state`, near(await pixel(90, 100), BLUE), String(await pixel(90, 100)));
		await page.mouse.up();
		await page.waitForTimeout(80);
		await move(15, 100);
		check(`${at}: outside the Hit frame: up again`, near(await pixel(90, 100), RED), String(await pixel(90, 100)));
		// the invisible button
		await move(210, 100);
		check(`${at}: invisible button: hand cursor`, (await cursor(210, 100)) === "pointer", await cursor(210, 100));
		check(`${at}: invisible button stays invisible`, near(await pixel(190, 80), WHITE), String(await pixel(190, 80)));
		await move(165, 100);
		check(`${at}: beside it: no hand`, (await cursor(165, 100)) !== "pointer", await cursor(165, 100));
		// its own drawing: the disc, not its box
		await move(320, 100);
		check(`${at}: no Hit frame: its drawing takes the pointer`, (await cursor(320, 100)) === "pointer", await cursor(320, 100));
		await move(293, 73);
		check(`${at}: no Hit frame: the corner of its box doesn't`, (await cursor(293, 73)) !== "pointer", await cursor(293, 73));
	}
	await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nHit areas: all good");
process.exitCode = failures ? 1 : 0;
