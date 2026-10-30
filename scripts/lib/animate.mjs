// Helpers to drive Adobe Animate from Node: Animate.exe <script.jsfl> runs the script in a fresh
// instance; our scripts end with fl.quit(false) so the process exits when the work is done.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function findAnimate() {
	if (process.env.FLASH2SVG_ANIMATE && existsSync(process.env.FLASH2SVG_ANIMATE)) {
		return process.env.FLASH2SVG_ANIMATE;
	}
	const roots =
		process.platform === "win32"
			? ["C:\\Program Files\\Adobe"]
			: ["/Applications"];
	for (const root of roots) {
		if (!existsSync(root)) continue;
		const dirs = readdirSync(root)
			.filter((d) => /^Adobe Animate/.test(d))
			.sort()
			.reverse();
		for (const d of dirs) {
			const exe =
				process.platform === "win32"
					? join(root, d, "Animate.exe")
					: join(root, d, `${d}.app`, "Contents", "MacOS", "Adobe Animate");
			if (existsSync(exe)) return exe;
		}
	}
	throw new Error("Adobe Animate not found. Set FLASH2SVG_ANIMATE to the Animate executable.");
}

export function isAnimateRunning() {
	if (process.platform !== "win32") return false;
	const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq Animate.exe", "/NH"], { encoding: "utf8" });
	return /Animate\.exe/i.test(out);
}

const fileUri = (p) => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1|");

/**
 * Runs a JSFL file in a new Animate instance and resolves when Animate exits. Whatever Animate
 * wrote to its Output panel (traces, compiler and script errors) is saved when the script calls
 * fl.quit(), printed, and returned as `output`.
 */
export function runJsfl(jsflPath, { timeoutMs = 10 * 60 * 1000, quiet = false } = {}) {
	if (isAnimateRunning()) {
		throw new Error("Animate is already running. Close it first: the test scripts quit Animate when they finish.");
	}
	const exe = findAnimate();
	const dir = mkdtempSync(join(tmpdir(), "f2s-jsfl-"));
	const outFile = join(dir, "output.txt");
	const wrapper = join(dir, "run.jsfl");
	writeFileSync(
		wrapper,
		`var __quit = fl.quit;\n` +
			`fl.quit = function (p) { try { fl.outputPanel.save(${JSON.stringify(fileUri(outFile))}, false); } catch (e) {} __quit.call(fl, p); };\n` +
			`fl.runScript(${JSON.stringify(fileUri(jsflPath))});\n`,
	);
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const finish = () => {
			const output = existsSync(outFile) ? readFileSync(outFile, "utf8").replace(/^﻿/, "").trim() : "";
			rmSync(dir, { recursive: true, force: true });
			if (output && !quiet) console.log(`Animate output panel:\n${output}`);
			return output;
		};
		// Animate drops temp folders into its working directory: keep that out of the repo
		const child = spawn(exe, [wrapper], { stdio: "ignore", windowsHide: false, cwd: tmpdir() });
		const timer = setTimeout(() => {
			child.kill();
			finish();
			reject(new Error(`Animate timed out after ${timeoutMs / 1000}s running ${jsflPath}`));
		}, timeoutMs);
		child.on("error", (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, seconds: (Date.now() - started) / 1000, output: finish() });
		});
	});
}
