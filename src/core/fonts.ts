/**
 * Fonts for dynamic and input text: the installed font files are found by their name tables, cut
 * down to the characters the text uses (HarfBuzz's subsetter, WebAssembly) and embedded as WOFF2
 * in an @font-face rule. The text then looks the same on every computer and stays text (selectable,
 * searchable). Fonts whose licence forbids embedding (OS/2 fsType) are left out, with a warning.
 * The font's metrics (ascent, descent, advance widths) go along, so the text is laid out like
 * Animate does: baselines from the font's ascent and descent, lines wrapped at the field's width.
 */
import type { SceneModel, TextElement } from "./model.ts";
import type { WasmLoader } from "./images.ts";

export const SUBSET_WASM = "harfbuzz-subset.wasm";
const HB_SUBSET_FLAGS_NO_HINTING = 0x1;
export const SUBSET_WASM_SOURCE = "harfbuzzjs/dist/harfbuzz-subset.wasm";

/** A font as embedded in the output, with what layout needs. */
export interface EmbeddedFont {
	/** Animate's face name, and the style the text asks for */
	face: string;
	bold: boolean;
	italic: boolean;
	/** CSS family name of the embedded copy */
	family: string;
	/** WOFF2, base64 */
	woff2: string;
	/** font units per em, ascent and descent (positive), in font units */
	upm: number;
	ascent: number;
	descent: number;
	/** advance width of each character used, in font units */
	widths: Record<string, number>;
}

/** Reads installed font files (the host's file system). */
export interface FontFiles {
	/** Font files (.ttf .otf .ttc .otc) in the font folders. */
	list(): string[];
	read(path: string, offset?: number, length?: number): Uint8Array;
}

export interface FontCodecs {
	/** The font (face `index` of a collection) cut down to these characters (sfnt). */
	subset(font: Uint8Array, index: number, codepoints: number[]): Promise<Uint8Array>;
	woff2(sfnt: Uint8Array): Promise<Uint8Array>;
}

export interface FontReport {
	face: string;
	bold: boolean;
	italic: boolean;
	/** the file used, or why none */
	file?: string;
	skipped?: string;
	chars: number;
	bytes: number;
}

// ------------------------------------------------------------------ reading sfnt

const u16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const i16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;
const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const tagAt = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

interface FaceInfo {
	file: string;
	index: number;
	/** offset of the face's table directory */
	at: number;
	names: string[];
	weight: number;
	italic: boolean;
	fsType: number;
}

/** Offsets of the faces in a font file (one, or a collection's). */
function faceOffsets(head: Uint8Array, read: (o: number, n: number) => Uint8Array): number[] {
	if (tagAt(head, 0) !== "ttcf") return [0];
	const n = u32(head, 8);
	const list = read(12, n * 4);
	return Array.from({ length: n }, (_, i) => u32(list, i * 4));
}

function tables(dir: Uint8Array, count: number): Map<string, [number, number]> {
	const t = new Map<string, [number, number]>();
	for (let i = 0; i < count; i++) t.set(tagAt(dir, i * 16), [u32(dir, i * 16 + 8), u32(dir, i * 16 + 12)]);
	return t;
}

