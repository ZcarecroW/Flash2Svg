/**
 * Classes in .as files to JavaScript for the JS player: the document class, the classes of library
 * symbols and every class they use.
 *
 * What AS3 does and a JavaScript class can't, and how it is done here:
 * - A constructor may use `this` before `super()`, and the fields' initial values are there before
 *   the base class's constructor runs (it may call a method the subclass overrides). So the JS
 *   constructors only make the object; the AS3 constructor is a method of its own (`$<id>`) that
 *   sets the fields and runs the body, its `super(...)` calling the base class's.
 * - Private members of two classes in one line of inheritance are two things: when their names
 *   meet, the private one is renamed (`name$<id>`).
 * - A method taken as a value stays bound to its object, and is the same function each time
 *   ($r.m).
 * - A class is set up (its statics, the code in its body) the first time it is used: the registry
 *   `$c` makes each class when it is first asked for.
 */
import { DECLARED, defaultOf, Emitter, FLASH_API, GLOBALS, hoist, INT, safe, type ClassScope } from "./emit.ts";
import { parseClassFile, ScriptError, type ClassDecl, type Expr, type FileDecl, type FuncDecl, type Member, type Stmt, type VarDecl } from "./parser.ts";

export interface ClassSource {
	/** Relative to its class path folder: shapes/Circle.as. */
	path: string;
	code: string;
}

export interface ClassOptions {
	/** Names of instances on the timeline of a class's library symbol (Animate declares them). */
	instances?: Record<string, string[]>;
}

export interface CompiledClasses {
	/** function($f,$r) returning {c: the registry, n: qualified name -> registry key}; "" without classes. */
	js: string;
	failed: { file: string; line: number; message: string }[];
	/** The classes by qualified name. */
	classes: Map<string, ClassInfo>;
	/** What the classes use that the player doesn't do. */
	warnings: string[];
	/** The members of a class as frame scripts on its timeline reach them. */
	scope(q: string): ClassScope | null;
}

export interface MemberInfo {
	m: Member;
	owner: ClassInfo;
	/** Its name in JavaScript. */
	js: string;
}

export interface ClassInfo {
	/** shapes.Circle (a class only its file sees: the file's name too). */
	q: string;
	/** Its key in the registry $c. */
	key: string;
	decl: ClassDecl;
	file: FileScope;
	id: number;
	base: ClassInfo | null;
	/** A base class of the player's Flash API or JavaScript's (`$f.MovieClip`, `Error`), when `base` is null. */
	baseJs: string | null;
	ifaces: ClassInfo[];
	/** Instance members and static members, by AS3 name. */
	own: Map<string, MemberInfo>;
	statics: Map<string, MemberInfo>;
}

interface DefInfo {
	q: string;
	js: string;
	pkg: string;
	f?: FuncDecl;
	v?: VarDecl;
	file: FileScope;
}

interface FileScope {
	path: string;
	decl: FileDecl;
	/** What only this file sees. */
	locals: Map<string, ClassInfo | DefInfo>;
}

const isClass = (x: ClassInfo | DefInfo | null | undefined): x is ClassInfo => !!x && "decl" in x;

/** JavaScript's classes AS3 has at the top level. */
const JS_CLASSES = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError", "URIError", "Array", "Date", "RegExp"]);

/** The qualified name Flash Player gives a class: shapes::Circle. */
const flashName = (q: string) => {
	const i = q.lastIndexOf(".");
	return i < 0 ? q : `${q.slice(0, i)}::${q.slice(i + 1)}`;
};

