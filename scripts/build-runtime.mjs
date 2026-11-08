// Bundles the player runtime (src/player/runtime.ts) into a minified IIFE and stores it as a
// string module the player emitter imports (src/core/emit/runtime-code.generated.ts).
import * as esbuild from "esbuild";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The runtime's own member names, shortened in the bundle (esbuild mangleProps). Only names that
 * are never a DOM/Web API property, part of the public API (svg.flash2svg) or a field of the JSON
 * program (src/player/format.ts) may be listed: every property access with the name is renamed.
 */
const INTERNAL = [
	"updateAdvance",
	"animTransform",
	"animAlpha",
	"hiddenTab",
	"offView",
	"resting",
	"rest",
	"playSounds",
	"stopStreams",
	"streamSync",
	"streams",
	"enteredFrame",
	"layerNodes",
	"maskIds",
	"buttonState",
	"seqIndex",
	"lastM",
	"filterRef",
	"fcopies",
	"fanim",
	"hit",
	"inScript",
	"pending",
	"ovAlpha",
	"removed",
	"moved",
	"scripts",
	"objOfInst",
	"objOfClip",
	"dynTick",
	"dynRender",
	"settle",
	"alphaNow",
	"advance",
	"colorWrap",
	"vanim",
	"anims",
	"runActions",
	"labelAt",
	"setFrame",
	"gotoFrame",
	"frameLoop",
	"inTick",
	"listeners",
	"mixer",
	"voices",
	"quiet",
	"clock",
	"tnode",
	"fnode",
	"owner",
	"items",
	"passes",
	"fresh",
	"ended",
	"flows",
	"adv",
	"age",
	"named",
	"dispose",
	"playing",
	"running",
	"startAll",
	"stopAll",
	"bufs",
	"born",
	"held",
	"emit",
	"node",
	"render",
	"sync",
	"tick",
	"step",
	"kind",
	"els",
	"player",
	"time",
	"last",
	"raf",
	"rate",
	"defs",
	"svg",
	"voice",
	"trigger",
	"hold",
	"pos",
	"mpart",
	"mels",
	"mcopies",
	"mrat",
	"mfra",
	"heard",
	"handlers",
	"pressed",
	"up",
	"inst",
	"wake",
	"scrub",
	"snap",
	// (the scripts layer's own: classes, instances coming and going)
	"linkedKey",
	"generated",
	"links",
	"ownCode",
	"classFor",
	"making",
	"unbuilt",
	"inPlace",
	"attach",
	"onStage",
	"addedHeard",
	"leavers",
	"leaving",
	"toStage",
	"userClass",
	"adopt",
	"gone",
	"clips",
	"objs",
	"classNames",
	"rootObj",
	"made",
	"user",
	"qualified",
	"parentMouse",
	"targetOf",
	"objectAt",
];

/**
 * Twelve builds: with or without the sound code (programs with sounds), the morph code (programs
 * with shape tweens as path morphs) and the interaction code (mouse handlers from code snippets,
 * the start triggers "visible" and "scroll"):
 * PLAYER_RUNTIMES[(sound ? 1 : 0) + (morph ? 2 : 0) + (events ? 4 : 0)]; 8 on: with the script
 * code too (programs whose frame scripts run; it has the interaction code):
 * PLAYER_RUNTIMES[8 + (sound ? 1 : 0) + (morph ? 2 : 0)].
 */
const noScripts = {
	name: "no-scripts",
	setup(b) {
		b.onResolve({ filter: /script\.ts$/ }, () => ({ path: "script", namespace: "no-scripts" }));
		b.onLoad({ filter: /.*/, namespace: "no-scripts" }, () => ({ contents: "export class Scripts {}", loader: "ts" }));
	},
};

/**
 * The runtimes with scripts also rename the fields of the objects scripts see (_node, _parent,
 * _alpha...): a script's own `_name` or `_speed` on a MovieClip or one of its classes would
 * overwrite them. Their names start with $ and a letter, which AS3 code hardly ever does.
 */
const SCRIPTED = new RegExp(`^(${INTERNAL.join("|")}|_[A-Za-z0-9][\\w$]*)$`);
const PARTS = ["media", "filters", "createjs", "query", "input", "controls", "flv", "classes", "xml"];

/** Names already in use as $-names somewhere in the player or in the code scripts compile to. */
function takenNames() {
	const taken = new Set(["$"]);
	const walk = (dir) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (/\.ts$/.test(e.name) && !e.name.endsWith(".generated.ts")) for (const m of readFileSync(p, "utf8").matchAll(/\$[A-Za-z]\w*/g)) taken.add(m[0]);
		}
	};
	walk(join(repo, "src/player"));
	walk(join(repo, "src/core/as3"));
	walk(join(repo, "src/core/emit"));
	return taken;
}

/** esbuild's names in the order it hands them out (the most used first). */
const FIRST = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
const REST = FIRST + "0123456789";
const rank = (n) => [...n].reduce((r, c, i) => r * 64 + (i ? REST : FIRST).indexOf(c), 0) + n.length * 64 ** 6;

