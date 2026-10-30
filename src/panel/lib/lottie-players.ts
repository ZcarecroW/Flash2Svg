/**
 * The Lottie players of the panel's preview, each its own bundle loaded on first use
 * (panel/lottie-web.js, panel/dotlottie.js; entry points src/panel/lottie-web-entry.ts,
 * dotlottie-entry.ts): the panel starts without them.
 */
import type { DotLottie } from "@lottiefiles/dotlottie-web";
import type { LottiePlayer } from "lottie-web";
import { extensionPath, node } from "./cep.ts";

function bundle<T>(file: string, global: string): () => Promise<T> {
	let p: Promise<T> | null = null;
	return () => {
		p ??= new Promise<T>((resolve, reject) => {
			const script = document.createElement("script");
			script.src = file;
			script.onload = () => {
				const g = (window as unknown as Record<string, T | undefined>)[global];
				if (g) resolve(g);
				else reject(new Error(`panel/${file} did not load`));
			};
			script.onerror = () => reject(new Error(`panel/${file} is missing`));
			document.head.appendChild(script);
		});
		p.catch(() => (p = null));
		return p;
	};
}

const lottieWebBundle = bundle<{ lottie: LottiePlayer }>("lottie-web.js", "Flash2SvgLottieWeb");
const dotLottieBundle = bundle<{ DotLottie: typeof DotLottie }>("dotlottie.js", "Flash2SvgDotLottie");

export async function lottieWeb(): Promise<LottiePlayer> {
	return (await lottieWebBundle()).lottie;
}

let wasmUrl = "";
/** dotlottie-web with its WebAssembly from wasm/ (it would fetch it from a CDN). */
export async function dotLottie(): Promise<typeof DotLottie> {
	const { DotLottie } = await dotLottieBundle();
	if (!wasmUrl && node) {
		const bytes = new Uint8Array(node.fs.readFileSync(node.path.join(extensionPath(), "wasm", "dotlottie-player.wasm")));
		wasmUrl = URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
		DotLottie.setWasmUrl(wasmUrl);
	}
	return DotLottie;
}