/** Family, full and PostScript names (Windows Unicode, any language; Mac Roman as a fallback). */
function namesOf(name: Uint8Array): string[] {
	const count = u16(name, 2);
	const strings = u16(name, 4);
	const out = new Set<string>();
	for (let i = 0; i < count; i++) {
		const r = 6 + i * 12;
		const platform = u16(name, r),
			id = u16(name, r + 6),
			len = u16(name, r + 8),
			off = strings + u16(name, r + 10);
		if (id !== 1 && id !== 4 && id !== 6 && id !== 16) continue;
		let s = "";
		if (platform === 3 || platform === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(u16(name, off + k));
		else if (platform === 1) for (let k = 0; k < len; k++) s += String.fromCharCode(name[off + k]!);
		if (s) out.add(s.toLowerCase());
	}
	return [...out];
}

/** The faces of an installed font file (reads only its directory, name and OS/2 tables). */
export function readFaces(file: string, files: FontFiles): FaceInfo[] {
	const read = (o: number, n: number) => files.read(file, o, n);
	const head = read(0, 12);
	if (head.length < 12) return [];
	const out: FaceInfo[] = [];
	faceOffsets(head, read).forEach((at, index) => {
		const count = u16(read(at, 12), 4);
		const t = tables(read(at + 12, count * 16), count);
		const nameT = t.get("name");
		if (!nameT) return;
		const os2 = t.get("OS/2");
		const o = os2 ? read(os2[0], Math.min(os2[1], 64)) : null;
		const names = namesOf(read(nameT[0], nameT[1]));
		const sel = o && o.length >= 64 ? u16(o, 62) : 0;
		out.push({ file, index, at, names, weight: o ? u16(o, 4) : 400, italic: !!(sel & 1) || names.some((n) => /italic|oblique/.test(n)), fsType: o ? u16(o, 8) : 0 });
	});
	return out;
}

/** Layout metrics of a face, from the whole font file. */
function metricsOf(font: Uint8Array, at: number, chars: string[]): Pick<EmbeddedFont, "upm" | "ascent" | "descent" | "widths"> {
	const t = tables(font.subarray(at + 12), u16(font, at + 4));
	const head = t.get("head")!,
		hhea = t.get("hhea")!,
		hmtx = t.get("hmtx")!,
		os2 = t.get("OS/2");
	const upm = u16(font, head[0] + 18);
	// Windows' ascent and descent (Flash and Animate lay text out with them), else hhea's
	let ascent = i16(font, hhea[0] + 4),
		descent = -i16(font, hhea[0] + 6);
	if (os2 && os2[1] >= 78) {
		ascent = u16(font, os2[0] + 74);
		descent = u16(font, os2[0] + 76);
	}
	const metrics = u16(font, hhea[0] + 34);
	const glyph = cmapOf(font, t.get("cmap"));
	const widths: Record<string, number> = {};
	for (const c of chars) {
		const g = glyph(c.codePointAt(0)!);
		widths[c] = u16(font, hmtx[0] + 4 * Math.min(g, metrics - 1));
	}
	return { upm, ascent, descent, widths };
}

/** Character → glyph lookup from the cmap (formats 4 and 12, Windows Unicode). */
function cmapOf(font: Uint8Array, cmap: [number, number] | undefined): (cp: number) => number {
	if (!cmap) return () => 0;
	const base = cmap[0];
	let sub = -1,
		best = -1;
	for (let i = 0, n = u16(font, base + 2); i < n; i++) {
		const r = base + 4 + i * 8;
		const platform = u16(font, r),
			enc = u16(font, r + 2),
			off = base + u32(font, r + 4);
		const format = u16(font, off);
		const rank = format === 12 ? 2 : format === 4 && (platform === 3 || platform === 0) && enc !== 0 ? 1 : format === 4 ? 0 : -1;
		if (rank > best) [best, sub] = [rank, off];
	}
	if (sub < 0) return () => 0;
	if (u16(font, sub) === 12) {
		const groups = u32(font, sub + 12);
		return (cp) => {
			for (let i = 0; i < groups; i++) {
				const g = sub + 16 + i * 12;
				const start = u32(font, g),
					end = u32(font, g + 4);
				if (cp >= start && cp <= end) return u32(font, g + 8) + cp - start;
			}
			return 0;
		};
	}
	const segs = u16(font, sub + 6) / 2;
	const ends = sub + 14,
		starts = ends + segs * 2 + 2,
		deltas = starts + segs * 2,
		ranges = deltas + segs * 2;
	return (cp) => {
		if (cp > 0xffff) return 0;
		for (let i = 0; i < segs; i++) {
			if (cp > u16(font, ends + i * 2)) continue;
			const start = u16(font, starts + i * 2);
			if (cp < start) return 0;
			const ro = u16(font, ranges + i * 2);
			if (!ro) return (cp + u16(font, deltas + i * 2)) & 0xffff;
			const g = u16(font, ranges + i * 2 + ro + (cp - start) * 2);
			return g ? (g + u16(font, deltas + i * 2)) & 0xffff : 0;
		}
		return 0;
	};
}

// ------------------------------------------------------------------ matching and embedding

let index: { key: string; faces: FaceInfo[] } | null = null;

/** All installed faces (read once per list of files). */
function installed(files: FontFiles): FaceInfo[] {
	const list = files.list();
	const key = list.join("|");
	if (index?.key !== key) {
		const faces: FaceInfo[] = [];
		for (const f of list) {
			try {
				faces.push(...readFaces(f, files));
			} catch {
				// unreadable or not a font: skipped
			}
		}
		index = { key, faces };
	}
	return index.faces;
}

/** The installed face closest to Animate's face name and style, or null. */
function match(faces: FaceInfo[], face: string, bold: boolean, italic: boolean): FaceInfo | null {
	const name = face.toLowerCase();
	let best: FaceInfo | null = null,
		score = Infinity;
	for (const f of faces) {
		if (!f.names.includes(name)) continue;
		const s = Math.abs(f.weight - (bold ? 700 : 400)) + (f.italic === italic ? 0 : 1000);
		if (s < score) [best, score] = [f, s];
	}
	return best;
}

/** The characters each face/style is used with (input fields: all of printable ASCII and Latin-1 too). */
function usage(model: SceneModel): Map<string, { face: string; bold: boolean; italic: boolean; chars: Set<string> }> {
	const out = new Map<string, { face: string; bold: boolean; italic: boolean; chars: Set<string> }>();
	for (const t of Object.values(model.timelines))
		for (const l of t.layers)
			for (const k of l.keyframes)
				for (const e of k.elements) {
					if (e.kind !== "text" || e.textType === "static") continue;
					for (const r of (e as TextElement).runs) {
						const key = fontKey(r.face, r.bold, r.italic);
						let u = out.get(key);
						if (!u) out.set(key, (u = { face: r.face, bold: r.bold, italic: r.italic, chars: new Set() }));
						for (const c of r.text) if (c >= " ") u.chars.add(c);
						if (e.textType === "input") for (let cp = 0x20; cp <= 0xff; cp++) if (cp < 0x7f || cp >= 0xa0) u.chars.add(String.fromCodePoint(cp));
					}
				}
	return out;
}

export const fontKey = (face: string, bold: boolean, italic: boolean) => `${face}|${bold ? 1 : 0}|${italic ? 1 : 0}`;

const toBase64 = (b: Uint8Array) => {
	const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(e: string): string } } }).Buffer;
	if (B) return B.from(b).toString("base64");
	let s = "";
	for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
	return btoa(s);
};

