/**
 * Frame scripts of a timeline to JavaScript for the JS player's script runtime (src/player/script.ts).
 *
 * All frame scripts of a timeline are one class in AS3: functions and variables declared at the top
 * level of any frame are the timeline's members, there from the start. So every name is looked up
 * here: a local stays a local, a member or anything else unknown (properties of the timeline, its
 * instances by name) goes to `$t`, the timeline's object; classes go to `$f`, the Flash API.
 * Assignments to variables of a number type convert as in AS3.
 */
import { parseScript, ScriptError, type Expr, type FuncDecl, type Stmt, type VarDecl } from "./parser.ts";

/** Names that stay what they are in JavaScript. */
export const GLOBALS = new Set([
	"Math",
	"JSON",
	"Date",
	"RegExp",
	"Object",
	"Array",
	"Function",
	"Error",
	"RangeError",
	"TypeError",
	"ReferenceError",
	"SyntaxError",
	"EvalError",
	"URIError",
	"String",
	"Number",
	"Boolean",
	"parseInt",
	"parseFloat",
	"isNaN",
	"isFinite",
	"encodeURI",
	"encodeURIComponent",
	"decodeURI",
	"decodeURIComponent",
	"escape",
	"unescape",
	"undefined",
	"NaN",
	"Infinity",
]);

/** What `$f` gives: the part of the Flash API the runtime has (see src/player/script.ts). */
export const FLASH_API = new Set([
	"XML",
	"XMLList",
	"isXMLName",
	"Namespace",
	"QName",
	"FLVPlayback",
	"VideoEvent",
	"MetadataEvent",
	"VideoState",
	"VideoScaleMode",
	"CuePointType",
	"Button",
	"LabelButton",
	"CheckBox",
	"RadioButton",
	"RadioButtonGroup",
	"ComboBox",
	"List",
	"TextInput",
	"TextArea",
	"Label",
	"NumericStepper",
	"Slider",
	"ColorPicker",
	"ProgressBar",
	"UILoader",
	"DataGrid",
	"DataGridColumn",
	"TileList",
	"ScrollPane",
	"UIScrollBar",
	"ScrollBar",
	"ScrollEvent",
	"ScrollBarDirection",
	"DataProvider",
	"UIComponent",
	"ComponentEvent",
	"ListEvent",
	"SliderEvent",
	"ColorPickerEvent",
	"DataChangeEvent",
	"DataChangeType",
	"ProgressBarMode",
	"ProgressBarDirection",
	"SliderDirection",
	"ButtonLabelPlacement",
	"ScrollPolicy",
	"StyleManager",
	"trace",
	"navigateToURL",
	"getTimer",
	"setTimeout",
	"clearTimeout",
	"setInterval",
	"clearInterval",
	"getDefinitionByName",
	"fscommand",
	"MovieClip",
	"Sprite",
	"Shape",
	"Bitmap",
	"BitmapData",
	"DisplayObject",
	"DisplayObjectContainer",
	"InteractiveObject",
	"SimpleButton",
	"Stage",
	"StageAlign",
	"StageScaleMode",
	"StageDisplayState",
	"Graphics",
	"Event",
	"MouseEvent",
	"KeyboardEvent",
	"TimerEvent",
	"FocusEvent",
	"TextEvent",
	"Keyboard",
	"int",
	"uint",
	"getQualifiedClassName",
	"getQualifiedSuperclassName",
	"ArgumentError",
	"IOError",
	"SecurityError",
	"EOFError",
	"IllegalOperationError",
	"DefinitionError",
	"EventDispatcher",
	"FrameLabel",
	"Scene",
	"LoaderInfo",
	"StageQuality",
	"BlendMode",
	"PixelSnapping",
	"GradientType",
	"SpreadMethod",
	"InterpolationMethod",
	"LineScaleMode",
	"CapsStyle",
	"JointStyle",
	"MouseCursor",
	"ProgressEvent",
	"IOErrorEvent",
	"HTTPStatusEvent",
	"NetStatusEvent",
	"SecurityErrorEvent",
	"AsyncErrorEvent",
	"TextFormatAlign",
	"AntiAliasType",
	"GridFitType",
	"Video",
	"URLVariables",
	"URLLoader",
	"URLRequestMethod",
	"URLLoaderDataFormat",
	"sendToURL",
	"NetConnection",
	"NetStream",
	"SharedObject",
	"ExternalInterface",
	"Security",
	"System",
	"Tween",
	"TweenEvent",
	"None",
	"Regular",
	"Strong",
	"Back",
	"Bounce",
	"Elastic",
	"BevelFilter",
	"ColorMatrixFilter",
	"BitmapFilterQuality",
	"BitmapFilterType",
	"Loader",
	"ProLoader",
	"Mouse",
	"Timer",
	"TextField",
	"TextFormat",
	"TextFieldAutoSize",
	"TextFieldType",
	"Sound",
	"SoundChannel",
	"SoundTransform",
	"SoundMixer",
	"URLRequest",
	"Point",
	"Rectangle",
	"Matrix",
	"ColorTransform",
	"Transform",
	"Vector",
	"Dictionary",
	"ByteArray",
	"Capabilities",
	"BlurFilter",
	"GlowFilter",
	"DropShadowFilter",
]);

