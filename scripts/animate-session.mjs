// A long-lived Animate for trying things out: scripts run in the same instance (no 13 s start each
// time), the document stays open between them, and the stage can be used with the mouse.
//   node scripts/animate-session.mjs start script.jsfl     starts Animate, runs a script
//   node scripts/animate-session.mjs run script.jsfl       runs a script in it, prints the Output panel
//   node scripts/animate-session.mjs stage                 finds the stage (a #FF00FF background)
//   node scripts/animate-session.mjs drag "x,y x,y ..."    presses, moves, releases, in stage pixels
//   node scripts/animate-session.mjs click "x,y"           one click, in stage pixels
//   node scripts/animate-session.mjs key w                 keys, in SendKeys syntax
//   node scripts/animate-session.mjs dialogs               open dialogs and their text
//   node scripts/animate-session.mjs shot                  a picture of the main window
//   node scripts/animate-session.mjs find "text"            where a text is in the window (OCR; screen px)
//   node scripts/animate-session.mjs press "x,y"           one click at a point of the screen (panels)
//   node scripts/animate-session.mjs stop                  closes everything, quits
// With --post the mouse goes as window messages: the real mouse stays where it is. The drawing tools
// follow those; Asset Warp reads the real mouse, and takes a press only when it lasts a moment (drag
// with a few points) and its object is selected on the keyframe. Keep the stage in view at 100 %.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findAnimate, jsflSyntaxError } from "./lib/animate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(tmpdir(), "f2s-session");
mkdirSync(dir, { recursive: true });
const stateFile = join(dir, "state.json");
const fileUri = (p) => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1|");
const state = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {});
const save = (s) => writeFileSync(stateFile, JSON.stringify(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function animatePid() {
	const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq Animate.exe", "/NH", "/FO", "CSV"], { encoding: "utf8" });
	return Number(/"Animate\.exe","(\d+)"/.exec(out)?.[1] ?? 0);
}
function ui(args) {
	const pid = animatePid();
	if (!pid) throw new Error("Animate isn't running");
	const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "lib", "animate-ui.ps1"), "-AnimatePid", String(pid), ...args], { encoding: "utf8", windowsHide: true });
	if (r.status) console.error(r.stderr);
	return (r.stdout ?? "").trim();
}

/** The title of Animate's main window, or null when it isn't running. */
function windowTitle() {
	const out = execFileSync("tasklist", ["/V", "/FI", "IMAGENAME eq Animate.exe", "/NH", "/FO", "CSV"], { encoding: "utf8" });
	const m = /^"Animate.exe".*"([^"]*)"s*$/m.exec(out);
	return m ? m[1] : null;
}

/**
 * Stops at once when Animate has crashed: its error report takes the main window's place and
 * waits for an answer. It is never sent: Animate is ended, a picture of the report kept.
 */
function checkAlive(after) {
	const title = windowTitle();
	if (!title?.startsWith("Error Report")) return;
	const picture = ui(["-Do", "shot"]);
	const pid = animatePid();
	spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
	console.log(`ANIMATE CRASHED ${after}. Its error report: ${picture}. Animate was ended, nothing sent.`);
	process.exit(2);
}

