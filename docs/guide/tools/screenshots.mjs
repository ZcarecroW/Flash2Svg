#!/usr/bin/env node
/**
 * Screenshots of the real panel inside Animate for the user guide (docs/guide/images/*.webp).
 *
 * Builds the self-test panel (it opens with a document) with CEP remote debugging on a port,
 * signs and installs it, opens a demo document in Animate and drives the panel through the
 * DevTools protocol: clicks its controls, runs real exports, and captures the panel itself at 2×.
 * Animate's window is captured as well (PrintWindow). Afterwards the panel closes itself before
 * Animate quits (a panel saved as open whose extension is removed makes Animate quit on every
 * document — see the README), and the extension is removed again.
 *
 *   node docs/guide/tools/screenshots.mjs        (Animate must not be running; needs ZXPSignCmd)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findAnimate, isAnimateRunning } from "../../../scripts/lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const guide = join(repo, "docs", "guide");
const images = join(guide, "images");
const raw = join(guide, "demos", "fla", "shots");
mkdirSync(images, { recursive: true });
mkdirSync(raw, { recursive: true });
const PORT = 8099;
const node = (script, args = []) => {
	const r = spawnSync(process.execPath, [join(repo, "scripts", script), ...args], { stdio: "inherit", cwd: repo });
	if (r.status) throw new Error(`${script} failed`);
};
const uri = (p) => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1|");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (isAnimateRunning()) {
	console.error("Close Animate first.");
	process.exit(1);
}
node("build.mjs", ["--selftest", `--debug-port=${PORT}`]);
node("package-zxp.mjs");
node("dev-install.mjs", ["--zxp"]);

let animate;
let ws;
try {
	const demo = (n) => join(guide, "demos", "fla", `${n}.fla`);
	const dir = mkdtempSync(join(tmpdir(), "f2s-shots-"));
	writeFileSync(join(dir, "open.jsfl"), `fl.openDocument(${JSON.stringify(uri(demo("hero")))});\n`);
	animate = spawn(findAnimate(), [join(dir, "open.jsfl")], { stdio: "ignore", cwd: dir });

	// ---------------------------------------------------------------- the panel over CDP
	let target = null;
	for (const t0 = Date.now(); !target && Date.now() - t0 < 180000; await sleep(1000)) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
			target = list.find((t) => /panel\/index\.html/.test(t.url));
		} catch {
			/* not up yet */
		}
	}
	if (!target) throw new Error("The panel didn't open (no remote debugging target)");
	ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
	let id = 0;
	const waiting = new Map();
	ws.onmessage = (m) => {
		const msg = JSON.parse(m.data);
		// the panel's own console and uncaught errors, for the log
		if (msg.method === "Runtime.exceptionThrown") console.log("panel exception:", msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
		if (msg.method === "Runtime.consoleAPICalled" && /error|warn/.test(msg.params.type)) console.log(`panel console.${msg.params.type}:`, msg.params.args.map((a) => a.value ?? a.description).join(" "));
		const w = waiting.get(msg.id);
		if (w) {
			waiting.delete(msg.id);
			msg.error ? w.j(new Error(msg.error.message)) : w.r(msg.result);
		}
	};
	const cdp = (method, params = {}) =>
		new Promise((r, j) => {
			waiting.set(++id, { r, j });
			ws.send(JSON.stringify({ id, method, params }));
		});
	const js = async (expr) => {
		const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
		return r.result.value;
	};
	await cdp("Runtime.enable");
	await cdp("Page.enable");
	const WIDTH = 340;
	const size = async (height) => cdp("Emulation.setDeviceMetricsOverride", { width: WIDTH, height, deviceScaleFactor: 2, mobile: false });
	await size(900);
	// helpers in the panel: click a control by its text, open or close a section, wait for a condition
	await js(`
		// (Svelte renders what a click opens a moment later: every helper waits for its target)
		const tick = () => new Promise((r) => setTimeout(r, 150));
		window.__shot = {
			async until(fn, ms = 120000) { for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 100))) { const v = fn(); if (v) return v; } throw new Error("timed out"); },
			async click(sel, text) {
				const e = await this.until(() => [...document.querySelectorAll(sel)].find((x) => !text || x.textContent.trim().startsWith(text)), 10000).catch(() => null);
				if (!e) throw new Error("no " + sel + " " + text);
				e.click();
				await tick();
			},
			async section(title, open) {
				const b = [...document.querySelectorAll("section h2 button")].find((x) => x.textContent.includes(title));
				if (b && (b.getAttribute("aria-expanded") === "true") !== open) b.click();
				await tick();
			},
			async select(label, value) {
				const l = await this.until(() => [...document.querySelectorAll("label.row")].find((x) => x.textContent.trim().startsWith(label)), 10000);
				const s = l.querySelector("select");
				s.value = value;
				s.dispatchEvent(new Event("change", { bubbles: true }));
				await tick();
			},
		};
		return true;
	`);
	const shot = async (name, opts = {}) => {
		await sleep(opts.wait ?? 400);
		const h = await js(`return Math.ceil(document.querySelector("main").getBoundingClientRect().height) + 8;`);
		await size(Math.max(200, Math.min(opts.maxHeight ?? 2400, h)));
		await sleep(300);
		const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
		writeFileSync(join(raw, `${name}.png`), Buffer.from(r.data, "base64"));
		console.log(`panel: ${name}`);
	};
	// opens a demo (the panel follows Animate's document events)
	const docOpen = (n) => js(`await new Promise((r) => window.__adobe_cep__.evalScript(${JSON.stringify(`fl.closeAll(false); fl.openDocument(${JSON.stringify(uri(demo(n)))}); "ok"`)}, r)); await new Promise((r) => setTimeout(r, 1500)); return true;`);
	const exportNow = async () => {
		const r = await js(
			`const resultHead = () => [...document.querySelectorAll("section h2 button")].find((x) => x.textContent.includes("Result")); try { await __shot.until(() => { const b = document.querySelector("button.primary"); return b && !b.disabled; }, 20000); } catch { return "Export stays disabled: " + document.querySelector("header").innerText; } await __shot.click("button.primary", "Export"); try { await __shot.until(() => document.querySelector(".progress") || resultHead() || document.querySelector(".error"), 5000); } catch { return "the click didn't start an export: " + document.querySelector("header").innerText; } try { await __shot.until(() => !document.querySelector(".progress") && (resultHead() || document.querySelector(".error")), 90000); } catch { return "no result after 90 s; the panel shows: " + document.querySelector("main").innerText.replace(/\\s+/g, " ").slice(0, 400); } if (document.querySelector(".error")) return document.querySelector(".error").textContent; await __shot.section("Result", true); return "";`,
		);
		if (r) {
			// what Animate shows (a dialog would hold the panel's scripts)
			spawnSync("powershell", ["-NoProfile", "-File", join(repo, "scripts", "lib", "watch-animate.ps1"), String(animate.pid)], { encoding: "utf8", timeout: 6000 });
			throw new Error(`The export failed in the panel: ${r} (pictures of Animate's dialogs, if any: %TEMP%\\flash2svg-dialogs)`);
		}
	};
	// start from the defaults
	await js(`const b = [...document.querySelectorAll("button.link")].find((x) => x.textContent.includes("Reset all")); if (b) b.click(); return true;`);
	await docOpen("hero");

	// 1. as it opens: Output and Animation
	for (const [s, o] of [["Output", true], ["Animation", true], ["Graphics", false], ["Images", false], ["Sounds", false], ["Advanced", false]]) await js(`await __shot.section(${JSON.stringify(s)}, ${o}); return true;`);
	await js(`await __shot.click("button[role=radio]", "SMIL"); return true;`);
	await shot("panel");
	// 2. after an export: the result with its preview and size overview
	await exportNow();
	await js(`await __shot.section("Output", false); await __shot.section("Animation", false); return true;`);
	await shot("panel-result", { wait: 1500 });
	// 3. Lottie: the preview plays in lottie-web
	await js(`await __shot.section("Output", true); await __shot.click("button[role=radio]", "Lottie"); return true;`);
	await exportNow();
	await js(`await __shot.section("Output", false); return true;`);
	await shot("panel-lottie", { wait: 2500 });
	// 4. the other sections
	await js(`await __shot.section("Result", false); await __shot.section("Graphics", true); await __shot.section("Advanced", true); return true;`);
	await shot("panel-advanced");
	await js(`await __shot.section("Graphics", false); await __shot.section("Advanced", false); return true;`);
	await docOpen("photo");
	await js(`await __shot.section("Output", true); await __shot.click("button[role=radio]", "CSS"); await __shot.section("Images", true); const b = [...document.querySelectorAll("button.link")].find((x) => x.textContent.includes("Reload list")); if (b) b.click(); return true;`);
	await sleep(1500);
	await shot("panel-images");
	await js(`await __shot.section("Images", false); await __shot.section("Output", false); return true;`);
	await docOpen("sound");
	await js(`await __shot.section("Output", true); await __shot.click("button[role=radio]", "JS player"); await __shot.section("Sounds", true); const b = [...document.querySelectorAll("button.link")].find((x) => x.textContent.includes("Reload list")); if (b) b.click(); return true;`);
	await sleep(1500);
	await shot("panel-sounds");
	await js(`await __shot.section("Sounds", false); return true;`);
	// 5. start modes: On scroll shows its range
	await js(`await __shot.section("Output", true); await __shot.click("button[role=radio]", "CSS"); await __shot.section("Animation", true); await __shot.select("Start", "scroll"); return true;`);
	await shot("panel-scroll");
	await js(`await __shot.select("Start", "auto"); return true;`);

	// ---------------------------------------------------------------- Animate's window with the panel
	await cdp("Emulation.clearDeviceMetricsOverride");
	await docOpen("hero");
	await sleep(1500);
	const ps = spawnSync(
		"powershell",
		[
			"-NoProfile",
			"-Command",
			`Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; } }
"@
$p = Get-Process Animate | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$r = New-Object W+RECT; [void][W]::GetWindowRect($p.MainWindowHandle, [ref]$r)
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc(); [void][W]::PrintWindow($p.MainWindowHandle, $dc, 2); $g.ReleaseHdc($dc)
$bmp.Save(${JSON.stringify(join(raw, "animate.png"))}, [System.Drawing.Imaging.ImageFormat]::Png)
"$($r.R - $r.L)x$($r.B - $r.T)"`,
		],
		{ encoding: "utf8" },
	);
	console.log(`animate window: ${ps.stdout.trim() || ps.stderr.trim()}`);

} finally {
	// quit: the panel closes itself first (also after an error half-way)
	if (ws?.readyState === 1) {
		ws.send(JSON.stringify({ id: 1e6, method: "Runtime.evaluate", params: { expression: `window.__adobe_cep__.evalScript("fl.closeAll(false); fl.quit(false)", () => {}); window.__adobe_cep__.closeExtension(); true` } }));
		await new Promise((r) => {
			const t = setTimeout(r, 30000);
			animate.on("exit", () => (clearTimeout(t), r()));
		});
	}
	try {
		ws?.close();
	} catch {}
	if (isAnimateRunning()) {
		console.error("Animate is still running: close the Flash2SVG panel and quit Animate before the extension is removed.");
	} else node("dev-install.mjs", ["--uninstall"]);
	node("build.mjs");
}

// ---------------------------------------------------------------- PNG → WebP for the pages
const { default: encode, init } = await import("@jsquash/webp/encode.js");
const { default: decode, init: initDec } = await import("@jsquash/png/decode.js");
await init(await WebAssembly.compile(readFileSync(join(repo, "node_modules/@jsquash/webp/codec/enc/webp_enc.wasm"))));
await initDec(await WebAssembly.compile(readFileSync(join(repo, "node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm"))));
for (const f of ["panel", "panel-result", "panel-lottie", "panel-advanced", "panel-images", "panel-sounds", "panel-scroll", "animate"]) {
	const src = join(raw, `${f}.png`);
	if (!existsSync(src)) continue;
	const img = await decode(readFileSync(src));
	const webp = await encode(img, { quality: 90, method: 6 });
	writeFileSync(join(images, `${f}.webp`), Buffer.from(webp));
	console.log(`${f}.webp ${img.width}x${img.height} ${(webp.byteLength / 1024).toFixed(0)} KB`);
}
rmSync(raw, { recursive: true, force: true });
