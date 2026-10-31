#!/usr/bin/env node
/**
 * Builds the user guide: docs/guide/pages/*.md → docs/guide/dist/ (a static site, any base path).
 *
 *   node docs/guide/build.mjs
 *
 * The demos are compiled here from their scene data (docs/guide/demos/models/<name>/, made in
 * Animate by docs/guide/tools/demos.mjs) with the compiler of this checkout — every format a page
 * shows, with its real size — so the guide always shows what this version writes. Code is
 * highlighted at build time (Shiki), so pages ship no highlighter; the only scripts are the small
 * site.js and, when a Lottie tab is opened, lottie-web.
 *
 * Markdown additions:
 *   ::: demo <name> <format,format,...> [inline] [caption text]   a live demo, one tab per format
 *   > [!NOTE] / [!TIP] / [!WARNING]                               callouts (GitHub's syntax)
 * Links between pages are written as page.md and become page.html; broken links and anchors
 * fail the build.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Marked } from "marked";
import { createHighlighter } from "shiki";
import { compileScene } from "../../src/core/compile.ts";
import { encodeImages } from "../../src/core/images.ts";
import { encodeSounds } from "../../src/core/audio.ts";
import { createAudioCodecs } from "../../src/core/audio-codecs.ts";
import { createCodecs } from "../../src/core/codecs.ts";
import { createFontCodecs, encodeFonts } from "../../src/core/fonts.ts";
import { exportRaster } from "../../src/core/raster.ts";
import { nodeFontFiles } from "../../src/cli/fonts-node.ts";
import { nodeRasterizer } from "../../src/cli/raster-node.ts";
import { nodeWasmLoader } from "../../src/cli/wasm.ts";

const GUIDE = dirname(fileURLToPath(import.meta.url));
const REPO = join(GUIDE, "..", "..");
const OUT = join(GUIDE, "dist");
const SITE = "https://zcarecrow.github.io/Flash2Svg/";
const GITHUB = "https://github.com/ZcarecroW/Flash2Svg";
const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
const t0 = performance.now();

const NAV = [
	{ title: "Get started", pages: ["index", "installation", "quick-start", "panel"] },
	{ title: "Formats", pages: ["formats", "lottie"] },
	{ title: "What is exported", pages: ["animation", "appearance", "text", "images-sounds"] },
	{ title: "Interactive", pages: ["interactivity", "player-api"] },
	{ title: "On the web", pages: ["embedding", "accessibility", "performance"] },
	{ title: "Reference", pages: ["command-line", "settings", "limits", "changelog"] },
];
const order = NAV.flatMap((s) => s.pages);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "demos"), { recursive: true });
const problems = [];

// ------------------------------------------------------------------ icons (Nucleo, see theme/icons.txt)
const ICONS = {};
for (const f of readdirSync(join(GUIDE, "theme", "icons")))
	ICONS[f.replace(/\.svg$/, "")] = readFileSync(join(GUIDE, "theme", "icons", f), "utf8").replace(/<svg /, '<svg class="i" aria-hidden="true" ');
const icon = (n) => ICONS[n] ?? "";

// ------------------------------------------------------------------ demos, compiled now
const loader = nodeWasmLoader();
const codecs = createCodecs(loader);
let audio, fonts;
const demoCache = new Map();
const EXT = { smil: ".svg", css: ".svg", player: ".svg", auto: ".svg", static: ".svg", lottie: ".json", dotlottie: ".lottie", gif: ".gif", webp: ".webp" };
const LABEL = {
	smil: "SMIL",
	css: "CSS",
	player: "JS player",
	auto: "Automatic",
	lottie: "Lottie",
	dotlottie: ".lottie",
	gif: "GIF",
	webp: "WebP",
	static: "Still",
};

async function demo(name, format) {
	const key = `${name}.${format}`;
	if (demoCache.has(key)) return demoCache.get(key);
	const dir = join(GUIDE, "demos", "models", name);
	if (!existsSync(join(dir, "scene.json"))) throw new Error(`no demo ${name} (run node docs/guide/tools/demos.mjs)`);
	let model = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
	let files = { readText: (r) => readFileSync(join(dir, r), "utf8"), readBinary: (r) => readFileSync(join(dir, r)) };
	const s = { format, includeBackground: true };
	({ model, files } = await encodeImages(model, files, s, codecs));
	if ((format === "player" || format === "auto") && Object.keys(model.sounds).length) {
		audio ??= createAudioCodecs(loader);
		({ model, files } = await encodeSounds(model, files, s, audio));
	}
	if (!/lottie|gif|webp/.test(format)) {
		fonts ??= createFontCodecs(loader, (await import("woff2-encoder")).compress);
		({ model } = await encodeFonts(model, nodeFontFiles(), fonts));
	}
	const out =
		format === "gif" || format === "webp"
			? await exportRaster(model, files, s, nodeRasterizer(loader), codecs)
			: compileScene(model, files, s, 0, { gzip: (d) => gzipSync(d, { level: 9 }) });
	const f = out.files[0];
	const bytes = f.bytes ?? Buffer.from(f.svg, "utf8");
	const file = `demos/${name}.${format}${EXT[format]}`;
	writeFileSync(join(OUT, file), bytes);
	const r = {
		file,
		bytes: bytes.length,
		gzip: /gif|webp|lottie$/.test(format) && format !== "lottie" ? bytes.length : gzipSync(bytes, { level: 9 }).length,
		width: Math.round(model.doc.width),
		height: Math.round(model.doc.height),
		format: out.stats.format ?? format,
		warnings: out.warnings,
		svg: f.svg,
	};
	demoCache.set(key, r);
	return r;
}
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

async function demoBlock(args) {
	const [name, list = "smil", ...rest] = args;
	const inline = rest[0] === "inline";
	const caption = (inline ? rest.slice(1) : rest).join(" ");
	const formats = list.split(",");
	const made = [];
	for (const f of formats) made.push([f, await demo(name, f)]);
	const [first, d] = made[0];
	const tabs = made
		.map(
			([f, x], i) =>
				`<button type="button" role="tab" aria-selected="${i === 0}" data-format="${f}" data-src="${x.file}" title="${kb(x.bytes)}${x.gzip !== x.bytes ? `, ${kb(x.gzip)} gzipped` : ""}">${LABEL[f]} <small>${kb(x.gzip)}</small></button>`,
		)
		.join("");
	const alt = caption || `${name} demo`;
	// inline: the SVG markup itself in the page (scroll-driven CSS needs it)
	const stage = inline ? `<div class="demo__svg">${d.svg.replace(/^<\?xml[^>]*>\s*/, "")}</div>` : stageFor(first, d, alt);
	return `<figure class="demo" data-demo="${name}">
