// Builds everything into dist/:
//   dist/extension/  - the CEP extension (panel, jsfl, manifest, icons)  -> install / package as ZXP
//   dist/cli/        - the flash2svg command line compiler (Node)
// Usage: node scripts/build.mjs [--watch]
import * as esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntime } from "./build-runtime.mjs";
import { writeIcons } from "./lib/icons.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repo, "dist");
const ext = join(dist, "extension");
const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const watch = process.argv.includes("--watch");
// CEP bundle versions must be numeric (x.y.z)
const version = pkg.version.replace(/-.*$/, "");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(ext, "panel"), { recursive: true });
mkdirSync(join(ext, "jsfl"), { recursive: true });
mkdirSync(join(ext, "CSXS"), { recursive: true });
mkdirSync(join(dist, "cli"), { recursive: true });

const runtimeSize = await buildRuntime();

const panelBuild = {
	entryPoints: [join(repo, "src/panel/main.ts")],
	bundle: true,
	outfile: join(ext, "panel/app.js"),
	format: "iife",
	// CEP 11 (Animate 2022/2023) ships Chromium 88; CEP 12 (Animate 2024) Chromium 99
	target: "chrome88",
	minify: !watch,
	sourcemap: watch ? "inline" : false,
	mainFields: ["svelte", "browser", "module", "main"],
	conditions: ["svelte", "browser"],
	plugins: [sveltePlugin({ compilerOptions: { css: "external" } })],
	define: { __VERSION__: JSON.stringify(pkg.version), __SELFTEST__: String(process.argv.includes("--selftest")) },
	logLevel: "info",
	legalComments: "none",
};

// image codecs for the panel, loaded only when an export has bitmaps. Without `process` the
// emscripten builds take the browser path (with `process`, as in CEP, they'd load Node modules).
const codecsBuild = {
	...panelBuild,
	entryPoints: [join(repo, "src/panel/codecs-entry.ts")],
	outfile: join(ext, "panel/codecs.js"),
	plugins: [],
	// the codecs build a URL from import.meta.url at start-up (unused: the WebAssembly is passed in)
	define: { process: "undefined", "import.meta.url": JSON.stringify("file:///flash2svg/codecs.js") },
};

// mpg123-decoder's unused worker variant (see src/core/vendor/no-worker.ts)
const NO_WORKER = { "@eshaz/web-worker": join(repo, "src/core/vendor/no-worker.ts") };

// audio codecs for the panel, loaded only for player exports with sounds. libopus asks
// globalThis.process whether it runs in Node (in CEP it would then import Node modules).
const audioBuild = {
	...codecsBuild,
	entryPoints: [join(repo, "src/panel/audio-entry.ts")],
	outfile: join(ext, "panel/audio.js"),
	define: { ...codecsBuild.define, "globalThis.process": "undefined", "import.meta.url": JSON.stringify("file:///flash2svg/audio.js") },
	external: ["node:*"],
	alias: NO_WORKER,
};

// the Lottie players of the panel's preview (src/panel/lib/lottie-players.ts), each loaded only
// when a Lottie export is previewed: lottie-web for JSON, dotlottie-web (WebAssembly in wasm/)
const lottieWebBuild = {
	...panelBuild,
	entryPoints: [join(repo, "src/panel/lottie-web-entry.ts")],
	outfile: join(ext, "panel/lottie-web.js"),
	plugins: [],
};
const dotLottieBuild = {
	...lottieWebBuild,
	entryPoints: [join(repo, "src/panel/dotlottie-entry.ts")],
	outfile: join(ext, "panel/dotlottie.js"),
	// the default WebAssembly URL is built from import.meta.url (the panel sets its own)
	define: { ...panelBuild.define, "import.meta.url": JSON.stringify("file:///flash2svg/dotlottie.js") },
};

const cliBuild = {
	entryPoints: [join(repo, "src/cli/flash2svg.ts")],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	outfile: join(dist, "cli/flash2svg.js"),
	alias: NO_WORKER,
	// the shebang comes from src/cli/flash2svg.ts (esbuild keeps it); a banner would duplicate it
	logLevel: "info",
};

function copyStatic() {
	copyFileSync(join(repo, "src/panel/index.html"), join(ext, "panel/index.html"));
	copyFileSync(join(repo, "src/jsfl/flash2svg.jsfl"), join(ext, "jsfl/flash2svg.jsfl"));
	let manifest = readFileSync(join(repo, "extension/CSXS/manifest.xml"), "utf8").replaceAll("{version}", version);
	if (process.argv.includes("--selftest")) {
		// Test builds start with Animate so the self-test (src/panel/lib/selftest.ts) can run unattended
		manifest = manifest.replace(
			"<AutoVisible>true</AutoVisible>",
			"<AutoVisible>true</AutoVisible>\n\t\t\t\t\t<StartOn>\n\t\t\t\t\t\t<Event>com.adobe.csxs.events.ApplicationActivate</Event>\n\t\t\t\t\t\t<Event>com.adobe.events.flash.documentOpened</Event>\n\t\t\t\t\t\t<Event>com.adobe.events.flash.documentNew</Event>\n\t\t\t\t\t</StartOn>",
		);
	}
	writeFileSync(join(ext, "CSXS/manifest.xml"), manifest);
	cpSync(join(repo, "LICENSE"), join(ext, "LICENSE"));
	writeIcons(join(ext, "icons"));
	// image and audio codecs (src/core/images.ts, audio-codecs.ts): WebAssembly next to the panel and the CLI
	for (const dir of [join(ext, "wasm"), join(dist, "cli", "wasm")]) {
		mkdirSync(dir, { recursive: true });
		for (const src of WASM) copyFileSync(join(repo, "node_modules", src), join(dir, src.slice(src.lastIndexOf("/") + 1)));
		copyFileSync(join(repo, "node_modules/wasm-media-encoders/wasm/mp3.wasm"), join(dir, "mp3.wasm"));
	}
	// the panel's dotLottie preview
	copyFileSync(join(repo, "node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm"), join(ext, "wasm", "dotlottie-player.wasm"));
}

// keep in sync with WASM_SOURCES in src/core/images.ts
const WASM = [
	"@jsquash/png/codec/pkg/squoosh_png_bg.wasm",
	"@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm",
	"@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm",
	"@jsquash/webp/codec/enc/webp_enc.wasm",
	"@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm",
	"@jsquash/avif/codec/enc/avif_enc.wasm",
];

copyStatic();
if (watch) {
	const ctx = await esbuild.context(panelBuild);
	await ctx.watch();
	console.log("watching panel sources…");
} else {
	await esbuild.build(panelBuild);
	await esbuild.build(codecsBuild);
	await esbuild.build(audioBuild);
	await esbuild.build(lottieWebBuild);
	await esbuild.build(dotLottieBuild);
	await esbuild.build(cliBuild);
	const kb = (n) => (n / 1024).toFixed(1) + " KB";
	console.log(`player runtime ${kb(runtimeSize[0])} (with sound ${kb(runtimeSize[1])}, morphs ${kb(runtimeSize[2])}); extension ${version} in ${ext}`);
}
