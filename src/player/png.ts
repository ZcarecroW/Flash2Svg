/**
 * A PNG read at once (browsers decode pictures asynchronously; Flash Player has a library bitmap's
 * pixels as soon as a script asks): zlib inflate and PNG's filters, 8-bit grey, RGB, palette, grey
 * with alpha and RGBA, not interlaced. Returns ARGB pixels, or null for what it doesn't read.
 */

/** zlib's inflate (RFC 1950/1951): stored, fixed and dynamic Huffman blocks. */
export function inflate(src: Uint8Array): Uint8Array {
	let pos = 2, // (the zlib header)
		bit = 0,
		out = new Uint8Array(src.length * 4 + 1024),
		n = 0;
	const need = (k: number) => {
		if (n + k <= out.length) return;
		const grown = new Uint8Array(Math.max(out.length * 2, n + k));
		grown.set(out);
		out = grown;
	};
	const bits = (k: number) => {
		let v = 0;
		for (let i = 0; i < k; i++) {
			v |= ((src[pos]! >> bit) & 1) << i;
			if (++bit === 8) {
				bit = 0;
				pos++;
			}
		}
		return v;
	};
	/** A Huffman table: counts per length and the symbols in order. */
	const table = (lengths: ArrayLike<number>) => {
		const counts = new Uint16Array(16),
			offs = new Uint16Array(16);
		for (let i = 0; i < lengths.length; i++) counts[lengths[i]!]!++;
		counts[0] = 0;
		for (let i = 1; i < 16; i++) offs[i] = offs[i - 1]! + counts[i - 1]!;
		const syms = new Uint16Array(lengths.length);
		for (let i = 0; i < lengths.length; i++) if (lengths[i]) syms[offs[lengths[i]!]!++] = i;
		return { counts, syms };
	};
	const decode = (t: { counts: Uint16Array; syms: Uint16Array }) => {
		let code = 0,
			first = 0,
			index = 0;
		for (let len = 1; len < 16; len++) {
			code |= bits(1);
			const c = t.counts[len]!;
			if (code - c < first) return t.syms[index + (code - first)]!;
			index += c;
			first = (first + c) << 1;
			code <<= 1;
		}
		throw new Error("bad code");
	};
	const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
	const LEXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
	const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
	const DEXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
	const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
	let fixedL: ReturnType<typeof table> | null = null,
		fixedD: ReturnType<typeof table> | null = null;
	for (let last = 0; !last; ) {
		last = bits(1);
		const type = bits(2);
		if (type === 0) {
			if (bit) {
				bit = 0;
				pos++;
			}
			const len = src[pos]! | (src[pos + 1]! << 8);
			pos += 4;
			need(len);
			out.set(src.subarray(pos, pos + len), n);
			n += len;
			pos += len;
			continue;
		}
		let lt: ReturnType<typeof table>, dt: ReturnType<typeof table>;
		if (type === 1) {
			if (!fixedL) {
				const l = new Uint8Array(288);
				l.fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288);
				fixedL = table(l);
				fixedD = table(new Uint8Array(30).fill(5));
			}
			lt = fixedL;
			dt = fixedD!;
		} else if (type === 2) {
			const hlit = bits(5) + 257,
				hdist = bits(5) + 1,
				hclen = bits(4) + 4;
			const cl = new Uint8Array(19);
			for (let i = 0; i < hclen; i++) cl[ORDER[i]!] = bits(3);
			const ct = table(cl);
			const lens = new Uint8Array(hlit + hdist);
			for (let i = 0; i < hlit + hdist; ) {
				const s = decode(ct);
				if (s < 16) lens[i++] = s;
				else {
					const [rep, val] = s === 16 ? [3 + bits(2), lens[i - 1]!] : s === 17 ? [3 + bits(3), 0] : [11 + bits(7), 0];
					lens.fill(val, i, i + rep);
					i += rep;
				}
			}
			lt = table(lens.subarray(0, hlit));
			dt = table(lens.subarray(hlit));
		} else throw new Error("bad block");
		for (;;) {
			const s = decode(lt);
			if (s < 256) {
				need(1);
				out[n++] = s;
			} else if (s === 256) break;
			else {
				const len = LBASE[s - 257]! + bits(LEXTRA[s - 257]!);
				const ds = decode(dt);
				const dist = DBASE[ds]! + bits(DEXTRA[ds]!);
				need(len);
				for (let i = 0; i < len; i++, n++) out[n] = out[n - dist]!;
			}
		}
	}
	return out.subarray(0, n);
}