/** Whether a statement list calls super() itself (not in a function inside it). */
function callsSuper(body: Stmt[]): boolean {
	let found = false;
	const ex = (x: Expr | null | undefined): void => {
		if (!x || found) return;
		switch (x.k) {
			case "call":
				if (x.f.k === "super") found = true;
				ex(x.f);
				x.args.forEach(ex);
				break;
			case "unary":
			case "update":
				ex(x.x);
				break;
			case "bin":
			case "assign":
				ex(x.a);
				ex(x.b);
				break;
			case "cond":
				ex(x.c);
				ex(x.a);
				ex(x.b);
				break;
			case "member":
				ex(x.o);
				break;
			case "index":
				ex(x.o);
				ex(x.i);
				break;
			case "new":
				ex(x.f);
				x.args.forEach(ex);
				break;
			case "seq":
			case "array":
				x.items.forEach(ex);
				break;
			case "object":
				for (const [, v] of x.props) ex(v);
				break;
		}
	};
	const st = (s: Stmt | null | undefined): void => {
		if (!s || found) return;
		switch (s.k) {
			case "expr":
				return ex(s.x);
			case "var":
				return s.decls.forEach((d) => ex(d.init));
			case "block":
				return s.body.forEach(st);
			case "if":
				ex(s.c);
				st(s.a);
				return st(s.b);
			case "for":
				st(s.init);
				ex(s.c);
				ex(s.u);
				return st(s.body);
			case "forin":
				ex(s.o);
				return st(s.body);
			case "while":
			case "do":
				ex(s.c);
				return st(s.body);
			case "label":
				return st(s.body);
			case "switch":
				ex(s.c);
				return s.cases.forEach((c) => c.body.forEach(st));
			case "try":
				s.body.forEach(st);
				s.catches.forEach((c) => c.body.forEach(st));
				return s.final?.forEach(st);
			case "return":
			case "throw":
				return ex(s.x);
		}
	};
	body.forEach(st);
	return found;
}

/** All classes and package definitions, and how a file's names lead to them. */
class World {
	byName = new Map<string, ClassInfo | DefInfo>();
	classes: ClassInfo[] = [];
	defs: DefInfo[] = [];
	private ids = 0;

	add(file: FileScope) {
		const d = file.decl;
		for (const c of d.classes) {
			const q = c.local ? `${file.path.replace(/\.as$/, "")}$${c.name}` : d.pkg ? `${d.pkg}.${c.name}` : c.name;
			const info: ClassInfo = { q, key: q.replace(/[^\w$]/g, "$"), decl: c, file, id: ++this.ids, base: null, baseJs: null, ifaces: [], own: new Map(), statics: new Map() };
			this.classes.push(info);
			if (c.local) file.locals.set(c.name, info);
			else this.byName.set(q, info);
		}
		for (const def of d.defs) {
			const name = def.f?.name ?? def.v!.name;
			const q = def.local ? `${file.path}$${name}` : def.pkg ? `${def.pkg}.${name}` : name;
			const info: DefInfo = { q, js: `$p_${q.replace(/[^\w$]/g, "$")}`, pkg: def.pkg, f: def.f, v: def.v, file };
			this.defs.push(info);
			if (def.local) file.locals.set(name, info);
			else this.byName.set(q, info);
		}
	}

	/** What a name in a file is: its own definitions, imports, its package, the top level. */
	resolve(file: FileScope, name: string): ClassInfo | DefInfo | null {
		const local = file.locals.get(name);
		if (local) return local;
		const d = file.decl;
		for (const imp of d.imports) if (!imp.endsWith(".*") && imp.slice(imp.lastIndexOf(".") + 1) === name) return this.byName.get(imp) ?? null;
		const inPkg = this.byName.get(d.pkg ? `${d.pkg}.${name}` : name);
		if (inPkg) return inPkg;
		for (const imp of d.imports) if (imp.endsWith(".*")) {
			const x = this.byName.get(`${imp.slice(0, -1)}${name}`);
			if (x) return x;
		}
		return this.byName.get(name) ?? null;
	}

	/** A type annotation (a bare name) as a class, if it is one of these. */
	classOf(file: FileScope, type: string): ClassInfo | null {
		const x = this.resolve(file, type);
		return isClass(x) ? x : null;
	}

