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

const cliBuild = {
	entryPoints: [join(repo, "src/cli/flash2svg.ts")],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	outfile: join(dist, "cli/flash2svg.js"),
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
}

copyStatic();
if (watch) {
	const ctx = await esbuild.context(panelBuild);
	await ctx.watch();
	console.log("watching panel sources…");
} else {
	await esbuild.build(panelBuild);
	await esbuild.build(cliBuild);
	console.log(`player runtime ${(runtimeSize / 1024).toFixed(1)} KB; extension ${version} in ${ext}`);
}
