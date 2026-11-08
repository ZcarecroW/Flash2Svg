/**
 * ActionScript 3: frame scripts (parseScript) and class files (parseClassFile: packages, classes,
 * interfaces, their members), with E4X (XML literals, .@, .., filters, XML namespaces). Namespaces of
 * code (use namespace, mx_internal) are refused: the caller then falls back on what it can recognise
 * without running the script. Metadata is read past ([Embed] is noted).
 */

export class ScriptError extends Error {
	readonly line: number;
	constructor(message: string, line: number) {
		super(message);
		this.line = line;
	}
}

// ------------------------------------------------------------------ tokens

type TokenKind = "id" | "num" | "str" | "regex" | "xml" | "op" | "end";

/** A piece of an XML literal: text, or an {expression} (ctx 0 content, 1 attribute value, 2 name). */
export type XmlPart = string | { src: string; ctx: number; line: number };

export interface Token {
	kind: TokenKind;
	text: string;
	/** Strings: the value. */
	value?: string;
	/** XML literals: their pieces. */
	parts?: XmlPart[];
	/** A line break comes before it. */
	nl: boolean;
	line: number;
	pos: number;
}

const OPS = [
	">>>=",
	"...",
	"===",
	"!==",
	">>>",
	"<<=",
	">>=",
	"&&=",
	"||=",
	"::",
	"==",
	"!=",
	"<=",
	">=",
	"&&",
	"||",
	"++",
	"--",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"&=",
	"|=",
	"^=",
	"<<",
	">>",
	".<",
	"..",
];

const KEYWORD_VALUES = new Set(["return", "typeof", "delete", "in", "is", "as", "instanceof", "new", "void", "throw", "case", "else", "do"]);