<div class="demo__stage" style="aspect-ratio:${d.width}/${d.height}">${stage}</div>
${inline ? "" : `<div class="demo__bar" role="tablist" aria-label="Format">${tabs}<a class="demo__get" href="${d.file}" download title="Download this file">${icon("download")}<span class="sr">Download</span></a></div>`}
${caption ? `<figcaption>${inlineMd(caption)}</figcaption>` : ""}
</figure>`;
}
function stageFor(format, d, alt) {
	const a = alt.replace(/"/g, "&quot;");
	if (format === "player") return `<object type="image/svg+xml" data="${d.file}" aria-label="${a}" width="${d.width}" height="${d.height}"></object>`;
	if (format === "lottie") return `<div class="demo__lottie" data-src="${d.file}" role="img" aria-label="${a}"></div>`;
	return `<img src="${d.file}" alt="${a}" width="${d.width}" height="${d.height}" loading="lazy" decoding="async">`;
}

// ------------------------------------------------------------------ Markdown
const highlighter = await createHighlighter({
	themes: ["github-light-default", "github-dark-default"],
	langs: ["html", "js", "ts", "bash", "powershell", "json", "xml", "css", "nginx", "apache", "actionscript-3"],
});
const ALIAS = { sh: "bash", shell: "bash", javascript: "js", typescript: "ts", ps1: "powershell", svg: "xml", as3: "actionscript-3" };
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) =>
	s
		.toLowerCase()
		.replace(/<[^>]+>/g, "")
		// entities, also numeric ones (marked writes ' as &#39;: "animate39s" otherwise)
		.replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/g, "")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-");

let headings = [];
let usedSlugs = new Set();
const marked = new Marked({
	gfm: true,
	renderer: {
		heading({ tokens, depth }) {
			const html = this.parser.parseInline(tokens);
			let id = slug(html);
			for (let k = 2; usedSlugs.has(id); k++) id = `${slug(html)}-${k}`;
			usedSlugs.add(id);
			if (depth === 2 || depth === 3) headings.push({ depth, id, text: html.replace(/<[^>]+>/g, "") });
			if (depth === 1) return `<h1>${html}</h1>\n`;
			return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
		},
		code({ text, lang }) {
			const l = ALIAS[lang] ?? lang ?? "text";
			const body = highlighter.getLoadedLanguages().includes(l)
				? highlighter.codeToHtml(text, { lang: l, themes: { light: "github-light-default", dark: "github-dark-default" }, defaultColor: false })
				: `<pre class="shiki"><code>${escapeHtml(text)}</code></pre>`;
			return `<div class="code"><button type="button" class="code__copy" aria-label="Copy">${icon("copy")}</button>${body}</div>\n`;
		},
		image({ href, title, text }) {
			const file = join(GUIDE, href);
			let size = "";
			if (/^images\//.test(href)) {
				if (!existsSync(file)) problems.push(`missing image ${href}`);
				else {
					const [w, h] = imageSize(file);
					// screenshots are taken at 2×
					size = ` width="${Math.round(w / 2)}" height="${Math.round(h / 2)}"`;
					copyAsset(href);
				}
			}
			const img = `<img src="${href}" alt="${escapeHtml(text)}"${size} loading="lazy" decoding="async">`;
			return title ? `<figure class="shot">${img}<figcaption>${inlineMd(title)}</figcaption></figure>` : img;
		},
		blockquote({ tokens }) {
			const inner = this.parser.parse(tokens);
			const m = /^<p>\[!(NOTE|TIP|WARNING)\]\s*/.exec(inner);
			if (!m) return `<blockquote>${inner}</blockquote>\n`;
			const kind = m[1].toLowerCase();
			const ic = { note: "circle-info", tip: "lightbulb", warning: "triangle-warning" }[kind];
			const title = { note: "Note", tip: "Tip", warning: "Careful" }[kind];
			return `<aside class="callout callout--${kind}"><p class="callout__title">${icon(ic)}${title}</p><p>${inner.slice(m[0].length)}</aside>\n`;
		},
		link({ href, title, tokens }) {
			const text = this.parser.parseInline(tokens);
			let h = href;
			const ext = /^https?:/.test(href);
			if (!ext && /\.md(#|$)/.test(href)) {
				const [page, anchor] = href.split("#");
				const p = page.replace(/\.md$/, "");
				if (!order.includes(p)) problems.push(`link to a missing page ${href}`);
				links.push({ page: p, anchor });
				h = `${p === "index" ? "index" : p}.html${anchor ? `#${anchor}` : ""}`;
			} else if (!ext && href.startsWith("#")) links.push({ page: current, anchor: href.slice(1) });
			return `<a href="${escapeHtml(h)}"${title ? ` title="${escapeHtml(title)}"` : ""}${ext ? ' rel="noopener"' : ""}>${text}${ext ? icon("arrow-up-right") : ""}</a>`;
		},
	},
});
const inlineMd = (s) => marked.parseInline(s);

function imageSize(file) {
	const b = readFileSync(file);
	if (b.toString("ascii", 1, 4) === "PNG") return [b.readUInt32BE(16), b.readUInt32BE(20)];
	if (b.toString("ascii", 8, 12) === "WEBP") {
		const f = b.toString("ascii", 12, 16);
		if (f === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
		if (f === "VP8L") {
			const v = b.readUInt32LE(21);
			return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
		}
		if (f === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
	}
	throw new Error(`size of ${file}?`);
}
function copyAsset(rel) {
	mkdirSync(dirname(join(OUT, rel)), { recursive: true });
	copyFileSync(join(GUIDE, rel), join(OUT, rel));
}

// ------------------------------------------------------------------ pages
let current = "";
const links = [];
const pages = [];
for (const name of order) {
	const src = readFileSync(join(GUIDE, "pages", `${name}.md`), "utf8").replace(/\r\n/g, "\n");
	const fm = /^---\n([\s\S]*?)\n---\n/.exec(src);
	const meta = Object.fromEntries((fm?.[1] ?? "").split("\n").map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
	let body = fm ? src.slice(fm[0].length) : src;
	// measured sizes: {{size <demo> <format>}} (gzipped)
	for (const m of [...body.matchAll(/\{\{size (\S+) (\S+)\}\}/g)]) body = body.replace(m[0], kb((await demo(m[1], m[2])).gzip));
	// demo blocks first (async)
	const blocks = [];
	body = body.replace(/^::: demo (.+)$/gm, (_, a) => {
		blocks.push(a.trim().split(/\s+/));
		return `<!--demo${blocks.length - 1}-->`;
	});
	current = name;
	headings = [];
	usedSlugs = new Set();
	let html = marked.parse(body);
	for (let i = 0; i < blocks.length; i++) html = html.replace(new RegExp(`(<p>)?<!--demo${i}-->(</p>)?`), await demoBlock(blocks[i]));
	pages.push({ name, title: meta.title ?? name, description: meta.description ?? "", html, headings: [...headings], ids: new Set(usedSlugs) });
}
for (const l of links) {
	const p = pages.find((x) => x.name === l.page);
	if (l.anchor && p && !p.ids.has(l.anchor)) problems.push(`link to a missing anchor ${l.page}#${l.anchor}`);
}
if (problems.length) {
	console.error(problems.join("\n"));
	// GUIDE_DRAFT=1: build anyway (screenshots not taken yet)
	if (!process.env.GUIDE_DRAFT) process.exit(1);
}

