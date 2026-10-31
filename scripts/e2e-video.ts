// E2E: video components (f51 AS3 FLVPlayback, f52 HTML5 Canvas Video) as <video> in the SVG.
// Served over HTTP, inline and in an <object>, for SMIL, CSS and the player: the video must load,
// play by itself (muted autoplay) and sit where the component was.
// Usage: node scripts/e2e-video.ts [--browser=msedge|firefox|webkit]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";
import { compileScene } from "../src/core/compile.ts";
import type { SceneModel } from "../src/core/model.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "tests", "out");
const dir = join(out, "video");
mkdirSync(join(dir, "videos"), { recursive: true });
const engine = process.argv.find((a) => a.startsWith("--browser="))?.slice(10) ?? "msedge";
const types: Record<string, string> = { svg: "image/svg+xml", webm: "video/webm", mp4: "video/mp4", html: "text/html; charset=utf-8" };
const server = createServer((req, res) => {
	const file = join(dir, decodeURIComponent((req.url ?? "/").split("?")[0]!.slice(1)));
	if (!file.startsWith(dir) || !existsSync(file)) return void res.writeHead(404).end();
	res.writeHead(200, { "content-type": types[file.split(".").pop()!] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const browser =
	engine === "firefox"
		? await firefox.launch({ channel: "moz-firefox", headless: true, firefoxUserPrefs: { "security.sandbox.content.level": 0, "media.autoplay.default": 0 }, env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: "1" } })
		: engine === "webkit"
			? await webkit.launch({ headless: true })
			: await chromium.launch({ channel: engine, headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 500 } });
let failures = 0;
// can this engine play the WebM test video at all? (WebKit's Windows build says maybe, then never loads it)
writeFileSync(join(dir, "probe.html"), '<!doctype html><video src="videos/clip.webm" autoplay muted playsinline></video>');
copyFileSync(join(repo, "tests", "fixtures", "assets", "clip.webm"), join(dir, "videos", "clip.webm"));
await page.goto(base + "probe.html", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const webm = await page.evaluate(() => (document.querySelector("video") as HTMLVideoElement).readyState >= 2);
if (!webm) console.log(`(${engine} can't play the WebM test video: only the markup and placement are checked)`);

for (const name of ["f51-video", "f52-video-canvas"]) {
	const modelDir = join(out, name, "model");
	if (!existsSync(join(modelDir, "scene.json"))) continue;
	const model: SceneModel = JSON.parse(readFileSync(join(modelDir, "scene.json"), "utf8"));
	const files = { readText: (rel: string) => readFileSync(join(modelDir, rel), "utf8"), readBinary: (rel: string) => readFileSync(join(modelDir, rel)) };
	for (const format of ["smil", "css", "player"] as const) {
		const r = compileScene(model, files, { format, includeBackground: true });
		for (const a of r.assets) copyFileSync(join(modelDir, a.source), join(dir, a.path));
		const file = `${name}-${format}.svg`;
		writeFileSync(join(dir, file), r.files[0]!.svg);
		for (const how of ["inline", "object"]) {
			const body = how === "inline" ? r.files[0]!.svg.replace(/^<\?xml[^>]*>\s*/, "") : `<object data="${file}" type="image/svg+xml" width="400" height="300"></object>`;
			writeFileSync(join(dir, "page.html"), `<!doctype html><body style="margin:0">${body}</body>`);
			await page.goto(base + "page.html", { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(1500);
			const res = await page.evaluate((how) => {
				const doc = how === "inline" ? document : (document.querySelector("object")!.contentDocument as Document);
				const v = doc?.querySelector("video") as HTMLVideoElement | null;
				if (!v) return null;
				const r = v.getBoundingClientRect();
				return { ready: v.readyState, time: v.currentTime, paused: v.paused, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
			}, how);
			const plays = !webm || (!!res && res.ready >= 2 && res.time > 0.3 && !res.paused);
			const ok = !!res && plays && Math.abs(res.x - 40) <= 1 && Math.abs(res.y - 40) <= 1 && Math.abs(res.w - 240) <= 2;
			if (!ok) failures++;
			console.log(`${name.padEnd(17)} ${format.padEnd(6)} ${how.padEnd(6)} ${ok ? "ok" : "FAIL"} ${JSON.stringify(res)}`);
		}
	}
}
await browser.close();
server.close();
console.log(failures ? `\nVideo: ${failures} FAILED` : "\nVideo: all good");
process.exit(failures ? 1 : 0);
