import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileScene, type ExportSettings } from "../../src/core/compile.ts";
import type { SceneModel } from "../../src/core/model.ts";

function compile(name: string, settings: Partial<ExportSettings>) {
	const model: SceneModel = JSON.parse(readFileSync(new URL(`../fixtures/models/${name}.json`, import.meta.url), "utf8"));
	// the stored models come without their atlas: every artwork is a stand-in square
	const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };
	return compileScene(model, files, settings);
}

describe("CSS output", () => {
	it("gives every @keyframes an explicit end when it does not repeat", () => {
		// f12-labels ends on stop(); f02-eases is forced to play once
		for (const [name, loop] of [["f12-labels", "auto"], ["f02-eases", "never"]] as const) {
			const svg = compile(name, { format: "css", loop }).files[0]!.svg;
			const blocks = svg.match(/@keyframes [^{]+\{(?:[^{}]*\{[^}]*\})*\}/g) ?? [];
			expect(blocks.length).toBeGreaterThan(0);
			for (const b of blocks) expect(b, b).toMatch(/100%\{/);
			expect(svg).not.toMatch(/infinite/);
		}
	});

	it("holds the stop() frame: the last label's artwork stays visible", () => {
		const svg = compile("f12-labels", { format: "css" }).files[0]!.svg;
		const last = /@keyframes (\S+)\{0%\{visibility:hidden\}75%\{visibility:visible\}100%\{visibility:visible\}\}/.exec(svg);
		expect(last).not.toBeNull();
	});
});

describe("settings", () => {
	it("ignores empty or out of range number fields", () => {
		for (const format of ["smil", "css", "player", "static"] as const) {
			const out = compile("f02-eases", { format, digits: null as unknown as number, delay: Number.NaN });
			for (const f of out.files) expect(f.svg).not.toMatch(/NaN|undefined/);
		}
		const out = compile("f02-eases", { format: "smil", digits: -3, delay: -1 });
		expect(out.files[0]!.svg).not.toMatch(/NaN|begin="-/);
	});
});

describe("ids", () => {
	const ids = (svg: string) => new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));

	it("never clash between different exports, so SVGs can be inlined together", () => {
		for (const format of ["smil", "css", "player", "static"] as const) {
			const a = ids(compile("f02-eases", { format }).files[0]!.svg);
			const b = ids(compile("f12-labels", { format }).files[0]!.svg);
			expect(a.size).toBeGreaterThan(0);
			for (const id of a) expect(b.has(id), `${format}: ${id}`).toBe(false);
		}
		// different settings of the same document, and different still frames
		const smooth = ids(compile("f02-eases", { format: "smil" }).files[0]!.svg);
		const steps = ids(compile("f02-eases", { format: "smil", smooth: false }).files[0]!.svg);
		for (const id of smooth) expect(steps.has(id)).toBe(false);
		const frames = compile("f12-labels", { format: "static" }).files.map((f) => ids(f.svg));
		for (const id of frames[0]!) expect(frames[1]!.has(id)).toBe(false);
	});

	it("are deterministic and can be set explicitly", () => {
		expect(compile("f02-eases", { format: "css" }).files[0]!.svg).toBe(compile("f02-eases", { format: "css" }).files[0]!.svg);
		const svg = compile("f02-eases", { format: "smil", idPrefix: "hero-" }).files[0]!.svg;
		for (const id of ids(svg)) expect(id.startsWith("hero-")).toBe(true);
		// every reference points at an id of the document
		const all = ids(svg);
		for (const m of svg.matchAll(/(?:href="#|url\(#)([^")]+)/g)) expect(all.has(m[1]!), m[1]).toBe(true);
	});
});

describe("stop() on the root timeline", () => {
	// f28: one frame with stop(); a spinner and a pulse loop inside movie clips, an intro stops itself
	it("keeps movie clips running: SMIL loops a tail after the first pass", () => {
		const svg = compile("f28-onestop", { format: "smil" }).files[0]!.svg;
		const clock = /<animate id="([^"]+clock[^"]*)"/.exec(svg);
		expect(clock).not.toBeNull();
		const tails = svg.match(new RegExp(`begin="${clock![1]}\\.end" repeatCount="indefinite"`, "g")) ?? [];
		expect(tails.length).toBeGreaterThan(0);
		// no syncbase end before the begin: browsers would drop the tail
		expect(svg).not.toMatch(/end="[^"]*clock[^"]*\.begin"/);
		// started by a click, a new click restarts the first pass and ends the tail
		const click = compile("f28-onestop", { format: "smil", begin: "click" }).files[0]!.svg;
		expect(click).toMatch(/begin="[^"]*clock\.end" repeatCount="indefinite" end="[^"]+\.click"/);
	});

	it("keeps movie clips running: CSS adds a delayed infinite animation", () => {
		const svg = compile("f28-onestop", { format: "css" }).files[0]!.svg;
		expect(svg).toMatch(/animation:[^}]* both,[^}]*s infinite/);
	});

	it("holds everything when played once", () => {
		for (const format of ["smil", "css"] as const) {
			const svg = compile("f28-onestop", { format, loop: "never" }).files[0]!.svg;
			expect(svg).not.toMatch(/indefinite|infinite|clock/);
		}
	});
});

describe("horizon limits", () => {
	it("warns when running clips have no common period within the limit", async () => {
		const { createContext } = await import("../../src/core/context.ts");
		const { bake } = await import("../../src/core/emit/bake.ts");
		const m: SceneModel = JSON.parse(readFileSync(new URL("../fixtures/models/f28-onestop.json", import.meta.url), "utf8"));
		const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };
		const ctx = createContext(m, files, { smooth: true, includeHiddenLayers: true, includeGuides: false, digits: 2 });
		bake(ctx, m.roots[0]!, { smooth: true, loop: "auto", maxTicks: 50 } as Parameters<typeof bake>[2]);
		expect(ctx.warnings.some((w) => w.includes("loops of very different lengths"))).toBe(true);
		const ok = createContext(m, files, { smooth: true, includeHiddenLayers: true, includeGuides: false, digits: 2 });
		bake(ok, m.roots[0]!, { smooth: true, loop: "auto" } as Parameters<typeof bake>[2]);
		expect(ok.warnings.some((w) => w.includes("loops of very different lengths"))).toBe(false);
	});
});
