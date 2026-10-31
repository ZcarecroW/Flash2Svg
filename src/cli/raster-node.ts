import type { Resvg as ResvgClass } from "@resvg/resvg-wasm";
import type { Pixels, WasmLoader } from "../core/images.ts";
import { unpremultiply, type Rasterize } from "../core/raster.ts";
import { escapeAttr, isNode, parseXml, serialize, type XmlChild, type XmlNode } from "../core/xml.ts";

/** resvg's WebAssembly and its JS glue: next to the built CLI as wasm/resvg.wasm and wasm/resvg.mjs, or from node_modules. */
export const RESVG_WASM = "resvg.wasm";
export const RESVG_WASM_SOURCE = "@resvg/resvg-wasm/index_bg.wasm";
export const RESVG_GLUE = "resvg.mjs";

/**
 * resvg-wasm keeps its WebAssembly instance in module state, and a panic (see renderAround) leaks
 * what the render had allocated — WebAssembly memory never shrinks: after a few hundred panics
 * every render fails. Its glue is evaluated again for a fresh instance after each panic; the
 * compiled module is kept.
 */
function instances(load: WasmLoader) {
	let compiled: Promise<{ module: WebAssembly.Module; glue: string }> | null = null;
	let current: Promise<typeof ResvgClass> | null = null;
	const fresh = async () => {
		compiled ??= (async () => {
			const [bytes, glue] = await Promise.all([load(RESVG_WASM), load(RESVG_GLUE)]);
			return { module: await WebAssembly.compile(bytes as BufferSource), glue: new TextDecoder().decode(glue as BufferSource) };
		})();
		const { module, glue } = await compiled;
		const body = glue.replace(/export\s*\{\s*Resvg2 as Resvg,\s*initWasm\s*\};?\s*$/, "return { Resvg: Resvg2, initWasm };");
		if (body === glue) throw new Error("Unexpected resvg-wasm glue (its exports changed)");
		const api = new Function(body)() as { Resvg: typeof ResvgClass; initWasm: (m: WebAssembly.Module) => Promise<void> };
		await api.initWasm(module);
		return api.Resvg;
	};
	/** Draws (pixels, or a PNG file), or throws after setting the instance aside. */
	async function render(svg: string, width: number): Promise<Pixels>;
	async function render(svg: string, width: number, png: true): Promise<Uint8Array>;
	async function render(svg: string, width: number, png?: true): Promise<Pixels | Uint8Array> {
		const Resvg = await (current ??= fresh());
		const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
		let img;
		try {
			img = r.render();
		} catch (e) {
			// the object stays borrowed (freeing it throws), the memory it took is lost
			current = null;
			throw e;
		}
		const out = png ? img.asPng() : { data: new Uint8ClampedArray(img.pixels), width: img.width, height: img.height };
		img.free();
		r.free();
		return out;
	}
	return render;
}

/**
 * Clipped bitmap fills stretch their edge pixels with nested viewports onto a sliver of 0.02 px
 * around the pixel's centre (artwork.ts: clampedImage; exact with smoothing in browsers). resvg
 * draws such a viewport by scaling the whole bitmap up to a thousandfold — 0.7 s for a frame of
 * f42 — panics on two of them under one clip and draws none under a turned clip. For resvg each
 * piece becomes a picture of just its edge pixels (a row, a column or a corner, cut out once by
 * resvg itself), stretched with nearest sampling: the same colours, 0.1 s.
 */
async function edgeStrips(root: XmlNode, render: ReturnType<typeof instances>, crops: Map<string, string>) {
	const byId = new Map<string, XmlNode>();
	const index = (n: XmlNode) => {
		if (n.attrs.id) byId.set(n.attrs.id, n);
		for (const c of n.children) if (isNode(c)) index(c);
	};
	index(root);
	const href = (n: XmlNode) => (n.attrs["xlink:href"] ?? n.attrs.href ?? "").slice(1);
	// the picture a nested viewport shows: <use> → (<use> →)* <image>
	const imageOf = (n: XmlNode): XmlNode | null => {
		for (let i = 0, x: XmlNode | undefined = n; x && i < 8; i++) {
			if (x.name === "image") return x;
			x = x.name === "use" ? byId.get(href(x)) : x.children.find(isNode);
		}
		return null;
	};
	const visit = async (n: XmlNode) => {
		for (const [i, c] of n.children.entries()) {
			if (!isNode(c)) continue;
			if (c.name !== "svg" || c.attrs.preserveAspectRatio !== "none" || !c.attrs.viewBox) {
				await visit(c);
				continue;
			}
			const [vx, vy, vw, vh] = c.attrs.viewBox.split(" ").map(Number) as [number, number, number, number];
			const img = imageOf(c);
			if (!img || !(vw < 0.1 || vh < 0.1)) continue;
			const [x, w] = vw < 0.1 ? [Math.floor(vx + vw / 2), 1] : [vx, vw];
			const [y, h] = vh < 0.1 ? [Math.floor(vy + vh / 2), 1] : [vy, vh];
			const data = img.attrs["xlink:href"] ?? img.attrs.href ?? "";
			const key = `${x} ${y} ${w} ${h} ${data}`;
			let crop = crops.get(key);
			if (!crop) {
				const cut = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"><image xlink:href="${escapeAttr(data)}" width="${img.attrs.width}" height="${img.attrs.height}" image-rendering="optimizeSpeed"/></svg>`;
				crop = "data:image/png;base64," + Buffer.from(await render(cut, w, true)).toString("base64");
				crops.set(key, crop);
			}
			n.children[i] = {
				name: "image",
				attrs: {
					x: c.attrs.x ?? "0",
					y: c.attrs.y ?? "0",
					width: c.attrs.width!,
					height: c.attrs.height!,
					preserveAspectRatio: "none",
					"image-rendering": "optimizeSpeed",
					"xlink:href": crop,
				},
				children: [],
			};
		}
	};
	await visit(root);
}

