/**
 * Changing Animate filters as one SVG filter whose primitives' numbers change (roadmap package 9),
 * instead of a filter per frame.
 *
 * Every filter set (the filters from one frame on, see InstanceItem.filters) is built into
 * primitives (buildFilters with `uniform`, so optional primitives are always there); consecutive
 * sets whose primitives differ only in numbers (blur, offsets, strengths, colours, matrices,
 * gradient tables) form a run, written as one filter whose changing attributes switch at the
 * frames — exactly Animate's values, which step with the frames in Animate too. (Interpolated
 * between frames, a browser draws the filter again at every refresh of the screen: measured in
 * Edge at 144 Hz, 2.8 times the rendering work of the filters demo, for a smoothness Animate
 * doesn't show.)
 */
import type { Track } from "../tracks.ts";
import { fmt } from "../geom.ts";
import type { FilterSet } from "../program.ts";
import { isNode, type XmlNode } from "../xml.ts";
import { buildFilters } from "./filters.ts";

export type { FilterSet };

/** Number attributes that change in a run: decimals they are written with (as buildFilters writes them). */
const NUMBERS: Record<string, number> = {
	stdDeviation: 3,
	dx: 3,
	dy: 3,
	slope: 3,
	k1: 3,
	k2: 3,
	k3: 3,
	k4: 3,
	values: 4,
	tableValues: 3,
	"flood-opacity": 3,
};
/** Colour attributes, as 0..255 channels. */
const COLOURS = new Set(["flood-color"]);

export interface FilterAnimation {
	/** Index path of the primitive in the filter: [i] or [i, child]. */
	path: number[];
	attr: string;
	/** 0 numbers, 1 colour (#rrggbb) */
	kind: 0 | 1;
	digits: number;
	/** one track of held keys per number (colour: r, g, b in 0..255), a key where the value changes */
	tracks: Track[];
}

export interface FilterRun {
	/** first frame (tick) of the run */
	t: number;
	/** the run's filter sets (one: a still filter) */
	sets: FilterSet[];
	/** set when numbers change inside the run: the primitives (values of the set shown at `poster`) and their changes */
	animated?: { primitives: XmlNode[]; margin: { x: number; y: number }; anims: FilterAnimation[] };
}

interface Flat {
	sig: string;
	/** changing-kind attribute values in document order: [path, attr, value] */
	vals: [number[], string, string][];
}

function flatten(prims: XmlNode[]): Flat {
	const sig: string[] = [];
	const vals: Flat["vals"] = [];
	const walk = (nodes: XmlNode[], path: number[]) => {
		nodes.forEach((n, i) => {
			const p = [...path, i];
			const parts: string[] = [n.name];
			for (const [k, s] of Object.entries(n.attrs)) {
				if (k in NUMBERS) {
					parts.push(`${k}#${s.split(/[\s,]+/).length}`);
					vals.push([p, k, s]);
				} else if (COLOURS.has(k)) {
					parts.push(k + "#");
					vals.push([p, k, s]);
				} else parts.push(`${k}=${s}`);
			}
			sig.push(parts.join(" "));
			const kids = n.children.filter(isNode);
			if (kids.length) {
				sig.push("[");
				walk(kids, p);
				sig.push("]");
			}
		});
	};
	walk(prims, []);
	return { sig: sig.join("|"), vals };
}

const nums = (s: string) => s.split(/[\s,]+/).map(Number);
const rgb = (s: string) => {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(s);
	return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [0, 0, 0];
};

/** The attribute text of an animation's numbers. */
export function filterValue(a: Pick<FilterAnimation, "kind" | "digits">, v: number[]): string {
	if (a.kind === 1)
		return (
			"#" +
			v
				.map((x) =>
					Math.max(0, Math.min(255, Math.round(x)))
						.toString(16)
						.padStart(2, "0"),
				)
				.join("")
		);
	return v.map((x) => fmt(x, a.digits)).join(" ");
}

/**
 * Splits filter sets (sorted by time, the first at the start of the instance's visibility) into
 * runs of one make-up, with the numbers that change inside each run. `poster`: the time whose
 * values the primitives show when nothing animates.
 */
export function filterRuns(sets: FilterSet[], scale: { x: number; y: number }, warn: (m: string) => void, poster: number): FilterRun[] {
	const built = sets.map((s) => (s.filters.length ? buildFilters(s.filters, scale, () => {}, true) : null));
	const flats = built.map((b) => (b ? flatten(b.primitives) : null));
	const runs: FilterRun[] = [];
	let from = 0;
	for (let i = 1; i <= sets.length; i++) {
		if (i < sets.length && flats[i] && flats[from] && flats[i]!.sig === flats[from]!.sig) continue;
		runs.push(makeRun(sets, built, flats, from, i, scale, warn, poster));
		from = i;
	}
	return runs;
}

function makeRun(
	sets: FilterSet[],
	built: (ReturnType<typeof buildFilters> | null)[],
	flats: (Flat | null)[],
	a: number,
	b: number,
	scale: { x: number; y: number },
	warn: (m: string) => void,
	poster: number,
): FilterRun {
	const run: FilterRun = { t: sets[a]!.t, sets: sets.slice(a, b) };
	if (b - a < 2 || !flats[a]) return run;
	const anims: FilterAnimation[] = [];
	flats[a]!.vals.forEach(([path, attr, v0], j) => {
		const texts = run.sets.map((_, k) => flats[a + k]!.vals[j]![2]);
		if (texts.every((s) => s === v0)) return;
		const kind = COLOURS.has(attr) ? 1 : 0;
		let values = texts.map(kind ? rgb : nums);
		// one blur for both axes where they never differ
		if (attr === "stdDeviation" && values.every((v) => v.length === 2 && v[0] === v[1])) values = values.map((v) => [v[0]!]);
		// a key where the value changes, held until the next
		const at = texts.map((s, k) => k).filter((k) => !k || texts[k] !== texts[k - 1]);
		const tracks = values[0]!.map((_, c): Track => at.map((k) => ({ t: run.sets[k]!.t, v: values[k]![c]!, ease: "hold" })));
		anims.push({ path, attr, kind, digits: kind ? 0 : NUMBERS[attr]!, tracks });
	});
	if (!anims.length) {
		run.sets = [run.sets[0]!];
		return run;
	}
	// the primitives with the poster's values (the set shown at `poster`, or the run's first)
	let p = a;
	for (let k = a; k < b; k++) if (sets[k]!.t <= poster) p = k;
	const shown = buildFilters(sets[p]!.filters, scale, warn, true);
	const margin = { x: 0, y: 0 };
	for (let k = a; k < b; k++) {
		margin.x = Math.max(margin.x, built[k]!.margin.x);
		margin.y = Math.max(margin.y, built[k]!.margin.y);
	}
	run.animated = { primitives: shown.primitives, margin, anims };
	return run;
}

/** The primitive at `path`. */
export function primitiveAt(prims: XmlNode[], path: number[]): XmlNode {
	let n = prims[path[0]!]!;
	for (const i of path.slice(1)) n = n.children.filter(isNode)[i]!;
	return n;
}
