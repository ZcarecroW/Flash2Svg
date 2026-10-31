import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// the command line compiler from source (Node runs the TypeScript directly)
const cli = new URL("../../src/cli/flash2svg.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const run = (...args: string[]) => {
	const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
	return { code: r.status, out: r.stdout, err: r.stderr };
};

let dir = "";
let scene = "";
beforeAll(() => {
	// a stored model with its artwork: every atlas item a square
	dir = mkdtempSync(join(tmpdir(), "f2s-cli-"));
	const model = JSON.parse(readFileSync(new URL("../fixtures/models/f12-labels.json", import.meta.url), "utf8"));
	const modelDir = join(dir, "model");
	mkdirSync(join(modelDir, "atlas"), { recursive: true });
	for (const a of Object.values(model.atlas) as { file: string }[])
		writeFileSync(join(modelDir, a.file), `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#336699" d="M0 0L5 0 5 5 0 5Z"/></svg>`);
	scene = join(modelDir, "scene.json");
	writeFileSync(scene, JSON.stringify(model));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("command line", () => {
	it("prints its help without arguments and with --help", () => {
		for (const args of [[], ["--help"], ["-h"]]) {
			const r = run(...args);
			expect(r.code).toBe(0);
			expect(r.out).toContain("--format");
		}
	});

	it("writes next to the scene folder by default and says what the size is made of", () => {
		const r = run(scene);
		expect(r.code).toBe(0);
		expect(existsSync(join(dir, "f12-labels.svg"))).toBe(true);
		expect(r.out).toMatch(/1 file\(s\), [\d.]+ KB/);
		expect(r.out).toMatch(/drawing [\d.]+ KB/);
	});

	it("creates missing folders and takes paths with spaces and non-ASCII letters", () => {
		const target = join(dir, "neu Ordner", "ä ö & ü", "Grüße.svg");
		const r = run(scene, "-o", target, "--format=css");
		expect(r.code).toBe(0);
		expect(readFileSync(target, "utf8")).toMatch(/^<\?xml|^<svg/);
	});

	it("names Lottie and dotLottie files by their format", () => {
		expect(run(scene, "--format", "lottie", "-o", join(dir, "anim")).code).toBe(0);
		expect(existsSync(join(dir, "anim.json"))).toBe(true);
		expect(run(scene, "--format", "dotlottie", "-o", join(dir, "anim")).code).toBe(0);
		expect(existsSync(join(dir, "anim.lottie"))).toBe(true);
		expect(run(scene, "--format", "static", "--svgz", "-o", join(dir, "still.svg")).code).toBe(0);
		// one file per frame
		expect(existsSync(join(dir, "still_1.svgz"))).toBe(true);
	});

	it("writes one file per root (several library symbols), also as GIF, and keeps names apart", () => {
		// the scene data of an export of two library symbols: their timelines are the roots
		const model = JSON.parse(readFileSync(new URL("../fixtures/models/f28-onestop.json", import.meta.url), "utf8"));
		const libDir = join(dir, "lib");
		mkdirSync(join(libDir, "atlas"), { recursive: true });
		for (const a of Object.values(model.atlas) as { file: string }[])
			writeFileSync(join(libDir, a.file), `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#cc3300" d="M0 0L9 0 9 9 0 9Z"/></svg>`);
		model.roots = ["sym:spin8", "sym:pulse6"];
		const libScene = join(libDir, "scene.json");
		writeFileSync(libScene, JSON.stringify(model));
		const svg = run(libScene, "-o", join(dir, "icons.svg"));
		expect(svg.code, svg.err).toBe(0);
		const a = readFileSync(join(dir, "icons_spin8.svg"), "utf8"),
			b = readFileSync(join(dir, "icons_pulse6.svg"), "utf8");
		expect(a).not.toBe(b);
		// GIF and WebP drew the first root into every file
		const gif = run(libScene, "--format", "gif", "-o", join(dir, "icons.gif"));
		expect(gif.code, gif.err).toBe(0);
		expect(readFileSync(join(dir, "icons_spin8.gif")).equals(readFileSync(join(dir, "icons_pulse6.gif")))).toBe(false);
	}, 60000);

	it("keeps to the frame range in GIF and WebP", () => {
		// a spinning square: every frame differs (identical neighbours merge into one frame)
		const model = JSON.parse(readFileSync(new URL("../fixtures/models/f28-onestop.json", import.meta.url), "utf8"));
		const spinDir = join(dir, "spin");
		mkdirSync(join(spinDir, "atlas"), { recursive: true });
		for (const a of Object.values(model.atlas) as { file: string }[])
			writeFileSync(join(spinDir, a.file), `<svg xmlns="http://www.w3.org/2000/svg"><path fill="#cc3300" d="M0 0L9 0 9 9 0 9Z"/></svg>`);
		model.roots = ["sym:spin8"];
		const spin = join(spinDir, "scene.json");
		writeFileSync(spin, JSON.stringify(model));
		const all = run(spin, "--format", "gif", "-o", join(dir, "all.gif"));
		const one = run(spin, "--format", "gif", "--frames", "3-3", "-o", join(dir, "one.gif"));
		expect(all.code, all.err).toBe(0);
		expect(one.code, one.err).toBe(0);
		// GIF frames start with an image descriptor after a graphic control extension
		const frames = (f: string) => readFileSync(join(dir, f)).toString("latin1").split("!ù").length - 1;
		expect(frames("one.gif")).toBe(1);
		expect(frames("all.gif")).toBeGreaterThan(1);
	}, 60000);

	it("writes into a folder given as -o", () => {
		const folder = join(dir, "into folder");
		mkdirSync(folder, { recursive: true });
		expect(run(scene, "-o", folder).code).toBe(0);
		expect(existsSync(join(folder, "f12-labels.svg"))).toBe(true);
		expect(run(scene, "-o", join(dir, "new folder") + "/", "--format", "lottie").code).toBe(0);
		expect(existsSync(join(dir, "new folder", "f12-labels.json"))).toBe(true);
	});

	it("rejects wrong options with a message, not a stack trace", () => {
		const cases: [string[], RegExp][] = [
			[[scene, "--bogus"], /Unknown option --bogus/],
			[[scene, "--format"], /Missing value for --format/],
			[[scene, "--format", "png"], /--format expects one of/],
			[[scene, "--frames", "0-5"], /--frames expects/],
			[[scene, "--frames", "5-3"], /--frames expects/],
			[[scene, "--frames", "x"], /--frames expects/],
			[[scene, "--digits", "7"], /--digits expects an integer from 0 to 6/],
			[[scene, "--digits", "1.5"], /--digits expects an integer/],
			[[scene, "--delay", "-1"], /--delay expects a number/],
			[[scene, "--image-quality", "0"], /--image-quality expects an integer from 1 to 100/],
			[[scene, "--image-resolution", "0.1"], /--image-resolution expects 0 or a number from 0.25 to 8/],
			[[scene, "--image-mode", "logo.png"], /--image-mode expects/],
			[[scene, "--sound-bitrate", "1000"], /--sound-bitrate expects/],
			[[scene, "--id-prefix", "1abc"], /--id-prefix expects/],
			[["--format", "css"], /No scene.json given/],
		];
		for (const [args, message] of cases) {
			const r = run(...args);
			expect(r.code, args.join(" ")).toBe(1);
			expect(r.err, args.join(" ")).toMatch(message);
			expect(r.err).not.toMatch(/\n\s+at /);
		}
	});

	it("explains input that isn't a scene model", () => {
		const missing = run(join(dir, "nope", "scene.json"));
		expect(missing.code).toBe(1);
		expect(missing.err).toMatch(/error: .*(no such file|not found)/i);
		const broken = join(dir, "broken.json");
		writeFileSync(broken, "{ not json");
		expect(run(broken).err).toMatch(/error: .*scene\.json|JSON/i);
		const other = join(dir, "other.json");
		writeFileSync(other, JSON.stringify({ name: "package", version: "1.0.0" }));
		expect(run(other).err).toMatch(/error: .*not a Flash2SVG scene model/i);
		const newer = join(dir, "newer.json");
		writeFileSync(newer, JSON.stringify({ ...JSON.parse(readFileSync(scene, "utf8")), version: 99 }));
		expect(run(newer).err).toMatch(/error: .*newer/i);
	});
});
