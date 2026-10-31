/**
 * Shortest path data for output. Inside the compiler, drawings keep simple absolute data
 * (M, L, Q, C, Z; compactPath in artwork.ts), which morphs, bounds, 9-slice scaling and the Lottie
 * writer parse. When the SVG is written (xml.ts serialize), each path is rewritten with the
 * shortest form of every segment: relative or absolute, H/V for straight lines along an axis,
 * T/S where a curve's first control point mirrors the previous one, implicit command letters,
 * no closing line before Z.
 *
 * Nothing moves: the numbers are taken on the grid of the decimals they were written with (as
 * integers), so relative steps are exact differences of the same rounded points, and T/S are
 * used only where the mirrored point is exactly the one written. Measured on the test documents:
 * path data about 45 % shorter, the files about a quarter smaller after Brotli.
 */

/** Path data compactPath can write: absolute M, L, Q, C, Z and plain decimals. */
const PLAIN = /^[MLQCZ\d.\s,-]*$/;
const TOKEN = /[MLQCZ]|-?(?:\d+\.?\d*|\.\d+)/g;
const ARITY: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };

interface Seg {
	c: "M" | "L" | "Q" | "C" | "Z";
	/** absolute coordinates, as integers on the grid of 10^-k */
	p: number[];
}

const cache = new Map<string, string>();

export function minifyPath(d: string): string {
	const hit = cache.get(d);
	if (hit !== undefined) return hit;
	const out = minify(d);
	// drawings are serialized more than once (sizes, de-duplication, the file): keep recent ones
	if (cache.size > 20000) cache.clear();
	cache.set(d, out);
	return out;
}

