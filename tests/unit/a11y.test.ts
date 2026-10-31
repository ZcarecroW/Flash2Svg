import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileScene, type ExportSettings } from "../../src/core/compile.ts";
import type { SceneModel } from "../../src/core/model.ts";

function compile(name: string, settings: Partial<ExportSettings>, edit?: (m: SceneModel) => void) {
	const model: SceneModel = JSON.parse(readFileSync(new URL(`../fixtures/models/${name}.json`, import.meta.url), "utf8"));
	edit?.(model);
	const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };
	return compileScene(model, files, settings).files[0]!.svg;
}

describe("accessibility (Animate's Accessibility panel)", () => {
	it("names and describes the document; a group when parts are accessible", () => {
		for (const format of ["smil", "css", "player", "static"] as const) {
			const svg = compile("f48-accessibility", { format });
			expect(svg, format).toMatch(/<svg [^>]*role="group"[^>]*><title>Moving box demo<\/title><desc>A blue box moves to the right; the Play button starts it again\.<\/desc>/);
		}
	});

	it("labels instances, buttons get their shortcut and tab index, silent ones are hidden", () => {
		for (const format of ["smil", "css", "static"] as const) {
			const svg = compile("f48-accessibility", { format });
			expect(svg, format).toMatch(/<g role="img" aria-label="Blue box"><desc>It moves from left to right<\/desc>/);
			expect(svg, format).toMatch(/<g role="button" aria-label="Play" aria-keyshortcuts="P" tabindex="1">/);
			expect(svg, format).toMatch(/<g aria-hidden="true">/);
			expect(svg, format).toMatch(/<g role="img" aria-label="Group">/);
		}
		// the player sets them at run time from its program
		const player = compile("f48-accessibility", { format: "player" });
		expect(player).toMatch(/"ac":\{"role":"button","aria-label":"Play","aria-keyshortcuts":"P","tabindex":"1"\}/);
		expect(player).toMatch(/"ad":"It moves from left to right"/);
	});

	it("a document nobody set up stays as it was; a silent one is hidden", () => {
		expect(compile("f03-transforms", { format: "smil" })).not.toMatch(/role=|<title>|aria-/);
		const silent = compile("f48-accessibility", { format: "smil" }, (m) => void (m.doc.acc = { silent: true }));
		expect(silent).toMatch(/<svg [^>]*aria-hidden="true"/);
		expect(silent).not.toMatch(/<title>/);
	});
});

describe("video components", () => {
	it("an HTML <video> in a <foreignObject> with an end tag, the file as an asset; autoplay muted", () => {
		const model: SceneModel = JSON.parse(readFileSync(new URL("../fixtures/models/f52-video-canvas.json", import.meta.url), "utf8"));
		const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };
		const out = compileScene(model, files, { format: "smil" });
		expect(out.files[0]!.svg).toMatch(/<foreignObject x="40" y="40\.05" width="239\.4" height="179\.4"><video xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" src="videos\/clip\.webm" autoplay="autoplay" muted="muted" loop="loop" playsinline="playsinline"[^>]*><\/video><\/foreignObject>/);
		expect(out.assets).toEqual([{ path: "videos/clip.webm", source: "videos/clip.webm" }]);
		// still frames don't play it
		expect(compileScene(model, files, { format: "static" }).files[0]!.svg).not.toMatch(/autoplay/);
		expect(compileScene(model, files, { format: "lottie" }).warnings.some((w) => /Videos aren't exported to Lottie/.test(w))).toBe(true);
	});
});
