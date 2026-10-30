/**
 * dotLottie v2 container (dotlottie.io/spec/2.0): a ZIP with manifest.json, the animation in
 * a/<id>.json, its bitmaps in i/ (referenced from the animation as u "/i/", p <file>) and the
 * playback state machine in s/<id>.json (statemachine.ts).
 */
import { strToU8, zipSync, type Zippable } from "fflate";
import { STATE_MACHINE_ID } from "./statemachine.ts";

/** Fixed file times: the same export gives the same bytes. */
const MTIME = new Date(2020, 0, 1);

/** An id the manifest accepts (letters, digits, . _ - and spaces). */
export function dotLottieId(name: string): string {
	return name.replace(/[^a-zA-Z0-9._\- ]+/g, "_").replace(/^[ .]+|[ .]+$/g, "") || "animation";
}

export function packDotLottie(
	json: string,
	id: string,
	images: { name: string; bytes: Uint8Array }[],
	stateMachine?: Record<string, unknown> | null,
): Uint8Array {
	const manifest: Record<string, unknown> = { version: "2", generator: "Flash2Svg", animations: [{ id }] };
	const files: Zippable = {
		[`a/${id}.json`]: [strToU8(json), { level: 9, mtime: MTIME }],
	};
	if (stateMachine) {
		manifest.stateMachines = [{ id: STATE_MACHINE_ID, name: "Playback" }];
		manifest.initial = { stateMachine: STATE_MACHINE_ID };
		files[`s/${STATE_MACHINE_ID}.json`] = [strToU8(JSON.stringify(stateMachine)), { level: 9, mtime: MTIME }];
	}
	files["manifest.json"] = [strToU8(JSON.stringify(manifest)), { level: 9, mtime: MTIME }];
	// bitmaps are compressed already: stored as they are
	for (const img of images) files[`i/${img.name}`] = [img.bytes, { level: 0, mtime: MTIME }];
	return zipSync(files);
}
