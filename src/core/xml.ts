/**
 * Minimal XML tree, parser and serializer. Good enough for the SVG Animate writes and for
 * everything we generate; avoids depending on DOMParser so the compiler runs in Node and CEP alike.
 */

export interface XmlNode {
	name: string;
	attrs: Record<string, string>;
	children: XmlChild[];
}
export type XmlChild = XmlNode | string;

export function el(name: string, attrs: Record<string, string | number | undefined | null> = {}, children: XmlChild[] = []): XmlNode {
	const a: Record<string, string> = {};
	for (const k in attrs) {
		const v = attrs[k];
		if (v !== undefined && v !== null && v !== "") a[k] = String(v);
	}
	return { name, attrs: a, children };
}

export function isNode(c: XmlChild | undefined): c is XmlNode {
	return typeof c === "object" && c !== null;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
	if (s.indexOf("&") < 0) return s;
	return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
		if (e[0] === "#") {
			const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e] ?? m;
	});
}

// What XML can't hold, not even as a character reference: control characters, unpaired
// surrogates, U+FFFE/FFFF (an author's label, name or text can have them). Left out.
const NOT_XML = /[\0-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const xmlChars = (s: string) => s.replace(NOT_XML, "");

// one scan for the common case of nothing to escape (path data, numbers)
export function escapeText(s: string): string {
	return /[&<>\0-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF\uFFFE\uFFFF]/.test(s) ? xmlChars(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : s;
}
export function escapeAttr(s: string): string {
	return /[&<"\n\0-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF\uFFFE\uFFFF]/.test(s)
		? xmlChars(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;")
		: s;
}

/** Parses an XML document and returns its root element. Comments, PIs and doctype are dropped. */
export function parseXml(src: string): XmlNode {
	let i = 0;
	const n = src.length;
	const root: XmlNode = { name: "#root", attrs: {}, children: [] };
	const stack: XmlNode[] = [root];

	const top = () => stack[stack.length - 1]!;

	while (i < n) {
		const lt = src.indexOf("<", i);
		if (lt < 0) {
			pushText(src.slice(i));
			break;
		}
		if (lt > i) pushText(src.slice(i, lt));
		if (src.startsWith("<!--", lt)) {
			const end = src.indexOf("-->", lt + 4);
			i = end < 0 ? n : end + 3;
			continue;
		}
		if (src.startsWith("<![CDATA[", lt)) {
			const end = src.indexOf("]]>", lt + 9);
			top().children.push(src.slice(lt + 9, end < 0 ? n : end));
			i = end < 0 ? n : end + 3;
			continue;
		}
		if (src[lt + 1] === "?" || src[lt + 1] === "!") {
			const end = src.indexOf(">", lt);
			i = end < 0 ? n : end + 1;
			continue;
		}
		if (src[lt + 1] === "/") {
			const end = src.indexOf(">", lt);
			const name = src.slice(lt + 2, end).trim();
			// pop to the matching element (tolerates sloppy input)
			for (let s = stack.length - 1; s > 0; s--) {
				if (stack[s]!.name === name) {
					stack.length = s;
					break;
				}
			}
			i = end + 1;
			continue;
		}
		// start tag
		let j = lt + 1;
		while (j < n && !/[\s/>]/.test(src[j]!)) j++;
		const node: XmlNode = { name: src.slice(lt + 1, j), attrs: {}, children: [] };
		// attributes
		for (;;) {
			while (j < n && /\s/.test(src[j]!)) j++;
			const c = src[j];
			if (c === ">" || c === "/" || c === undefined) break;
			let k = j;
			while (k < n && !/[\s=/>]/.test(src[k]!)) k++;
			const attrName = src.slice(j, k);
			while (k < n && /\s/.test(src[k]!)) k++;
			if (src[k] === "=") {
				k++;
				while (k < n && /\s/.test(src[k]!)) k++;
				const q = src[k];
				if (q === '"' || q === "'") {
					const end = src.indexOf(q, k + 1);
					node.attrs[attrName] = decode(src.slice(k + 1, end));
					j = end + 1;
				} else {
					let e = k;
					while (e < n && !/[\s>]/.test(src[e]!)) e++;
					node.attrs[attrName] = decode(src.slice(k, e));
					j = e;
				}
			} else {
				node.attrs[attrName] = "";
				j = k;
			}
		}
		top().children.push(node);
		if (src[j] === "/") {
			i = src.indexOf(">", j) + 1;
		} else {
			stack.push(node);
			i = j + 1;
		}
	}

	function pushText(t: string) {
		if (!t) return;
		top().children.push(decode(t));
	}

	const first = root.children.find(isNode);
	if (!first) throw new Error("No XML element found");
	return first;
}

export interface SerializeOptions {
	pretty?: boolean;
}

/** A CDATA section (used for scripts and styles so they work both as .svg and inline in HTML). */
export function cdata(text: string): XmlNode {
	return { name: "#cdata", attrs: {}, children: [text] };
}

export function serialize(node: XmlChild, opts: SerializeOptions = {}, depth = 0): string {
	if (typeof node === "string") return escapeText(node);
	// already serialized markup (see OutputDoc.toString)
	if (node.name === "#raw") return String(node.children[0] ?? "");
	if (node.name === "#cdata")
		return (
			"<![CDATA[" +
			xmlChars(String(node.children[0] ?? ""))
				.split("]]>")
				.join("]]]]><![CDATA[>") +
			"]]>"
		);
	const ind = opts.pretty ? "\n" + "  ".repeat(depth) : "";
	let s = ind + "<" + node.name;
	for (const k in node.attrs) s += " " + k + '="' + escapeAttr(node.attrs[k]!) + '"';
	if (!node.children.length) return s + "/>";
	s += ">";
	let hasElements = false;
	for (const c of node.children) {
		if (typeof c !== "string") hasElements = true;
		s += serialize(c, opts, depth + 1);
	}
	if (opts.pretty && hasElements) s += "\n" + "  ".repeat(depth);
	return s + "</" + node.name + ">";
}

/** Removes whitespace-only text children (recursively), except inside text-like elements. */
export function stripWhitespace(node: XmlNode): XmlNode {
	if (node.name === "text" || node.name === "tspan" || node.name === "style" || node.name === "script") return node;
	node.children = node.children.filter((c) => typeof c !== "string" || c.trim() !== "");
	for (const c of node.children) if (isNode(c)) stripWhitespace(c);
	return node;
}

export function walk(node: XmlNode, fn: (n: XmlNode, parent: XmlNode | null) => void, parent: XmlNode | null = null): void {
	fn(node, parent);
	for (const c of node.children) if (isNode(c)) walk(c, fn, node);
}

export function clone(node: XmlNode): XmlNode {
	return {
		name: node.name,
		attrs: { ...node.attrs },
		children: node.children.map((c) => (typeof c === "string" ? c : clone(c))),
	};
}
