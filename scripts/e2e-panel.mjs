// Panel test inside Animate, start to finish: builds the self-test panel, signs it (needs Adobe's
// ZXPSignCmd, see package-zxp.mjs; no CEP debug mode needed), installs it for the current user,
// runs panel-selftest.mjs and removes the extension again (it starts with Animate). Finally checks
// that Animate still opens documents without the extension (see the note in selftest.ts).
// Usage: node scripts/e2e-panel.mjs   (Animate must not be running)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runJsfl } from "./lib/animate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (script, args = []) => spawnSync(process.execPath, [join(repo, "scripts", script), ...args], { stdio: "inherit", cwd: repo }).status ?? 1;
const uri = (p) => "file:///" + p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1|");

/** Animate quits when a saved workspace holds an open panel of a removed extension: make sure it doesn't. */
async function animateStillOpensDocuments() {
	const dir = mkdtempSync(join(tmpdir(), "f2s-check-"));
	const log = join(dir, "log.txt");
	const fla = join(repo, "tests", "fixtures", "fla", "f02-eases.fla");
	writeFileSync(
		join(dir, "check.jsfl"),
		`var d = fl.openDocument(${JSON.stringify(uri(fla))});\n` +
			`if (d) { fl.closeDocument(d, false); var n = fl.createDocument("timeline"); FLfile.write(${JSON.stringify(uri(log))}, n ? "ok" : "no new document"); }\n` +
			`fl.quit(false);\n`,
	);
	await runJsfl(join(dir, "check.jsfl"));
	const ok = existsSync(log) && readFileSync(log, "utf8") === "ok";
	rmSync(dir, { recursive: true, force: true });
	return ok;
}

let status = run("build.mjs", ["--selftest"]) || run("package-zxp.mjs");
const signed = existsSync(join(repo, "dist")) && readdirSync(join(repo, "dist")).some((f) => f.endsWith(".zxp"));
if (!status && !signed) {
	console.error("No signed .zxp: put Adobe's ZXPSignCmd into tools/zxpsign/ (or set ZXPSIGNCMD).");
	status = 1;
}
if (!status) {
	try {
		status = run("dev-install.mjs", ["--zxp"]) || run("panel-selftest.mjs");
	} finally {
		run("dev-install.mjs", ["--uninstall"]);
		run("build.mjs");
	}
	if (await animateStillOpensDocuments()) console.log("Animate opens documents without the extension: ok");
	else {
		console.error("Animate can no longer open documents without the extension (its saved workspace still has the panel open).");
		status = 1;
	}
}
process.exitCode = status;
