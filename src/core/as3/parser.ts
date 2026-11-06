/**
 * ActionScript 3 as frame scripts use it: a parser for the language without classes (those can't
 * be written in a frame script). E4X, namespaces and metadata are refused: the caller then falls
 * back on what it can recognise without running the script.
 */

export class ScriptError extends Error {
	readonly line: number;
	constructor(message: string, line: number) {
		super(message);
		this.line = line;
	}
}

// ------------------------------------------------------------------ tokens

type TokenKind = "id" | "num" | "str" | "regex" | "op" | "end";

export interface Token {
	kind: TokenKind;
	text: string;
	/** Strings: the value. */
	value?: string;
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
		if (c === "<" && startsValue() && out[out.length - 1]?.text !== "new" && /[A-Za-z/]/.test(src[i + 1] ?? "")) throw new ScriptError("XML in scripts isn't supported", line);
		const op = OPS.find((o) => src.startsWith(o, i)) ?? c;
		if (!/[{}()[\];,.?:~!<>=+\-*/%&|^]/.test(c)) throw new ScriptError(`Unexpected character ${c}`, line);
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
	| { k: "seq"; items: Expr[] };

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
	| { k: "try"; body: Stmt[]; param: string; handler: Stmt[] | null; final: Stmt[] | null }
	| { k: "label"; name: string; body: Stmt }
	| { k: "expr"; x: Expr }
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
			typeName();
			closeAngle();
			return "Vector";
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

	function functionRest(name: string): FuncDecl {
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
		return { name, params, ret, body: blockBody() };
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
					fail("super isn't available in a frame script");
			}
			p++;
			// Vector.<int> as a value: new Vector.<int>(), Vector.<int>(list)
			if (t.text === "Vector" && eat(".<")) {
				typeName();
				closeAngle();
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
		if (t.text === "<") fail("XML in scripts isn't supported");
		return fail(`Unexpected ${t.text || "end of the script"}`);
	}

	function newExpr(): Expr {
		expect("new");
		// new <int>[1, 2, 3]
		if (eat("<")) {
			typeName();
			closeAngle();
			return primary();
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
				if (is("@") || is("(")) fail("XML in scripts isn't supported");
				x = { k: "member", o: x, name: ident() };
			} else if (is("..") || is("::")) fail("XML and namespaces in scripts aren't supported");
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
			if (c.k !== "id" && c.k !== "member" && c.k !== "index") fail("This can't be assigned to");
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
				case "class":
				case "interface":
				case "package":
					fail(`${t.text} can't be written in a frame script`);
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
		let param = "";
		let handler: Stmt[] | null = null;
		while (eat("catch")) {
			expect("(");
			const name = ident();
			annotation();
			expect(")");
			const h = blockBody();
			// (several catch clauses by type: the first one takes all)
			if (!handler) {
				handler = h;
				param = name;
			}
		}
		const final = eat("finally") ? blockBody() : null;
		return { k: "try", body, param, handler, final };
	}

	const out: Stmt[] = [];
	while (peek().kind !== "end") out.push(statement());
	return out;
}