/**
 * Embeds the fonts of the document's dynamic and input text (SceneModel.fonts). Faces not
 * installed, or whose licence restricts embedding, are left to the viewer's fonts (warned).
 */
export async function encodeFonts(model: SceneModel, files: FontFiles, codecs: FontCodecs): Promise<{ model: SceneModel; warnings: string[]; report: FontReport[] }> {
	const used = usage(model);
	if (!used.size) return { model, warnings: [], report: [] };
	const faces = installed(files);
	const warnings: string[] = [];
	const report: FontReport[] = [];
	const fonts: EmbeddedFont[] = [];
	const families = new Map<string, string>();
	for (const u of used.values()) {
		const style = `${u.face}${u.bold ? " bold" : ""}${u.italic ? " italic" : ""}`;
		const chars = [...u.chars];
		const f = match(faces, u.face, u.bold, u.italic);
		// fsType: 0x0002 restricted licence, 0x0200 bitmap embedding only
		const why = !f ? "not installed" : f.fsType & 0x0002 || f.fsType & 0x0200 ? "its licence doesn't allow embedding" : "";
		if (why) {
			warnings.push(`Font ${style} is not embedded (${why}): the text uses the viewer's fonts`);
			report.push({ face: u.face, bold: u.bold, italic: u.italic, skipped: why, chars: chars.length, bytes: 0 });
			continue;
		}
		const font = files.read(f!.file);
		const sub = await codecs.subset(font, f!.index, chars.map((c) => c.codePointAt(0)!));
		const woff2 = await codecs.woff2(sub);
		// one CSS family per face name: its styles are told apart by weight and style
		let family = families.get(u.face);
		if (!family) families.set(u.face, (family = `f2s-${u.face.replace(/[^\w-]+/g, "-")}`));
		fonts.push({ face: u.face, bold: u.bold, italic: u.italic, family, woff2: toBase64(woff2), ...metricsOf(font, f!.at, chars) });
		report.push({ face: u.face, bold: u.bold, italic: u.italic, file: f!.file, chars: chars.length, bytes: woff2.length });
	}
	return { model: { ...model, fonts }, warnings, report };
}