function minify(d: string): string {
	if (!PLAIN.test(d)) return d;
	const tokens = d.match(TOKEN);
	if (!tokens) return d;
	// the grid: as many decimals as the most precise number has
	let k = 0;
	for (const t of tokens) {
		const dot = t.indexOf(".");
		if (dot >= 0) k = Math.max(k, t.length - dot - 1);
	}
	if (k > 9) return d;
	const scale = 10 ** k;

	// segments with absolute integer coordinates
	const segs: Seg[] = [];
	let cmd = "";
	for (let i = 0; i < tokens.length;) {
		const t = tokens[i]!;
		const c = t.charCodeAt(0);
		if (c >= 65) {
			cmd = t;
			i++;
			if (cmd === "Z") segs.push({ c: "Z", p: [] });
			continue;
		}
		if (!cmd || cmd === "Z") return d;
		const n = ARITY[cmd]!;
		if (i + n > tokens.length) return d;
		const p: number[] = [];
		for (let j = 0; j < n; j++) {
			const v = tokens[i + j]!;
			if (v.charCodeAt(v.length - 1) >= 65) return d;
			p.push(Math.round(parseFloat(v) * scale));
		}
		i += n;
		segs.push({ c: cmd as Seg["c"], p });
		// coordinates after a moveto are lines
		if (cmd === "M") cmd = "L";
	}

	// a straight line back to the start just before Z: Z draws it
	for (let i = 0, start = -1; i < segs.length; i++) {
		const s = segs[i]!;
		if (s.c === "M") start = i;
		else if (s.c === "Z" && start >= 0 && i - start >= 4) {
			const last = segs[i - 1]!,
				m = segs[start]!;
			if (last.c === "L" && last.p[0] === m.p[0] && last.p[1] === m.p[1]) {
				segs.splice(i - 1, 1);
				i--;
			}
		}
	}

	const num = (n: number): string => {
		if (k === 0 || n === 0) return String(n);
		const neg = n < 0;
		let s = String(neg ? -n : n);
		if (s.length <= k) s = "0".repeat(k - s.length + 1) + s;
		const ip = s.slice(0, s.length - k);
		const fp = s.slice(s.length - k).replace(/0+$/, "");
		const r = fp ? (ip === "0" ? "" : ip) + "." + fp : ip;
		return neg ? "-" + r : r;
	};

	let out = "";
	// the last number written (separators), and the command a bare number would continue
	let last = "";
	let implicit = "";
	let x = 0,
		y = 0,
		sx = 0,
		sy = 0;
	// the previous curve's last control point, for T and S
	let ctrlX = 0,
		ctrlY = 0;
	let prevKind = "";

	/** Text of `nums` after the number `prev` ("" after a command letter). */
	const join = (nums: number[], prev: string): [string, string] => {
		let s = "";
		for (const n of nums) {
			const t = num(n);
			if (prev && t[0] !== "-" && !(t[0] === "." && prev.indexOf(".") >= 0)) s += " ";
			s += t;
			prev = t;
		}
		return [s, prev];
	};
	/** The shortest of the options [letter, numbers], written. */
	const emit = (options: [string, number[]][]) => {
		let best = "",
			bestLast = "",
			bestLetter = "";
		for (const [letter, nums] of options) {
			const bare = letter === implicit;
			const [s, l] = join(nums, bare ? last : "");
			const text = (bare ? "" : letter) + s;
			if (!best || text.length < best.length) {
				best = text;
				bestLast = l;
				bestLetter = letter;
			}
		}
		out += best;
		last = bestLast;
		implicit = bestLetter === "M" ? "L" : bestLetter === "m" ? "l" : bestLetter;
	};

	for (let i = 0; i < segs.length; i++) {
		const s = segs[i]!,
			p = s.p;
		switch (s.c) {
			case "M": {
				const [nx, ny] = p as [number, number];
				// the first moveto counts from 0,0 either way: keep it absolute
				emit(
					i === 0
						? [["M", [nx, ny]]]
						: [
								["M", [nx, ny]],
								["m", [nx - x, ny - y]],
							],
				);
				x = sx = nx;
				y = sy = ny;
				prevKind = "";
				break;
			}
			case "L": {
				const [nx, ny] = p as [number, number];
				const opts: [string, number[]][] = [
					["L", [nx, ny]],
					["l", [nx - x, ny - y]],
				];
				if (ny === y) opts.push(["H", [nx]], ["h", [nx - x]]);
				if (nx === x) opts.push(["V", [ny]], ["v", [ny - y]]);
				emit(opts);
				x = nx;
				y = ny;
				prevKind = "";
				break;
			}
			case "Q": {
				const [cx, cy, nx, ny] = p as [number, number, number, number];
				const mirrored = prevKind === "Q" ? cx === 2 * x - ctrlX && cy === 2 * y - ctrlY : cx === x && cy === y;
				const opts: [string, number[]][] = [
					["Q", [cx, cy, nx, ny]],
					["q", [cx - x, cy - y, nx - x, ny - y]],
				];
				if (mirrored) opts.push(["T", [nx, ny]], ["t", [nx - x, ny - y]]);
				emit(opts);
				ctrlX = cx;
				ctrlY = cy;
				x = nx;
				y = ny;
				prevKind = "Q";
				break;
			}
			case "C": {
				const [ax, ay, bx, by, nx, ny] = p as [number, number, number, number, number, number];
				const mirrored = prevKind === "C" ? ax === 2 * x - ctrlX && ay === 2 * y - ctrlY : ax === x && ay === y;
				const opts: [string, number[]][] = [
					["C", [ax, ay, bx, by, nx, ny]],
					["c", [ax - x, ay - y, bx - x, by - y, nx - x, ny - y]],
				];
				if (mirrored) opts.push(["S", [bx, by, nx, ny]], ["s", [bx - x, by - y, nx - x, ny - y]]);
				emit(opts);
				ctrlX = bx;
				ctrlY = by;
				x = nx;
				y = ny;
				prevKind = "C";
				break;
			}
			case "Z":
				out += "z";
				last = "";
				// a number can't follow Z: the next command is written
				implicit = "";
				x = sx;
				y = sy;
				prevKind = "";
				break;
		}
	}
	return out;
}