	link(warn: (m: string) => void) {
		for (const c of this.classes) {
			const d = c.decl;
			if (d.ext) {
				const bare = d.ext.slice(d.ext.lastIndexOf(".") + 1);
				const user = d.ext.includes(".") ? this.byName.get(d.ext) : this.resolve(c.file, d.ext);
				if (isClass(user)) c.base = user;
				else if (FLASH_API.has(bare)) c.baseJs = `$f.${bare}`;
				else if (JS_CLASSES.has(bare)) c.baseJs = bare;
				else if (bare !== "Object") c.baseJs = `$r.cls(${JSON.stringify(bare)},null)`;
				if (!user && bare !== "Object" && !FLASH_API.has(bare) && !JS_CLASSES.has(bare)) warn(`${c.q} extends ${d.ext}: a class of the library, or one the player doesn't have`);
			}
			for (const i of d.impl) {
				const x = i.includes(".") ? this.byName.get(i) : this.resolve(c.file, i);
				if (isClass(x)) c.ifaces.push(x);
			}
		}
		// a line of inheritance that comes back to itself
		for (const c of this.classes) {
			const seen = new Set<ClassInfo>();
			for (let x: ClassInfo | null = c; x; x = x.base) {
				if (seen.has(x)) throw new ScriptError(`${c.q} extends itself`, c.decl.line);
				seen.add(x);
			}
		}
		for (const c of this.classes)
			for (const m of c.decl.members) (m.isStatic ? c.statics : c.own).set(`${m.kind === "set" ? "set " : ""}${m.name}`, { m, owner: c, js: m.name });
		// private members whose names meet another member in the same line of inheritance
		for (const c of this.classes)
			for (const [k, mi] of c.own) {
				if (mi.m.access !== "private") continue;
				const name = mi.m.name;
				const meets = (x: ClassInfo) => x !== c && (x.own.has(name) || x.own.has(`set ${name}`));
				let clash = false;
				for (let x = c.base; x && !clash; x = x.base) clash = meets(x);
				for (const x of this.classes) if (!clash) for (let y = x.base; y; y = y.base) if (y === c && meets(x)) clash = true;
				if (clash) {
					mi.js = `${name}$${c.id}`;
					const other = c.own.get(k.startsWith("set ") ? name : `set ${name}`);
					if (other) other.js = mi.js;
				}
			}
	}

	/** An instance member as seen from code of `from` (its own private ones, everyone's others). */
	member(c: ClassInfo, name: string, from: ClassInfo | null, setter = false): MemberInfo | null {
		for (let x: ClassInfo | null = c; x; x = x.base) {
			const m = (setter ? x.own.get(`set ${name}`) : null) ?? x.own.get(name) ?? (setter ? null : x.own.get(`set ${name}`));
			if (m && (m.m.access !== "private" || x === from)) return m;
		}
		return null;
	}

	staticMember(c: ClassInfo, name: string, from: ClassInfo | null): MemberInfo | null {
		const m = c.statics.get(name) ?? c.statics.get(`set ${name}`);
		return m && (m.m.access !== "private" || c === from) ? m : null;
	}

	/** A static member in the scope of `c`'s code: its own and its base classes'. */
	staticInScope(c: ClassInfo, name: string): MemberInfo | null {
		for (let x: ClassInfo | null = c; x; x = x.base) {
			const m = this.staticMember(x, name, c === x ? x : null);
			if (m) return m;
		}
		return null;
	}
}

const typeOfClass = (q: string) => `class:${q}`;

/** One class's code. */
class ClassEmitter extends Emitter {
	readonly world: World;
	readonly file: FileScope;
	readonly cls: ClassInfo | null;
	/** In static code (static methods, the class's setup): no `this`. */
	isStatic = false;
	/** How deep in functions inside a method: there members go through `$s`. */
	private depth = 0;
	private needS = false;
	/** In the AS3 constructor: super(...) calls the base class's. */
	private inCtor = false;
	readonly warnings: string[];

	constructor(world: World, file: FileScope, cls: ClassInfo | null, linked: Set<string>, warnings: string[]) {
		super(new Map(), linked);
		this.world = world;
		this.file = file;
		this.cls = cls;
		this.warnings = warnings;
		this.self = "this";
	}

	/** What members are reached through here. */
	private selfRef(): string {
		if (this.depth > 0) {
			this.needS = true;
			return "$s";
		}
		return "this";
	}

	private classRef(c: ClassInfo): string {
		return `$c.${c.key}`;
	}

