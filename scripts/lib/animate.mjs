// Helpers to drive Adobe Animate from Node: Animate.exe <script.jsfl> runs the script in a fresh
// instance; our scripts end with fl.quit(false) so the process exits when the work is done.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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

/** Runs a JSFL file in a new Animate instance and resolves when Animate exits. */
export function runJsfl(jsflPath, { timeoutMs = 10 * 60 * 1000 } = {}) {
	if (isAnimateRunning()) {
		throw new Error("Animate is already running. Close it first: the test scripts quit Animate when they finish.");
	}
	const exe = findAnimate();
	return new Promise((resolve, reject) => {
		const started = Date.now();
		// Animate drops temp folders into its working directory: keep that out of the repo
		const child = spawn(exe, [jsflPath], { stdio: "ignore", windowsHide: false, cwd: tmpdir() });
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`Animate timed out after ${timeoutMs / 1000}s running ${jsflPath}`));
		}, timeoutMs);
		child.on("error", (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, seconds: (Date.now() - started) / 1000 });
		});
	});
}
