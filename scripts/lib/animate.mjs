// Helpers to drive Adobe Animate from Node: Animate.exe <script.jsfl> runs the script in a fresh
// instance; our scripts end with fl.quit(false) so the process exits when the work is done.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
 * fl.quit(), printed, and returned as `output`. Crashes, hangs and dialogs are detected (see watch()):
 * the run then fails with the reason instead of waiting for the timeout.
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
		let done = false;
		let watcher = null;
		const finish = () => {
			done = true;
			watcher?.kill();
			const output = existsSync(outFile) ? readFileSync(outFile, "utf8").replace(/^﻿/, "").trim() : "";
			rmSync(dir, { recursive: true, force: true });
			if (output && !quiet) console.log(`Animate output panel:\n${output}`);
			return output;
		};
		// Animate drops temp folders into its working directory: keep that out of the repo
		const child = spawn(exe, [wrapper], { stdio: "ignore", windowsHide: false, cwd: tmpdir() });
		/** Ends Animate (and what it started, e.g. a crash reporter) and fails the run. */
		const fail = (why) => {
			if (done) return;
			clearTimeout(timer);
			if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
			else child.kill();
			const output = finish();
			reject(Object.assign(new Error(`Animate ${why} (running ${jsflPath})`), { output }));
		};
		const timer = setTimeout(() => fail(`timed out after ${timeoutMs / 1000}s`), timeoutMs);
		const dialogs = [];
		if (process.platform === "win32" && child.pid) watcher = watch(child.pid, dialogs, fail, quiet);
		child.on("error", (e) => {
			clearTimeout(timer);
			watcher?.kill();
			reject(e);
		});
		child.on("exit", (code) => {
			if (done) return;
			clearTimeout(timer);
			const output = finish();
			// fl.quit() exits with 0; a crash ends with an exception code such as 0xC0000005
			if (code !== 0) reject(Object.assign(new Error(`Animate crashed (exit code 0x${(code >>> 0).toString(16)}) running ${jsflPath}`), { output, dialogs }));
			else resolve({ code, seconds: (Date.now() - started) / 1000, output, dialogs });
		});
	});
}

/**
 * Watches Animate (scripts/lib/watch-animate.ps1): reports and closes dialogs (Esc / Cancel, never
 * OK), and fails the run when a dialog won't close, a crash reporter starts, or Animate hangs
 * (no CPU time used for HANG_SECONDS while no dialog is open; a running script keeps it busy).
 */
const HANG_SECONDS = 90;
function watch(pid, dialogs, fail, quiet) {
	const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dirname(fileURLToPath(import.meta.url)), "watch-animate.ps1"), "-AnimatePid", String(pid)], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
	let cpu = -1;
	let idleSince = Date.now();
	let buf = "";
	ps.stdout.setEncoding("utf8");
	ps.stdout.on("data", (chunk) => {
		buf += chunk;
		let nl;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			let st;
			try {
				st = JSON.parse(line);
			} catch {
				continue;
			}
			const list = [st.dialogs ?? []].flat();
			for (const d of list) {
				const text = `"${d.title}"${d.text ? `: ${d.text}` : ""}`;
				if (d.state === "closed") {
					dialogs.push(text);
					if (!quiet) console.log(`Animate showed a dialog, closed it (Esc): ${text}`);
				}
				if (d.state === "stuck") return fail(`is stuck on a dialog that does not close: ${text}`);
			}
			const crash = [st.crash ?? []].flat();
			if (crash.length) return fail(`crashed (${crash.join(", ")} started)`);
			if (st.cpu > cpu + 0.05 || list.length) idleSince = Date.now();
			cpu = Math.max(cpu, st.cpu ?? 0);
			if (Date.now() - idleSince > HANG_SECONDS * 1000) return fail(`hangs (no activity for ${HANG_SECONDS}s)`);
		}
	});
	return ps;
}

