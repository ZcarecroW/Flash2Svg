/**
 * Public entry point of the compiler: scene model -> SVG text(s).
 */
import { createContext, type FileSource } from "./context.ts";
import { renderAnimated, type BeginMode } from "./emit/animate.ts";
import { renderPlayer } from "./emit/player.ts";
import { renderStatic } from "./emit/static.ts";
import type { SceneModel } from "./model.ts";

export type OutputFormat = "smil" | "css" | "player" | "static";

export interface ExportSettings {
	format: OutputFormat;
	/** Static format: which frames (0-based). Default: all frames of the range. */
	frames?: number[];
	startFrame?: number;
	endFrame?: number;
	loop: "auto" | "always" | "never";
	begin: BeginMode;
	delay: number;
	/** High FPS interpolation of tweens. */
	smooth: boolean;
	includeBackground: boolean;
	includeHiddenLayers: boolean;
	includeGuides: boolean;
	embedImages: boolean;
	textAsOutlines: boolean;
	posterFrame: "first" | "last";
	digits: number;
	pretty: boolean;
}

export const DEFAULT_SETTINGS: ExportSettings = {
	format: "smil",
	loop: "auto",
	begin: "auto",
	delay: 0,
	smooth: true,
	includeBackground: false,
	includeHiddenLayers: true,
	includeGuides: false,
	embedImages: true,
	textAsOutlines: false,
	posterFrame: "first",
	digits: 2,
	pretty: false,
};

export interface OutputFile {
	/** Suggested file name suffix ("" for the main file, "_12" for frame 12...). */
	suffix: string;
	svg: string;
}

export interface CompileOutput {
	files: OutputFile[];
	/** Files to copy next to the output (sidecar images, sounds), relative to scene.json. */
	assets: { path: string; source: string }[];
	warnings: string[];
	stats: { durationSeconds: number; frames: number; bytes: number };
}

export function compileScene(model: SceneModel, files: FileSource, partial: Partial<ExportSettings> = {}, rootIndex = 0): CompileOutput {
	const s: ExportSettings = { ...DEFAULT_SETTINGS, ...partial };
	const ctx = createContext(model, files, {
		smooth: s.smooth,
		includeHiddenLayers: s.includeHiddenLayers,
		includeGuides: s.includeGuides,
		digits: s.digits,
	});
	const rootId = model.roots[rootIndex];
	if (!rootId) throw new Error("Nothing to export");
	const prog = ctx.programs[rootId]!;
	const fps = model.doc.frameRate || 24;
	const out: CompileOutput = { files: [], assets: [], warnings: ctx.warnings, stats: { durationSeconds: 0, frames: 0, bytes: 0 } };
	const assets = new Map<string, { path: string; source: string }>();

	if (s.format === "static") {
		const start = s.startFrame ?? 0;
		const end = s.endFrame ?? prog.frameCount;
		const frames = s.frames ?? Array.from({ length: Math.max(1, end - start) }, (_, i) => start + i);
		for (const f of frames) {
			const r = renderStatic(ctx, rootId, {
				frame: f,
				movieClips: "play",
				includeBackground: s.includeBackground,
				embedImages: s.embedImages,
				textAsOutlines: s.textAsOutlines,
				pretty: s.pretty,
			});
			out.files.push({ suffix: frames.length > 1 ? `_${f + 1}` : "", svg: r.svg });
			r.assets.forEach((a) => assets.set(a.path, a));
		}
		out.stats.frames = frames.length;
	} else if (s.format === "player") {
		const r = renderPlayer(ctx, rootId, s);
		out.files.push({ suffix: "", svg: r.svg });
		r.assets.forEach((a) => assets.set(a.path, a));
		out.stats.frames = prog.frameCount;
		out.stats.durationSeconds = prog.frameCount / fps;
	} else {
		const r = renderAnimated(ctx, rootId, {
			format: s.format,
			smooth: s.smooth,
			loop: s.loop,
			startFrame: s.startFrame,
			endFrame: s.endFrame,
			includeBackground: s.includeBackground,
			embedImages: s.embedImages,
			textAsOutlines: s.textAsOutlines,
			posterFrame: s.posterFrame,
			begin: s.begin,
			delay: s.delay,
			pretty: s.pretty,
		});
		out.files.push({ suffix: "", svg: r.svg });
		r.assets.forEach((a) => assets.set(a.path, a));
		out.stats.frames = r.horizon.ticks;
		out.stats.durationSeconds = r.horizon.ticks / r.horizon.fps;
	}
	out.assets = [...assets.values()];
	out.stats.bytes = out.files.reduce((n, f) => n + f.svg.length, 0);
	return out;
}