/** $-names in the same order: $a, $b ... $Z, $aa ... (letters only, none taken). */
function dollarNames(cache) {
	const taken = takenNames();
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
	let i = 0;
	const next = () => {
		for (;;) {
			let n = "",
				k = i++;
			do {
				n = letters[k % 52] + n;
				k = Math.floor(k / 52) - 1;
			} while (k >= 0);
			if (!taken.has(`$${n}`)) return `$${n}`;
		}
	};
	const out = {};
	for (const [prop] of Object.entries(cache)
		.filter(([, v]) => typeof v === "string")
		.sort((a, b) => rank(a[1]) - rank(b[1])))
		out[prop] = next();
	return out;
}

export async function buildRuntime() {
	const build = async (sound, morph, events, scripts, cache) => {
		const r = await esbuild.build({
			entryPoints: [join(repo, "src/player/runtime.ts")],
			bundle: true,
			minify: true,
			format: "iife",
			target: "es2020",
			write: false,
			legalComments: "none",
			define: { __SOUND__: String(sound), __MORPH__: String(morph), __EVENTS__: String(events), __SCRIPTS__: String(scripts) },
			mangleProps: scripts ? SCRIPTED : new RegExp(`^(${INTERNAL.join("|")})$`),
			...(scripts ? { mangleCache: cache } : {}),
			// (without scripts the module isn't used, but its top level would stay: it builds tables)
			plugins: scripts ? [] : [noScripts],
		});
		if (scripts) Object.assign(cache, r.mangleCache);
		// "]]>" can't appear in CDATA-less script text either; guard anyway
		return r.outputFiles[0].text.trim().replace(/<\/script/gi, "<\\/script");
	};
	const part = async (name, cache) => {
		const r = await esbuild.build({
			entryPoints: [join(repo, `src/player/parts/${name}.ts`)],
			bundle: true,
			minify: true,
			format: "iife",
			globalName: "__f2sPart",
			target: "es2020",
			write: false,
			legalComments: "none",
			mangleProps: SCRIPTED,
			mangleCache: cache,
		});
		Object.assign(cache, r.mangleCache);
		return r.outputFiles[0].text.trim().replace(/<\/script/gi, "<\\/script");
	};
	const plain = await Promise.all([...Array(8).keys()].map((i) => build(!!(i & 1), !!(i & 2), !!(i & 4), false)));
	// (the runtimes with scripts and their parts work on each other's objects: one set of names.
	// A first round finds them all, the second builds with their $-names.)
	const found = {};
	for (let i = 0; i < 4; i++) await build(!!(i & 1), !!(i & 2), true, true, found);
	for (const name of PARTS) await part(name, found);
	const fixed = dollarNames(found);
	const shared = { ...fixed };
	const scripted = [];
	for (let i = 0; i < 4; i++) scripted.push(await build(!!(i & 1), !!(i & 2), true, true, shared));
	const parts = {};
	for (const name of PARTS) parts[name] = await part(name, shared);
	const strays = Object.keys(shared).filter((k) => typeof shared[k] === "string" && shared[k] !== fixed[k]);
	if (strays.length) throw new Error(`Names the first round didn't find: ${strays.join(", ")}`);
	const sound = await esbuild.build({
		entryPoints: [join(repo, "src/player/soundtrack.ts")],
		bundle: true,
		minify: true,
		format: "iife",
		globalName: "__f2sSound",
		target: "es2020",
		write: false,
		legalComments: "none",
		define: { __SCRIPTS__: "false" },
		mangleProps: new RegExp(`^(${INTERNAL.join("|")})$`),
	});
	const all = [...plain, ...scripted];
	const out =
		`// Generated by scripts/build-runtime.mjs from src/player/runtime.ts and src/player/parts. Do not edit.\n` +
		`// index: 1 sound + 2 morphs + 4 mouse handlers; 8 + 1 sound + 2 morphs: with scripts\n` +
		`export const PLAYER_RUNTIMES = ${JSON.stringify(all)};\n` +
		`/** Parts of the API of scripts, for the documents that use them: each sets the global __f2sPart. */\n` +
		`export const PLAYER_PARTS = ${JSON.stringify(parts)};\n` +
		`/** Sounds of SMIL and CSS output: sets the global __f2sSound. */\n` +
		`export const PLAYER_SOUNDTRACK = ${JSON.stringify(sound.outputFiles[0].text.trim().replace(/<\/script/gi, "<\\/script"))};\n`;
	writeFileSync(join(repo, "src/core/emit/runtime-code.generated.ts"), out);
	return all.map((s) => s.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const kb = (x) => (x / 1024).toFixed(1) + " KB";
	const n = await buildRuntime();
	console.log(`player runtime: ${kb(n[0])}, with sound ${kb(n[1])}, with morphs ${kb(n[2])}, with mouse handlers ${kb(n[4])}, with all ${kb(n[7])}`);
}