/** E4X: the methods of XML and XMLList (a child of such a name is reached through $r.xc), and what they give. */
const XML_RETURNS: Record<string, string> = {
	attribute: "XMLList",
	attributes: "XMLList",
	child: "XMLList",
	children: "XMLList",
	elements: "XMLList",
	descendants: "XMLList",
	text: "XMLList",
	comments: "XMLList",
	processingInstructions: "XMLList",
	parent: "XML",
	appendChild: "XML",
	prependChild: "XML",
	insertChildAfter: "XML",
	insertChildBefore: "XML",
	setChildren: "XML",
	replace: "XML",
	normalize: "XML",
	copy: "",
	name: "String",
	localName: "String",
	nodeKind: "String",
	toString: "String",
	toXMLString: "String",
	length: "int",
	childIndex: "int",
	hasOwnProperty: "Boolean",
	contains: "Boolean",
	hasSimpleContent: "Boolean",
	hasComplexContent: "Boolean",
	valueOf: "",
	setName: "*",
	setLocalName: "*",
	namespace: "*",
	inScopeNamespaces: "*",
	addNamespace: "*",
	removeNamespace: "*",
	setNamespace: "*",
	namespaceDeclarations: "*",
	propertyIsEnumerable: "Boolean",
};
const XMLISH = new Set(["XML", "XMLList"]);

/** JavaScript's reserved words that are plain names in AS3. */
const JS_RESERVED = new Set(["await", "let", "yield", "async", "of", "enum", "implements", "private", "public", "protected", "static", "eval", "with", "debugger", "export", "extends", "class", "super"]);

export const safe = (n: string) => (JS_RESERVED.has(n) ? `$_${n}` : n);

interface Scope {
	vars: Map<string, string>;
	up: Scope | null;
}

/** The class of a timeline (the document class, a symbol's): its frame scripts are part of it. */
export interface ClassScope {
	/** A member by its AS3 name, as the class's own code reaches it (its private ones too). */
	member(name: string): { js: string; isStatic: boolean; method: boolean; type: string; owner: string } | null;
}

export interface ScriptUnit {
	/** 0-based frame. */
	frame: number;
	code: string;
}

export interface CompiledScripts {
	/** JavaScript: an expression, function($t, $f, $r) returning the frame functions by frame. */
	js: string;
	/** Scripts that can't be compiled, and why; their frames do nothing. */
	failed: { frame: number; line: number; message: string }[];
	/** Flash API names used that the runtime doesn't have. */
	unknown: string[];
}

/** Collects what a statement list declares at function level (var hoists out of blocks). */
/** The type of a function declared by name: unlike a variable of type Function, it has a value at once. */
export const DECLARED = "function!";

export function hoist(body: Stmt[], out: Map<string, string>, fns: FuncDecl[] | null) {
	const walk = (s: Stmt | null | undefined) => {
		if (!s) return;
		switch (s.k) {
			case "var":
				for (const d of s.decls) if (!out.has(d.name) || d.type !== "*") out.set(d.name, d.type);
				break;
			case "func":
				out.set(s.f.name, DECLARED);
				fns?.push(s.f);
				break;
			case "block":
				s.body.forEach(walk);
				break;
			case "if":
				walk(s.a);
				walk(s.b);
				break;
			case "for":
				walk(s.init);
				walk(s.body);
				break;
			case "forin":
				if (s.decl) out.set(s.decl.name, s.decl.type);
				walk(s.body);
				break;
			case "while":
			case "do":
			case "label":
				walk(s.body);
				break;
			case "switch":
				for (const c of s.cases) c.body.forEach(walk);
				break;
			case "try":
				s.body.forEach(walk);
				for (const c of s.catches) c.body.forEach(walk);
				s.final?.forEach(walk);
				break;
		}
	};
	body.forEach(walk);
}