	/** A member, from this class's code: a method not called is bound to its object. */
	private memberRef(on: string, mi: MemberInfo): string {
		if (mi.m.isStatic) return `${this.classRef(mi.owner)}.${mi.js}`;
		if (mi.m.kind === "method" && !this.calling) return `$r.m(${on},${JSON.stringify(mi.js)})`;
		return `${on}.${mi.js}`;
	}

	protected override ref(name: string): string {
		if (this.lookup(name) !== undefined) return safe(name);
		if (name === "trace") return "$f.trace";
		if (name === "arguments") return name;
		const c = this.cls;
		if (c) {
			if (!this.isStatic) {
				const mi = this.world.member(c, name, c);
				if (mi) return this.memberRef(this.selfRef(), mi);
			}
			const si = this.world.staticInScope(c, name);
			if (si) return this.memberRef("", si);
		}
		const def = this.world.resolve(this.file, name);
		if (isClass(def)) return this.classRef(def);
		if (def) return def.js;
		if (FLASH_API.has(name) && !this.linked.has(name)) return `$f.${name}`;
		if (GLOBALS.has(name)) return name;
		const inherits = !!c && !this.isStatic && this.extendsFlash(c);
		// (a class of the library, without a file of its own)
		if (/^[A-Z]/.test(name)) return `$r.cls(${JSON.stringify(name)},${inherits ? this.selfRef() : "null"})`;
		// (a member of the Flash class it extends: x, addChild, stage...)
		if (inherits) return `${this.selfRef()}.${name}`;
		throw new ScriptError(`${name} isn't defined, or the player doesn't have it`, 0);
	}

	/** Whether a class extends one of the Flash API's (whose members aren't known here). */
	private extendsFlash(c: ClassInfo): boolean {
		for (let x: ClassInfo | null = c; x; x = x.base) if (x.baseJs) return true;
		return false;
	}

	/** The class an expression's value is an instance of, or (`class:`) the class it names. */
	protected override typeIn(x: Expr): string {
		switch (x.k) {
			case "this":
				return this.cls && this.depth === 0 ? this.cls.q : "*";
			case "id": {
				const local = this.lookup(x.name);
				if (local !== undefined) return this.qualify(local);
				const c = this.cls;
				if (c) {
					const mi = (!this.isStatic && this.world.member(c, x.name, c)) || this.world.staticInScope(c, x.name);
					if (mi) return mi.m.kind === "method" ? "Function" : this.qualify(mi.m.type, mi.owner.file);
				}
				const def = this.world.resolve(this.file, x.name);
				if (isClass(def)) return typeOfClass(def.q);
				if (def?.v) return this.qualify(def.v.type, def.file);
				return "*";
			}
			case "member": {
				const mi = this.memberOf(x.o, x.name);
				if (mi) return mi.m.kind === "method" ? "Function" : this.qualify(mi.m.type, mi.owner.file);
				return super.typeIn(x);
			}
			case "call": {
				const f = x.f;
				const mi = f.k === "member" ? this.memberOf(f.o, f.name) : f.k === "id" && this.cls && this.lookup(f.name) === undefined ? ((!this.isStatic && this.world.member(this.cls, f.name, this.cls)) || this.world.staticInScope(this.cls, f.name)) : null;
				if (mi?.m.kind === "method") return this.qualify(mi.m.type, mi.owner.file);
				return "*";
			}
			case "new":
				if (x.f.k === "id" && this.lookup(x.f.name) === undefined) {
					const c = this.world.resolve(this.file, x.f.name);
					if (isClass(c)) return c.q;
				}
				return "*";
			case "bin":
				if (x.op === "as" && x.b.k === "id") {
					const c = this.world.resolve(this.file, x.b.name);
					if (isClass(c)) return c.q;
				}
				return "*";
			default:
				return super.typeIn(x);
		}
	}

	/** A type annotation: a class of these by its qualified name, the rest as written. */
	private qualify(type: string, file = this.file): string {
		if (type === "*" || type === DECLARED) return type;
		const c = this.world.classOf(file, type);
		return c ? c.q : type;
	}

	private infoOf(type: string): ClassInfo | null {
		const x = this.world.byName.get(type.startsWith("class:") ? type.slice(6) : type) ?? this.world.classes.find((c) => c.q === type.replace(/^class:/, ""));
		return isClass(x) ? x : null;
	}