/**
 * resvg 2.6 (and 2.7's previews) panics on some layers — a filter, clip, blend or nested viewport
 * — whose content ends up outside its canvas or empty (an unwrap of an empty intersection in
 * fit_to_rect), e.g. a filtered symbol far off stage. Such a frame is drawn without the fewest
 * parts it can't take (filters or drawn elements), found by bisection; a group left without
 * content is left out too (an empty layer panics).
 */
async function renderAround(root: XmlNode, draw: (svg: string) => Promise<Pixels>, warn: (m: string) => void): Promise<Pixels> {
	const parts: { node: XmlNode; filter: boolean }[] = [];
	const collect = (n: XmlNode) => {
		for (const c of n.children) {
			if (!isNode(c)) continue;
			if (c.attrs.filter) parts.push({ node: c, filter: true });
			// what draws: a reference, a picture, a shape, a nested viewport
			if (/^(svg|use|image|path|rect|circle|ellipse|line|polyline|polygon|text)$/.test(c.name)) parts.push({ node: c, filter: false });
			collect(c);
		}
	};
	collect(root);
	const dropped = new Set(parts.keys());
	const unfiltered = new Set<XmlNode>();
	const skipped = new Set<XmlNode>();
	const text = (c: XmlChild): string => {
		if (!isNode(c) || c.name.startsWith("#")) return serialize(c);
		if (skipped.has(c)) return "";
		let s = "<" + c.name;
		for (const k in c.attrs) if (!(k === "filter" && unfiltered.has(c))) s += ` ${k}="${escapeAttr(c.attrs[k]!)}"`;
		const inner = c.children.map(text);
		// a container whose content is all left out goes too
		if (c !== root && c.children.some(isNode) && c.children.every((ch, i) => !isNode(ch) || !inner[i])) return "";
		return s + ">" + inner.join("") + `</${c.name}>`;
	};
	const attempt = () => {
		unfiltered.clear();
		skipped.clear();
		for (const i of dropped) (parts[i]!.filter ? unfiltered : skipped).add(parts[i]!.node);
		return draw(text(root));
	};
	let out = await attempt();
	// bring parts back, a range at a time, splitting the ranges it can't take
	const restore = async (from: number, to: number) => {
		for (let i = from; i < to; i++) dropped.delete(i);
		try {
			out = await attempt();
		} catch {
			for (let i = from; i < to; i++) dropped.add(i);
			if (to - from > 1) {
				const mid = (from + to) >> 1;
				await restore(from, mid);
				await restore(mid, to);
			}
		}
	};
	await restore(0, parts.length);
	warn(`resvg could not draw ${dropped.size} part(s) of a frame (outside the stage, e.g. a filtered symbol); drawn without them`);
	return out;
}

/** SVG frames to pixels with resvg (system fonts not loaded: text comes as outlines). */
export function nodeRasterizer(load: WasmLoader, warn: (m: string) => void = () => {}): Rasterize {
	const render = instances(load);
	const crops = new Map<string, string>();
	return async (svg, width) => {
		// resvg knows SVG 1.1's nearest sampling, not CSS's "pixelated" (pixel art: no Allow smoothing)
		svg = svg.replaceAll('image-rendering="pixelated"', 'image-rendering="optimizeSpeed"');
		if (svg.includes('preserveAspectRatio="none"')) {
			const root = parseXml(svg);
			await edgeStrips(root, render, crops);
			svg = serialize(root);
		}
		let out;
		try {
			out = await render(svg, width);
		} catch {
			out = await renderAround(parseXml(svg), (s) => render(s, width), warn);
		}
		unpremultiply(out.data);
		return out;
	};
}