/** The tokens of a script. A `/` is a regular expression where a value is expected. */
export function tokenize(src: string): Token[] {
	const out: Token[] = [];
	let i = 0,
		line = 1,
		nl = false;
	const n = src.length;
	/** An XML literal from `<` to the end of its root (or of <>...</>), with its {expressions} apart. */
	const xmlLiteral = (start: number) => {
		const parts: XmlPart[] = [];
		const first = line;
		let j = start,
			buf = "",
			depth = 0;
		const unclosed = () => new ScriptError("XML isn't closed", first);
		const through = (end: string) => {
			const e = src.indexOf(end, j);
			if (e < 0) throw unclosed();
			const piece = src.slice(j, e + end.length);
			for (const ch of piece) if (ch === "\n") line++;
			buf += piece;
			j = e + end.length;
		};
		const expr = (ctx: number) => {
			let d = 0,
				k = j;
			for (; k < n; k++) {
				const ch = src[k]!;
				if (ch === '"' || ch === "'") {
					// (a string of the expression: its escapes too)
					let e = k + 1;
					while (e < n && src[e] !== ch) e += src[e] === "\\" ? 2 : 1;
					if (e >= n) throw unclosed();
					k = e;
				} else if (ch === "{") d++;
				else if (ch === "}" && !--d) break;
			}
			if (k >= n) throw new ScriptError("An expression in XML isn't closed", line);
			if (buf) parts.push(buf);
			buf = "";
			parts.push({ src: src.slice(j + 1, k), ctx, line });
			for (let q = j; q < k; q++) if (src[q] === "\n") line++;
			j = k + 1;
		};
		for (;;) {
			if (j >= n) throw unclosed();
			const ch = src[j]!;
			if (ch === "<") {
				if (src.startsWith("<!--", j)) through("-->");
				else if (src.startsWith("<![CDATA[", j)) through("]]>");
				else if (src.startsWith("<?", j)) through("?>");
				else {
					const closing = src[j + 1] === "/";
					let alone = false;
					buf += "<";
					j++;
					while (j < n && src[j] !== ">") {
						const t = src[j]!;
						if (t === '"' || t === "'") {
							const e = src.indexOf(t, j + 1);
							if (e < 0) throw unclosed();
							buf += src.slice(j, e + 1);
							j = e + 1;
						} else if (t === "{") expr(/=\s*$/.test(buf) ? 1 : 2);
						else {
							if (t === "/" && src[j + 1] === ">") alone = true;
							if (t === "\n") line++;
							buf += t;
							j++;
						}
					}
					if (j >= n) throw unclosed();
					buf += ">";
					j++;
					if (closing) depth--;
					else if (!alone) depth++;
					if (depth <= 0) break;
				}
			} else if (ch === "{") expr(0);
			else {
				if (ch === "\n") line++;
				buf += ch;
				j++;
			}
		}
		if (buf) parts.push(buf);
		return { end: j, parts };
	};
	const startsValue = () => {
		const t = out[out.length - 1];
		if (!t) return true;
		if (t.kind === "num" || t.kind === "str" || t.kind === "regex") return false;
		if (t.kind === "id") return KEYWORD_VALUES.has(t.text);
		return !(t.text === ")" || t.text === "]" || t.text === "}");
	};
	while (i < n) {
		const c = src[i]!;
		if (c === "\n") {
			line++;
			nl = true;
			i++;
			continue;
		}
		if (c === " " || c === "\t" || c === "\r" || c === "﻿" || c === " ") {
			i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			while (i < n && src[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			const e = src.indexOf("*/", i + 2);
			const end = e < 0 ? n : e + 2;
			for (let k = i; k < end; k++) {
				if (src[k] === "\n") {
					line++;
					nl = true;
				}
			}
			i = end;
			continue;
		}
		const at = { nl, line, pos: i };
		nl = false;
		if (/[A-Za-z_$]/.test(c)) {
			let j = i + 1;
			while (j < n && /[A-Za-z0-9_$]/.test(src[j]!)) j++;
			out.push({ kind: "id", text: src.slice(i, j), ...at });
			i = j;
			continue;
		}
		if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
			const m = /^(0[xX][0-9a-fA-F]+|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)/.exec(src.slice(i, i + 64))!;
			out.push({ kind: "num", text: m[1]!, ...at });
			i += m[1]!.length;
			continue;
		}
		if (c === '"' || c === "'") {
			let j = i + 1,
				value = "";
			for (;;) {
				if (j >= n || src[j] === "\n") throw new ScriptError("A string isn't closed", line);
				const d = src[j]!;
				if (d === c) break;
				if (d === "\\") {
					const e = src[j + 1] ?? "";
					j += 2;
					const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
					if (e === "u" || e === "x") {
						const len = e === "u" ? 4 : 2;
						value += String.fromCharCode(parseInt(src.slice(j, j + len), 16));
						j += len;
					} else if (e === "\n") {
						line++;
					} else value += map[e] ?? e;
					continue;
				}
				value += d;
				j++;
			}
			out.push({ kind: "str", text: src.slice(i, j + 1), value, ...at });
			i = j + 1;
			continue;
		}
		if (c === "/" && startsValue()) {
			let j = i + 1,
				cls = false;
			for (;;) {
				if (j >= n || src[j] === "\n") throw new ScriptError("A regular expression isn't closed", line);
				const d = src[j]!;
				if (d === "\\") j++;
				else if (d === "[") cls = true;
				else if (d === "]") cls = false;
				else if (d === "/" && !cls) break;
				j++;
			}
			j++;
			while (j < n && /[a-z]/.test(src[j]!)) j++;
			out.push({ kind: "regex", text: src.slice(i, j), ...at });
			i = j;
			continue;
		}
		if (c === "<" && startsValue() && out[out.length - 1]?.text !== "new" && /[A-Za-z_>!?{]/.test(src[i + 1] ?? "")) {
			const x = xmlLiteral(i);
			out.push({ kind: "xml", text: src.slice(i, x.end), parts: x.parts, ...at });
			i = x.end;
			continue;
		}
		const op = OPS.find((o) => src.startsWith(o, i)) ?? c;
		if (!/[{}()[\];,.?:~!<>=+\-*/%&|^@]/.test(c)) throw new ScriptError(`Unexpected character ${c}`, line);
		out.push({ kind: "op", text: op, ...at });
		i += op.length;
	}
	out.push({ kind: "end", text: "", nl: true, line, pos: n });
	return out;
}

// ------------------------------------------------------------------ syntax tree

export type Expr =
	| { k: "num"; v: string }
	| { k: "str"; v: string }
	| { k: "regex"; v: string }
	| { k: "id"; name: string }
	| { k: "this" }
	| { k: "super" }
	| { k: "lit"; v: "null" | "true" | "false" }
	| { k: "array"; items: Expr[] }
	| { k: "object"; props: [string, Expr][] }
	| { k: "func"; f: FuncDecl }
	| { k: "unary"; op: string; x: Expr }
	| { k: "update"; op: string; prefix: boolean; x: Expr }
	| { k: "bin"; op: string; a: Expr; b: Expr }
	| { k: "assign"; op: string; a: Expr; b: Expr }
	| { k: "cond"; c: Expr; a: Expr; b: Expr }
	| { k: "member"; o: Expr; name: string }
	| { k: "index"; o: Expr; i: Expr }
	| { k: "call"; f: Expr; args: Expr[] }
	| { k: "new"; f: Expr; args: Expr[] }
	| { k: "vector"; of: string }
	| { k: "seq"; items: Expr[] }
	// E4X
	| { k: "xml"; list: boolean; parts: (string | { x: Expr; ctx: number })[] }
	/** o.@name, o.@*, o.@[i], o.@ns::name; `o` null: an attribute of the item a filter looks at */
	| { k: "xattr"; o: Expr | null; name: string | null; i?: Expr; ns?: Expr }
	/** o..name, o..@name, o..*, o..ns::name */
	| { k: "xdesc"; o: Expr; name: string; ns?: Expr }
	/** o.ns::name, o.ns::* */
	| { k: "xq"; o: Expr; ns: Expr; name: string }
	/** o.* */
	| { k: "xchild"; o: Expr; name: string }
	/** o.(predicate) */
	| { k: "xfilter"; o: Expr; pred: Expr };

export interface VarDecl {
	name: string;
	type: string;
	init: Expr | null;
}

export interface Param {
	name: string;
	type: string;
	init: Expr | null;
	rest: boolean;
}

export interface FuncDecl {
	name: string;
	params: Param[];
	ret: string;
	body: Stmt[];
	/** Declared without a body: in an interface, or native. */
	bodiless?: boolean;
	line?: number;
}

/** A member of a class or interface. */
export interface Member {
	kind: "var" | "const" | "method" | "get" | "set";
	name: string;
	isStatic: boolean;
	access: "public" | "private" | "protected" | "internal";
	override: boolean;
	/** A variable's type, a function's return type. */
	type: string;
	init: Expr | null;
	f: FuncDecl | null;
	/** Under [Embed]: an asset the Flash compiler would have put in. */
	embed: boolean;
	line: number;
}

export interface ClassDecl {
	kind: "class" | "interface";
	name: string;
	/** Its package ("" the top level). */
	pkg: string;
	/** Written outside the package block: seen only in its own file. */
	local: boolean;
	/** What it extends, as written (an interface: in `impl`). */
	ext: string | null;
	impl: string[];
	dynamic: boolean;
	members: Member[];
	ctor: FuncDecl | null;
	/** Statements in the class body: run once, when the class is set up; `at`: after that many members. */
	init: { at: number; s: Stmt }[];
	line: number;
}

/** What a package or a file defines besides classes: a function or a variable. */
export interface PackageDef {
	pkg: string;
	local: boolean;
	f?: FuncDecl;
	v?: VarDecl;
	line: number;
}

/** A class file. */
export interface FileDecl {
	pkg: string;
	imports: string[];
	classes: ClassDecl[];
	defs: PackageDef[];
	/** Statements outside any definition. */
	body: Stmt[];
}

export type Stmt =
	| { k: "block"; body: Stmt[] }
	| { k: "var"; decls: VarDecl[] }
	| { k: "func"; f: FuncDecl }
	| { k: "if"; c: Expr; a: Stmt; b: Stmt | null }
	| { k: "for"; init: Stmt | null; c: Expr | null; u: Expr | null; body: Stmt }
	| { k: "forin"; each: boolean; decl: VarDecl | null; left: Expr | null; o: Expr; body: Stmt }
	| { k: "while"; c: Expr; body: Stmt }
	| { k: "do"; c: Expr; body: Stmt }
	| { k: "switch"; c: Expr; cases: { test: Expr | null; body: Stmt[] }[] }
	| { k: "break" | "continue"; label: string }
	| { k: "return"; x: Expr | null }
	| { k: "throw"; x: Expr }
	| { k: "try"; body: Stmt[]; catches: { param: string; type: string; body: Stmt[] }[]; final: Stmt[] | null }
	| { k: "label"; name: string; body: Stmt }
	| { k: "expr"; x: Expr }
	/** default xml namespace = x */
	| { k: "xmlns"; x: Expr }
	| { k: "empty" };

// ------------------------------------------------------------------ parser

const BINARY: Record<string, number> = {
	"||": 1,
	"&&": 2,
	"|": 3,
	"^": 4,
	"&": 5,
	"==": 6,
	"!=": 6,
	"===": 6,
	"!==": 6,
	"<": 7,
	">": 7,
	"<=": 7,
	">=": 7,
	instanceof: 7,
	is: 7,
	as: 7,
	in: 7,
	"<<": 8,
	">>": 8,
	">>>": 8,
	"+": 9,
	"-": 9,
	"*": 10,
	"/": 10,
	"%": 10,
};
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "&&=", "||="]);