	/** The member `o.name` is, where the class of `o` is known. */
	private memberOf(o: Expr, name: string, setter = false): MemberInfo | null {
		if (o.k === "super") return this.cls?.base ? this.world.member(this.cls.base, name, null, setter) : null;
		const t = this.typeIn(o);
		const c = this.infoOf(t);
		if (!c) return null;
		if (t.startsWith("class:")) return this.world.staticMember(c, name, this.cls);
		return this.world.member(c, name, this.cls, setter);
	}

	protected override member(o: Expr, name: string): string {
		if (o.k === "super") {
			if (this.depth > 0) throw new ScriptError("super can't be used in a function inside a method", 0);
			if (this.isStatic) throw new ScriptError("super can't be used in static code", 0);
			const mi = this.memberOf(o, name);
			const js = mi?.js ?? name;
			if (mi?.m.kind === "method" && !this.calling) return `super.${js}.bind(this)`;
			return `super.${js}`;
		}
		const mi = this.memberOf(o, name);
		if (mi) {
			if (mi.m.isStatic) return `${this.classRef(mi.owner)}.${mi.js}`;
			const on = this.plain(o);
			if (mi.m.kind === "method" && !this.calling) return `$r.m(${on},${JSON.stringify(mi.js)})`;
			return `${on}.${mi.js}`;
		}
		return super.member(o, name);
	}

	protected override call(f: Expr, args: Expr[]): string {
		if (f.k === "super") {
			if (!this.inCtor || this.depth > 0) throw new ScriptError("super() is called in the constructor only", 0);
			const list = args.map((a) => this.plain(a)).join(",");
			return this.superCall(list, args.length);
		}
		if (f.k === "member" && f.o.k !== "super" && this.memberOf(f.o, f.name)?.m.kind === "method") return `${this.callee(f)}(${args.map((a) => this.plain(a)).join(",")})`;
		// (a method of the class, written with a capital: a call, not a cast)
		if (f.k === "id" && this.cls && this.lookup(f.name) === undefined) {
			const mi = (!this.isStatic && this.world.member(this.cls, f.name, this.cls)) || this.world.staticInScope(this.cls, f.name);
			if (mi) return `${this.callee(f)}(${args.map((a) => this.plain(a)).join(",")})`;
		}
		return super.call(f, args);
	}

	/** super(...) in the constructor: the base class's AS3 constructor, or the Flash class's own. */
	private superCall(list: string, n: number): string {
		const c = this.cls!;
		if (c.base) return `this.$${c.base.id}(${list})`;
		if (!c.baseJs || !n) return "void 0";
		return `$r.base(this,${c.baseJs},[${list}])`;
	}

	/** Assigning to a member: the setter's own name when a private pair was renamed, the member's type. */
	protected override typeOfTarget(a: Expr): string {
		return this.typeIn(a);
	}

	override func(f: FuncDecl, asExpression: boolean, member = false): string {
		this.depth++;
		const js = super.func(f, asExpression, member);
		this.depth--;
		return js;
	}

	/** A method of the class: `(params){...}`, with `$s` when functions inside use the members. */
	method(f: FuncDecl, isStatic: boolean, pre = ""): string {
		const was = { s: this.isStatic, need: this.needS, self: this.self };
		this.isStatic = isStatic;
		this.needS = false;
		this.self = "this";
		const js = this.funcBody({ ...f, name: "" }, false, () => (this.needS ? "var $s=this;" : "") + pre);
		this.isStatic = was.s;
		this.needS = was.need;
		this.self = was.self;
		return js;
	}

	/** The AS3 constructor: the fields, then the body (with super() first where it doesn't say). */
	ctor(f: FuncDecl | null, fields: string): string {
		const decl: FuncDecl = f ?? { name: "", params: [], ret: "void", body: [] };
		this.inCtor = true;
		const implicit = callsSuper(decl.body) ? "" : `${this.superCall("", 0)};`;
		const js = this.method(decl, false, fields + (implicit === "void 0;" ? "" : implicit));
		this.inCtor = false;
		return js;
	}