export const INT = new Set(["int", "uint"]);

/** A variable's default in AS3. */
export function defaultOf(type: string): string {
	if (INT.has(type)) return "0";
	if (type === "Number") return "NaN";
	if (type === "Boolean") return "false";
	if (type === "*") return "undefined";
	return "null";
}

export class Emitter {
	unknown = new Set<string>();
	protected scope: Scope | null = null;
	/** The timeline's members and their types. */
	protected members: Map<string, string>;
	protected linked: Set<string>;
	/** The timeline's class, if it has one of the document's own. */
	protected klass: ClassScope | null;
	constructor(members: Map<string, string>, linked: Set<string>, cls: ClassScope | null = null) {
		this.members = members;
		this.linked = linked;
		this.klass = cls;
	}
	protected ret = "*";
	/** What `this` is: the timeline at the top of a frame and in its functions; in a function literal, what it is called on. */
	protected self = "$t";
	/** Rendering what is called: a method stays a method (not one bound to its object). */
	protected calling = false;
	/** In an E4X filter's predicate: names are looked up on the item first ($x). */
	protected filters = 0;

	/** The declared type of an expression, as far as it is known here. */
	protected typeIn(x: Expr): string {
		if (x.k === "id") return this.filters ? "XMLList" : (this.lookup(x.name) ?? this.members.get(x.name) ?? this.klass?.member(x.name)?.type ?? "*");
		if (x.k === "member" && x.o.k === "this") return this.members.get(x.name) ?? "*";
		if (x.k === "index") {
			const t = this.typeIn(x.o);
			const m = /^Vector\.<(.*)>$/.exec(t);
			if (m) return m[1]!;
			if (XMLISH.has(t)) return "XML";
		}
		return this.xmlType(x);
	}

	/** E4X: XML or XMLList where an expression is one, else "*". */
	protected xmlType(x: Expr): string {
		switch (x.k) {
			case "xml":
				return x.list ? "XMLList" : "XML";
			case "xattr":
			case "xdesc":
			case "xchild":
			case "xfilter":
			case "xq":
				return "XMLList";
			case "member":
				return x.o.k !== "this" && XMLISH.has(this.typeIn(x.o)) ? "XMLList" : "*";
			case "new":
				return x.f.k === "id" && XMLISH.has(x.f.name) && this.lookup(x.f.name) === undefined ? x.f.name : "*";
			case "call": {
				const f = x.f;
				if (f.k === "id" && XMLISH.has(f.name) && this.lookup(f.name) === undefined) return f.name;
				const on = f.k === "member" ? this.typeIn(f.o) : f.k === "id" && this.filters && this.lookup(f.name) === undefined ? "XML" : "";
				const name = f.k === "member" || f.k === "id" ? f.name : "";
				if (!XMLISH.has(on) || !(name in XML_RETURNS)) return "*";
				return XML_RETURNS[name] || on;
			}
		}
		return "*";
	}

	protected isVector(x: Expr) {
		return this.typeIn(x).startsWith("Vector.<");
	}

	protected isDictionary(x: Expr): boolean {
		return this.typeIn(x) === "Dictionary";
	}

	protected lookup(name: string): string | undefined {
		for (let s = this.scope; s; s = s.up) {
			const t = s.vars.get(name);
			if (t !== undefined) return t;
		}
		return undefined;
	}

	protected ref(name: string): string {
		if (this.lookup(name) !== undefined) return safe(name);
		if (name === "trace") return "$f.trace";
		if (name === "arguments") return name;
		if (this.members.has(name)) return `$t.${safe(name) === name ? name : `["${name}"]`}`;
		const mi = this.klass?.member(name);
		if (mi) {
			if (mi.isStatic) return `$r.cls(${JSON.stringify(mi.owner)},null).${mi.js}`;
			return mi.method && !this.calling ? `$r.m($t,${JSON.stringify(mi.js)})` : `$t.${mi.js}`;
		}
		if (GLOBALS.has(name)) return name;
		if (FLASH_API.has(name) && !this.linked.has(name)) return `$f.${name}`;
		// a class of the library (linkage), or what the timeline has
		if (/^[A-Z]/.test(name)) return `$r.cls("${name}",$t)`;
		return `$t.${name}`;
	}

