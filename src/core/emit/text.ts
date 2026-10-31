import { fmt, fmtMatrix } from "../geom.ts";
import type { EmbeddedFont } from "../fonts.ts";
import type { FilterData, TextElement, TextRun } from "../model.ts";
import { el, type XmlNode } from "../xml.ts";

// Animate text fields have a 2 px gutter; the field's matrix already points inside it
const GUTTER = 2;

/** The fonts embedded for the text (OutputDoc.fonts): a face's metrics and CSS family, if embedded. */
export interface FontSet {
	get(face: string, bold: boolean, italic: boolean): EmbeddedFont | undefined;
}

interface Piece {
	r: TextRun;
	text: string;
}

/**
 * Native SVG <text> for dynamic/input text fields (selectable, searchable, smaller). With the
 * fonts embedded (fonts.ts) the text is laid out by their metrics, as Animate does: baselines
 * from the fonts' ascent and descent, multiline fields wrapped at the field's width. Without
 * them: approximations.
 */
export function textNode(t: TextElement, digits: number, fonts?: FontSet): XmlNode {
	const runs: TextRun[] = t.runs.length
		? t.runs
		: [{ text: t.text, face: "sans-serif", size: 12, fillColor: "#000000", bold: false, italic: false, alignment: "left", letterSpacing: 0, lineSpacing: 2 }];
	const first = runs[0]!;
	const anchor = first.alignment === "center" ? "middle" : first.alignment === "right" ? "end" : "start";
	const inner = t.width - 2 * GUTTER;
	const x = anchor === "middle" ? inner / 2 : anchor === "end" ? inner : 0;
	const font = (r: TextRun) => fonts?.get(r.face, r.bold, r.italic);
	const ascent = (r: TextRun) => {
		const f = font(r);
		return f ? (f.ascent * r.size) / f.upm : r.size * 0.9;
	};
	const descent = (r: TextRun) => {
		const f = font(r);
		return f ? (f.descent * r.size) / f.upm : r.size * 0.1;
	};
	const width = (r: TextRun, s: string) => {
		const f = font(r);
		if (!f) return NaN;
		let w = 0;
		for (const c of s) w += f.widths[c] ?? f.upm / 2;
		return (w * r.size) / f.upm + r.letterSpacing * [...s].length;
	};
	// lines as written (a line starts with the run it begins in: its size counts when empty)
	const hard: { pieces: Piece[]; r: TextRun }[] = [{ pieces: [], r: first }];
	for (const r of runs)
		r.text.split(/\r\n|\r|\n/).forEach((part, i) => {
			if (i > 0) hard.push({ pieces: [], r });
			if (part) hard[hard.length - 1]!.pieces.push({ r, text: part });
		});
	// multiline fields wrap at the field's width, word by word (needs every run's metrics)
	const wrap = t.multiline && runs.every((r) => font(r));
	const max = inner;
	const lines: { pieces: Piece[]; r: TextRun }[] = [];
	for (const line of hard) {
		if (!wrap) {
			lines.push(line);
			continue;
		}
		let cur: Piece[] = [];
		let w = 0;
		for (const p of line.pieces)
			for (const word of p.text.match(/\S+\s*|\s+/g) ?? []) {
				const ww = width(p.r, word.trimEnd());
				if (cur.length && w + ww > max) {
					lines.push({ pieces: cur, r: cur[0]!.r });
					cur = [];
					w = 0;
				}
				const last = cur[cur.length - 1];
				if (last && last.r === p.r) last.text += word;
				else cur.push({ r: p.r, text: word });
				w += width(p.r, word);
			}
		lines.push({ pieces: cur, r: cur[0]?.r ?? line.r });
	}
	const children: XmlNode[] = [];
	let y = 0;
	let below = 0;
	lines.forEach((line, i) => {
		const rs = line.pieces.length ? line.pieces.map((p) => p.r) : [line.r];
		const up = Math.max(...rs.map(ascent));
		y += i === 0 ? up : below + line.r.lineSpacing + up;
		below = Math.max(...rs.map(descent));
		const spans = line.pieces.map((p, k) => {
			const f = font(p.r);
			// a wrapped line doesn't end in its space
			const s = k === line.pieces.length - 1 && wrap ? p.text.trimEnd() : p.text;
			return el(
				"tspan",
				{
					"font-family": fontFamily(p.r.face, f?.family),
					"font-size": fmt(p.r.size, 2),
					fill: p.r.fillColor,
					"font-weight": p.r.bold ? "bold" : undefined,
					"font-style": p.r.italic ? "italic" : undefined,
					"letter-spacing": p.r.letterSpacing ? fmt(p.r.letterSpacing, 2) : undefined,
				},
				[s],
			);
		});
		children.push(el("tspan", { x: fmt(x, 2), y: fmt(y, 2) }, spans));
	});
	return el(
		"text",
		{
			transform: fmtMatrix(t.matrix, digits) || undefined,
			"text-anchor": anchor === "start" ? undefined : anchor,
			"xml:space": "preserve",
			// the instance name, for page scripts (not an id: names repeat across keyframes and
			// copies, and needn't be valid ids)
			"data-name": t.name || undefined,
			"aria-hidden": t.acc?.silent ? "true" : undefined,
			"aria-label": !t.acc?.silent && t.acc?.name ? t.acc.name : undefined,
		},
		children,
	);
}

