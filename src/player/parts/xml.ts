/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AS3's XML and XMLList (E4X), for the documents whose scripts use them. Parsing, printing and the
 * whitespace rules are Flash Player's (f94 compares them line by line): text is trimmed and
 * whitespace-only text, comments and processing instructions are left out; printing indents by two
 * spaces and keeps an element with only text on one line.
 *
 * An XML or XMLList object is a Proxy: what isn't one of its methods is a child by that name
 * (`x.item`, `x.item[0]`), as in E4X. The compiled code reaches attributes, descendants and filters
 * through the helpers (`$r.xa`, `$r.xd`, `$r.xf`...).
 *
 * Namespaces as Flash Player has them (f95): an unqualified name finds elements of no namespace and
 * of the default xml namespace, `ns::name` those of `ns`; `name()` is a QName (`uri::local`);
 * printing puts the attributes first, then the namespaces (all those in scope at what is printed).
 */

/** Node kinds, in nodeKind()'s words. */
const ELEMENT = 1,
	ATTRIBUTE = 2,
	TEXT = 3,
	COMMENT = 4,
	PI = 5;
const KINDS = ["", "element", "attribute", "text", "comment", "processing-instruction"];

class XNode {
	_k: number;
	/** Its local name; the prefix it was written with; its namespace. */
	_name: string;
	_px = "";
	_uri = "";
	/** The namespaces it declares: [prefix, uri] ("" the default). */
	_ns: [string, string][] | null = null;
	_v = "";
	_attrs: XNode[] = [];
	_kids: XNode[] = [];
	_up: XNode | null = null;
	constructor(k: number, name = "", v = "") {
		this._k = k;
		this._name = name;
		this._v = v;
	}
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export default function xml(L: any): Record<string, unknown> {
	const { fail } = L;
	const settings = { ignoreComments: true, ignoreProcessingInstructions: true, ignoreWhitespace: true, prettyPrinting: true, prettyIndent: 2 };
	const bad = (id: number, text: string) => fail(TypeError, id, text);
	/** The default xml namespace (default xml namespace = ...). */
	let dns = "";
	const qname = (n: XNode) => (n._px ? `${n._px}:${n._name}` : n._name);
	/** The namespace a prefix stands for at a node ("" the default one), or undefined. */
	const lookup = (n: XNode | null, px: string): string | undefined => {
		for (let x = n; x; x = x._up) for (const [p, u] of x._ns ?? []) if (p === px) return u;
		return px === "" ? "" : px === "xml" ? "http://www.w3.org/XML/1998/namespace" : undefined;
	};
	/** The namespaces in scope at a node, the nearer declaration of a prefix winning (outermost first). */
	const inScope = (n: XNode): [string, string][] => {
		const chain: XNode[] = [];
		for (let x: XNode | null = n; x; x = x._up) chain.unshift(x);
		const m = new Map<string, string>();
		for (const x of chain) for (const [p, u] of x._ns ?? []) m.set(p, u);
		return [...m];
	};

	// ------------------------------------------------------------------ parsing

	const unescape = (s: string) =>
		s.indexOf("&") < 0
			? s
			: s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENTITIES[e] ?? m)));

	/** The nodes of a piece of XML text (more than one at the top level is a list). */
	function parse(src: string): XNode[] {
		const top = new XNode(ELEMENT);
		const open: XNode[] = [top];
		let i = 0;
		const n = src.length;
		const text = (s: string, cdata = false) => {
			const t = settings.ignoreWhitespace && !cdata ? s.trim() : s;
			if (!t) return;
			const node = new XNode(TEXT, "", cdata ? t : unescape(t));
			node._up = open[open.length - 1]!;
			node._up._kids.push(node);
		};
		while (i < n) {
			const lt = src.indexOf("<", i);
			if (lt < 0) {
				text(src.slice(i));
				break;
			}
			if (lt > i) text(src.slice(i, lt));
			const up = open[open.length - 1]!;
			if (src.startsWith("<!--", lt)) {
				const e = src.indexOf("-->", lt + 4);
				if (e < 0) throw bad(1091, "XML parser failure: Unterminated comment.");
				if (!settings.ignoreComments) {
					const c = new XNode(COMMENT, "", src.slice(lt + 4, e));
					c._up = up;
					up._kids.push(c);
				}
				i = e + 3;
			} else if (src.startsWith("<![CDATA[", lt)) {
				const e = src.indexOf("]]>", lt + 9);
				if (e < 0) throw bad(1092, "XML parser failure: Unterminated CDATA section.");
				text(src.slice(lt + 9, e), true);
				i = e + 3;
			} else if (src.startsWith("<?", lt)) {
				const e = src.indexOf("?>", lt + 2);
				if (e < 0) throw bad(1097, "XML parser failure: Unterminated processing instruction.");
				const body = src.slice(lt + 2, e);
				const name = /^[^\s]+/.exec(body)?.[0] ?? "";
				if (!settings.ignoreProcessingInstructions && name.toLowerCase() !== "xml") {
					const p = new XNode(PI, name, body.slice(name.length).trim());
					p._up = up;
					up._kids.push(p);
				}
				i = e + 2;
			} else if (src.startsWith("<!", lt)) {
				// (a DOCTYPE: left out, with what it says inside [ ])
				let depth = 0,
					j = lt + 2;
				for (; j < n; j++) {
					if (src[j] === "[") depth++;
					else if (src[j] === "]") depth--;
					else if (src[j] === ">" && depth <= 0) break;
				}
				i = j + 1;
			} else if (src[lt + 1] === "/") {
				const e = src.indexOf(">", lt);
				if (e < 0) throw bad(1090, "XML parser failure: element is malformed.");
				const name = src.slice(lt + 2, e).trim();
				const want = open.length < 2 ? name : qname(up);
				if (open.length < 2 || want !== name) throw bad(1085, `The element type "${want}" must be terminated by the matching end-tag "</${want}>".`);
				open.pop();
				i = e + 1;
			} else {
				const m = /^<([^\s/>]+)/.exec(src.slice(lt, lt + 256));
				if (!m) throw bad(1090, "XML parser failure: element is malformed.");
				const el = new XNode(ELEMENT, m[1]!);
				el._up = up;
				let j = lt + m[0].length;
				for (;;) {
					while (j < n && /\s/.test(src[j]!)) j++;
					if (j >= n) throw bad(1090, "XML parser failure: element is malformed.");
					if (src[j] === ">" || src.startsWith("/>", j)) break;
					const a = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(j, j + 65536));
					if (!a) throw bad(1090, "XML parser failure: element is malformed.");
					const value = unescape(a[3] ?? a[4] ?? "");
					if (a[1] === "xmlns" || a[1]!.startsWith("xmlns:")) (el._ns ??= []).push([a[1] === "xmlns" ? "" : a[1]!.slice(6), value]);
					else {
						const at = new XNode(ATTRIBUTE, a[1]!, value);
						at._up = el;
						el._attrs.push(at);
					}
					j += a[0].length;
				}
				// (prefixes resolved once its own declarations are known)
				for (const x of [el, ...el._attrs]) {
					const c = x._name.indexOf(":");
					if (c > 0) {
						x._px = x._name.slice(0, c);
						x._name = x._name.slice(c + 1);
					}
					const uri = x._k === ATTRIBUTE && !x._px ? "" : lookup(el, x._px);
					if (uri === undefined) throw bad(1083, `The prefix "${x._px}" for element "${x._name}" is not bound.`);
					x._uri = uri;
				}
				up._kids.push(el);
				if (src[j] === ">") {
					open.push(el);
					i = j + 1;
				} else i = j + 2;
			}
		}
		if (open.length > 1) {
			const name = open[open.length - 1]!._name;
			throw bad(1085, `The element type "${name}" must be terminated by the matching end-tag "</${name}>".`);
		}
		for (const k of top._kids) k._up = null;
		return top._kids;
	}

	// ------------------------------------------------------------------ printing

	const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;").replace(/\t/g, "&#x9;");

	/** `root`: what is printed starts here: the namespaces in scope are declared on it. */
	function print(node: XNode, level: number, root = level === 0): string {
		const pretty = settings.prettyPrinting;
		const pad = pretty ? " ".repeat(level * settings.prettyIndent) : "";
		switch (node._k) {
			case TEXT:
				return pad + escText(pretty ? node._v.trim() : node._v);
			case ATTRIBUTE:
				return pad + escAttr(node._v);
			case COMMENT:
				return `${pad}<!--${node._v}-->`;
			case PI:
				return `${pad}<?${node._name} ${node._v}?>`;
		}
		const name = qname(node);
		const decl = (root ? inScope(node) : (node._ns ?? [])).map(([p, u]) => ` xmlns${p ? `:${p}` : ""}="${escAttr(u)}"`).join("");
		const head = `${pad}<${name}${node._attrs.map((a) => ` ${qname(a)}="${escAttr(a._v)}"`).join("")}${decl}`;
		const kids = node._kids;
		if (!kids.length) return `${head}/>`;
		// (only text inside: one line)
		if (kids.length === 1 && kids[0]!._k === TEXT) return `${head}>${escText(kids[0]!._v)}</${name}>`;
		if (!pretty) return `${head}>${kids.map((k) => print(k, 0, false)).join("")}</${name}>`;
		return `${head}>\n${kids.map((k) => print(k, level + 1, false)).join("\n")}\n${pad}</${name}>`;
	}

	const simple = (node: XNode) => (node._k === ELEMENT ? !node._kids.some((k) => k._k === ELEMENT) : node._k === TEXT || node._k === ATTRIBUTE);
	/** What a node says as a String: its text, or itself as XML. */
	const text = (node: XNode): string =>
		node._k === ELEMENT
			? simple(node)
				? node._kids
						.filter((k) => k._k === TEXT)
						.map((k) => k._v)
						.join("")
				: print(node, 0)
			: node._v;

	const copyNode = (node: XNode): XNode => {
		const c = new XNode(node._k, node._name, node._v);
		c._px = node._px;
		c._uri = node._uri;
		// (a copy keeps the namespaces it was in)
		if (node._k === ELEMENT) c._ns = node._up ? inScope(node) : (node._ns?.slice() ?? null);
		for (const a of node._attrs) {
			const ca = copyNode(a);
			ca._up = c;
			c._attrs.push(ca);
		}
		for (const k of node._kids) {
			const ck = copyNode(k);
			ck._up = c;
			c._kids.push(ck);
		}
		return c;
	};
	const same = (a: XNode, b: XNode): boolean =>
		a._k === b._k &&
		a._name === b._name &&
		a._uri === b._uri &&
		a._v === b._v &&
		a._attrs.length === b._attrs.length &&
		a._attrs.every((x) => b._attrs.some((y) => y._name === x._name && y._v === x._v)) &&
		a._kids.length === b._kids.length &&
		a._kids.every((x, i) => same(x, b._kids[i]!));

	// ------------------------------------------------------------------ objects

	/** One XML object for each node, as in Flash Player (x.item[0] === x.item[0]). */
	const objects = new WeakMap<XNode, any>();
	const matches = (n: XNode, name: string) => name === "*" || n._name === name;
	/** An element by name: unqualified (uri undefined) of no namespace or the default one; else of `uri`. */
	const isElement = (x: XNode, name: string, uri?: string) => x._k === ELEMENT && (name === "*" || x._name === name) && (uri === undefined ? name === "*" || x._uri === "" || x._uri === dns : x._uri === uri);
	const isAttr = (x: XNode, name: string, uri?: string) => (name === "*" || x._name === name) && (uri === undefined ? name === "*" || x._uri === "" : x._uri === uri);
	/** A name an XML method is given: text, or a QName. */
	const nameOf = (q: any): [string, string | undefined] => (q instanceof QNameClass ? [q.localName, q.uri] : [String(q), undefined]);

	/** Nodes of a value an XML method is given: an XML, a list, or text that is parsed. */
	function nodesOf(v: any): XNode[] {
		if (v instanceof XMLClass) return [v._n];
		if (v instanceof XMLListClass) return v._l;
		if (v === null || v === undefined) return [];
		const s = String(v);
		return /^\s*</.test(s) ? parse(s) : [new XNode(TEXT, "", s)];
	}
	function adopt(parent: XNode, list: XNode[], at: number) {
		const fresh = list.map((k) => (k._up ? copyNode(k) : k));
		for (const k of fresh) k._up = parent;
		parent._kids.splice(at, 0, ...fresh);
	}

	/** The children of the nodes in a list by name, in order (attributes with @); `uri`: of that namespace. */
	function childrenOf(nodes: XNode[], name: string, uri?: string): XNode[] {
		const out: XNode[] = [];
		if (name[0] === "@") {
			const a = name.slice(1);
			for (const n of nodes) for (const x of n._attrs) if (isAttr(x, a, uri)) out.push(x);
		} else for (const n of nodes) for (const x of n._kids) if (name === "*" && uri === undefined ? true : isElement(x, name, uri)) out.push(x);
		return out;
	}
	function descendantsOf(nodes: XNode[], name: string, uri?: string): XNode[] {
		const out: XNode[] = [];
		const attr = name[0] === "@" ? name.slice(1) : null;
		const walk = (n: XNode) => {
			for (const k of n._kids) {
				if (k._k !== ELEMENT) {
					if (!attr && name === "*" && uri === undefined) out.push(k);
					continue;
				}
				if (attr !== null) {
					for (const a of k._attrs) if (isAttr(a, attr, uri)) out.push(a);
				} else if (isElement(k, name, uri)) out.push(k);
				walk(k);
			}
		};
		for (const n of nodes) walk(n);
		return out;
	}

	/** Setting a child by name, as E4X does: the first one's content is replaced, the others go; none: a new one. */
	function setChild(node: XNode, name: string, v: any) {
		if (node._k !== ELEMENT) return;
		if (name[0] === "@") {
			const a = name.slice(1);
			const s = v instanceof XMLListClass ? v._l.map(text).join(" ") : String(v);
			const at = node._attrs.find((x) => x._name === a && !x._uri);
			if (at) at._v = s;
			else {
				const x = new XNode(ATTRIBUTE, a, s);
				x._up = node;
				node._attrs.push(x);
			}
			return;
		}
		const list = node._kids.filter((k) => isElement(k, name));
		const content = v instanceof XMLClass || v instanceof XMLListClass ? nodesOf(v).map(copyNode) : [new XNode(TEXT, "", String(v))];
		if (!list.length) {
			const el = new XNode(ELEMENT, name);
			adopt(el, content, 0);
			adopt(node, [el], node._kids.length);
			return;
		}
		const first = list[0]!;
		// (an XML value takes the element's place; text becomes its content)
		if (v instanceof XMLClass && content[0]?._k === ELEMENT) {
			const at = node._kids.indexOf(first);
			first._up = null;
			node._kids.splice(at, 1);
			adopt(node, content, at);
		} else {
			for (const k of first._kids) k._up = null;
			first._kids = [];
			adopt(first, content, 0);
		}
		for (const extra of list.slice(1)) {
			extra._up = null;
			node._kids.splice(node._kids.indexOf(extra), 1);
		}
	}
	function remove(n: XNode) {
		const up = n._up;
		if (!up) return;
		const arr = n._k === ATTRIBUTE ? up._attrs : up._kids;
		const i = arr.indexOf(n);
		if (i >= 0) arr.splice(i, 1);
		n._up = null;
	}

	/** Property access on an XML or XMLList: methods stay methods, other names are children. */
	const handler = (isList: boolean): ProxyHandler<any> => ({
		get(t, k, r) {
			if (typeof k === "symbol" || k in t) return Reflect.get(t, k, r);
			if (/^\d+$/.test(k)) {
				const n = isList ? t._l[+k] : +k === 0 ? t._n : undefined;
				return n ? wrap(n) : undefined;
			}
			return list(childrenOf(isList ? t._l : [t._n], k));
		},
		set(t, k, v) {
			if (typeof k === "symbol" || k in t) {
				t[k] = v;
				return true;
			}
			const nodes: XNode[] = isList ? t._l : [t._n];
			if (/^\d+$/.test(k)) {
				const old = nodes[+k];
				// (not XML: the item keeps its name and gets the value as its content, as E4X does)
				if (old && !(v instanceof XMLClass || v instanceof XMLListClass)) {
					if (old._k === ELEMENT) {
						for (const c of old._kids) c._up = null;
						old._kids = [];
						adopt(old, [new XNode(TEXT, "", String(v))], 0);
					} else old._v = String(v);
					return true;
				}
				if (old?._up) {
					const up = old._up;
					const at = up._kids.indexOf(old);
					old._up = null;
					up._kids.splice(at, 1);
					adopt(up, nodesOf(v), at);
				}
				return true;
			}
			if (nodes.length === 1) setChild(nodes[0]!, k, v);
			return true;
		},
		deleteProperty(t, k) {
			if (typeof k === "symbol") return true;
			const nodes: XNode[] = isList ? t._l : [t._n];
			if (/^\d+$/.test(k)) {
				const n = nodes[+k];
				if (n) {
					remove(n);
					if (isList) t._l.splice(+k, 1);
				}
			} else for (const n of childrenOf(nodes, k)) remove(n);
			return true;
		},
		has(t, k) {
			if (typeof k === "symbol" || k in t) return true;
			const nodes: XNode[] = isList ? t._l : [t._n];
			return /^\d+$/.test(k) ? +k < nodes.length : childrenOf(nodes, k).length > 0;
		},
		ownKeys(t) {
			return isList ? t._l.map((_: unknown, i: number) => String(i)) : ["0"];
		},
		getOwnPropertyDescriptor(t, k) {
			const nodes: XNode[] = isList ? t._l : [t._n];
			if (typeof k === "string" && /^\d+$/.test(k) && +k < nodes.length) return { value: wrap(nodes[+k]!), enumerable: true, configurable: true, writable: true };
			return Reflect.getOwnPropertyDescriptor(t, k);
		},
	});
	const xmlHandler = handler(false);
	const listHandler = handler(true);

	function wrap(n: XNode): any {
		let o = objects.get(n);
		if (!o) {
			const t = Object.create(XMLClass.prototype);
			t._n = n;
			objects.set(n, (o = new Proxy(t, xmlHandler)));
		}
		return o;
	}
	function list(nodes: XNode[]): any {
		const t = Object.create(XMLListClass.prototype);
		t._l = nodes;
		return new Proxy(t, listHandler);
	}

	/** What an XMLList and an XML (a list of one) can both do. */
	const shared = {
		attribute(this: any, q: any) {
			const [name, uri] = nameOf(q);
			return list(childrenOf(this._nodes(), `@${name}`, uri));
		},
		attributes(this: any) {
			return list(childrenOf(this._nodes(), "@*"));
		},
		child(this: any, q: any) {
			if (typeof q === "number") return list(this._nodes().flatMap((n: XNode) => (n._kids[q] ? [n._kids[q]!] : [])));
			const [name, uri] = nameOf(q);
			return list(childrenOf(this._nodes(), name, uri));
		},
		children(this: any) {
			return list(childrenOf(this._nodes(), "*"));
		},
		elements(this: any, q: any = "*") {
			const [name, uri] = nameOf(q);
			return list(this._nodes().flatMap((n: XNode) => n._kids.filter((k) => k._k === ELEMENT && (name === "*" && uri === undefined ? true : isElement(k, name, uri)))));
		},
		descendants(this: any, q: any = "*") {
			const [name, uri] = nameOf(q);
			return list(descendantsOf(this._nodes(), name, uri));
		},
		text(this: any) {
			return list(this._nodes().flatMap((n: XNode) => n._kids.filter((k) => k._k === TEXT)));
		},
		comments(this: any) {
			return list(this._nodes().flatMap((n: XNode) => n._kids.filter((k) => k._k === COMMENT)));
		},
		processingInstructions(this: any, name = "*") {
			return list(this._nodes().flatMap((n: XNode) => n._kids.filter((k) => k._k === PI && matches(k, name))));
		},
		hasOwnProperty(this: any, name: string) {
			return childrenOf(this._nodes(), name).length > 0;
		},
		toXMLString(this: any) {
			return this._nodes()
				.map((n: XNode) => print(n, 0))
				.join("\n");
		},
	};

	class XMLClass {
		declare _n: XNode;
		static get ignoreComments() {
			return settings.ignoreComments;
		}
		static set ignoreComments(v: boolean) {
			settings.ignoreComments = !!v;
		}
		static get ignoreProcessingInstructions() {
			return settings.ignoreProcessingInstructions;
		}
		static set ignoreProcessingInstructions(v: boolean) {
			settings.ignoreProcessingInstructions = !!v;
		}
		static get ignoreWhitespace() {
			return settings.ignoreWhitespace;
		}
		static set ignoreWhitespace(v: boolean) {
			settings.ignoreWhitespace = !!v;
		}
		static get prettyPrinting() {
			return settings.prettyPrinting;
		}
		static set prettyPrinting(v: boolean) {
			settings.prettyPrinting = !!v;
		}
		static get prettyIndent() {
			return settings.prettyIndent;
		}
		static set prettyIndent(v: number) {
			settings.prettyIndent = v | 0;
		}
		static settings() {
			return { ...settings };
		}
		static setSettings(o?: Record<string, unknown>) {
			Object.assign(settings, o ?? { ignoreComments: true, ignoreProcessingInstructions: true, ignoreWhitespace: true, prettyPrinting: true, prettyIndent: 2 });
		}
		static defaultSettings() {
			return { ignoreComments: true, ignoreProcessingInstructions: true, ignoreWhitespace: true, prettyPrinting: true, prettyIndent: 2 };
		}
		/** XML(value): an XML is itself, text is parsed. */
		static $from(v: any) {
			if (v instanceof XMLClass) return v;
			if (v instanceof XMLListClass) {
				if (v._l.length !== 1) throw bad(1088, "The markup in the document following the root element must be well-formed.");
				return wrap(v._l[0]!);
			}
			return new XMLClass(v);
		}
		constructor(v: any = "") {
			if (v instanceof XMLClass) return wrap(copyNode(v._n));
			const nodes = v instanceof XMLListClass ? v._l.map(copyNode) : parse(v === null || v === undefined ? "" : String(v));
			if (nodes.length > 1) throw bad(1088, "The markup in the document following the root element must be well-formed.");
			return wrap(nodes[0] ?? new XNode(TEXT, "", ""));
		}
		_nodes() {
			return [this._n];
		}
		appendChild(this: any, v: any) {
			if (this._n._k === ELEMENT) adopt(this._n, nodesOf(v), this._n._kids.length);
			return this;
		}
		prependChild(this: any, v: any) {
			if (this._n._k === ELEMENT) adopt(this._n, nodesOf(v), 0);
			return this;
		}
		insertChildAfter(this: any, ref: any, v: any) {
			const kids = this._n._kids as XNode[];
			const at = ref === null ? 0 : kids.indexOf(nodesOf(ref)[0]!) + 1;
			if (at > 0 || ref === null) adopt(this._n, nodesOf(v), at);
			return at > 0 || ref === null ? this : undefined;
		}
		insertChildBefore(this: any, ref: any, v: any) {
			const kids = this._n._kids as XNode[];
			const at = ref === null ? kids.length : kids.indexOf(nodesOf(ref)[0]!);
			if (at >= 0) adopt(this._n, nodesOf(v), at);
			return at >= 0 ? this : undefined;
		}
		setChildren(this: any, v: any) {
			for (const k of this._n._kids) k._up = null;
			this._n._kids = [];
			adopt(this._n, nodesOf(v), 0);
			return this;
		}
		replace(this: any, name: string | number, v: any) {
			const kids = this._n._kids as XNode[];
			const at = typeof name === "number" ? name : kids.findIndex((k) => k._k === ELEMENT && matches(k, String(name)));
			if (at >= 0 && at < kids.length) {
				kids[at]!._up = null;
				kids.splice(at, 1);
				adopt(this._n, nodesOf(v), at);
			}
			return this;
		}
		childIndex(this: any) {
			const up = this._n._up as XNode | null;
			return up && this._n._k !== ATTRIBUTE ? up._kids.indexOf(this._n) : -1;
		}
		parent(this: any) {
			return this._n._up ? wrap(this._n._up) : undefined;
		}
		copy(this: any) {
			return wrap(copyNode(this._n));
		}
		contains(this: any, v: any) {
			return v instanceof XMLClass && same(this._n, v._n);
		}
		length() {
			return 1;
		}
		name(this: any) {
			const n = this._n as XNode;
			return n._k === ELEMENT || n._k === ATTRIBUTE || n._k === PI ? new QNameClass(n._uri, n._name) : null;
		}
		localName(this: any) {
			const n = this._n as XNode;
			return n._k === ELEMENT || n._k === ATTRIBUTE || n._k === PI ? n._name : null;
		}
		setName(this: any, q: any) {
			const [name, uri] = nameOf(q);
			this._n._name = name;
			if (uri !== undefined) this._n._uri = uri;
		}
		setLocalName(this: any, n: string) {
			this._n._name = String(n);
		}
		/** Its namespace, or the one of a prefix in scope. */
		namespace(this: any, px?: string) {
			const n = this._n as XNode;
			if (px === undefined) return n._k === ELEMENT || n._k === ATTRIBUTE ? new NamespaceClass(n._px, n._uri) : null;
			const uri = lookup(n._k === ELEMENT ? n : n._up, String(px));
			return uri === undefined ? undefined : new NamespaceClass(String(px), uri);
		}
		inScopeNamespaces(this: any) {
			return inScope(this._n).map(([p, u]) => new NamespaceClass(p, u));
		}
		namespaceDeclarations(this: any) {
			return (this._n._ns ?? []).map(([p, u]: [string, string]) => new NamespaceClass(p, u));
		}
		addNamespace(this: any, ns: any) {
			const n = this._n as XNode;
			const p = ns?.prefix ?? "";
			if (n._k === ELEMENT && !(n._ns ?? []).some(([x]) => x === p)) (n._ns ??= []).push([p, String(ns?.uri ?? ns)]);
			return this;
		}
		removeNamespace(this: any, ns: any) {
			const n = this._n as XNode;
			if (n._ns) n._ns = n._ns.filter(([, u]) => u !== String(ns?.uri ?? ns));
			return this;
		}
		setNamespace(this: any, ns: any) {
			const n = this._n as XNode;
			n._uri = String(ns?.uri ?? ns);
			n._px = ns?.prefix ?? n._px;
			if (n._k === ELEMENT && n._px !== undefined && lookup(n, n._px) !== n._uri) (n._ns ??= []).push([n._px, n._uri]);
		}
		nodeKind(this: any) {
			return KINDS[this._n._k];
		}
		hasSimpleContent(this: any) {
			return simple(this._n);
		}
		hasComplexContent(this: any) {
			return this._n._k === ELEMENT && !simple(this._n);
		}
		normalize(this: any) {
			const walk = (n: XNode) => {
				const out: XNode[] = [];
				for (const k of n._kids) {
					if (k._k === TEXT && out.length && out[out.length - 1]!._k === TEXT) out[out.length - 1]!._v += k._v;
					else if (k._k !== TEXT || k._v) out.push(k);
					if (k._k === ELEMENT) walk(k);
				}
				n._kids = out;
			};
			walk(this._n);
			return this;
		}
		toString(this: any) {
			return text(this._n);
		}
		valueOf(this: any) {
			return this;
		}
	}
	Object.assign(XMLClass.prototype, shared);

	class XMLListClass {
		declare _l: XNode[];
		constructor(v: any = "") {
			const nodes = v instanceof XMLClass ? [copyNode(v._n)] : v instanceof XMLListClass ? v._l.map(copyNode) : parse(v === null || v === undefined ? "" : String(v));
			return list(nodes);
		}
		_nodes() {
			return this._l;
		}
		length(this: any) {
			return this._l.length;
		}
		copy(this: any) {
			return list(this._l.map(copyNode));
		}
		contains(this: any, v: any) {
			return v instanceof XMLClass && this._l.some((n: XNode) => same(n, v._n));
		}
		parent(this: any) {
			const up = this._l[0]?._up;
			return up && this._l.every((n: XNode) => n._up === up) ? wrap(up) : undefined;
		}
		hasSimpleContent(this: any) {
			const l = this._l as XNode[];
			return l.length === 1 ? simple(l[0]!) : !l.some((n) => n._k === ELEMENT);
		}
		hasComplexContent(this: any) {
			const l = this._l as XNode[];
			return l.length === 1 ? l[0]!._k === ELEMENT && !simple(l[0]!) : l.some((n) => n._k === ELEMENT);
		}
		toString(this: any) {
			return this.hasSimpleContent() ? (this._l as XNode[]).map(text).join("") : this.toXMLString();
		}
		valueOf(this: any) {
			return this;
		}
		/** (for each over a list) */
		_items(this: any) {
			return (this._l as XNode[]).map(wrap);
		}
	}
	Object.assign(XMLListClass.prototype, shared);
	// a list of one does what its XML does
	for (const k of ["appendChild", "prependChild", "insertChildAfter", "insertChildBefore", "setChildren", "replace", "childIndex", "name", "localName", "setName", "setLocalName", "nodeKind", "normalize", "namespace", "inScopeNamespaces", "namespaceDeclarations", "addNamespace", "removeNamespace", "setNamespace"] as const)
		(XMLListClass.prototype as any)[k] = function (this: any, ...a: unknown[]) {
			if (this._l.length !== 1) throw bad(1086, `The ${k} method only works on lists containing one item.`);
			return (wrap(this._l[0]) as any)[k](...a);
		};
	// (the methods aren't enumerable, as a class's are: for..in over a list gives its indices only)
	for (const proto of [XMLClass.prototype, XMLListClass.prototype])
		for (const k of Object.keys(proto)) Object.defineProperty(proto, k, { enumerable: false });

	class NamespaceClass {
		prefix: string | undefined;
		uri: string;
		constructor(a?: any, b?: any) {
			if (b !== undefined) {
				this.prefix = a === undefined || a === null ? undefined : String(a);
				this.uri = b instanceof QNameClass ? b.uri : String(b?.uri ?? b);
			} else if (a instanceof NamespaceClass) {
				this.prefix = a.prefix;
				this.uri = a.uri;
			} else {
				this.uri = a === undefined ? "" : a instanceof QNameClass ? a.uri : String(a);
				this.prefix = this.uri === "" ? "" : undefined;
			}
		}
		toString() {
			return this.uri;
		}
		valueOf() {
			return this.uri;
		}
	}
	class QNameClass {
		uri: string;
		localName: string;
		constructor(a?: any, b?: any) {
			if (b === undefined) {
				if (a instanceof QNameClass) {
					this.uri = a.uri;
					this.localName = a.localName;
				} else {
					this.uri = dns;
					this.localName = a === undefined ? "" : String(a);
				}
			} else {
				this.uri = a === null || a === undefined ? "" : String(a?.uri ?? a);
				this.localName = String(b);
			}
		}
		toString() {
			return this.uri ? `${this.uri}::${this.localName}` : this.localName;
		}
		valueOf() {
			return this.toString();
		}
	}

	// ------------------------------------------------------------------ what the compiled code calls

	const nodes = (o: any): XNode[] => {
		if (o instanceof XMLClass) return [o._n];
		if (o instanceof XMLListClass) return o._l;
		if (o === null || o === undefined) throw fail(TypeError, 1009, "Cannot access a property or method of a null object reference.");
		return [];
	};
	const h = L.scripts.helpers;
	const vals = h.vals;
	Object.assign(h, {
		/** An XML literal: its text with the values of the {expressions} put in (0 content, 1 attribute value, 2 name). */
		xml(isList: number, ...parts: unknown[]) {
			let s = "";
			for (let i = 0; i < parts.length; i++) {
				const p = parts[i];
				if (typeof p === "string") s += p;
				else {
					const [ctx, v] = p as [number, any];
					if (ctx === 1) s += `"${escAttr(String(v))}"`;
					else if (ctx === 2) s += String(v);
					else s += v instanceof XMLClass || v instanceof XMLListClass ? nodesOf(v).map((n) => printRaw(n)).join("") : escText(String(v));
				}
			}
			return isList ? new XMLListClass(s.replace(/^\s*<>|<\/>\s*$/g, "")) : new XMLClass(s);
		},
		/** o.@name, o.@* */
		xa: (o: any, name: string) => list(childrenOf(nodes(o), `@${name}`)),
		/** o..name, o..@name, o..* */
		xd: (o: any, name: string) => list(descendantsOf(nodes(o), name)),
		/** o.name as a child even where XML has a method of that name; o.* */
		xc: (o: any, name: string) => (o instanceof XMLClass || o instanceof XMLListClass ? list(childrenOf(nodes(o), name)) : o?.[name]),
		/** o.(predicate): the items it holds for */
		xf(o: any, pred: (x: any) => unknown) {
			return list(nodes(o).filter((n) => pred(wrap(n))));
		},
		/** A name in a filter: the item's children of that name, if it has some; else what the name is outside. */
		xn(x: any, name: string, outside: unknown) {
			const c = childrenOf(nodes(x), name);
			return c.length ? list(c) : outside;
		},
		/** a + b, a += b: XML and XML make a list of both (E4X), anything else adds as text or numbers */
		xadd(a: any, b: any) {
			const xml = (v: any) => v instanceof XMLClass || v instanceof XMLListClass;
			return xml(a) && xml(b) ? list([...nodes(a), ...nodes(b)]) : a + b;
		},
		/** o.@name = v */
		xs(o: any, name: string, v: unknown) {
			const l = nodes(o);
			if (l.length === 1) setChild(l[0]!, name, v);
			return v;
		},
		/** o.ns::name (0), o.@ns::name (1), o..ns::name (2), o..@ns::name (3) */
		xq(o: any, ns: any, name: string, mode: number) {
			const uri = String(ns?.uri ?? ns);
			const at = mode & 1 ? `@${name}` : name;
			return list(mode & 2 ? descendantsOf(nodes(o), at, uri) : childrenOf(nodes(o), at, uri));
		},
		/** default xml namespace = ns */
		xdns(ns: any) {
			dns = ns === null || ns === undefined ? "" : String(ns?.uri ?? ns);
		},
		/** delete o.@name */
		xdel(o: any, name: string) {
			for (const n of childrenOf(nodes(o), name)) remove(n);
			return true;
		},
		/** == where XML is on one side: two XML values are equal when they are the same XML */
		xeq(a: any, b: any) {
			const one = (v: any) => (v instanceof XMLListClass && v._l.length === 1 ? wrap(v._l[0]!) : v);
			a = one(a);
			b = one(b);
			if (a instanceof XMLListClass && b instanceof XMLListClass) return a._l.length === b._l.length && a._l.every((n: XNode, i: number) => same(n, b._l[i]!));
			if (a instanceof XMLClass && b instanceof XMLClass) return a._n._k === ELEMENT && b._n._k === ELEMENT && !(simple(a._n) && simple(b._n)) ? same(a._n, b._n) : text(a._n) === text(b._n);
			if (a instanceof XMLListClass) return !a._l.length && (b === undefined || b === null) ? false : a == b;
			if (b instanceof XMLListClass) return b == a;
			if (a instanceof XMLClass || b instanceof XMLClass) {
				const x = a instanceof XMLClass ? a : b,
					y = a instanceof XMLClass ? b : a;
				if (y === null || y === undefined) return false;
				return typeof y === "number" ? +text(x._n) === y : text(x._n) == String(y);
			}
			return a == b;
		},
		vals: (o: any) => (o instanceof XMLListClass ? o._items() : o instanceof XMLClass ? [o] : vals(o)),
	});
	/** A node as text for putting into another literal (not pretty). */
	function printRaw(n: XNode): string {
		const was = settings.prettyPrinting;
		settings.prettyPrinting = false;
		try {
			return print(n, 0);
		} finally {
			settings.prettyPrinting = was;
		}
	}
	return { XML: XMLClass, XMLList: XMLListClass, Namespace: NamespaceClass, QName: QNameClass, isXMLName: (s: unknown) => /^[A-Za-z_][\w.-]*$/.test(String(s)) };
}
