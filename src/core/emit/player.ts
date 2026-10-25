// Placeholder until the JS player emitter is written.
import type { ExportSettings } from "../compile.ts";
import type { Context } from "../context.ts";
import type { OutputDoc } from "./document.ts";

export function renderPlayer(_ctx: Context, _rootId: string, _s: ExportSettings): { svg: string; assets: OutputDoc["assets"] } {
	throw new Error("The JS player format is not implemented yet");
}
