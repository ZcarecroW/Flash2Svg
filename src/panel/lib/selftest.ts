/**
 * Automated in-Animate test of the panel's export path. If <tmp>/flash2svg-selftest.json exists
 * when the panel starts, its jobs are exported exactly as the Export button would, the results
 * are written to the given file and (optionally) Animate quits.
 */
import { DEFAULT_SETTINGS, type ExportSettings } from "../../core/compile.ts";
import { evalScript, node, toFileUri } from "./cep.ts";
import { docInfo, runExport } from "./exporter.ts";

interface SelfTestJob {
	fla: string;
	output: string;
	settings?: Partial<ExportSettings>;
	source?: "timeline" | "library";
	frames?: "all" | "current" | "range";
	rangeStart?: number;
	rangeEnd?: number;
	/** Library items to select before exporting (for source "library"). */
	select?: string[];
	/** JSFL to run on the opened document before exporting. */
	jsfl?: string;
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
	const log = (r: unknown) => {
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
				},
				info,
				(p, m) => {
					if (progress[progress.length - 1] !== m) progress.push(`${Math.round(p * 100)}% ${m}`);
				},
				() => false,
			);
			log({ fla: job.fla, ok: true, format: res.format, files: res.files, bytes: res.output.reduce((n, o) => n + o.stats.bytes, 0), warnings: res.warnings, seconds: res.seconds, steps: progress.length, docType: info.type, images: res.images.map((i) => [i.name, i.width, i.height]), parts: res.output.map((o) => o.stats.parts), drawings: res.output.flatMap((o) => o.stats.drawings), linkedBytes: res.linkedBytes });
		} catch (e) {
			log({ fla: job.fla, ok: false, error: (e as Error).message, seconds: (Date.now() - t0) / 1000 });
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
