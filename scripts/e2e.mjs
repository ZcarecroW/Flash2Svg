// Full end-to-end run (needs Adobe Animate and Edge/Chrome):
//   1. builds the fixture FLAs (only if missing, or with --rebuild)
//   2. extracts each fixture inside Animate (+ Animate's own PNG renderings)
//   3. compares static renders with Animate's PNGs (resvg)
//   4. checks SMIL / CSS / JS player output frame by frame in the browser (smooth and --steps)
//   5. checks the JS player's API and interaction (labels, goto, loop, start modes, buttons, sounds)
//   6. inlines several exports into one HTML page (ids must not clash)
//   7. checks the Lottie output (schema; lottie-web, dotLottie, Skottie frame by frame; smooth and --steps)
//   8. runs the .lottie state machine in dotLottie (intro and tail, click start, loop, play once)
//   9. checks the start triggers "visible" and "scroll" (inline and in an <object>), scale modes, the web component
//  10. checks the GIF and WebP fallbacks frame by frame (ImageDecoder)
//  11. plays the video components (inline and in an <object>)
//  12. checks the panel's interface (tips, icons, layout, contrast, presets) without Animate
//  13. checks CSS output in browsers from before linear() easing (simulated): every animation runs
// Usage: node scripts/e2e.mjs [names] [--rebuild] [--skip-animate]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const names = args.find((a) => !a.startsWith("--"));
const run = (script, extra = []) => {
	console.log(`\n=== ${script} ${extra.join(" ")}`);
	const r = spawnSync(process.execPath, [join(repo, "scripts", script), ...extra], { stdio: "inherit", cwd: repo });
	return r.status ?? 1;
};

let failed = 0;
const flaDir = join(repo, "tests", "fixtures", "fla");
if (!args.includes("--skip-animate")) {
	const haveFixtures = existsSync(flaDir) && readdirSync(flaDir).some((f) => f.endsWith(".fla"));
	if (args.includes("--rebuild") || !haveFixtures) failed += run("build-fixtures.mjs", names ? [names] : []);
	failed += run("e2e-extract.mjs", names ? [names] : []);
}
failed += run("e2e-compare.ts", names ? [names] : []);
failed += run("e2e-browser.ts", [...(names ? [names] : []), "--formats=smil,css,player"]);
failed += run("e2e-browser.ts", [...(names ? [names] : []), "--formats=smil,css,player", "--steps"]);
if (!names) failed += run("e2e-player.ts");
if (!names) failed += run("e2e-inline.ts");
failed += run("e2e-lottie.ts", names ? [names] : []);
failed += run("e2e-lottie.ts", [...(names ? [names] : []), "--steps"]);
if (!names) failed += run("e2e-statemachine.ts");
if (!names) failed += run("e2e-triggers.ts");
if (!names) failed += run("e2e-raster.ts");
if (!names) failed += run("e2e-video.ts");
if (!names) failed += run("e2e-panel-ui.ts");
if (!names) failed += run("e2e-compat.ts");
console.log(failed ? `\nE2E: ${failed} step(s) reported failures` : "\nE2E: all good");
process.exitCode = failed ? 1 : 0;