/** Parses a frame script: its statements. */
export function parseScript(src: string): Stmt[] {
	return parser(src, false).script();
}

/** Parses a class file: its package, imports, classes and interfaces. */
export function parseClassFile(src: string): FileDecl {
	return parser(src, true).file();
}

const MODIFIERS = new Set(["public", "private", "protected", "internal", "static", "override", "final", "dynamic", "native"]);
const DEFINES = new Set(["var", "const", "function", "class", "interface", "namespace"]);

function parser(src: string, classes: boolean) {
	const toks = tokenize(src);
	let p = 0;
	let noIn = false;
	const peek = () => toks[p]!;
	const next = () => toks[p++]!;
	const is = (text: string) => {
		const t = peek();
		return (t.kind === "op" || t.kind === "id") && t.text === text;
	};
	const eat = (text: string) => {
		if (is(text)) {
			p++;
			return true;
		}
		return false;
	};
	const fail = (what: string): never => {
		throw new ScriptError(what, peek().line);
	};
	const expect = (text: string) => {
		if (!eat(text)) fail(`Expected ${text} instead of ${peek().text || "the end"}`);
	};
	const ident = () => {
		const t = next();
		if (t.kind !== "id") throw new ScriptError(`Expected a name instead of ${t.text || "the end"}`, t.line);
		return t.text;
	};
	/** A statement ends at ";", before "}", at the end, or at a line break. */
	const semi = () => {
		if (eat(";") || is("}") || peek().kind === "end" || peek().nl) return;
		fail(`Expected the end of the statement before ${peek().text}`);
	};

	/** A type name: Number, flash.display.MovieClip, Vector.<int>, *, void. */
	function typeName(): string {
		if (eat("*")) return "*";
		let t = ident();
		while (is(".") && toks[p + 1]?.kind === "id") {
			p++;
			t = ident();
		}
		if (eat(".<")) {
			const of = typeName();
			closeAngle();
			return `Vector.<${of}>`;
		}
		return t;
	}
	/** The ">" closing a Vector type (">>" nests: split it). */
	function closeAngle() {
		const t = peek();
		if (t.text === ">") p++;
		else if (t.text === ">>" || t.text === ">>>") toks[p] = { ...t, text: t.text.slice(1) };
		else fail("Expected > after a Vector's type");
	}
	const annotation = () => (eat(":") ? typeName() : "*");

	/** `bodiless`: it may end without a body (interfaces, native functions). */
	function functionRest(name: string, bodiless = false): FuncDecl {
		const line = peek().line;
		expect("(");
		const params: Param[] = [];
		while (!is(")")) {
			const rest = eat("...");
			const pname = ident();
			const type = annotation();
			const init = eat("=") ? assignment() : null;
			params.push({ name: pname, type, init, rest });
			if (!eat(",")) break;
		}
		expect(")");
		const ret = annotation();
		if (bodiless && !is("{")) {
			semi();
			return { name, params, ret, body: [], bodiless: true, line };
		}
		return { name, params, ret, body: blockBody(), line };
	}

	function blockBody(): Stmt[] {
		expect("{");
		const body: Stmt[] = [];
		while (!is("}")) {
			if (peek().kind === "end") fail("A block isn't closed");
			body.push(statement());
		}
		p++;
		return body;
	}

	function primary(): Expr {
		const t = peek();
		if (t.kind === "num") {
			p++;
			return { k: "num", v: t.text };
		}
		if (t.kind === "str") {
			p++;
			return { k: "str", v: t.value! };
		}
		if (t.kind === "regex") {
			p++;
			return { k: "regex", v: t.text };
		}
		if (t.kind === "xml") {
			p++;
			const parts = t.parts!.map((q) => {
				if (typeof q === "string") return q;
				try {
					return { x: parser(q.src, classes).expr(), ctx: q.ctx };
				} catch (e) {
					if (e instanceof ScriptError) throw new ScriptError(e.message, q.line + e.line - 1);
					throw e;
				}
			});
			return { k: "xml", list: /^<\s*>/.test(t.text), parts };
		}
		if (t.kind === "op" && t.text === "@") {
			p++;
			return attrRest(null);
		}
		if (t.kind === "id") {
			switch (t.text) {
				case "this":
					p++;
					return { k: "this" };
				case "null":
				case "true":
				case "false":
					p++;
					return { k: "lit", v: t.text };
				case "function": {
					p++;
					const name = peek().kind === "id" ? ident() : "";
					return { k: "func", f: functionRest(name) };
				}
				case "new":
					return newExpr();
				case "super":
					if (!classes) fail("super isn't available in a frame script");
					p++;
					if (!is("(") && !is(".")) fail("Expected ( or . after super");
					return { k: "super" };
			}
			p++;
			// Vector.<int> as a value: new Vector.<int>(), Vector.<int>(list)
			if (t.text === "Vector" && eat(".<")) {
				const of = typeName();
				closeAngle();
				return { k: "vector", of };
			}
			return { k: "id", name: t.text };
		}
		if (eat("(")) {
			const saved = noIn;
			noIn = false;
			const x = expression();
			noIn = saved;
			expect(")");
			return x;
		}
		if (eat("[")) {
			const items: Expr[] = [];
			while (!is("]")) {
				if (is(",")) {
					p++;
					items.push({ k: "id", name: "undefined" });
					continue;
				}
				items.push(assignment());
				if (!eat(",")) break;
			}
			expect("]");
			return { k: "array", items };
		}
		if (eat("{")) {
			const props: [string, Expr][] = [];
			while (!is("}")) {
				const n = next();
				if (n.kind !== "id" && n.kind !== "str" && n.kind !== "num") throw new ScriptError(`Unexpected ${n.text} in an object`, n.line);
				expect(":");
				props.push([n.value ?? n.text, assignment()]);
				if (!eat(",")) break;
			}
			expect("}");
			return { k: "object", props };
		}
		return fail(`Unexpected ${t.text || "end of the script"}`);
	}

	/** A name of E4X: name, *, or ns::name, ns::* (`ns` a variable holding a Namespace). */
	function qualName(): { ns?: Expr; name: string } {
		if (eat("*")) return { name: "*" };
		const first = ident();
		if (eat("::")) return { ns: { k: "id", name: first }, name: eat("*") ? "*" : ident() };
		return { name: first };
	}

	/** After @: a name, *, ns::name, or [expression]. */
	function attrRest(o: Expr | null): Expr {
		if (eat("[")) {
			const i = expression();
			expect("]");
			return { k: "xattr", o, name: null, i };
		}
		const q = qualName();
		return { k: "xattr", o, name: q.name, ...(q.ns ? { ns: q.ns } : {}) };
	}

	function newExpr(): Expr {
		expect("new");
		// new <int>[1, 2, 3]
		if (eat("<")) {
			const of = typeName();
			closeAngle();
			return { k: "call", f: { k: "vector", of }, args: [primary()] };
		}
		let f: Expr = primary();
		for (;;) {
			if (eat(".")) f = { k: "member", o: f, name: ident() };
			else if (eat("[")) {
				const i = expression();
				expect("]");
				f = { k: "index", o: f, i };
			} else break;
		}
		return { k: "new", f, args: is("(") ? args() : [] };
	}

	function args(): Expr[] {
		expect("(");
		const out: Expr[] = [];
		const saved = noIn;
		noIn = false;
		while (!is(")")) {
			out.push(assignment());
			if (!eat(",")) break;
		}
		noIn = saved;
		expect(")");
		return out;
	}

	function postfix(): Expr {
		let x = primary();
		for (;;) {
			if (is(".")) {
				p++;
				if (eat("@")) x = attrRest(x);
				else if (eat("*")) x = { k: "xchild", o: x, name: "*" };
				else if (eat("(")) {
					const saved = noIn;
					noIn = false;
					const pred = expression();
					noIn = saved;
					expect(")");
					x = { k: "xfilter", o: x, pred };
				} else {
					const name = ident();
					if (eat("::")) x = { k: "xq", o: x, ns: { k: "id", name }, name: eat("*") ? "*" : ident() };
					else x = { k: "member", o: x, name };
				}
			} else if (is("..")) {
				p++;
				const attr = eat("@");
				const q = qualName();
				x = { k: "xdesc", o: x, name: `${attr ? "@" : ""}${q.name}`, ...(q.ns ? { ns: q.ns } : {}) };
			} else if (is("::")) fail("Namespaces in scripts aren't supported");
			else if (is("[")) {
				p++;
				const saved = noIn;
				noIn = false;
				const i = expression();
				noIn = saved;
				expect("]");
				x = { k: "index", o: x, i };
			} else if (is("(")) x = { k: "call", f: x, args: args() };
			else if ((is("++") || is("--")) && !peek().nl) x = { k: "update", op: next().text, prefix: false, x };
			else return x;
		}
	}

	function unary(): Expr {
		const t = peek();
		if (t.kind === "op" && (t.text === "++" || t.text === "--")) {
			p++;
			return { k: "update", op: t.text, prefix: true, x: unary() };
		}
		if ((t.kind === "op" && (t.text === "!" || t.text === "~" || t.text === "-" || t.text === "+")) || (t.kind === "id" && (t.text === "typeof" || t.text === "delete" || t.text === "void"))) {
			p++;
			return { k: "unary", op: t.text, x: unary() };
		}
		return postfix();
	}

	function binary(min: number): Expr {
		let a = unary();
		for (;;) {
			const t = peek();
			const prec = t.kind === "op" || t.kind === "id" ? BINARY[t.text] : undefined;
			if (prec === undefined || prec < min || (noIn && t.text === "in")) return a;
			p++;
			// `x as T`, `x is T`: a type on the right
			a = { k: "bin", op: t.text, a, b: binary(prec + 1) };
		}
	}

	function assignment(): Expr {
		const c = binary(1);
		if (eat("?")) {
			const a = assignment();
			expect(":");
			return { k: "cond", c, a, b: assignment() };
		}
		const t = peek();
		if (t.kind === "op" && ASSIGN.has(t.text)) {
			if (c.k !== "id" && c.k !== "member" && c.k !== "index" && c.k !== "xattr") fail("This can't be assigned to");
			p++;
			return { k: "assign", op: t.text, a: c, b: assignment() };
		}
		return c;
	}

	function expression(): Expr {
		const x = assignment();
		if (!is(",")) return x;
		const items = [x];
		while (eat(",")) items.push(assignment());
		return { k: "seq", items };
	}

	function varDecls(): VarDecl[] {
		const decls: VarDecl[] = [];
		do {
			const name = ident();
			const type = annotation();
			decls.push({ name, type, init: eat("=") ? assignment() : null });
		} while (eat(","));
		return decls;
	}

	function statement(): Stmt {
		const t = peek();
		if (t.kind === "op") {
			if (t.text === "{") return { k: "block", body: blockBody() };
			if (t.text === ";") {
				p++;
				return { k: "empty" };
			}
		}
		if (t.kind === "id") {
			switch (t.text) {
				case "var":
				case "const": {
					p++;
					const decls = varDecls();
					semi();
					return { k: "var", decls };
				}
				case "function":
					if (toks[p + 1]?.kind === "id") {
						p++;
						const name = ident();
						return { k: "func", f: functionRest(name) };
					}
					break;
				case "import":
				case "include":
					p++;
					while (!is(";") && !peek().nl && peek().kind !== "end") p++;
					eat(";");
					return { k: "empty" };
				case "use":
					fail("Namespaces in scripts aren't supported");
					break;
				case "default":
					if (toks[p + 1]?.text === "xml" && toks[p + 2]?.text === "namespace") {
						p += 3;
						expect("=");
						const x = assignment();
						semi();
						return { k: "xmlns", x };
					}
					break;
				case "class":
				case "interface":
				case "package":
					fail(classes ? `${t.text} can't be written here` : `${t.text} can't be written in a frame script`);
					break;
				case "if": {
					p++;
					expect("(");
					const c = expression();
					expect(")");
					const a = statement();
					eat(";");
					return { k: "if", c, a, b: eat("else") ? statement() : null };
				}
				case "while": {
					p++;
					expect("(");
					const c = expression();
					expect(")");
					return { k: "while", c, body: statement() };
				}
				case "do": {
					p++;
					const body = statement();
					expect("while");
					expect("(");
					const c = expression();
					expect(")");
					eat(";");
					return { k: "do", c, body };
				}
				case "for":
					return forStatement();
				case "switch":
					return switchStatement();
				case "break":
				case "continue": {
					p++;
					const label = peek().kind === "id" && !peek().nl ? ident() : "";
					semi();
					return { k: t.text as "break", label };
				}
				case "return": {
					p++;
					const x = is(";") || is("}") || peek().nl || peek().kind === "end" ? null : expression();
					semi();
					return { k: "return", x };
				}
				case "throw": {
					p++;
					const x = expression();
					semi();
					return { k: "throw", x };
				}
				case "try":
					return tryStatement();
			}
			if (toks[p + 1]?.text === ":" && toks[p + 1]?.kind === "op") {
				p += 2;
				return { k: "label", name: t.text, body: statement() };
			}
		}
		const x = expression();
		semi();
		return { k: "expr", x };
	}

	function forStatement(): Stmt {
		expect("for");
		const each = eat("each");
		expect("(");
		let init: Stmt | null = null;
		noIn = true;
		if (is("var")) {
			p++;
			const decls = varDecls();
			noIn = false;
			if (decls.length === 1 && eat("in")) {
				const o = expression();
				expect(")");
				return { k: "forin", each, decl: decls[0]!, left: null, o, body: statement() };
			}
			init = { k: "var", decls };
		} else if (!is(";")) {
			const x = expression();
			noIn = false;
			if (eat("in")) {
				const o = expression();
				expect(")");
				return { k: "forin", each, decl: null, left: x, o, body: statement() };
			}
			init = { k: "expr", x };
		}
		noIn = false;
		expect(";");
		const c = is(";") ? null : expression();
		expect(";");
		const u = is(")") ? null : expression();
		expect(")");
		return { k: "for", init, c, u, body: statement() };
	}

	function switchStatement(): Stmt {
		expect("switch");
		expect("(");
		const c = expression();
		expect(")");
		expect("{");
		const cases: { test: Expr | null; body: Stmt[] }[] = [];
		while (!is("}")) {
			let test: Expr | null = null;
			if (eat("case")) test = expression();
			else expect("default");
			expect(":");
			const body: Stmt[] = [];
			while (!is("case") && !is("default") && !is("}")) body.push(statement());
			cases.push({ test, body });
		}
		p++;
		return { k: "switch", c, cases };
	}

	function tryStatement(): Stmt {
		expect("try");
		const body = blockBody();
		const catches: { param: string; type: string; body: Stmt[] }[] = [];
		while (eat("catch")) {
			expect("(");
			const param = ident();
			const type = annotation();
			expect(")");
			catches.push({ param, type, body: blockBody() });
		}
		const final = eat("finally") ? blockBody() : null;
		return { k: "try", body, catches, final };
	}

	/** a.b.C, or a.b.* where `star` (imports). */
	function dotted(star = false): string {
		let s = ident();
		while (eat(".")) {
			if (star && eat("*")) return `${s}.*`;
			s += `.${ident()}`;
		}
		return s;
	}

	/** Metadata, [Name(...)]: read past; its name. */
	function metadata(): string {
		expect("[");
		const name = peek().kind === "id" ? peek().text : "";
		for (let depth = 1; depth; ) {
			const t = next();
			if (t.kind === "end") fail("Metadata isn't closed");
			if (t.text === "[") depth++;
			else if (t.text === "]") depth--;
		}
		return name;
	}

	/** Attributes before a definition (public static ...). A namespace of its own is refused. */
	function modifiers(): Set<string> {
		const m = new Set<string>();
		for (;;) {
			const t = peek();
			if (t.kind !== "id") return m;
			const after = toks[p + 1]!;
			const leads = after.kind === "id" && (MODIFIERS.has(after.text) || DEFINES.has(after.text));
			if (MODIFIERS.has(t.text) && leads) m.add(next().text);
			else if (!MODIFIERS.has(t.text) && !DEFINES.has(t.text) && leads && !after.nl) fail(`Namespaces aren't supported (${t.text})`);
			else return m;
		}
	}

	const accessOf = (m: Set<string>): Member["access"] => (m.has("private") ? "private" : m.has("protected") ? "protected" : m.has("public") ? "public" : "internal");

	function classDef(m: Set<string>, pkg: string, local: boolean): ClassDecl {
		const line = peek().line;
		const kind = next().text as ClassDecl["kind"];
		const c: ClassDecl = { kind, name: ident(), pkg, local, ext: null, impl: [], dynamic: m.has("dynamic"), members: [], ctor: null, init: [], line };
		const list = () => {
			do c.impl.push(dotted());
			while (eat(","));
		};
		if (eat("extends")) {
			if (kind === "interface") list();
			else c.ext = dotted();
		}
		if (kind === "class" && eat("implements")) list();
		expect("{");
		let embed = false;
		while (!is("}")) {
			if (peek().kind === "end") fail(`The ${kind} ${c.name} isn't closed`);
			if (is("[")) {
				if (metadata() === "Embed") embed = true;
				continue;
			}
			if (eat(";")) continue;
			if (is("use") || is("namespace")) fail("Namespaces aren't supported");
			const at = peek().line;
			const mods = modifiers();
			const isStatic = mods.has("static");
			if (is("var") || is("const")) {
				const k = next().text as "var" | "const";
				for (const d of varDecls()) c.members.push({ kind: k, name: d.name, isStatic, access: accessOf(mods), override: false, type: d.type, init: d.init, f: null, embed, line: at });
				semi();
				embed = false;
				continue;
			}
			if (is("function")) {
				p++;
				let mk: Member["kind"] = "method";
				if ((is("get") || is("set")) && toks[p + 1]?.kind === "id") mk = next().text as "get" | "set";
				const name = ident();
				const f = functionRest(name, kind === "interface" || mods.has("native"));
				if (name === c.name && mk === "method" && !isStatic) {
					if (kind === "interface") fail("An interface has no constructor");
					c.ctor = f;
				} else c.members.push({ kind: mk, name, isStatic, access: kind === "interface" ? "public" : accessOf(mods), override: mods.has("override"), type: f.ret, init: null, f, embed: false, line: at });
				embed = false;
				continue;
			}
			if (mods.size) fail(`Expected var, const or function after ${[...mods].join(" ")}`);
			if (kind === "interface") fail(`Unexpected ${peek().text} in an interface`);
			c.init.push({ at: c.members.length, s: statement() });
		}
		p++;
		return c;
	}

	/** One thing in a package block or outside it. */
	function directive(out: FileDecl, pkg: string, local: boolean) {
		if (is("[")) return void metadata();
		if (eat(";")) return;
		if (is("import")) {
			p++;
			out.imports.push(dotted(true));
			return semi();
		}
		if (is("include")) fail("include isn't supported in class files");
		if (is("use") || is("namespace")) fail("Namespaces aren't supported");
		const line = peek().line;
		const m = modifiers();
		if (is("class") || is("interface")) return void out.classes.push(classDef(m, pkg, local));
		if (is("function") && toks[p + 1]?.kind === "id") {
			p++;
			const name = ident();
			return void out.defs.push({ pkg, local, f: functionRest(name, m.has("native")), line });
		}
		if (is("var") || is("const")) {
			p++;
			for (const v of varDecls()) out.defs.push({ pkg, local, v, line });
			return semi();
		}
		if (m.size) fail(`Expected a definition after ${[...m].join(" ")}`);
		out.body.push(statement());
	}

	return {
		expr(): Expr {
			const x = expression();
			if (peek().kind !== "end") fail(`Unexpected ${peek().text}`);
			return x;
		},
		script(): Stmt[] {
			const out: Stmt[] = [];
			while (peek().kind !== "end") out.push(statement());
			return out;
		},
		file(): FileDecl {
			const out: FileDecl = { pkg: "", imports: [], classes: [], defs: [], body: [] };
			let packages = 0;
			while (peek().kind !== "end") {
				if (is("package")) {
					p++;
					if (packages++) fail("A file has one package");
					out.pkg = is("{") ? "" : dotted();
					expect("{");
					while (!is("}")) {
						if (peek().kind === "end") fail("The package isn't closed");
						directive(out, out.pkg, false);
					}
					p++;
					continue;
				}
				// (after the package block: seen only in this file)
				directive(out, "", true);
			}
			return out;
		},
	};
}
