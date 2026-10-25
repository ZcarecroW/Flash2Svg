// Packages dist/extension:
//   dist/Flash2SVG-<version>.zip  (always; unpack into the CEP extensions folder)
//   dist/Flash2SVG-<version>.zxp  (when Adobe's ZXPSignCmd is available: signed with a self-signed
//                                  certificate, installable with ExManCmd / UPIA / Anastasiy's EM)
// ZXPSignCmd: set ZXPSIGNCMD or put it in tools/ZXPSignCmd(.exe)
// Certificate: cert/cert.p12 + cert/password.txt (created on first run if missing).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(repo, "dist", "extension");
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
if (!existsSync(join(ext, "CSXS", "manifest.xml"))) {
	console.error("Build first: npm run build");
	process.exit(1);
}

// ---------------------------------------------------------------- plain zip (no dependencies)
function zipDir(dir, out) {
	const files = [];
	const walk = (d) => {
		for (const f of readdirSync(d)) {
			const p = join(d, f);
			if (statSync(p).isDirectory()) walk(p);
			else files.push(p);
		}
	};
	walk(dir);
	const chunks = [];
	const central = [];
	let offset = 0;
	for (const f of files) {
		const name = Buffer.from(relative(dir, f).replace(/\\/g, "/"));
		const data = readFileSync(f);
		const comp = deflateRawSync(data);
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(0, 10);
		local.writeUInt32LE(crc >>> 0, 14);
		local.writeUInt32LE(comp.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		chunks.push(local, name, comp);
		const c = Buffer.alloc(46);
		c.writeUInt32LE(0x02014b50, 0);
		c.writeUInt16LE(20, 4);
		c.writeUInt16LE(20, 6);
		c.writeUInt16LE(0, 8);
		c.writeUInt16LE(8, 10);
		c.writeUInt32LE(0, 12);
		c.writeUInt32LE(crc >>> 0, 16);
		c.writeUInt32LE(comp.length, 20);
		c.writeUInt32LE(data.length, 24);
		c.writeUInt16LE(name.length, 28);
		c.writeUInt32LE(offset, 42);
		central.push(c, name);
		offset += 30 + name.length + comp.length;
	}
	const cd = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	writeFileSync(out, Buffer.concat([...chunks, cd, end]));
	return files.length;
}

const zipOut = join(repo, "dist", `Flash2SVG-${version}.zip`);
const n = zipDir(ext, zipOut);
console.log(`zip: ${zipOut} (${n} files)`);

// ---------------------------------------------------------------- signed ZXP
const candidates = [process.env.ZXPSIGNCMD, join(repo, "tools", "ZXPSignCmd.exe"), join(repo, "tools", "ZXPSignCmd")].filter(Boolean);
const signer = candidates.find((c) => existsSync(c));
if (!signer) {
	console.log("ZXPSignCmd not found: skipping the signed .zxp (set ZXPSIGNCMD to build it).");
	process.exit(0);
}
const certDir = join(repo, "cert");
mkdirSync(certDir, { recursive: true });
const cert = join(certDir, "cert.p12");
const pwFile = join(certDir, "password.txt");
if (!existsSync(cert)) {
	const pw = process.env.ZXP_PASSWORD || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
	writeFileSync(pwFile, pw);
	execFileSync(signer, ["-selfSignedCert", "US", "NA", "Flash2SVG", "Flash2SVG", pw, cert], { stdio: "inherit" });
}
const password = (process.env.ZXP_PASSWORD || readFileSync(pwFile, "utf8")).trim();
const zxp = join(repo, "dist", `Flash2SVG-${version}.zxp`);
rmSync(zxp, { force: true });
const args = ["-sign", ext, zxp, cert, password];
if (process.env.ZXP_TSA) args.push("-tsa", process.env.ZXP_TSA);
execFileSync(signer, args, { stdio: "inherit" });
console.log(`zxp: ${zxp}`);
