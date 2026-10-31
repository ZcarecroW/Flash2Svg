#!/usr/bin/env node
/**
 * Builds the user guide and publishes it to the gh-pages branch, which GitHub Pages serves at
 * https://zcarecrow.github.io/Flash2Svg/ (and zcarecrow.github.io/flash2svg forwards there).
 *
 *   node docs/guide/publish.mjs
 *
 * The branch holds the built site and nothing else, as one commit replaced on every publish: the
 * pages are made from docs/guide on the main branch, so a history of them would only be a
 * second, larger copy of it. DOCS_REMOTE overrides where it goes (default: this checkout's origin).
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUIDE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(GUIDE, "..", "..");
const OUT = join(GUIDE, "dist");
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const read = (args) => {
	try {
		return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
	} catch {
		return "";
	}
};

run(process.execPath, [join(GUIDE, "build.mjs")]);
const remote = process.env.DOCS_REMOTE || read(["remote", "get-url", "origin"]);
if (!remote) throw new Error("No remote to publish to: set DOCS_REMOTE or add an origin.");
const commit = read(["rev-parse", "--short", "HEAD"]) || "a working tree";
const name = read(["config", "user.name"]) || "github-actions[bot]";
const email = read(["config", "user.email"]) || "41898282+github-actions[bot]@users.noreply.github.com";

// no Jekyll: nothing to build, and it would skip files starting with "_"
writeFileSync(join(OUT, ".nojekyll"), "");
rmSync(join(OUT, ".git"), { recursive: true, force: true });
run("git", ["init", "-q", "-b", "gh-pages"], OUT);
run("git", ["-c", "core.autocrlf=false", "add", "-A"], OUT);
run("git", ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "-c", "core.autocrlf=false", "commit", "-q", "-m", `User guide built from ${commit}`], OUT);
run("git", ["push", "-q", "-f", remote, "gh-pages"], OUT);
rmSync(join(OUT, ".git"), { recursive: true, force: true });
console.log("Published to gh-pages; GitHub Pages serves it within a minute or two.");