// ------------------------------------------------------------------ codecs

/** HarfBuzz's subsetter (its WebAssembly has no imports: the C API is called directly). */
export function createFontCodecs(load: WasmLoader, woff2: (sfnt: Uint8Array) => Promise<Uint8Array>): FontCodecs {
	let hb: Promise<Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory }> | null = null;
	const instance = () =>
		(hb ??= (async () => {
			const bytes = await load(SUBSET_WASM);
			const src = (await WebAssembly.instantiate((bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) as BufferSource, {})) as WebAssembly.WebAssemblyInstantiatedSource;
			return src.instance.exports as never;
		})());
	return {
		async subset(font, index, codepoints) {
			const x = await instance();
			const heap = () => new Uint8Array(x.memory.buffer);
			const ptr = x.malloc!(font.length);
			heap().set(font, ptr);
			// HB_MEMORY_MODE_WRITABLE: HarfBuzz may use the copy as it is
			const blob = x.hb_blob_create!(ptr, font.length, 2, 0, 0);
			const face = x.hb_face_create!(blob, index);
			x.hb_blob_destroy!(blob);
			const input = x.hb_subset_input_create_or_fail!();
			// no hinting: browsers smooth the outlines themselves (and Animate draws them unhinted)
			x.hb_subset_input_set_flags!(input, x.hb_subset_input_get_flags!(input) | HB_SUBSET_FLAGS_NO_HINTING);
			const set = x.hb_subset_input_unicode_set!(input);
			for (const cp of codepoints) x.hb_set_add!(set, cp);
			const out = x.hb_subset_or_fail!(face, input);
			x.hb_subset_input_destroy!(input);
			x.hb_face_destroy!(face);
			x.free!(ptr);
			if (!out) throw new Error("The font could not be subset");
			const res = x.hb_face_reference_blob!(out);
			const len = x.hb_blob_get_length!(res);
			const data = x.hb_blob_get_data!(res, 0);
			const copy = heap().slice(data, data + len);
			x.hb_blob_destroy!(res);
			x.hb_face_destroy!(out);
			return copy;
		},
		woff2,
	};
}

// ------------------------------------------------------------------ installed fonts

/** The folders installed fonts live in (Windows: system and per user; macOS: system, library, user). */
export function fontFolders(platform: string, env: Record<string, string | undefined>, home: string, join: (...p: string[]) => string): string[] {
	if (platform === "win32") return [join(env.WINDIR ?? "C:\Windows", "Fonts"), ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts")] : [])];
	if (platform === "darwin") return ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", join(home, "Library", "Fonts")];
	return ["/usr/share/fonts", "/usr/local/share/fonts", join(home, ".fonts"), join(home, ".local", "share", "fonts")];
}

/** The Node file system calls font discovery needs (the CLI's, or the CEP panel's). */
export interface FontFs {
	existsSync(p: string): boolean;
	readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
	readFileSync(p: string): Uint8Array;
	openSync(p: string, flags: string): number;
	readSync(fd: number, buf: Uint8Array, off: number, len: number, pos: number): number;
	closeSync(fd: number): void;
}

/** Installed font files (.ttf .otf .ttc .otc in the folders, three levels deep), read in parts. */
export function fontFiles(fs: FontFs, join: (...p: string[]) => string, folders: string[]): FontFiles {
	return {
		list() {
			const out: string[] = [];
			const walk = (dir: string, depth: number) => {
				if (!fs.existsSync(dir)) return;
				for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
					if (e.isDirectory() && depth < 3) walk(join(dir, e.name), depth + 1);
					else if (/\.(ttf|otf|ttc|otc)$/i.test(e.name)) out.push(join(dir, e.name));
				}
			};
			for (const f of folders) walk(f, 0);
			return out;
		},
		read(path, offset, length) {
			if (offset === undefined) return fs.readFileSync(path);
			const fd = fs.openSync(path, "r");
			try {
				const buf = new Uint8Array(length ?? 0);
				return buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, offset));
			} finally {
				fs.closeSync(fd);
			}
		},
	};
}