	/** The value converted to a variable's type. */
	protected coerce(type: string, js: string, x?: Expr): string {
		switch (type) {
			case "int":
				return x?.k === "num" && /^\d+$/.test(x.v) ? js : `(${js}|0)`;
			case "uint":
				return x?.k === "num" && /^\d+$/.test(x.v) ? js : `(${js}>>>0)`;
			case "Number":
				return x?.k === "num" ? js : `+(${js})`;
			case "Boolean":
				return x?.k === "lit" ? js : `!!(${js})`;
			case "String":
				return x?.k === "str" ? js : `$r.str(${js})`;
			default:
				return js;
		}
	}

	protected typeOfTarget(a: Expr): string {
		return this.typeIn(a);
	}

	expr(x: Expr): string {
		switch (x.k) {
			case "num":
				// (a leading zero means nothing in AS3)
				return /^0\d+$/.test(x.v) ? x.v.replace(/^0+(?=\d)/, "") : x.v;
			case "vector":
				return JSON.stringify(`Vector.<${x.of}>`);
			case "str":
				return JSON.stringify(x.v);
			case "regex": {
				// AS3's x flag: spaces and comments in the pattern don't count. JavaScript hasn't got it.
				const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(x.v);
				if (!m || !m[2]!.includes("x")) return x.v;
				const plain = m[1]!.replace(/\\[\s\S]|\s+|#.*$/gm, (t) => (t[0] === "\\" ? t : ""));
				return `$r.re(${JSON.stringify(plain)},${JSON.stringify(m[2]!.replace("x", ""))})`;
			}
			case "lit":
				return x.v;
			case "id":
				// (in a filter's predicate the item's children come first, as in a with block)
				if (this.filters && !this.calling) return `$r.xn($x,${JSON.stringify(x.name)},${this.ref(x.name)})`;
				return this.ref(x.name);
			case "xml":
				return `$r.xml(${x.list ? 1 : 0}${x.parts.map((q) => (typeof q === "string" ? `,${JSON.stringify(q)}` : `,[${q.ctx},${this.plain(q.x)}]`)).join("")})`;
			case "xattr":
				if (x.ns) return `$r.xq(${x.o ? this.plain(x.o) : "$x"},${this.plain(x.ns)},${JSON.stringify(x.name)},1)`;
				return `$r.xa(${x.o ? this.plain(x.o) : "$x"},${x.name !== null ? JSON.stringify(x.name) : this.plain(x.i!)})`;
			case "xdesc":
				if (x.ns) return `$r.xq(${this.plain(x.o)},${this.plain(x.ns)},${JSON.stringify(x.name.replace(/^@/, ""))},${x.name[0] === "@" ? 3 : 2})`;
				return `$r.xd(${this.plain(x.o)},${JSON.stringify(x.name)})`;
			case "xq":
				return `$r.xq(${this.plain(x.o)},${this.plain(x.ns)},${JSON.stringify(x.name)},0)`;
			case "xchild":
				return `$r.xc(${this.plain(x.o)},${JSON.stringify(x.name)})`;
			case "xfilter": {
				const o = this.plain(x.o);
				this.filters++;
				const pred = this.plain(x.pred);
				this.filters--;
				return `$r.xf(${o},($x)=>${pred})`;
			}
			case "this":
				return this.self;
			case "super":
				throw new ScriptError("super must be called or followed by a name", 0);
			case "array":
				return `[${x.items.map((i) => this.expr(i)).join(",")}]`;
			case "object":
				return `{${x.props.map(([k, v]) => `${JSON.stringify(k)}:${this.expr(v)}`).join(",")}}`;
			case "func":
				return this.func(x.f, true);
			case "unary":
				if (x.op === "delete" && x.x.k === "xattr") return `$r.xdel(${x.x.o ? this.plain(x.x.o) : "$x"},${x.x.name !== null ? JSON.stringify(`@${x.x.name}`) : `"@"+(${this.plain(x.x.i!)})`})`;
				if (x.op === "typeof" && XMLISH.has(this.typeIn(x.x))) return '"xml"';
				if (x.op === "typeof" && x.x.k === "id") {
					// (a typed variable has its type's name, null or not; a class is an object)
					const t = this.typeIn(x.x);
					if (t === "String") return '"string"';
					if (t === "Boolean") return '"boolean"';
					if (t === "Number" || INT.has(t)) return '"number"';
					if (t === "*" && this.lookup(x.x.name) === undefined && !this.members.has(x.x.name) && /^[A-Z]/.test(x.x.name) && (GLOBALS.has(x.x.name) || FLASH_API.has(x.x.name))) return '"object"';
				}
				if (x.op === "delete" || x.op === "typeof" || x.op === "void") return `(${x.op} ${this.expr(x.x)})`;
				return `(${x.op}${this.expr(x.x)})`;
			case "update": {
				if (x.x.k === "index" && this.isVector(x.x.o)) {
					const o = this.expr(x.x.o),
						i = this.expr(x.x.i);
					const step = x.op === "++" ? 1 : -1;
					const set = `$r.vset(${o},${i},$r.vget(${o},${i})+${step})`;
					return x.prefix ? set : `(${set}-${step})`;
				}
				const js = this.expr(x.x);
				const t = this.typeOfTarget(x.x);
				// (overflow wraps; postfix gives the old value)
				if (INT.has(t)) {
					const wrap = t === "uint" ? ">>>0" : "|0";
					const step = x.op === "++" ? "+1" : "-1";
					const old = x.prefix ? "" : `,(${js}${x.op === "++" ? "-1" : "+1"})${wrap}`;
					return `(${js}=(${js}${step})${wrap}${old})`;
				}
				return x.prefix ? `(${x.op}${js})` : `(${js}${x.op})`;
			}
			case "bin":
				return this.binary(x);
			case "assign": {
				if (x.a.k === "xattr") {
					const o = x.a.o ? this.plain(x.a.o) : "$x";
					const n = x.a.name !== null ? JSON.stringify(`@${x.a.name}`) : `"@"+(${this.plain(x.a.i!)})`;
					const v = this.plain(x.b);
					return x.op === "=" ? `$r.xs(${o},${n},${v})` : `$r.xs(${o},${n},$r.xa(${o},${n}.slice(1))${x.op.slice(0, -1)}(${v}))`;
				}
				// (a child named like a method of XML)
				if (x.a.k === "member" && x.op === "=" && x.a.name in XML_RETURNS && XMLISH.has(this.typeIn(x.a.o))) return `$r.xs(${this.plain(x.a.o)},${JSON.stringify(x.a.name)},${this.plain(x.b)})`;
				if (x.a.k === "index" && this.isVector(x.a.o)) {
					const o = this.expr(x.a.o),
						i = this.expr(x.a.i),
						v = this.expr(x.b);
					return x.op === "=" ? `$r.vset(${o},${i},${v})` : `$r.vset(${o},${i},$r.vget(${o},${i})${x.op.slice(0, -1)}(${v}))`;
				}
				const a = this.expr(x.a);
				const b = this.expr(x.b);
				const t = this.typeOfTarget(x.a);
				if (x.op === "=") return `(${a}=${this.coerce(t, b, x.b)})`;
				if (t === "*" || (t !== "int" && t !== "uint" && t !== "Number" && t !== "String" && t !== "Boolean")) {
					if (x.op === "&&=" || x.op === "||=") return `(${a}=${a}${x.op.slice(0, 2)}${b})`;
					return `(${a}${x.op}${b})`;
				}
				return `(${a}=${this.coerce(t, `${a}${x.op.slice(0, -1)}(${b})`)})`;
			}
			case "cond":
				return `(${this.expr(x.c)}?${this.expr(x.a)}:${this.expr(x.b)})`;
			case "member":
				return this.member(x.o, x.name);
			case "index":
				if (this.isVector(x.o)) return `$r.vget(${this.expr(x.o)},${this.expr(x.i)})`;
				// (a Dictionary's keys are objects)
				return `${this.expr(x.o)}[${this.isDictionary(x.o) ? `$r.key(${this.expr(x.i)})` : this.expr(x.i)}]`;
			case "call":
				return this.call(x.f, x.args);
			case "new": {
				const list = x.args.map((a) => this.expr(a));
				if (x.f.k === "vector") return `$r.vec(${[JSON.stringify(x.f.of), ...list].join(",")})`;
				// (in AS3 these make plain values)
				if (x.f.k === "id" && this.lookup(x.f.name) === undefined) {
					if (x.f.name === "String") return list.length ? `$r.text(${list[0]})` : '""';
					if (x.f.name === "Number") return list.length ? `(+(${list[0]}))` : "0";
					if (x.f.name === "Boolean") return list.length ? `(!!(${list[0]}))` : "false";
				}
				// (an error's second argument is its number)
				if (x.f.k === "id" && /Error$/.test(x.f.name) && (GLOBALS.has(x.f.name) || FLASH_API.has(x.f.name)) && this.lookup(x.f.name) === undefined && list.length > 1) return `Object.assign(new (${this.expr(x.f)})(${list[0]}),{errorID:${list[1]}})`;
				return `new (${this.expr(x.f)})(${list.join(",")})`;
			}
			case "seq":
				return `(${x.items.map((i) => this.expr(i)).join(",")})`;
		}
	}

	/** The name of a package path (flash.utils.Timer), if that is what this is. */
	protected inPackage(o: Expr): boolean {
		for (let x = o; ; x = (x as { o: Expr }).o) {
			if (x.k === "id") return (x.name === "flash" || x.name === "fl") && this.lookup(x.name) === undefined && !this.members.has(x.name);
			if (x.k !== "member") return false;
		}
	}

	protected member(o: Expr, name: string): string {
		if (this.inPackage(o)) return this.ref(name);
		// (E4X: the children of that name, not the method of XML)
		if (!this.calling && name in XML_RETURNS && XMLISH.has(this.typeIn(o))) return `$r.xc(${this.plain(o)},${JSON.stringify(name)})`;
		// constants of AS3's Array
		if (o.k === "id" && o.name === "Array" && this.lookup("Array") === undefined) {
			const c: Record<string, number> = { CASEINSENSITIVE: 1, DESCENDING: 2, UNIQUESORT: 4, RETURNINDEXEDARRAY: 8, NUMERIC: 16 };
			if (name in c) return String(c[name]);
		}
		const n = /^[A-Za-z_$][\w$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
		const of = this.plain(o);
		return o.k === "num" ? `(${of})${n}` : `${of}${n}`;
	}

	/** An expression that isn't itself what is called (the object a method is called on, an argument). */
	protected plain(x: Expr): string {
		const was = this.calling;
		this.calling = false;
		const js = this.expr(x);
		this.calling = was;
		return js;
	}

	/** A class as `is` and `as` take it. */
	protected classOf(type: string): string {
		if (type === "int" || type === "uint" || type === "Number" || type === "String" || type === "Boolean" || type === "Class") return `"${type}"`;
		return type.startsWith("Vector.<") ? JSON.stringify(type) : this.ref(type);
	}

	protected binary(x: Extract<Expr, { k: "bin" }>): string {
		if ((x.op === "==" || x.op === "!=") && (XMLISH.has(this.typeIn(x.a)) || XMLISH.has(this.typeIn(x.b)))) return `(${x.op === "!=" ? "!" : ""}$r.xeq(${this.plain(x.a)},${this.plain(x.b)}))`;
		const a = this.expr(x.a);
		if (x.op === "as" || x.op === "is") {
			if (x.b.k === "vector") return `$r.${x.op}(${a},${this.expr(x.b)})`;
			const type = x.b.k === "id" ? x.b.name : x.b.k === "member" ? x.b.name : "*";
			const cls = type === "int" || type === "uint" || type === "Number" || type === "String" || type === "Boolean" || type === "Class" ? `"${type}"` : this.expr(x.b);
			return `$r.${x.op}(${a},${cls})`;
		}
		return `(${a}${x.op === "instanceof" || x.op === "in" ? ` ${x.op} ` : x.op}${this.expr(x.b)})`;
	}

	/** What is called, rendered as such. */
	protected callee(f: Expr): string {
		const was = this.calling;
		this.calling = f.k === "id" || f.k === "member";
		const js = this.expr(f);
		this.calling = was;
		return js;
	}

	protected call(f: Expr, args: Expr[]): string {
		const list = args.map((a) => this.plain(a)).join(",");
		if (f.k === "vector") return `$r.vec(${JSON.stringify(f.of)},${list})`;
		if (f.k === "id" && this.lookup(f.name) === undefined && !this.members.has(f.name) && !this.klass?.member(f.name)) {
			// conversions
			if (f.name === "XML") return `$f.XML.$from(${list})`;
			if (f.name === "Namespace" || f.name === "QName") return `new $f.${f.name}(${list})`;
			if (f.name === "XMLList") return `new $f.XMLList(${list})`;
			if (this.filters && f.name in XML_RETURNS) return `$x.${f.name}(${list})`;
			if (f.name === "int") return `(${list}|0)`;
			if (f.name === "uint") return `(${list}>>>0)`;
			if (f.name === "String" && args.length === 1) return `$r.text(${list})`;
			// a cast: Class(x)
			if (args.length === 1 && /^[A-Z]/.test(f.name) && (!GLOBALS.has(f.name) || f.name === "Object")) return `(${list})`;
		}
		if (f.k === "member" && (f.name === "sort" || f.name === "sortOn")) return `$r.${f.name}(${this.expr(f.o)}${list ? `,${list}` : ""})`;
		return `${this.callee(f)}(${list})`;
	}

	/** A function with its own scope. Named functions are members or locals, see `decl`. */
	func(f: FuncDecl, asExpression: boolean, member = false): string {
		const savedSelf = this.self;
		this.self = member ? "$t" : "this";
		const js = `function${asExpression && f.name ? ` ${safe(f.name)}` : ""}${this.funcBody(f, asExpression && !!f.name)}`;
		this.self = savedSelf;
		return js;
	}

	/**
	 * `(params){...}`: a function's own scope, its parameters as AS3 passes them, its locals. `named`:
	 * a function expression with a name, which it sees itself by. `pre`: code that goes first, asked
	 * for once the rest is written.
	 */
	protected funcBody(f: FuncDecl, named: boolean, pre?: () => string): string {
		const vars = new Map<string, string>();
		for (const p of f.params) vars.set(p.name, p.rest ? "Array" : p.type);
		const inner: FuncDecl[] = [];
		hoist(f.body, vars, inner);
		if (named) vars.set(f.name, DECLARED);
		const saved = this.scope;
		const savedRet = this.ret;
		this.scope = { vars, up: saved };
		this.ret = f.ret;
		const params = f.params.map((p) => (p.rest ? `...${safe(p.name)}` : safe(p.name))).join(",");
		// defaults by how many came: passing undefined isn't leaving out, and they don't count in .length
		const head = f.params
			.map((p, i) => {
				if (p.rest) return "";
				const n = safe(p.name);
				const given = p.init ? `if(arguments.length<${i + 1})${n}=${this.expr(p.init)};` : "";
				const typed = p.type === "int" || p.type === "uint" || p.type === "Number" || p.type === "String" || p.type === "Boolean";
				return given + (typed ? `${n}=${this.coerce(p.type, n)};` : "");
			})
			.join("");
		const paramNames = new Set(f.params.map((p) => p.name));
		const locals = [...vars].filter(([n]) => !paramNames.has(n) && !(named && n === f.name)).map(([n, t]) => (t === DECLARED ? null : `${safe(n)}=${defaultOf(t)}`));
		const decl = locals.filter(Boolean).length ? `var ${locals.filter(Boolean).join(",")};` : "";
		// functions in functions: there from the start, as declarations are
		const hoisted = inner.map((g) => `function ${safe(g.name)}${this.func(g, false).replace(/^function/, "")}`).join("");
		const body = f.body.map((s) => this.stmt(s, false)).join("");
		this.scope = saved;
		this.ret = savedRet;
		return `(${params}){${pre?.() ?? ""}${head}${decl}${hoisted}${body}}`;
	}

	protected varInit(d: VarDecl, top: boolean): string {
		const js = d.init ? this.coerce(d.type, this.expr(d.init), d.init) : null;
		if (top) return js === null ? `$t.${d.name}=$t.${d.name};` : `$t.${d.name}=${js};`;
		return js === null ? "" : `${safe(d.name)}=${js};`;
	}

	/** `top`: at the top level of a frame, where declarations are the timeline's members. */
	stmt(s: Stmt, top: boolean): string {
		const body = (b: Stmt) => this.stmt(b, top);
		switch (s.k) {
			case "empty":
			case "func":
				return "";
			case "block":
				return `{${s.body.map(body).join("")}}`;
			case "var":
				return s.decls.map((d) => this.varInit(d, top)).join("");
			case "expr":
				return `${this.expr(s.x)};`;
			case "if":
				return `if(${this.expr(s.c)})${this.branch(s.a, top)}${s.b ? `else ${this.branch(s.b, top)}` : ""}`;
			case "while":
				return `while(${this.expr(s.c)})${this.branch(s.body, top)}`;
			case "do":
				return `do ${this.branch(s.body, top)}while(${this.expr(s.c)});`;
			case "for": {
				const init = s.init ? (s.init.k === "var" ? s.init.decls.map((d) => this.varInit(d, top)).join("").replace(/;$/, "").replace(/;/g, ",") : this.expr((s.init as { x: Expr }).x)) : "";
				return `for(${init};${s.c ? this.expr(s.c) : ""};${s.u ? this.expr(s.u) : ""})${this.branch(s.body, top)}`;
			}
			case "forin": {
				const target = s.decl ? (top ? `$t.${s.decl.name}` : safe(s.decl.name)) : this.expr(s.left!);
				const o = this.expr(s.o);
				if (!s.each && this.isDictionary(s.o)) return `for(${target} of $r.keys(${o}))${this.branch(s.body, top)}`;
				return s.each ? `for(${target} of $r.vals(${o}))${this.branch(s.body, top)}` : `for(${target} in ${o})${this.branch(s.body, top)}`;
			}
			case "switch":
				return `switch(${this.expr(s.c)}){${s.cases.map((c) => `${c.test ? `case ${this.expr(c.test)}:` : "default:"}${c.body.map(body).join("")}`).join("")}}`;
			case "break":
			case "continue":
				return `${s.k}${s.label ? ` ${s.label}` : ""};`;
			case "return":
				return `return${s.x ? ` ${this.coerce(this.ret, this.expr(s.x), s.x)}` : ""};`;
			case "throw":
				return `throw ${this.expr(s.x)};`;
			case "label":
				return `${s.name}:${this.stmt(s.body, top)}`;
			case "xmlns":
				return `$r.xdns(${this.plain(s.x)});`;
			case "try": {
				let out = `try{${s.body.map(body).join("")}}`;
				if (s.catches.length) {
					// by type, in turn; what none of them takes goes on
					const saved = this.scope;
					out += "catch($e){$e=$r.err($e);";
					let open = false;
					s.catches.forEach((c, i) => {
						this.scope = { vars: new Map([[c.param, c.type]]), up: saved };
						const any = c.type === "*" || c.type === "Object";
						const test = any ? "" : `if($r.is($e,${this.classOf(c.type)}))`;
						out += `${i ? "else " : ""}${test}{var ${safe(c.param)}=$e;${c.body.map(body).join("")}}`;
						open = !any;
					});
					if (open) out += "else throw $e;";
					out += "}";
					this.scope = saved;
				}
				if (s.final) out += `finally{${s.final.map(body).join("")}}`;
				return out;
			}
		}
	}

	protected branch(s: Stmt, top: boolean): string {
		return s.k === "block" || s.k === "empty" ? this.stmt(s, top) || ";" : `{${this.stmt(s, top)}}`;
	}
}

/**
 * Compiles a timeline's frame scripts. A script that can't be parsed is left out and reported;
 * the others still run.
 */
/** `linked`: class names of the library, which win over the Flash API's. */
export function compileScripts(units: ScriptUnit[], linked: Set<string> = new Set(), cls: ClassScope | null = null): CompiledScripts {
	const failed: CompiledScripts["failed"] = [];
	const parsed: { frame: number; body: Stmt[] }[] = [];
	for (const u of units) {
		try {
			parsed.push({ frame: u.frame, body: parseScript(u.code) });
		} catch (e) {
			if (!(e instanceof ScriptError)) throw e;
			failed.push({ frame: u.frame, line: e.line, message: e.message });
		}
	}
	const members = new Map<string, string>();
	const fns: FuncDecl[] = [];
	for (const p of parsed) hoist(p.body, members, fns);
	const em = new Emitter(members, linked, cls);
	let out = "function($t,$f,$r){";
	for (const [name, type] of members) if (type !== DECLARED) out += `$t.${name}=${defaultOf(type)};`;
	for (const f of fns) out += `$t.${f.name}=${em.func(f, false, true)};`;
	out += "return{";
	out += parsed.map((p) => `${p.frame}:function(){${p.body.map((s) => em.stmt(s, true)).join("")}}`).join(",");
	out += "}}";
	return { js: out, failed, unknown: [...em.unknown] };
}