/** ARGB pixels of a PNG file's bytes, or null. */
export function decodePng(b: Uint8Array): { w: number; h: number; px: Uint32Array } | null {
	if (b[0] !== 0x89 || b[1] !== 0x50) return null;
	const u32 = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
	let w = 0,
		h = 0,
		depth = 0,
		type = 0,
		laced = 0;
	let pal: Uint8Array | null = null,
		trns: Uint8Array | null = null;
	const idat: Uint8Array[] = [];
	for (let i = 8; i + 8 <= b.length; ) {
		const len = u32(i),
			kind = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
		const data = b.subarray(i + 8, i + 8 + len);
		if (kind === "IHDR") {
			w = u32(i + 8);
			h = u32(i + 12);
			depth = data[8]!;
			type = data[9]!;
			laced = data[12]!;
		} else if (kind === "PLTE") pal = data;
		else if (kind === "tRNS") trns = data;
		else if (kind === "IDAT") idat.push(data);
		else if (kind === "IEND") break;
		i += 12 + len;
	}
	const channels = [1, 0, 3, 1, 2, 0, 4][type] ?? 0;
	if (depth !== 8 || laced || !channels || !w || !h) return null;
	const all = new Uint8Array(idat.reduce((s, d) => s + d.length, 0));
	let at = 0;
	for (const d of idat) {
		all.set(d, at);
		at += d.length;
	}
	let raw: Uint8Array;
	try {
		raw = inflate(all);
	} catch {
		return null;
	}
	// the filters, line by line
	const bpp = channels,
		stride = w * bpp;
	const cur = new Uint8Array(stride),
		prev = new Uint8Array(stride);
	const px = new Uint32Array(w * h);
	for (let y = 0; y < h; y++) {
		const f = raw[y * (stride + 1)]!;
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? cur[x - bpp]! : 0,
				up = prev[x]!,
				c = x >= bpp ? prev[x - bpp]! : 0;
			let v = line[x]!;
			if (f === 1) v += a;
			else if (f === 2) v += up;
			else if (f === 3) v += (a + up) >> 1;
			else if (f === 4) {
				const p = a + up - c,
					pa = Math.abs(p - a),
					pb = Math.abs(p - up),
					pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
			}
			cur[x] = v;
		}
		for (let x = 0; x < w; x++) {
			const o = x * bpp;
			let r: number, g: number, bl: number, al: number;
			if (type === 6) [r, g, bl, al] = [cur[o]!, cur[o + 1]!, cur[o + 2]!, cur[o + 3]!];
			else if (type === 2) [r, g, bl, al] = [cur[o]!, cur[o + 1]!, cur[o + 2]!, 255];
			else if (type === 3) {
				const k = cur[o]!;
				[r, g, bl, al] = [pal?.[k * 3] ?? 0, pal?.[k * 3 + 1] ?? 0, pal?.[k * 3 + 2] ?? 0, trns?.[k] ?? 255];
			} else if (type === 4) [r, g, bl, al] = [cur[o]!, cur[o]!, cur[o]!, cur[o + 1]!];
			else [r, g, bl, al] = [cur[o]!, cur[o]!, cur[o]!, 255];
			px[y * w + x] = ((al << 24) | (r << 16) | (g << 8) | bl) >>> 0;
		}
		prev.set(cur);
	}
	return { w, h, px };
}
