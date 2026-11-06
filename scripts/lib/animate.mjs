// Helpers to drive Adobe Animate from Node: Animate.exe <script.jsfl> runs the script in a fresh
// instance; our scripts end with fl.quit(false) so the process exits when the work is done.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const libDir = dirname(fileURLToPath(import.meta.url));

export function findAnimate() {
	if (process.env.FLASH2SVG_ANIMATE && existsSync(process.env.FLASH2SVG_ANIMATE)) {
		return process.env.FLASH2SVG_ANIMATE;
	}
	const roots = process.platform === "win32" ? ["C:\\Program Files\\Adobe"] : ["/Applications"];
	for (const root of roots) {
		if (!existsSync(root)) continue;
		const dirs = readdirSync(root)
			.filter((d) => /^Adobe Animate/.test(d))
			.sort()
			.reverse();
		for (const d of dirs) {
			const exe = process.platform === "win32" ? join(root, d, "Animate.exe") : join(root, d, `${d}.app`, "Contents", "MacOS", "Adobe Animate");
			if (existsSync(exe)) return exe;
		}
	}
	throw new Error("Adobe Animate not found. Set FLASH2SVG_ANIMATE to the Animate executable.");
}

/** Lines of Animate's Output panel that report a problem (errors, unsupported APIs). */
export function outputProblems(text) {
	return (text ?? "").split(/\r?\n/).filter((l) => /error|exception|failed|not supported|could not|damaged/i.test(l));
}

export function isAnimateRunning() {
	if (process.platform !== "win32") return false;
	const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq Animate.exe", "/NH"], { encoding: "utf8" });
	return /Animate\.exe/i.test(out);
}

const fileUri = (p) => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1|");

/** A JSFL file's syntax error as "file:line: message" (Animate only says that the script failed, after 13 s), or null. */
export function jsflSyntaxError(path) {
	try {
		new vm.Script(readFileSync(path, "utf8"), { filename: path });
		return null;
	} catch (e) {
		if (!(e instanceof SyntaxError)) return null;
		const line = /:(\d+)\r?\n/.exec(e.stack ?? "")?.[1];
		return `${path}${line ? `:${line}` : ""}: ${e.message}`;
	}
}

/** Why Windows ended Animate: the crash record of the last minutes (module, exception code, offset), or "". */
function windowsCrashRecord() {
	const script = `$e = Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'; StartTime=(Get-Date).AddMinutes(-3)} -MaxEvents 8 -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'Animate\\.exe' } | Select-Object -First 1; if ($e) { ($e.Message -split '\\r?\\n' | Where-Object { $_ -match 'Faulting module name|Exception code|Fault offset' } | ForEach-Object { $_.Trim() }) -join '; ' }`;
	const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 20000 });
	return (r.stdout ?? "").trim();
}

/** A picture of Animate's main window as it is (for a hang or a timeout); its path, or "". */
function snapshotWindow(pid) {
	const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(libDir, "watch-animate.ps1"), "-AnimatePid", String(pid), "-Snapshot"], {
		encoding: "utf8",
		windowsHide: true,
		timeout: 20000,
	});
	return (r.stdout ?? "").trim();
}

/** Keeps what is known about the last run, whatever happened to it (tests/out/animate-last-run.json). */
function recordRun(run) {
	try {
		const dir = join(libDir, "..", "..", "tests", "out");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "animate-last-run.json"), JSON.stringify(run, null, "\t"));
	} catch {}
}

/**
 * Runs a JSFL file in a new Animate instance and resolves when Animate exits. All the run says is
 * kept, also when it goes wrong, and printed, and comes with the result or the error:
 * - `output`: Animate's Output panel (traces, compiler errors), saved when the script ends and at
 *   each checkpoint; what went through fl.trace() is on disk at once, so it survives a crash.
 * - `step`: the last fl.__checkpoint(label) the script reached, `output` saved there.
 * - `dialogs`: every dialog with its text (read from a picture of it; Adobe's dialogs show theirs
 *   to no API) and the picture's path.
 * - `crash`: the crash record of Windows (module, exception code).
 * A syntax error is found before Animate starts; an exception in the script fails the run with
 * its message and line, at once. Crashes, hangs and dialogs are detected (see watch()); a picture
 * of the main window is taken of a hang or a timeout. tests/out/animate-last-run.json keeps it all.
 */
