/**
 * MP4 and WebM from the command line: Node has no video encoder, an installed Chrome or Edge has
 * (H.264 too). The browser runs headless, driven over its DevTools protocol (Node's own WebSocket,
 * no other dependency); the frames are drawn here as for GIF and APNG and handed over as I420, the
 * page encodes them (src/core/video-codecs.ts, the panel's code) and the sounds, Node writes the file.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { AudioTrack, Sample } from "../core/mux.ts";
import type { FrameSink, VideoEncoders } from "../core/video-codecs.ts";
import { VIDEO_PAGE } from "./video-page.generated.ts";

/** A browser with WebCodecs: FLASH2SVG_BROWSER, else an installed Chrome, Edge or Chromium. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | null {
	const own = env.FLASH2SVG_BROWSER;
	if (own) return existsSync(own) ? own : null;
	const list: string[] = [];
	if (platform === "win32") {
		for (const root of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]) {
			if (!root) continue;
			list.push(join(root, "Google", "Chrome", "Application", "chrome.exe"), join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
		}
	} else if (platform === "darwin") {
		for (const app of ["Google Chrome", "Microsoft Edge", "Chromium"]) list.push(`/Applications/${app}.app/Contents/MacOS/${app}`);
	} else {
		for (const dir of (env.PATH ?? "").split(delimiter))
			for (const name of ["google-chrome", "google-chrome-stable", "microsoft-edge", "microsoft-edge-stable", "chromium", "chromium-browser"])
				list.push(join(dir, name));
	}
	return list.find((p) => existsSync(p)) ?? null;
}

interface Cdp {
	send(method: string, params?: object, sessionId?: string): Promise<Record<string, unknown>>;
	close(): void;
}

/** A DevTools protocol connection (commands and their answers; events aren't needed). */
function connect(url: string): Promise<Cdp> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		let id = 0;
		const pending = new Map<number, { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>();
		ws.onmessage = (e) => {
			const m = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
			const p = m.id !== undefined ? pending.get(m.id) : undefined;
			if (!p) return;
			pending.delete(m.id!);
			if (m.error) p.fail(new Error(m.error.message));
			else p.ok(m.result ?? {});
		};
		ws.onerror = () => reject(new Error("The browser's DevTools connection failed"));
		ws.onclose = () => {
			for (const p of pending.values()) p.fail(new Error("The browser closed"));
			pending.clear();
		};
		ws.onopen = () =>
			resolve({
				send: (method, params = {}, sessionId) =>
					new Promise((ok, fail) => {
						const n = ++id;
						pending.set(n, { ok, fail });
						ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
					}),
				close: () => ws.close(),
			});
	});
}

/** Starts the browser headless; resolves with its DevTools address once it says it. */
function launch(exe: string, profile: string): Promise<{ child: ChildProcess; url: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			exe,
			[
				"--headless=new",
				"--remote-debugging-port=0",
				`--user-data-dir=${profile}`,
				"--no-first-run",
				"--no-default-browser-check",
				// (started from an elevated shell, Chrome and Edge otherwise relaunch themselves as the
				// user and the process started here ends at once)
				"--do-not-de-elevate",
				"--disable-extensions",
				"--mute-audio",
				"about:blank",
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let text = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`The browser (${exe}) didn't start in time`));
		}, 30000);
		child.stderr!.on("data", (d: Buffer) => {
			text += d.toString();
			const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
			if (m) {
				clearTimeout(timer);
				resolve({ child, url: m[1]! });
			}
		});
		child.on("error", (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`The browser (${exe}) ended before it was ready (exit ${code})`));
		});
	});
}

const b64 = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString("base64");
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const unpack = (list: (Omit<Sample, "data"> & { data: string })[]): Sample[] => list.map((s) => ({ ...s, data: bytes(s.data) }));

/** The encoders of an installed browser, for exportVideo; `close()` ends the browser. */
export async function browserCodecs(exe = findBrowser()): Promise<VideoEncoders & { close(): Promise<void>; browser: string }> {
	if (!exe) throw new Error("MP4 and WebM need Chrome or Edge installed (their video encoders), or the panel; FLASH2SVG_BROWSER can name a browser");
	const profile = mkdtempSync(join(tmpdir(), "flash2svg-browser-"));
	let child: ChildProcess | null = null;
	let cdp: Cdp | null = null;
	let server: Server | null = null;
	let closed: Promise<void> | null = null;
	// Ends the browser and removes its profile (up to 180 MB). Waited for: a timer left behind
	// never ran, the process ended first and every export kept its profile in the temp folder.
	const close = () =>
		(closed ??= (async () => {
			const c = child;
			if (c && c.exitCode === null && c.signalCode === null) {
				const gone = new Promise<void>((done) => c.once("exit", () => done()));
				const wait = (ms: number) => Promise.race([gone, new Promise<void>((done) => setTimeout(done, ms).unref())]);
				// asked to close it ends its helper processes too, which hold the profile's files
				await cdp?.send("Browser.close").catch(() => {});
				await wait(3000);
				if (c.exitCode === null && c.signalCode === null) {
					c.kill();
					await wait(2000);
				}
			}
			cdp?.close();
			server?.close();
			try {
				rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
			} catch {
				// still held by a helper process: the system's temp clean-up takes it
			}
		})());
	try {
		const started = await launch(exe, profile);
		child = started.child;
		cdp = await connect(started.url);
		// a page of its own on this computer: WebCodecs needs a secure context, which a blank page
		// the protocol opens isn't, a local address is
		server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>flash2svg</title>"));
		await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
		const port = (server.address() as { port: number }).port;
		const { targetId } = (await cdp.send("Target.createTarget", { url: `http://127.0.0.1:${port}/` })) as { targetId: string };
		const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
		const run = async <T>(expression: string): Promise<T> => {
			const r = (await cdp!.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId)) as {
				result: { value: T };
				exceptionDetails?: { exception?: { description?: string }; text?: string };
			};
			if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "The browser's encoder failed");
			return r.result.value;
		};
		for (let i = 0; i < 200 && !(await run<boolean>("document.readyState === 'complete' && isSecureContext")); i++) await new Promise((r) => setTimeout(r, 25));
		await run(VIDEO_PAGE);
		const call = <T>(fn: string, ...args: unknown[]) => run<T>(`${fn}(${args.map((a) => JSON.stringify(a)).join(",")})`);
		return {
			browser: exe,
			close,
			pick: async (format, candidates) => JSON.parse(await call<string>("f2sPick", format, candidates)),
			async open(config): Promise<FrameSink> {
				await call("f2sOpen", config);
				return {
					encode: async (i420, width, height, timestamp, duration, key) => void (await call("f2sEncode", b64(i420), width, height, timestamp, duration, key)),
					async close() {
						const r = JSON.parse(await call<string>("f2sClose")) as { samples: (Omit<Sample, "data"> & { data: string })[]; description: string | null };
						return { samples: unpack(r.samples), ...(r.description ? { description: bytes(r.description) } : {}) };
					},
				};
			},
			async sound(schedule, seconds, format) {
				const r = await call<string | null>("f2sSound", schedule, seconds, format);
				if (!r) return null;
				const t = JSON.parse(r) as Omit<AudioTrack, "samples" | "description"> & {
					samples: (Omit<Sample, "data"> & { data: string })[];
					description: string | null;
				};
				return { ...t, samples: unpack(t.samples), ...(t.description ? { description: bytes(t.description) } : { description: undefined }) };
			},
		};
	} catch (e) {
		await close();
		throw e;
	}
}