	/** A field's value: as written, converted to its type, or its type's default. */
	fieldValue(m: Member): string {
		if (!m.init) return defaultOf(m.type);
		return this.coerceTo(m.type, this.expr(m.init), m.init);
	}

	coerceTo(type: string, js: string, x?: Expr): string {
		return this.coerce(type, js, x);
	}

	/** Statements in static code (the class's setup). */
	statics(stmts: Stmt[]): string {
		const was = this.isStatic;
		this.isStatic = true;
		const vars = new Map<string, string>();
		hoist(stmts, vars, null);
		this.scope = { vars, up: null };
		const decl = [...vars].filter(([, t]) => t !== DECLARED).map(([n, t]) => `${safe(n)}=${defaultOf(t)}`);
		const js = (decl.length ? `var ${decl.join(",")};` : "") + stmts.map((s) => this.stmt(s, false)).join("");
		this.scope = null;
		this.isStatic = was;
		return js;
	}
}

/** The JavaScript of one class (or interface) for the registry. */
function emitClass(world: World, c: ClassInfo, opts: ClassOptions, linked: Set<string>, warnings: string[]): string {
	const d = c.decl;
	const em = new ClassEmitter(world, c.file, c, linked, warnings);
	const name = flashName(c.q);
	if (d.kind === "interface") return `$d(${JSON.stringify(c.key)},function(){return $r.iface(${JSON.stringify(name)},[${c.ifaces.map((i) => `$c.${i.key}`).join(",")}])});`;
	const declared = new Set(opts.instances?.[c.q] ?? []);
	const parts: string[] = [];
	// the object is made by the JS constructors; the AS3 one runs once, from the class that was asked for
	if (c.base) parts.push(`constructor(...a){super($r.NEW);if(a[0]!==$r.NEW)this.$${c.id}(...a)}`);
	else if (c.baseJs) parts.push(`constructor(...a){super();if(a[0]!==$r.NEW)this.$${c.id}(...a)}`);
	else parts.push(`constructor(...a){if(a[0]!==$r.NEW)this.$${c.id}(...a)}`);
	let fields = "";
	for (const m of d.members) {
		if (m.isStatic || (m.kind !== "var" && m.kind !== "const")) continue;
		if (m.embed) warnings.push(`${c.q}.${m.name}: assets embedded with [Embed] aren't exported`);
		// (an instance on the symbol's timeline: the player hands it over)
		if (declared.has(m.name)) continue;
		const mi = c.own.get(m.name)!;
		fields += `this.${mi.js}=${em.fieldValue(m)};`;
	}
	parts.push(`$${c.id}${em.ctor(d.ctor, fields)}`);
	const has = new Set<string>();
	for (const m of d.members) {
		if (m.kind === "var" || m.kind === "const" || !m.f || m.f.bodiless) continue;
		const mi = (m.isStatic ? c.statics : c.own).get(`${m.kind === "set" ? "set " : ""}${m.name}`)!;
		const pre = m.isStatic ? "static " : "";
		const kw = m.kind === "get" ? "get " : m.kind === "set" ? "set " : "";
		parts.push(`${pre}${kw}${mi.js}${em.method(m.f, m.isStatic)}`);
		has.add(`${pre}${kw}${m.name}`);
	}
	// a getter or setter overridden alone keeps the other half of the base class's
	for (const m of d.members) {
		if (m.isStatic || (m.kind !== "get" && m.kind !== "set")) continue;
		const other = m.kind === "get" ? "set" : "get";
		if (has.has(`${other} ${m.name}`)) continue;
		const js = c.own.get(`${m.kind === "set" ? "set " : ""}${m.name}`)!.js;
		let inBase = false;
		for (let x = c.base; x && !inBase; x = x.base) inBase = x.own.has(other === "set" ? `set ${m.name}` : m.name) || !!x.baseJs;
		if (inBase || (!c.base && c.baseJs)) parts.push(other === "get" ? `get ${js}(){return super.${js}}` : `set ${js}(v){super.${js}=v}`);
		has.add(`${other} ${m.name}`);
	}
	// (AS3's Object prints the class's name)
	if (!c.base && !c.baseJs && !d.members.some((m) => m.name === "toString" && !m.isStatic)) parts.push(`toString(){return $r.objStr(this)}`);
	const ext = c.base ? ` extends $c.${c.base.key}` : c.baseJs ? ` extends ${c.baseJs}` : "";
	const make = `var C=class $${d.name}${ext}{${parts.join("")}};C.$n=${JSON.stringify(name)};${c.ifaces.length ? `C.$i=[${c.ifaces.map((i) => `$c.${i.key}`).join(",")}];` : ""}return C`;
	// statics and the code in the class body, in the order written
	let setup = "";
	const run = (stmts: Stmt[]) => (setup += em.statics(stmts));
	const inits = d.init.slice();
	for (let i = 0; i <= d.members.length; i++) {
		while (inits.length && inits[0]!.at === i) run([inits.shift()!.s]);
		const m = d.members[i];
		if (!m || !m.isStatic || (m.kind !== "var" && m.kind !== "const")) continue;
		em.isStatic = true;
		setup += `C.${c.statics.get(m.name)!.js}=${em.fieldValue(m)};`;
		em.isStatic = false;
	}
	return `$d(${JSON.stringify(c.key)},function(){${make}}${setup ? `,function(C){${setup}}` : ""});`;
}

