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
			const info = await docInfo();
			const progress: string[] = [];
			const res = await runExport(
				{
					settings: { ...DEFAULT_SETTINGS, ...(job.settings ?? {}) },
					source: job.source ?? "timeline",
					frames: job.frames ?? "all",
					rangeStart: 1,
					rangeEnd: info.frameCount ?? 1,
					output: job.output,
				},
				info,
				(p, m) => {
					if (progress[progress.length - 1] !== m) progress.push(`${Math.round(p * 100)}% ${m}`);
				},
				() => false,
			);
			log({ fla: job.fla, ok: true, files: res.files, bytes: res.output.reduce((n, o) => n + o.stats.bytes, 0), warnings: res.warnings, seconds: res.seconds, steps: progress.length, docType: info.type });
		} catch (e) {
			log({ fla: job.fla, ok: false, error: (e as Error).message, seconds: (Date.now() - t0) / 1000 });
		}
		await evalScript("fl.closeAll(false)").catch(() => "");
	}
	node.fs.writeFileSync(cfg.result, JSON.stringify({ done: true, results }, null, 1));
	if (cfg.quit) await evalScript("fl.quit(false)").catch(() => "");
	return true;
}
