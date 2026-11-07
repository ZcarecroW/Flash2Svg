#!/usr/bin/env node
/**
 * The guide's video demos (docs/guide/demos/video/<name>.mp4 and .webm), exported the way the panel
 * does it: MP4 and WebM come from a browser's video encoders, so build.mjs (Node) can't make them.
 * The files are committed; build.mjs copies them.
 *
 *   node docs/guide/tools/videos.mjs [name,name]     (Edge)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const guide = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(guide, "..", "..");
const models = join(guide, "demos", "models");
const out = join(guide, "demos", "video");
mkdirSync(out, { recursive: true });
const names = (process.argv[2] ?? "gears").split(",");

const page = await build({
	stdin: {
		contents: `import { exportVideo } from "./src/core/video.ts";
const rasterize = async (svg, width, height) => {
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		const img = new Image(width, height);
		img.src = url;
		await img.decode();
		const c = document.createElement("canvas");
		c.width = width;
		c.height = height;
		const g = c.getContext("2d", { willReadFrequently: true });
		g.drawImage(img, 0, 0, width, height);
		const d = g.getImageData(0, 0, width, height);
		return { data: d.data, width, height };
	} finally {
		URL.revokeObjectURL(url);
	}
};
window.run = async (name, format, list) => {
	const model = await (await fetch("/" + name + "/scene.json")).json();
	const need = {};
	for (const p of list) need[p] = new Uint8Array(await (await fetch("/" + name + "/" + p)).arrayBuffer());
	const files = { readBinary: (p) => need[p], readText: (p) => new TextDecoder().decode(need[p]) };
	const r = await exportVideo(model, files, { format, includeBackground: true }, rasterize);
	return { bytes: Array.from(r.files[0].bytes), warnings: r.warnings };
};`,
		resolveDir: repo,
		loader: "js",
	},
	bundle: true,
	format: "iife",
	write: false,
	target: "chrome99",
	platform: "browser",
	logLevel: "silent",
});
const js = page.outputFiles[0].text;
const server = createServer((req, res) => {
	const url = decodeURIComponent(req.url.split("?")[0]);
	if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>x</title><script src="/export.js"></script>`);
	if (url === "/export.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(js);
	const file = normalize(join(models, url));
	if (!file.startsWith(models) || !existsSync(file)) return res.writeHead(404).end();
	res.writeHead(200, { "content-type": extname(file) === ".json" ? "application/json" : "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const tab = await browser.newPage();
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
for (const name of names) {
	const dir = join(models, name);
	const list = readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"));
	for (const format of ["mp4", "webm"]) {
		const r = await tab.evaluate(([n, f, l]) => window.run(n, f, l), [name, format, list]);
		const bytes = Uint8Array.from(r.bytes);
		writeFileSync(join(out, `${name}.${format}`), bytes);
		console.log(`${name}.${format}: ${(bytes.length / 1024).toFixed(1)} KB${r.warnings.length ? `; ${r.warnings.join(" | ")}` : ""}`);
	}
}
await browser.close();
server.close();