/**
 * What a text field shows besides its letters, around its node: "Show border around text" (a
 * white field with a black outline, behind the text), a link set on its text (SVG links outlines
 * only as a whole: one per field) and its filters, in the parent's orientation as a symbol's.
 * `filter` makes the filter reference (OutputDoc.filter).
 */
export function textField(
	t: TextElement,
	node: XmlNode | null,
	digits: number,
	filter: (fs: FilterData[], size: { w: number; h: number }) => string | null,
	warn: (m: string) => void,
): XmlNode | null {
	if (!node) return node;
	let out = node;
	if (t.border) {
		// the outline on the field's edge pixels (the matrix points inside the gutter)
		const box = el("rect", {
			transform: fmtMatrix(t.matrix, digits) || undefined,
			x: fmt(0.5 - GUTTER, 2),
			y: fmt(0.5 - GUTTER, 2),
			width: fmt(t.width - 1, 2),
			height: fmt(t.height - 1, 2),
			fill: "#FFFFFF",
			stroke: "#000000",
		});
		out = el("g", {}, [box, out]);
	}
	const urls = [...new Set(t.runs.map((r) => r.url).filter((u): u is string => !!u))];
	if (urls.length) {
		if (urls.length > 1) warn(`The text "${t.text.slice(0, 30)}" links to ${urls.length} addresses: the whole field links to the first`);
		out = el("a", { "xlink:href": urls[0], target: t.runs.find((r) => r.url === urls[0])?.target }, [out]);
	}
	const fs = (t.filters ?? []).filter((f) => f.enabled);
	const ref = fs.length ? filter(fs, { w: t.bounds.width, h: t.bounds.height }) : null;
	return ref ? el("g", { filter: ref }, [out]) : out;
}

/** True if the field needs textField's additions. */
export const hasFieldExtras = (t: TextElement) => !!(t.border || t.runs.some((r) => r.url) || t.filters?.some((f) => f.enabled));

/**
 * Text drawn as outlines keeps its words for assistive technology (Flash reads static text too):
 * an image labelled with the text, or with the Accessibility panel's name; hidden when "Make
 * object accessible" is off.
 */
export function outlineText<N extends XmlNode | null>(t: TextElement, node: N): N | XmlNode {
	if (!node) return node;
	if (t.acc?.silent) return el("g", { "aria-hidden": "true" }, [node]);
	const words = (t.acc?.name || t.text).replace(/\s+/g, " ").trim();
	return words ? el("g", { role: "img", "aria-label": words }, [node]) : node;
}

function fontFamily(face: string, embedded?: string): string {
	const generic = /mono|courier/i.test(face) ? "monospace" : /serif|times|georgia/i.test(face) && !/sans/i.test(face) ? "serif" : "sans-serif";
	return `${embedded ? `'${embedded}', ` : ""}'${face.replace(/'/g, "")}', ${generic}`;
}