/** Runs a script in the running Animate (or starts it) and waits until it has run. */
async function run(script, timeoutMs = 120000, keep = false) {
	const syntax = jsflSyntaxError(script);
	if (syntax) throw new Error(`Syntax error: ${syntax}`);
	const id = Date.now().toString(36);
	const done = join(dir, `done-${id}.txt`),
		output = join(dir, `output-${id}.txt`),
		wrapper = join(dir, `run-${id}.jsfl`);
	const u = (p) => JSON.stringify(fileUri(p));
	writeFileSync(
		wrapper,
		`fl.outputPanel.clear();\n` +
			`try { fl.runScript(${u(script)}); } catch (e) { fl.trace("Script error: " + e); }\n` +
			`try { fl.outputPanel.save(${u(output)}, false); } catch (e) {}\n` +
			`FLfile.write(${u(done)}, "done");\n`,
	);
	spawn(findAnimate(), [wrapper], { stdio: "ignore", detached: true, cwd: tmpdir() }).unref();
	const t0 = Date.now();
	for (let i = 0; Date.now() - t0 < timeoutMs; i++) {
		if (i % 7 === 6) checkAlive(`running ${script}`);
		if (existsSync(done)) {
			const text = existsSync(output) ? readFileSync(output, "utf8").replace(/^﻿/, "").trim() : "";
			for (const f of [done, output, wrapper]) rmSync(f, { force: true });
			if (text) console.log(text);
			console.log(`(ran in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
			return;
		}
		await sleep(150);
	}
	checkAlive(`running ${script}`);
	console.log("No end of the script seen: dialogs now open:");
	console.log(ui(["-Do", "dialogs"]));
	process.exitCode = 1;
}

/** Stage pixels to screen pixels. */
function toScreen(text) {
	const s = state();
	if (!s.stage) throw new Error('find the stage first: "stage <width> <height>"');
	const scale = (s.stage.right - s.stage.left + 1) / s.w;
	return text
		.trim()
		.split(/\s+/)
		.map((p) => {
			const [x, y] = p.split(",").map(Number);
			return `${Math.round(s.stage.left + x * scale)},${Math.round(s.stage.top + y * scale)}`;
		})
		.join(" ");
}

const [cmd, ...rest] = process.argv.slice(2);
const post = rest.includes("--post") ? ["-Post"] : [];
const args = rest.filter((a) => a !== "--post");
if (cmd !== "start" && cmd !== "stop") checkAlive(`before "${cmd}"`);
switch (cmd) {
	case "start":
		if (!args[0]) throw new Error("start needs a script (a new document, say)");
		await run(args[0], 180000);
		break;
	case "run":
		// --keep: the Output panel stays as it is (traces of a running Test Movie)
		await run(args[0], 120000, args.includes("--keep"));
		break;
	case "stage": {
		const stage = JSON.parse(ui(["-Do", "stage", "-Marker", "FF00FF"]));
		save({ ...state(), stage, w: Number(args[0] ?? 0) || stage.right - stage.left + 1 });
		console.log(JSON.stringify(stage));
		break;
	}
	case "drag":
		ui(["-Do", "mouse", "-Path", toScreen(args[0]), ...post]);
		break;
	case "click":
		ui(["-Do", "click", "-Path", toScreen(args[0]), ...post]);
		break;
	case "key":
		ui(["-Do", "key", "-Keys", args[0], ...post, ...(post.length ? ["-Path", toScreen("0,0")] : [])]);
		break;
	case "dialogs":
		console.log(ui(["-Do", "dialogs"]));
		break;
	case "shot":
		console.log(ui(["-Do", "shot"]));
		break;
	case "find":
		console.log(ui(["-Do", "find", "-Keys", args[0] ?? ""]));
		break;
	case "press":
		ui(["-Do", "click", "-Path", args[0], ...post]);
		break;
	case "stop": {
		const f = join(dir, "stop.jsfl");
		writeFileSync(f, "fl.closeAll(false);\nfl.quit(false);\n");
		spawn(findAnimate(), [f], { stdio: "ignore", detached: true, cwd: tmpdir() }).unref();
		for (let i = 0; i < 30 && animatePid(); i++) await sleep(150);
		if (animatePid()) {
			// (seen after long sessions: quitting hangs; everything is saved by then)
			spawnSync("taskkill", ["/IM", "Animate.exe", "/T", "/F"], { stdio: "ignore" });
			console.log("Animate didn't quit: ended it");
		} else console.log("closed");
		break;
	}
	default:
		console.log("start | run | stage | drag | click | press | key | dialogs | shot | find | stop");
}