/** Compiles classes. A file that can't be parsed is left out and reported; its classes are missing. */
export function compileClasses(sources: ClassSource[], opts: ClassOptions = {}, linked: Set<string> = new Set()): CompiledClasses {
	const failed: CompiledClasses["failed"] = [];
	const warnings: string[] = [];
	const world = new World();
	for (const s of sources) {
		try {
			world.add({ path: s.path, decl: parseClassFile(s.code), locals: new Map() });
		} catch (e) {
			if (!(e instanceof ScriptError)) throw e;
			failed.push({ file: s.path, line: e.line, message: e.message });
		}
	}
	try {
		world.link((m) => warnings.push(m));
	} catch (e) {
		if (!(e instanceof ScriptError)) throw e;
		failed.push({ file: "", line: e.line, message: e.message });
		return { js: "", failed, classes: new Map(), warnings, scope: () => null };
	}
	const out: string[] = [];
	for (const c of world.classes) {
		try {
			out.push(emitClass(world, c, opts, linked, warnings));
		} catch (e) {
			if (!(e instanceof ScriptError)) throw e;
			failed.push({ file: c.file.path, line: e.line || c.decl.line, message: e.message });
		}
	}
	// functions and variables of packages
	const defs: string[] = [];
	for (const d of world.defs) {
		const em = new ClassEmitter(world, d.file, null, linked, warnings);
		try {
			if (d.f) defs.push(`function ${d.js}${em.method(d.f, true)}`);
			else {
				em.isStatic = true;
				defs.push(`var ${d.js}=${d.v!.init ? em.coerceTo(d.v!.type, em.expr(d.v!.init), d.v!.init) : defaultOf(d.v!.type)};`);
			}
		} catch (e) {
			if (!(e instanceof ScriptError)) throw e;
			failed.push({ file: d.file.path, line: e.line, message: e.message });
		}
	}
	const classes = new Map(world.classes.map((c) => [c.q, c]));
	const scope = (q: string): ClassScope | null => {
		const c = classes.get(q);
		if (!c) return null;
		return {
			member(name) {
				const mi = world.member(c, name, c) ?? world.staticInScope(c, name);
				return mi ? { js: mi.js, isStatic: mi.m.isStatic, method: mi.m.kind === "method", type: mi.m.type, owner: mi.owner.q } : null;
			},
		};
	};
	if (!world.classes.length && !world.defs.length) return { js: "", failed, classes, warnings, scope };
	const names = Object.fromEntries(world.classes.filter((c) => !c.decl.local).map((c) => [c.q, c.key]));
	const js =
		`function($f,$r){var $c={};` +
		`function $d(k,make,setup){Object.defineProperty($c,k,{configurable:true,enumerable:true,get:function(){var C=make();Object.defineProperty($c,k,{value:C,enumerable:true});if(setup)setup(C);return C}})}` +
		out.join("") +
		defs.join("") +
		`return{c:$c,n:${JSON.stringify(names)}}}`;
	return { js, failed, classes, warnings, scope };
}

export { INT };
