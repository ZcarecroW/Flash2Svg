/**
 * Minimal bridge to the CEP host (replaces Adobe's CSInterface.js) plus Node access.
 * The panel runs with --enable-nodejs --mixed-context, so `require` is available.
 */

interface AdobeCep {
	evalScript(script: string, cb: (result: string) => void): void;
	getHostEnvironment(): string;
	getSystemPath(kind: string): string;
	addEventListener(type: string, cb: (e: unknown) => void, obj?: unknown): void;
	requestOpenExtension?(id: string, params: string): void;
	closeExtension?(): void;
}

declare global {
	interface Window {
		__adobe_cep__?: AdobeCep;
		cep?: {
			fs: {
				showSaveDialogEx(title: string, initialPath: string, types: string[], defaultName: string, friendlyFilePrefix?: string): { err: number; data: string };
				showOpenDialogEx(multi: boolean, folders: boolean, title: string, initialPath: string, types?: string[]): { err: number; data: string[] };
			};
			util: { openURLInDefaultBrowser(url: string): void };
		};
	}
}

export const inCep = typeof window !== "undefined" && !!window.__adobe_cep__;

const ERR = "__flash2svg_error__:";

/** Evaluates JSFL in Animate. Exceptions come back with their message (CEP alone only says "EvalScript error."). */
export function evalScript(script: string): Promise<string> {
	const wrapped = `(function(){try{var __r=eval(${JSON.stringify(script)});return __r===undefined||__r===null?"":String(__r);}catch(e){return ${JSON.stringify(ERR)}+e+(e&&e.lineNumber?" (line "+e.lineNumber+")":"");}})()`;
	return new Promise((resolve, reject) => {
		const cep = window.__adobe_cep__;
		if (!cep) return reject(new Error("Not running inside Adobe Animate"));
		cep.evalScript(wrapped, (r) => {
			if (r === "EvalScript error.") reject(new Error(`Animate could not run: ${script.slice(0, 120)}`));
			else if (typeof r === "string" && r.startsWith(ERR)) reject(new Error(`${r.slice(ERR.length)} — in: ${script.slice(0, 120)}`));
			else resolve(r);
		});
	});
}

/** Calls a JSFL expression and parses its JSON result. */
export async function evalJson<T>(script: string): Promise<T> {
	const r = await evalScript(script);
	try {
		return JSON.parse(r) as T;
	} catch {
		throw new Error(r || "Empty response from Animate");
	}
}

/** Folder of the installed extension as a platform path (CEP returns a file:/// URI). */
export function extensionPath(): string {
	let p = window.__adobe_cep__?.getSystemPath("extension") ?? "";
	if (p.startsWith("file:")) {
		p = decodeURIComponent(p.replace(/^file:\/\//, ""));
		if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // "/C:/Users/..." -> "C:/Users/..."
	}
	return p;
}

export function onHostEvent(type: string, cb: () => void) {
	window.__adobe_cep__?.addEventListener(type, () => cb());
}

export interface Skin {
	background: string;
	dark: boolean;
	fontSize: number;
}

export function hostSkin(): Skin | null {
	const cep = window.__adobe_cep__;
	if (!cep) return null;
	try {
		const env = JSON.parse(cep.getHostEnvironment()) as {
			appSkinInfo: { panelBackgroundColor: { color: { red: number; green: number; blue: number } }; baseFontSize: number };
		};
		const c = env.appSkinInfo.panelBackgroundColor.color;
		const hex = "#" + [c.red, c.green, c.blue].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
		return { background: hex, dark: (c.red + c.green + c.blue) / 3 < 128, fontSize: env.appSkinInfo.baseFontSize || 11 };
	} catch {
		return null;
	}
}

export function onThemeChange(cb: () => void) {
	onHostEvent("com.adobe.csxs.events.ThemeColorChanged", cb);
}

// ------------------------------------------------------------------ Node

type Req = (m: string) => unknown;
const req: Req | null = typeof (globalThis as { require?: Req }).require === "function" ? (globalThis as { require: Req }).require : null;

export const node = req
	? {
			fs: req("fs") as typeof import("node:fs"),
			path: req("path") as typeof import("node:path"),
			os: req("os") as typeof import("node:os"),
			url: req("url") as typeof import("node:url"),
			child: req("child_process") as typeof import("node:child_process"),
		}
	: null;

/** Animate JSFL wants file:/// URIs (file:///C|/folder/file on Windows). */
export function toFileUri(p: string): string {
	let s = p.replace(/\\/g, "/");
	if (/^[A-Za-z]:/.test(s)) s = "/" + s[0] + "|" + s.slice(2);
	return "file://" + encodeURI(s).replace(/#/g, "%23");
}

export function fromFileUri(uri: string): string {
	let s = decodeURI(uri.replace(/^file:\/\//, ""));
	if (/^\/[A-Za-z][|:]/.test(s)) s = s[1] + ":" + s.slice(3);
	return node?.path ? node.path.normalize(s) : s;
}

export function openInBrowser(path: string) {
	const url = node?.url.pathToFileURL(path).href ?? "file:///" + path;
	window.cep?.util.openURLInDefaultBrowser(url);
}

export function revealInExplorer(path: string) {
	if (!node) return;
	if (node.os.platform() === "win32") node.child.spawn("explorer.exe", ["/select,", path], { detached: true });
	else node.child.spawn("open", ["-R", path], { detached: true });
}