export function runJsfl(jsflPath, { timeoutMs = 10 * 60 * 1000, quiet = false } = {}) {
	if (isAnimateRunning()) {
		throw new Error("Animate is already running. Close it first: the test scripts quit Animate when they finish.");
	}
	const syntax = jsflSyntaxError(jsflPath);
	if (syntax) throw new Error(`Syntax error in a script for Animate: ${syntax}`);
	const exe = findAnimate();
	const dir = mkdtempSync(join(tmpdir(), "f2s-jsfl-"));
	const outFile = join(dir, "output.txt");
	const traceFile = join(dir, "trace.txt");
	const stepFile = join(dir, "steps.txt");
	const errorFile = join(dir, "error.txt");
	const inner = join(dir, "script.jsfl");
	const wrapper = join(dir, "run.jsfl");
	// the script inside a try (on its first line, so that lines keep their numbers): an exception
	// otherwise only shows a dialog without its message
	const source = readFileSync(jsflPath, "utf8");
	const bom = source.startsWith("﻿") ? "﻿" : "";
	writeFileSync(
		inner,
		`${bom}try { ${source.slice(bom.length).replace(/fl\.scriptURI/g, JSON.stringify(fileUri(jsflPath)))}\n} catch (__e) { fl.__failed(__e); }\n`,
	);
	const uri = (p) => JSON.stringify(fileUri(p));
	writeFileSync(
		wrapper,
		`var __quit = fl.quit, __trace = fl.trace, __quitting = false;\n` +
			`function __panel() { try { fl.outputPanel.save(${uri(outFile)}, false); } catch (e) {} }\n` +
			`fl.trace = function (s) { __trace.call(fl, s); FLfile.write(${uri(traceFile)}, s + "\\n", "append"); };\n` +
			`fl.__checkpoint = function (s) { FLfile.write(${uri(stepFile)}, s + "\\n", "append"); __panel(); };\n` +
			`fl.__failed = function (e) { var m = String(e) + (e && e.lineNumber ? " (line " + e.lineNumber + ")" : ""); FLfile.write(${uri(errorFile)}, m); fl.trace("Script error: " + m); };\n` +
			`fl.quit = function (p) { __quitting = true; __panel(); __quit.call(fl, p); };\n` +
			`fl.runScript(${uri(inner)});\n` +
			// ended before its fl.quit(): keep the Output panel, don't wait for the timeout
			`if (!__quitting) { if (!FLfile.exists(${uri(errorFile)})) fl.__failed("the script stopped without quitting"); fl.closeAll(false); fl.quit(false); }\n`,
	);
	return new Promise((resolve, reject) => {
		const started = Date.now();
		let done = false;
		let watcher = null;
		const dialogs = [];
		const read = (f) => (existsSync(f) ? readFileSync(f, "utf8").replace(/^﻿/, "").trim() : "");
		const finish = () => {
			done = true;
			watcher?.kill();
			// (the panel as last saved, or what was traced)
			const output = read(outFile) || read(traceFile);
			const step = read(stepFile).split(/\r?\n/).pop() ?? "";
			const error = read(errorFile);
			// after a forced end Animate may still hold the folder for a moment
			try {
				rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch {}
			if (output && !quiet) console.log(`Animate output panel:\n${output}`);
			return { output, step, error };
		};
		const report = (state, info) => recordRun({ script: jsflPath, state, seconds: (Date.now() - started) / 1000, dialogs, ...info });
		// Animate drops temp folders into its working directory: keep that out of the repo
		const child = spawn(exe, [wrapper], { stdio: "ignore", windowsHide: false, cwd: tmpdir() });
		const failed = (why, info) => {
			const where = info.step ? ` at step "${info.step}"` : "";
			const crash = /crash/.test(why) ? windowsCrashRecord() : "";
			report(why, { ...info, crash });
			return Object.assign(new Error(`Animate ${why}${where} (running ${jsflPath})${crash ? `: ${crash}` : ""}`), { ...info, crash, dialogs });
		};
		/** Ends Animate (and what it started, e.g. a crash reporter) and fails the run. */
		const fail = (why) => {
			if (done) return;
			clearTimeout(timer);
			const picture = /crash/.test(why) ? "" : snapshotWindow(child.pid);
			if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
			else child.kill();
			reject(failed(picture ? `${why}, picture: ${picture}` : why, finish()));
		};
		const timer = setTimeout(() => fail(`timed out after ${timeoutMs / 1000}s`), timeoutMs);
		if (process.platform === "win32" && child.pid) watcher = watch(child.pid, dialogs, fail, quiet);
		child.on("error", (e) => {
			clearTimeout(timer);
			watcher?.kill();
			reject(e);
		});
		child.on("exit", (code) => {
			if (done) return;
			clearTimeout(timer);
			const info = finish();
			// fl.quit() exits with 0; a crash ends with an exception code such as 0xC0000005
			if (code !== 0) reject(failed(`crashed (exit code 0x${(code >>> 0).toString(16)})`, info));
			else if (info.error) reject(failed(`script failed: ${info.error}`, info));
			else {
				const seconds = (Date.now() - started) / 1000;
				report("finished", info);
				resolve({ code, seconds, ...info, dialogs });
			}
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
	const ps = spawn(
		"powershell.exe",
		["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(libDir, "watch-animate.ps1"), "-AnimatePid", String(pid)],
		{ stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
	);
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