// ------------------------------------------------------------------ theme and layout
mkdirSync(join(OUT, "assets"), { recursive: true });
const hashed = (file) => {
	const data = readFileSync(join(GUIDE, "theme", file));
	const h = createHash("sha256").update(data).digest("hex").slice(0, 8);
	const out = file.replace(/\.(\w+)$/, `.${h}.$1`);
	writeFileSync(join(OUT, "assets", out), data);
	return `assets/${out}`;
};
const css = hashed("site.css");
const js = hashed("site.js");
// lottie-web for the Lottie tabs (loaded only when one is opened)
const require = createRequire(import.meta.url);
copyFileSync(require.resolve("lottie-web/build/player/lottie_svg.min.js"), join(OUT, "assets", "lottie_svg.min.js"));
copyFileSync(join(GUIDE, "theme", "favicon.svg"), join(OUT, "favicon.svg"));

const navHtml = (active) =>
	NAV.map(
		(s) =>
			`<p class="nav__title">${s.title}</p><ul>${s.pages
				.map((p) => {
					const pg = pages.find((x) => x.name === p);
					return `<li><a href="${p}.html"${p === active ? ' aria-current="page"' : ""}>${pg.title}</a></li>`;
				})
				.join("")}</ul>`,
	).join("");

const search = [];
for (const [i, p] of pages.entries()) {
	const prev = pages[i - 1],
		next = pages[i + 1];
	const toc =
		p.headings.length > 2
			? `<nav class="toc" aria-label="On this page"><p class="toc__title">On this page</p><ul>${p.headings.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${h.text}</a></li>`).join("")}</ul></nav>`
			: "";
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.name === "index" ? "Flash2SVG — animated SVG and Lottie from Adobe Animate" : `${p.title} — Flash2SVG`}</title>
<meta name="description" content="${escapeHtml(p.description)}">
<link rel="canonical" href="${SITE}${p.name === "index" ? "" : `${p.name}.html`}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta name="color-scheme" content="light dark">
<script>try{var t=localStorage.getItem("f2s-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="${css}">
<script src="${js}" defer></script>
</head>
<body>
<a class="skip" href="#content">Skip to the content</a>
<header class="top">
<button type="button" class="top__menu" aria-label="Menu" aria-expanded="false" aria-controls="nav">${icon("menu")}</button>
<a class="brand" href="index.html"><img src="favicon.svg" alt="" width="26" height="26">Flash2SVG <span class="brand__v">${version.replace(/\.0$/, "")}</span></a>
<div class="search"><label class="sr" for="q">Search the guide</label>${icon("magnifier")}<input id="q" type="search" placeholder="Search" autocomplete="off"><ul class="search__hits" role="listbox" hidden></ul></div>
<button type="button" class="top__theme" aria-label="Switch between light and dark">${icon("sun")}${icon("moon")}</button>
<a class="top__gh" href="${GITHUB}" aria-label="Flash2SVG on GitHub" rel="noopener">${icon("logo-github")}</a>
</header>
<div class="layout">
<nav id="nav" class="nav" aria-label="Guide">${navHtml(p.name)}</nav>
<main id="content" class="content">
<article>${p.html}</article>
<nav class="pager" aria-label="Pages">${prev ? `<a class="pager__prev" href="${prev.name}.html">${icon("chevron-left")}<span><small>Back</small>${prev.title}</span></a>` : "<span></span>"}${next ? `<a class="pager__next" href="${next.name}.html"><span><small>Next</small>${next.title}</span>${icon("chevron-right")}</a>` : ""}</nav>
<footer class="foot">Flash2SVG ${version} · MIT licence · <a href="${GITHUB}">GitHub</a> · <a href="${GITHUB}/issues">Report a problem</a> · Icons by <a href="https://nucleoapp.com/">Nucleo</a></footer>
</main>
${toc}
</div>
</body>
</html>
`;
	writeFileSync(join(OUT, `${p.name}.html`), html);
	// the search index: the page, its headings and its text
	const text = p.html
		.replace(/<figure class="demo"[\s\S]*?<\/figure>/g, " ")
		.replace(/<svg[\s\S]*?<\/svg>/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&[a-z#0-9]+;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	search.push({ p: p.name, t: p.title, h: p.headings.map((h) => [h.id, h.text]), x: text });
}
writeFileSync(join(OUT, "search.json"), JSON.stringify(search));
writeFileSync(join(OUT, ".nojekyll"), "");
writeFileSync(
	join(OUT, "404.html"),
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found — Flash2SVG</title><link rel="stylesheet" href="${css}"></head><body><main class="content" style="margin:auto;max-width:36rem;padding:4rem 1rem"><h1>Not found</h1><p>There is no page at this address. <a href="index.html">The Flash2SVG guide starts here.</a></p></main></body></html>`,
);

// ------------------------------------------------------------------ report
let total = 0;
const walk = (d) => {
	for (const f of readdirSync(d)) {
		const p = join(d, f);
		if (statSync(p).isDirectory()) walk(p);
		else total += statSync(p).size;
	}
};
walk(OUT);
console.log(
	`${pages.length} pages, ${demoCache.size} demo files, ${(total / 1024 / 1024).toFixed(2)} MB in ${((performance.now() - t0) / 1000).toFixed(1)} s → ${OUT}`,
);
const warned = [...demoCache.entries()].filter(([, d]) => d.warnings.length);
for (const [k, d] of warned) console.log(`  ${k}: ${d.warnings.join(" | ")}`);
