#!/usr/bin/env node
/**
 * Checks the built guide (docs/guide/dist) in Edge, served over HTTP as on GitHub Pages:
 * every page at desktop and phone width (no console errors or failed requests, no sideways
 * scrolling, every image loads), every demo's every format tab (the image, player or Lottie
 * animation really shows; links of linked demos are there), the scroll-driven demo (follows the
 * scroll, stands still without it), search and the theme switch.
 *
 *   node docs/guide/tools/check.mjs [https://zcarecrow.github.io/Flash2Svg/]
 *
 * With an address it checks the published site instead (the pages listed are the local build's).
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (!existsSync(join(dist, "index.html"))) {
	console.error("Build the guide first: node docs/guide/build.mjs");
	process.exit(1);
}
const TYPES = {
	".html": "text/html",
	".css": "text/css",
	".js": "text/javascript",
	".json": "application/json",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".gif": "image/gif",
	".lottie": "application/zip",
	".png": "image/png",
	".mp3": "audio/mpeg",
	".woff2": "font/woff2",
};
const server = createServer((req, res) => {
	const path = normalize(join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname)));
	const file = path.startsWith(dist) && existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
	if (!file.startsWith(dist) || !existsSync(file)) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-length": statSync(file).size });
	if (req.method === "HEAD") res.end();
	else createReadStream(file).pipe(res);
}).listen(0);
const live = process.argv[2];
const base = live ? live.replace(/\/?$/, "/") : `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);
const pages = readdirSync(dist).filter((f) => f.endsWith(".html") && f !== "404.html");
const browser = await chromium.launch({ channel: "msedge" });
let tabs = 0;
const t0 = Date.now();
try {
	for (const [label, viewport] of [
		["desktop", { width: 1280, height: 800 }],
		["phone", { width: 390, height: 844 }],
	]) {
		const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
		for (const name of pages) {
			const page = await ctx.newPage();
			const where = `${name} (${label})`;
			page.on("console", (m) => m.type() === "error" && fail(where, `console: ${m.text()}`));
			page.on("pageerror", (e) => fail(where, `exception: ${e.message}`));
			page.on("requestfailed", (r) => fail(where, `request failed: ${r.url()} ${r.failure()?.errorText}`));
			page.on("response", (r) => r.status() >= 400 && fail(where, `HTTP ${r.status()}: ${r.url()}`));
			await page.goto(base + name, { waitUntil: "load" });
			// lazy images: load them all, then check each
			const broken = await page.evaluate(async () => {
				const imgs = [...document.images];
				for (const i of imgs) i.loading = "eager";
				await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r))))));
				return imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"));
			});
			for (const b of broken) fail(where, `image doesn't load: ${b}`);
			const wide = await page.evaluate(() => {
				const w = document.documentElement.clientWidth;
				if (document.documentElement.scrollWidth <= w) return null;
				// the widest element that sticks out (not inside something that scrolls itself)
				const out = [...document.querySelectorAll("body *")].filter(
					(e) => e.getBoundingClientRect().right > w + 1 && !e.closest("pre, .table, table, [style*=overflow]"),
				);
				return `${document.documentElement.scrollWidth}px > ${w}px: ${out
					.slice(0, 3)
					.map((e) => e.tagName.toLowerCase() + (e.className ? "." + e.className : ""))
					.join(", ")}`;
			});
			if (wide) fail(where, `scrolls sideways, ${wide}`);
			// every demo: every format tab (once, at desktop width)
			if (label === "desktop") {
				const demos = await page.locator(".demo").count();
				for (let d = 0; d < demos; d++) {
					const fig = page.locator(".demo").nth(d);
					const n = await fig.locator("[role=tab]").count();
					for (let k = 0; k < n; k++) {
						const tab = fig.locator("[role=tab]").nth(k);
						const format = await tab.getAttribute("data-format");
						const embed = await tab.getAttribute("data-embed");
						await tab.scrollIntoViewIfNeeded();
						await tab.click();
						tabs++;
						const what = `${where} demo ${(await fig.getAttribute("data-demo")) ?? d} ${format}`;
						const ok = await fig
							.evaluate(
								async (f, [format, embed]) => {
									const until = async (fn, ms = 15000) => {
										for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 50))) if (await fn()) return true;
										return false;
									};
									const stage = f.querySelector(".demo__stage");
									if (format === "dotlottie") {
										const a = stage.querySelector("a[download]");
										// a zip archive
										const b = a && new Uint8Array(await (await fetch(a.href)).arrayBuffer());
										return !!b && b[0] === 0x50 && b[1] === 0x4b;
									}
									if (format === "lottie")
										return until(() => stage.querySelector(".demo__lottie svg g") && stage.querySelector(".demo__lottie")._anim?.isLoaded);
									if (format === "player") return until(() => stage.querySelector("object")?.contentDocument?.documentElement?.flash2svg);
									// links and scripts: an <object> with the SVG document in it
									if (embed === "object") return until(() => stage.querySelector("object")?.contentDocument?.documentElement?.localName === "svg");
									return until(() => {
										const i = stage.querySelector("img");
										return i && i.complete && i.naturalWidth > 0;
									});
								},
								[format, embed],
							)
							.catch((e) => e.message);
						if (ok !== true) fail(what, `doesn't show (${ok})`);
						if (!(await fig.locator(".demo__get").getAttribute("href"))?.length) fail(what, "no download link");
					}
				}
				// the banner's button links (Go to Web Page) in SMIL and CSS
				if (name === "animation.html")
					for (const format of ["smil", "css"]) {
						const fig = page.locator('.demo[data-demo="banner"]');
						await fig.locator(`[data-format="${format}"]`).click();
						const href = await fig
							.evaluate(async (f) => {
								for (const t = Date.now(); Date.now() - t < 10000; await new Promise((r) => setTimeout(r, 50))) {
									const a = f.querySelector("object")?.contentDocument?.querySelector("a");
									if (a) return a.getAttribute("xlink:href") ?? a.getAttribute("href");
								}
								return null;
							})
							.catch(() => null);
						if (!href?.startsWith("https://")) fail(`${where} demo banner ${format}`, "the button isn't a link");
					}
				// the scroll demo follows the page's scroll, and only that
				if (name === "interactivity.html") {
					const wheel = async () =>
						page.evaluate(() => {
							const fig = document.querySelector('.demo[data-demo="scroll"] svg');
							const g = [...fig.querySelectorAll("[class]")].find((e) => getComputedStyle(e).rotate !== "none");
							return g ? parseFloat(getComputedStyle(g).rotate) : NaN;
						});
					const at = async (k) => {
						await page.evaluate((k) => {
							const r = document.querySelector('.demo[data-demo="scroll"]').getBoundingClientRect();
							// k = 0: the demo's bottom at the window's bottom; k = 1: its top at the window's top
							scrollTo(0, scrollY + r.bottom - innerHeight + k * (innerHeight - r.height));
						}, k);
						await page.waitForTimeout(150);
						return wheel();
					};
					const a = await at(0.2),
						b = await at(0.8);
					await page.waitForTimeout(600);
					const c = await wheel();
					if (!(Math.abs(b - a) > 90)) fail(where, `the scroll demo doesn't follow the scroll (wheel ${a}° → ${b}°)`);
					if (Math.abs(c - b) > 0.5) fail(where, `the scroll demo moves without scrolling (${b}° → ${c}°)`);
				}
				// search finds pages; the theme switch flips the theme
				if (name === "index.html") {
					await page.fill("#q", "lottie");
					if (!(await page.waitForSelector(".search__hits:not([hidden]) a", { timeout: 5000 }).catch(() => null)))
						fail(where, "search shows no hits for 'lottie'");
					const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
					await page.click(".top__theme");
					const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
					if (before === after) fail(where, "the theme switch doesn't change the background");
				}
			}
			await page.close();
		}
		await ctx.close();
	}
} finally {
	await browser.close();
	server.close();
}
console.log(`${pages.length} pages × 2 widths, ${tabs} demo tabs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (problems.length) {
	console.log(problems.map((p) => "  " + p).join("\n"));
	process.exitCode = 1;
} else console.log("guide: all good");
