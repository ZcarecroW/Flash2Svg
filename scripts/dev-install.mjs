// Installs the built extension (dist/extension) for the current user so Animate loads it from
// source builds. Unsigned extensions need CEP's PlayerDebugMode; this script only checks for it
// and prints how to enable it.
// Usage: node scripts/dev-install.mjs [--uninstall]
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(repo, "dist", "extension");
const base =
	process.platform === "win32"
		? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Adobe", "CEP", "extensions")
		: join(homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
const target = join(base, "org.flash2svg");

if (process.argv.includes("--uninstall")) {
	rmSync(target, { recursive: true, force: true });
	console.log(`Removed ${target}`);
	process.exit(0);
}
mkdirSync(base, { recursive: true });
rmSync(target, { recursive: true, force: true });
const zxpArg = process.argv.find((a) => a.startsWith("--zxp"));
if (zxpArg) {
	// Install a signed package: a ZXP is a zip with META-INF/signatures.xml; CEP checks it on load
	const zxp = zxpArg.includes("=") ? zxpArg.slice(6) : join(repo, "dist", readdirSync(join(repo, "dist")).find((f) => f.endsWith(".zxp")) ?? "missing.zxp");
	if (!existsSync(zxp)) {
		console.error("No signed .zxp found: npm run package");
		process.exit(1);
	}
	const tmpZip = join(tmpdir(), `flash2svg-${Date.now()}.zip`);
	copyFileSync(zxp, tmpZip);
	if (process.platform === "win32") {
		execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${target}' -Force`], { stdio: "inherit" });
	} else {
		execFileSync("unzip", ["-o", tmpZip, "-d", target], { stdio: "inherit" });
	}
	rmSync(tmpZip, { force: true });
	console.log(`Installed signed ${zxp} to ${target}`);
	console.log("Restart Animate, then open Window > Extensions > Flash2SVG.");
	process.exit(0);
}
if (!existsSync(join(src, "CSXS", "manifest.xml"))) {
	console.error("Build first: npm run build");
	process.exit(1);
}
cpSync(src, target, { recursive: true });
console.log(`Installed to ${target}`);

// PlayerDebugMode check (CEP 9-12)
const versions = ["9", "10", "11", "12"];
const missing = [];
for (const v of versions) {
	let on = false;
	try {
		if (process.platform === "win32") {
			const out = execFileSync("reg", ["query", `HKCU\\Software\\Adobe\\CSXS.${v}`, "/v", "PlayerDebugMode"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
			on = /PlayerDebugMode\s+REG_SZ\s+1/.test(out);
		} else {
			const out = execFileSync("defaults", ["read", `com.adobe.CSXS.${v}`, "PlayerDebugMode"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
			on = out.trim() === "1";
		}
	} catch {
		on = false;
	}
	if (!on) missing.push(v);
}
if (missing.length === versions.length) {
	console.log("\nAnimate only loads unsigned extensions with CEP debug mode enabled. To enable it, run:");
	for (const v of ["11", "12"]) {
		console.log(
			process.platform === "win32"
				? `  reg add HKCU\\Software\\Adobe\\CSXS.${v} /v PlayerDebugMode /t REG_SZ /d 1 /f`
				: `  defaults write com.adobe.CSXS.${v} PlayerDebugMode 1`,
		);
	}
	console.log("Or install a signed ZXP instead (npm run package).");
} else {
	console.log("CEP debug mode is enabled. Restart Animate, then open Window > Extensions > Flash2SVG.");
}
