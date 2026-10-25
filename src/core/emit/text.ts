import { fmt, fmtMatrix } from "../geom.ts";
import type { TextElement } from "../model.ts";
import { el, type XmlNode } from "../xml.ts";

const GUTTER = 2; // Animate text fields have a 2px gutter

/** Native SVG <text> for dynamic/input text fields (selectable, searchable, smaller). */
export function textNode(t: TextElement, digits: number): XmlNode {
	const runs = t.runs.length ? t.runs : [{ text: t.text, face: "sans-serif", size: 12, fillColor: "#000000", bold: false, italic: false, alignment: "left", letterSpacing: 0, lineSpacing: 2 }];
	const first = runs[0]!;
	const anchor = first.alignment === "center" ? "middle" : first.alignment === "right" ? "end" : "start";
	const x = anchor === "middle" ? t.width / 2 : anchor === "end" ? t.width - GUTTER : GUTTER;
	// split runs into lines
	const lines: { spans: XmlNode[]; size: number; spacing: number }[] = [{ spans: [], size: first.size, spacing: first.lineSpacing }];
	for (const r of runs) {
		const parts = r.text.split(/\r\n|\r|\n/);
		parts.forEach((part, i) => {
			if (i > 0) lines.push({ spans: [], size: r.size, spacing: r.lineSpacing });
			const line = lines[lines.length - 1]!;
			line.size = Math.max(line.size, r.size);
			if (!part) return;
			line.spans.push(
				el(
					"tspan",
					{
						"font-family": fontFamily(r.face),
						"font-size": fmt(r.size, 2),
						fill: r.fillColor,
						"font-weight": r.bold ? "bold" : undefined,
						"font-style": r.italic ? "italic" : undefined,
						"letter-spacing": r.letterSpacing ? fmt(r.letterSpacing, 2) : undefined,
					},
					[part],
				),
			);
		});
	}
	const children: XmlNode[] = [];
	let y = GUTTER;
	lines.forEach((line, i) => {
		y += i === 0 ? line.size * 0.9 : line.size + line.spacing;
		children.push(el("tspan", { x: fmt(x, 2), y: fmt(y, 2) }, line.spans));
	});
	return el(
		"text",
		{
			transform: fmtMatrix(t.matrix, digits) || undefined,
			"text-anchor": anchor === "start" ? undefined : anchor,
			"xml:space": "preserve",
			id: t.name || undefined,
		},
		children,
	);
}

function fontFamily(face: string): string {
	const generic = /mono|courier/i.test(face) ? "monospace" : /serif|times|georgia/i.test(face) && !/sans/i.test(face) ? "serif" : "sans-serif";
	return `'${face.replace(/'/g, "")}', ${generic}`;
}
