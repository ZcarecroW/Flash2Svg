/**
 * Automated in-Animate test of the panel's export path. If <tmp>/flash2svg-selftest.json exists
 * when the panel starts, its jobs are exported exactly as the Export button would, the results
 * are written to the given file and (optionally) Animate quits.
 */
import { mount, unmount } from "svelte";
import { DEFAULT_SETTINGS, type ExportSettings } from "../../core/compile.ts";
import LottiePreview from "../LottiePreview.svelte";
import { evalScript, node, toFileUri } from "./cep.ts";
import { docInfo, runExport } from "./exporter.ts";

interface SelfTestJob {
	fla: string;
	output: string;
	settings?: Partial<ExportSettings>;
	source?: "timeline" | "library" | "scenes";
	frames?: "all" | "current" | "range";
	rangeStart?: number;
	rangeEnd?: number;
	/** Library items to select before exporting (for source "library"). */
	select?: string[];
	/** JSFL to run on the opened document before exporting. */
	jsfl?: string;
	/** Keep the scene data next to the output (<name>.scene/). */
	keepScene?: boolean;
	/** Lottie exports: show the result in the panel's preview (in this player) and report what it drew. */
	preview?: { player?: "lottie-web" | "dotlottie"; click?: boolean };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mounts the Lottie preview off screen and reports what it shows: drawn elements or pixels, time, state machine. */
async function checkPreview(file: string, format: "lottie" | "dotlottie", opts: NonNullable<SelfTestJob["preview"]>): Promise<Record<string, unknown>> {
	const host = document.createElement("div");
	host.style.cssText = "position:fixed;left:0;top:0;width:320px;opacity:0.01;pointer-events:none;z-index:-1";
	document.body.appendChild(host);
	const comp = mount(LottiePreview, { target: host, props: { file, format } });
	const out: Record<string, unknown> = {};
	const ready = async () => {
		for (const t0 = Date.now(); Date.now() - t0 < 15000; await sleep(100)) {
			if (host.querySelector(".preview")?.getAttribute("data-state") !== "loading") return;
		}
	};
	try {
		await sleep(50);
		if (opts.player) {
			const sel = host.querySelector<HTMLSelectElement>("select");
			if (sel) {
				sel.value = opts.player;
				sel.dispatchEvent(new Event("change"));
				await sleep(100);
			}
		}
		await ready();
		await sleep(800);
		const time1 = host.querySelector(".time")?.textContent;
		await sleep(700);
		out.error = host.querySelector(".error")?.textContent ?? "";
		out.time = [time1, host.querySelector(".time")?.textContent];
		out.svgElements = host.querySelectorAll(".stage svg *").length;
		out.svgFilters = host.querySelectorAll(".stage svg filter").length;
		out.svgImages = host.querySelectorAll(".stage svg image").length;
		const canvas = host.querySelector<HTMLCanvasElement>(".stage canvas");
		if (canvas && canvas.width && canvas.height) {
			const px = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
			let n = 0;
			if (px) for (let i = 3; i < px.length; i += 4) if (px[i]! > 0) n++;
			out.canvasPixels = n;
		}
		const state = () => host.querySelector(".state")?.textContent ?? "";
		out.state = state();
		if (opts.click && canvas) {
			const r = canvas.getBoundingClientRect();
			const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
			canvas.dispatchEvent(new PointerEvent("pointerdown", at));
			canvas.dispatchEvent(new PointerEvent("pointerup", at));
			canvas.dispatchEvent(new MouseEvent("click", at));
			await sleep(600);
			out.stateAfterClick = state();
		}
	} catch (e) {
		out.error = (e as Error).message;
	} finally {
		unmount(comp);
		host.remove();
	}
	return out;
}

interface SelfTestConfig {
	jobs: SelfTestJob[];
	result: string;
	quit?: boolean;
}

export async function runSelfTestIfRequested(): Promise<boolean> {
	if (!node) return false;
	const cfgPath = node.path.join(node.os.tmpdir(), "flash2svg-selftest.json");
	if (!node.fs.existsSync(cfgPath)) return false;
	const cfg = JSON.parse(node.fs.readFileSync(cfgPath, "utf8")) as SelfTestConfig;
	node.fs.unlinkSync(cfgPath); // never loop
	const results: unknown[] = [];
	// what Animate wrote to its Output panel during a job (its own errors, JSFL warnings): saved,
	// then cleared, so every job reports its own
	const outFile = cfg.result.replace(/\.json$/i, "") + "-output.txt";
	const animateOutput = async () => {
		await evalScript(`fl.outputPanel.save(${JSON.stringify(toFileUri(outFile))}, false); fl.outputPanel.clear(); "ok"`).catch(() => "");
		const text = node!.fs.existsSync(outFile)
			? node!.fs
					.readFileSync(outFile, "utf8")
					.replace(/^\uFEFF/, "")
					.trim()
			: "";
		return text || undefined;
	};
	await animateOutput();
	const log = async (r: Record<string, unknown>) => {
		r.output = await animateOutput();
		results.push(r);
		node!.fs.writeFileSync(cfg.result, JSON.stringify({ done: false, results }, null, 1));
	};
	for (const job of cfg.jobs) {
		const t0 = Date.now();
		try {
			await evalScript(`fl.openDocument(${JSON.stringify(toFileUri(job.fla))}) ? "ok" : "fail"`);
			if (job.select) {
				await evalScript(
					`(function(){var l=fl.getDocumentDOM().library;l.selectNone();var n=${JSON.stringify(job.select)};for(var i=0;i<n.length;i++)l.selectItem(n[i],false);return "ok";})()`,
				);
			}
			if (job.jsfl) await evalScript(job.jsfl);
			const info = await docInfo();
			const progress: string[] = [];
			const res = await runExport(
				{
					settings: { ...DEFAULT_SETTINGS, ...(job.settings ?? {}) },
					source: job.source ?? "timeline",
					frames: job.frames ?? "all",
					rangeStart: job.rangeStart ?? 1,
					rangeEnd: job.rangeEnd ?? info.frameCount ?? 1,
					output: job.output,
					keepScene: job.keepScene,
				},
				info,
				(p, m) => {
					if (progress[progress.length - 1] !== m) progress.push(`${Math.round(p * 100)}% ${m}`);
				},
				() => false,
			);
			const preview =
				job.preview && (res.format === "lottie" || res.format === "dotlottie") ? await checkPreview(res.files[0]!, res.format, job.preview) : undefined;
			await log({
				fla: job.fla,
				ok: true,
				format: res.format,
				files: res.files,
				bytes: res.output.reduce((n, o) => n + o.stats.bytes, 0),
				warnings: res.warnings,
				seconds: res.seconds,
				steps: progress.length,
				docType: info.type,
				images: res.images.map((i) => [i.name, i.width, i.height]),
				parts: res.output.map((o) => o.stats.parts),
				drawings: res.output.flatMap((o) => o.stats.drawings),
				linkedBytes: res.linkedBytes,
				preview,
			});
		} catch (e) {
			await log({ fla: job.fla, ok: false, error: (e as Error).message, seconds: (Date.now() - t0) / 1000 });
		}
		await evalScript("fl.closeAll(false)").catch(() => "");
	}
	node.fs.writeFileSync(cfg.result, JSON.stringify({ done: true, results }, null, 1));
	if (cfg.quit) {
		// Close this panel before Animate quits: Animate saves the workspace on quit, and a panel
		// saved as open whose extension is later removed makes Animate quit whenever a document
		// window opens. The quit request is queued first; it runs after the panel is gone.
		const cep = window.__adobe_cep__;
		if (cep?.closeExtension) {
			cep.evalScript("fl.quit(false)", () => {});
			cep.closeExtension();
		} else await evalScript("fl.quit(false)").catch(() => "");
	}
	return true;
}
