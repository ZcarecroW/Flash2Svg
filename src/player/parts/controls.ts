/**
 * Part of the Flash API for UI components (fl.controls): the classes behave as Animate's own (read
 * from their source, measured against Flash Player: tests/fixtures/as3/f85-controls.as), what they
 * show are real HTML controls (see control-markup.ts). A component's state is its parameters.
 */
import { controlBox, controlSpec, itemData, itemLabel, ROW, type Params, type Spec } from "../control-markup.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function controls(L: any): Record<string, unknown> {
	const { Sprite, Dispatcher, FEvent, FMouseEvent, FTextEvent, TextField, htmlEl, svgEl, matrixText, scripts, typing } = L;
	const FProgressEvent = L.ProgressEvent ?? FEvent;
	const safely = (f: () => void) => scripts.safely(f);

	class ComponentEvent extends FEvent {
		static BUTTON_DOWN = "buttonDown";
		static ENTER = "enter";
		static HIDE = "hide";
		static LABEL_CHANGE = "labelChange";
		static MOVE = "move";
		static RESIZE = "resize";
		static SHOW = "show";
		constructor(type: string, bubbles = false, cancelable = false) {
			super(type, bubbles, cancelable);
		}
	}
	class ListEvent extends FEvent {
		static ITEM_CLICK = "itemClick";
		static ITEM_DOUBLE_CLICK = "itemDoubleClick";
		static ITEM_ROLL_OUT = "itemRollOut";
		static ITEM_ROLL_OVER = "itemRollOver";
		columnIndex: number;
		rowIndex: number;
		index: number;
		item: unknown;
		constructor(type: string, bubbles = false, cancelable = false, columnIndex = -1, rowIndex = -1, index = -1, item: unknown = null) {
			super(type, bubbles, cancelable);
			this.columnIndex = columnIndex;
			this.rowIndex = rowIndex;
			this.index = index;
			this.item = item;
		}
	}
	class SliderEvent extends FEvent {
		static CHANGE = "change";
		static THUMB_DRAG = "thumbDrag";
		static THUMB_PRESS = "thumbPress";
		static THUMB_RELEASE = "thumbRelease";
		value: number;
		clickTarget: string | null;
		triggerEvent: string | null;
		keyCode: number;
		constructor(type: string, value = 0, clickTarget: string | null = null, triggerEvent: string | null = null, keyCode = 0) {
			super(type);
			this.value = value;
			this.clickTarget = clickTarget;
			this.triggerEvent = triggerEvent;
			this.keyCode = keyCode;
		}
	}
	class ColorPickerEvent extends FEvent {
		static CHANGE = "change";
		static ENTER = "enter";
		static ITEM_ROLL_OUT = "itemRollOut";
		static ITEM_ROLL_OVER = "itemRollOver";
		color: number;
		constructor(type: string, color = 0) {
			super(type, true);
			this.color = color;
		}
	}
	class DataChangeEvent extends FEvent {
		static DATA_CHANGE = "dataChange";
		static PRE_DATA_CHANGE = "preDataChange";
		changeType: string;
		startIndex: number;
		endIndex: number;
		constructor(type: string, changeType: string, list: unknown[] = [], startIndex = -1, endIndex = -1) {
			super(type);
			this.changeType = changeType;
			(this as any)["items"] = list;
			this.startIndex = startIndex;
			this.endIndex = endIndex;
		}
	}
	const DataChangeType = { ADD: "add", CHANGE: "change", INVALIDATE: "invalidate", INVALIDATE_ALL: "invalidateAll", REMOVE: "remove", REMOVE_ALL: "removeAll", REPLACE: "replace", SORT: "sort" };

	class DataProvider extends Dispatcher {
		_d: any[];
		constructor(v: any = null) {
			super();
			this._d = v === null || v === undefined ? [] : this._of(v);
		}
		private _of(v: any): any[] {
			if (Array.isArray(v)) return typeof v[0] === "string" || typeof v[0] === "number" ? v.map((x) => ({ label: String(x), data: x })) : v.slice();
			if (v instanceof DataProvider) return v.toArray();
			// (XML: each child an item, its attributes and the children with only text in them its fields)
			const X = L.scripts.api.XML;
			if (X && v instanceof X)
				return v.children()._items().map((node: any) => {
					const o: Record<string, string> = {};
					for (const a of node.attributes()._items()) o[a.localName()] = a.toString();
					for (const p of node.children()._items()) if (p.hasSimpleContent()) o[p.localName()] = p.toString();
					return o;
				});
			throw new TypeError(`Error: Type Coercion failed: cannot convert ${v} to Array or DataProvider.`);
		}
		private _in(i: number, max: number) {
			if (i > max || i < 0) throw new RangeError(`DataProvider index (${i}) is not in acceptable range (0 - ${max})`);
		}
		/** Tells of a change: before, then does it, then after. */
		private _do(type: string, list: unknown[], from: number, to: number, f: () => void) {
			this.dispatchEvent(new DataChangeEvent(DataChangeEvent.PRE_DATA_CHANGE, type, list, from, to));
			f();
			this.dispatchEvent(new DataChangeEvent(DataChangeEvent.DATA_CHANGE, type, list, from, to));
		}
		get length() {
			return this._d.length;
		}
		invalidate() {
			this.dispatchEvent(new DataChangeEvent(DataChangeEvent.DATA_CHANGE, DataChangeType.INVALIDATE_ALL, this._d.slice(), 0, this._d.length));
		}
		invalidateItemAt(i: number) {
			this._in(i, this._d.length - 1);
			this.dispatchEvent(new DataChangeEvent(DataChangeEvent.DATA_CHANGE, DataChangeType.INVALIDATE, [this._d[i]], i, i));
		}
		invalidateItem(it: unknown) {
			const i = this.getItemIndex(it);
			if (i !== -1) this.invalidateItemAt(i);
		}
		addItemAt(it: unknown, i: number) {
			this._in(i, this._d.length);
			this._do(DataChangeType.ADD, [it], i, i, () => this._d.splice(i, 0, it));
		}
		addItem(it: unknown) {
			this._d.push(it);
			const i = this._d.length - 1;
			this.dispatchEvent(new DataChangeEvent(DataChangeEvent.DATA_CHANGE, DataChangeType.ADD, [it], i, i));
		}
		addItemsAt(v: unknown, i: number) {
			this._in(i, this._d.length);
			const a = this._of(v);
			this._do(DataChangeType.ADD, a, i, i + a.length - 1, () => this._d.splice(i, 0, ...a));
		}
		addItems(v: unknown) {
			this.addItemsAt(v, this._d.length);
		}
		concat(v: unknown) {
			this.addItems(v);
		}
		merge(v: unknown) {
			const from = this._d.length;
			for (const it of this._of(v)) if (!this._d.includes(it)) this._d.push(it);
			this.dispatchEvent(new DataChangeEvent(DataChangeEvent.DATA_CHANGE, DataChangeType.ADD, this._d.slice(from), from, this._d.length - 1));
		}
		getItemAt(i: number) {
			this._in(i, this._d.length - 1);
			return this._d[i];
		}
		getItemIndex(it: unknown) {
			return this._d.indexOf(it);
		}
		removeItemAt(i: number) {
			this._in(i, this._d.length - 1);
			const it = this._d[i];
			this._do(DataChangeType.REMOVE, [it], i, i, () => this._d.splice(i, 1));
			return it;
		}
		removeItem(it: unknown) {
			const i = this.getItemIndex(it);
			return i === -1 ? null : this.removeItemAt(i);
		}
		removeAll() {
			const a = this._d.slice();
			this._do(DataChangeType.REMOVE_ALL, a, 0, a.length, () => (this._d = []));
		}
		replaceItemAt(it: unknown, i: number) {
			this._in(i, this._d.length - 1);
			const was = this._d[i];
			this._do(DataChangeType.REPLACE, [was], i, i, () => (this._d[i] = it));
			return was;
		}
		replaceItem(it: unknown, old: unknown) {
			const i = this.getItemIndex(old);
			return i === -1 ? null : this.replaceItemAt(it, i);
		}
		sort(...a: any[]) {
			let r: unknown;
			this._do(DataChangeType.SORT, this._d.slice(), 0, this._d.length - 1, () => (r = scripts.helpers.sort(this._d, ...a)));
			return r;
		}
		sortOn(f: unknown, o: unknown = null) {
			let r: unknown;
			this._do(DataChangeType.SORT, this._d.slice(), 0, this._d.length - 1, () => (r = scripts.helpers.sortOn(this._d, f, o)));
			return r;
		}
		clone() {
			return new DataProvider(this._d);
		}
		toArray() {
			return this._d.slice();
		}
		toString() {
			return `DataProvider [${this._d.join(" , ")}]`;
		}
	}

	function build([tag, attrs, ...kids]: Spec): HTMLElement {
		const e = htmlEl(tag) as HTMLElement;
		for (const k in attrs) if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]!);
		for (const c of kids) e.append(typeof c === "string" ? c : build(c));
		return e;
	}

	const globalStyles: Record<string, unknown> = {};

	class UIComponent extends Sprite {
		_cls = "UIComponent";
		focusEnabled = true;
		mouseFocusEnabled = true;
		focusManager: unknown = null;
		_kind: string;
		_p: Params;
		_w: number;
		_h: number;
		/** The size it came with: what its scale is taken from. */
		_w0: number;
		_h0: number;
		_x = NaN;
		_y = NaN;
		/** What it shows, the box around that, and what takes the keyboard. */
		_root: HTMLElement;
		_fo: SVGElement;
		_ui: any;
		_styles: Record<string, unknown> = {};
		/** Not drawn yet (it is at the end of the frame's script). */
		_early = true;
		private _queued = false;
		constructor(node: SVGElement | undefined, ct: any, kind: string, w: number, h: number, defaults: Params = {}) {
			super(node);
			this._kind = kind;
			this._p = ct?.[1] ?? { ...defaults };
			this._w = this._w0 = ct?.[2] ?? w;
			this._h = this._h0 = ct?.[3] ?? h;
			let fo = node?.querySelector("foreignObject") as SVGElement | null;
			if (fo) {
				// (the transform belongs to the object, on its outer node, as for all of them)
				const inner = fo.parentNode as SVGGElement;
				const list = inner.transform.baseVal;
				if (list.numberOfItems) {
					const m = list.consolidate()!.matrix;
					node!.setAttribute("transform", matrixText([m.a, m.b, m.c, m.d, m.e, m.f]));
					inner.removeAttribute("transform");
				}
				if (inner.hasAttribute("display")) {
					inner.removeAttribute("display");
					this._vis = false;
					this._show();
				}
			} else {
				const b = controlBox(kind, this._w, this._h);
				fo = svgEl("foreignObject", { x: String(b.x), y: String(b.y), width: String(b.w), height: String(b.h), tabindex: "-1" }) as SVGElement;
				const spec = controlSpec(kind, this._p, false);
				if (spec) fo.appendChild(build(spec));
				this._node.appendChild(fo);
			}
			this._fo = fo;
			this._root = fo.firstElementChild as HTMLElement;
			this._ui = this._root?.matches("input,select,textarea,button") ? this._root : (this._root?.querySelector("input,select,textarea,button") ?? this._root);
			const stage = scripts.stage;
			// (WebKit's buttons don't take the keyboard from a click: the box around them does)
			fo.addEventListener("focus", () => this._ui?.focus?.({ preventScroll: true }));
			fo.addEventListener("focusin", () => safely(() => void (stage._focus !== this && scripts.focused(this))));
			fo.addEventListener("focusout", (e) => safely(() => void (stage._focus === this && scripts.blurred(this, (e as FocusEvent).relatedTarget as Node | null))));
			this._later();
		}
		/** For the stage's focus. */
		get _in() {
			return this._ui;
		}
		get visible() {
			return super.visible;
		}
		set visible(v: boolean) {
			if (super.visible === !!v) return;
			super.visible = v;
			this.dispatchEvent(new ComponentEvent(v ? ComponentEvent.SHOW : ComponentEvent.HIDE, true));
		}
		/** Draws at the end of the script that changed it. */
		_later() {
			if (this._queued) return;
			this._queued = true;
			queueMicrotask(() =>
				safely(() => {
					this._queued = false;
					this._early = false;
					this._drawn();
				}),
			);
		}
		_drawn() {}
		get width() {
			return this._w;
		}
		set width(v: number) {
			if (v !== this._w) this.setSize(v, this._h);
		}
		get height() {
			return this._h;
		}
		set height(v: number) {
			if (v !== this._h) this.setSize(this._w, v);
		}
		get scaleX() {
			return this._w / this._w0;
		}
		set scaleX(v: number) {
			this.setSize(this._w0 * v, this._h);
		}
		get scaleY() {
			return this._h / this._h0;
		}
		set scaleY(v: number) {
			this.setSize(this._w, this._h0 * v);
		}
		get x() {
			return Number.isNaN(this._x) ? super.x : this._x;
		}
		set x(v: number) {
			this.move(v, this.y);
		}
		get y() {
			return Number.isNaN(this._y) ? super.y : this._y;
		}
		set y(v: number) {
			this.move(this.x, v);
		}
		_self() {
			return { l: 0, t: 0, r: this._w, b: this._h };
		}
		setSize(w: number, h: number) {
			this._w = w;
			this._h = h;
			const b = controlBox(this._kind, w, h);
			this._fo.setAttribute("x", String(b.x));
			this._fo.setAttribute("y", String(b.y));
			this._fo.setAttribute("width", String(b.w));
			this._fo.setAttribute("height", String(b.h));
			this.dispatchEvent(new ComponentEvent(ComponentEvent.RESIZE));
		}
		move(x: number, y: number) {
			this._x = x;
			this._y = y;
			super.x = Math.round(x);
			super.y = Math.round(y);
			this.dispatchEvent(new ComponentEvent(ComponentEvent.MOVE));
		}
		get enabled() {
			return this._p.enabled !== false;
		}
		set enabled(v: boolean) {
			this._p.enabled = !!v;
			this.mouseEnabled = !!v;
			this._able(!!v);
		}
		_able(on: boolean) {
			if (this._ui && "disabled" in this._ui) this._ui.disabled = !on;
			this._root.style.color = on ? "" : "#999";
		}
		setFocus() {
			scripts.stage.focus = this;
		}
		getFocus() {
			return scripts.stage.focus;
		}
		drawNow() {
			this._early = false;
			this._drawn();
		}
		validateNow() {
			this.drawNow();
		}
		drawFocus() {}
		setStyle(name: string, v: unknown) {
			this._styles[name] = v;
			if (name === "textFormat" && v) this._format(v);
		}
		clearStyle(name: string) {
			delete this._styles[name];
		}
		getStyle(name: string) {
			return this._styles[name] ?? globalStyles[name] ?? null;
		}
		_format(f: any) {
			const c = this._root.style;
			if (f.font) c.fontFamily = `'${f.font}', sans-serif`;
			if (f.size) c.fontSize = `${f.size}px`;
			if (f.color !== null && f.color !== undefined) c.color = L.colorOf(f.color);
			if (f.bold !== null && f.bold !== undefined) c.fontWeight = f.bold ? "bold" : "normal";
			if (f.italic !== null && f.italic !== undefined) c.fontStyle = f.italic ? "italic" : "normal";
			if (f.align) c.textAlign = f.align;
		}
	}

	class LabelButton extends UIComponent {
		override _cls = "LabelButton";
		constructor(node: SVGElement | undefined, ct: any, kind: string, w: number, h: number, defaults: Params) {
			super(node, ct, kind, w, h, defaults);
			// (before what scripts listen with)
			this.addEventListener(FMouseEvent.CLICK, () => {
				if (!this.toggle) return;
				this._toggled();
			});
			const down = () => safely(() => this.dispatchEvent(new ComponentEvent(ComponentEvent.BUTTON_DOWN, true)));
			this._root.addEventListener("pointerdown", down);
			// what the browser would do is done here; a key on it is a click
			this._root.addEventListener("click", (e) => {
				e.preventDefault();
				if (!(e as MouseEvent).detail) safely(() => this.dispatchEvent(new FMouseEvent(FMouseEvent.CLICK, true)));
			});
			// (Space presses it, and any character that goes to it is said)
			this._root.addEventListener("keydown", (e) => {
				const k = (e as KeyboardEvent).key;
				if ((k !== " " && k !== "Enter") || (e as KeyboardEvent).repeat) return;
				if (k === "Enter") e.preventDefault();
				else down();
				safely(() => this.dispatchEvent(new FTextEvent(FTextEvent.TEXT_INPUT, true, true, k === " " ? " " : "\r")));
			});
		}
		_toggled() {
			this.selected = !this.selected;
			this.dispatchEvent(new FEvent(FEvent.CHANGE, true));
		}
		get label() {
			return this._p.label;
		}
		set label(v: string) {
			const was = this._p.label;
			this._p.label = v;
			const t = this._root.lastChild;
			if (t?.nodeType === 3) t.nodeValue = v;
			else this._root.append(v);
			if (was !== v) this.dispatchEvent(new ComponentEvent(ComponentEvent.LABEL_CHANGE));
		}
		get labelPlacement() {
			return this._p.labelPlacement ?? "right";
		}
		set labelPlacement(v: string) {
			this._p.labelPlacement = v;
			const c = this._root.style;
			c.flexDirection = { left: "row-reverse", top: "column", bottom: "column-reverse" }[v] ?? "";
		}
		get toggle() {
			return !!this._p.toggle;
		}
		set toggle(v: boolean) {
			if (!v && this._p.selected) this.selected = false;
			this._p.toggle = !!v;
		}
		get selected() {
			return this.toggle ? !!this._p.selected : false;
		}
		set selected(v: boolean) {
			this._p.selected = !!v;
			this._mark(!!v);
		}
		_mark(on: boolean) {
			if (this.toggle) this._ui.setAttribute?.("aria-pressed", String(on));
			if (this._ui.localName === "button") this._ui.style.background = on ? "linear-gradient(#d9dcde,#fff)" : "";
		}
		get autoRepeat() {
			return !!this._p.autoRepeat;
		}
		set autoRepeat(v: boolean) {
			this._p.autoRepeat = !!v;
		}
		get emphasized() {
			return !!this._p.emphasized;
		}
		set emphasized(v: boolean) {
			this._p.emphasized = !!v;
			this._ui.style.borderWidth = v ? "2px" : "";
		}
		get textField() {
			return this;
		}
	}

	class Button extends LabelButton {
		override _cls = "Button";
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "Button", 100, 22, { label: "Label" });
		}
	}

	class CheckBox extends LabelButton {
		override _cls = "CheckBox";
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "CheckBox", 100, 22, { label: "Label" });
		}
		override get toggle() {
			return true;
		}
		override set toggle(_v: boolean) {
			throw new Error("Warning: You cannot change a CheckBox's toggle.");
		}
		override get autoRepeat() {
			return false;
		}
		override set autoRepeat(_v: boolean) {}
		override _mark(on: boolean) {
			this._ui.checked = on;
		}
	}

	const groups: Record<string, RadioButtonGroup> = {};

	class RadioButtonGroup extends Dispatcher {
		_name: string;
		_list: RadioButton[] = [];
		_sel: RadioButton | null = null;
		static getGroup(name: string) {
			return groups[name] ?? new RadioButtonGroup(name);
		}
		constructor(name: string) {
			super();
			this._name = name;
			groups[name] = this;
		}
		get name() {
			return this._name;
		}
		addRadioButton(r: RadioButton) {
			if (r.groupName !== this._name) {
				r.groupName = this._name;
				return;
			}
			this._list.push(r);
			if (r.selected) this.selection = r;
		}
		removeRadioButton(r: RadioButton) {
			const i = this._list.indexOf(r);
			if (i !== -1) this._list.splice(i, 1);
			if (this._sel === r) this._sel = null;
		}
		get selection() {
			return this._sel;
		}
		set selection(r: RadioButton | null) {
			if (this._sel === r || !r || !this._list.includes(r)) return;
			this._sel = r;
			this.dispatchEvent(new FEvent(FEvent.CHANGE, true));
		}
		get selectedData() {
			return this._sel ? this._sel.value : null;
		}
		set selectedData(v: unknown) {
			const r = this._list.find((x) => x.value === v);
			if (r) this.selection = r;
		}
		getRadioButtonIndex(r: RadioButton) {
			return this._list.indexOf(r);
		}
		getRadioButtonAt(i: number) {
			return this._list[i];
		}
		get numRadioButtons() {
			return this._list.length;
		}
	}

	class RadioButton extends LabelButton {
		override _cls = "RadioButton";
		_group: RadioButtonGroup | null = null;
		private _heard = () => {
			this._p.selected = this._group!.selection === this;
			this._mark(this._p.selected);
			this.dispatchEvent(new FEvent(FEvent.CHANGE, true));
		};
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "RadioButton", 100, 22, { label: "Label" });
			const on = this._p.selected;
			this._p.selected = false;
			this.groupName = this._p.groupName || "RadioButtonGroup";
			if (on) this.selected = true;
			this.addEventListener(FMouseEvent.CLICK, () => this._group?.dispatchEvent(new FMouseEvent(FMouseEvent.CLICK, true)));
		}
		override get toggle() {
			return true;
		}
		override set toggle(_v: boolean) {
			throw new Error("Warning: You cannot change a RadioButtons toggle.");
		}
		override get autoRepeat() {
			return false;
		}
		override set autoRepeat(_v: boolean) {}
		override get selected() {
			return !!this._p.selected;
		}
		override set selected(v: boolean) {
			if (!v || this.selected) return;
			if (this._group) this._group.selection = this;
			else {
				this._p.selected = true;
				this._mark(true);
			}
		}
		override _mark(on: boolean) {
			this._ui.checked = on;
		}
		get groupName() {
			return this._group ? this._group.name : null;
		}
		set groupName(v: string | null) {
			if (this._group) {
				this._group.removeRadioButton(this);
				this._group.removeEventListener(FEvent.CHANGE, this._heard);
			}
			this._group = v === null ? null : RadioButtonGroup.getGroup(v);
			if (this._group) {
				this._group.addRadioButton(this);
				this._group.addEventListener(FEvent.CHANGE, this._heard);
				this._ui.name = v;
			}
		}
		get group() {
			return this._group;
		}
		set group(g: RadioButtonGroup | null) {
			this.groupName = g!.name;
		}
		get value() {
			return this._p.value === "" || this._p.value === undefined ? null : this._p.value;
		}
		set value(v: unknown) {
			this._p.value = v;
		}
	}

	/** What ComboBox and List share: items and a selection. */
	class SelectableList extends UIComponent {
		override _cls = "SelectableList";
		_dp: DataProvider;
		_sel: number[] = [];
		_labelField = "label";
		_labelFunction: ((it: unknown) => unknown) | null = null;
		private _onData = (e: any) => this._data(e);
		/** What was selected when the items began to change. */
		_before: unknown[] = [];
		private _onPre = () => void (this._before = this.selectedItems);
		constructor(node: SVGElement | undefined, ct: any, kind: string, w: number, h: number) {
			super(node, ct, kind, w, h, {});
			this._dp = new DataProvider(this._p.dataProvider ?? []);
			this._dp.addEventListener(DataChangeEvent.DATA_CHANGE, this._onData);
			this._dp.addEventListener(DataChangeEvent.PRE_DATA_CHANGE, this._onPre);
			this._root.addEventListener("change", () => safely(() => this._chosen()));
			this._root.addEventListener("pointerdown", (e) => safely(() => this._pressed(e)));
			// (keys end here, on their way to the stage)
			this.addEventListener("keyDown", (e: any) => e.stopPropagation());
			this._root.addEventListener("keydown", () => (this._keyed = true));
		}
		/** The last thing to happen to it was a key. */
		_keyed = false;
		_pressed(_e: Event) {
			this.dispatchEvent(new ComponentEvent(ComponentEvent.BUTTON_DOWN, true));
		}
		get dataProvider() {
			return this._dp;
		}
		set dataProvider(v: DataProvider) {
			this._dp.removeEventListener(DataChangeEvent.DATA_CHANGE, this._onData);
			this._dp.removeEventListener(DataChangeEvent.PRE_DATA_CHANGE, this._onPre);
			this._dp = v;
			v.addEventListener(DataChangeEvent.DATA_CHANGE, this._onData);
			v.addEventListener(DataChangeEvent.PRE_DATA_CHANGE, this._onPre);
			this._sel = [];
			this._fill();
		}
		private _data(e: any) {
			const from = e.startIndex,
				to = e.endIndex,
				s = this._sel;
			if (e.changeType === DataChangeType.SORT) this.selectedItems = this._before;
			else if (e.changeType === DataChangeType.INVALIDATE_ALL) this._sel = [];
			else if (e.changeType === DataChangeType.ADD) {
				for (let i = 0; i < s.length; i++) if (s[i]! >= from) s[i]! += from - to;
			} else if (e.changeType === DataChangeType.REMOVE) {
				for (let i = s.length - 1; i >= 0; i--) {
					if (s[i]! < from) continue;
					if (s[i]! <= to) s.splice(i, 1);
					else s[i]! -= from - to + 1;
				}
			} else if (e.changeType === DataChangeType.REMOVE_ALL) this._sel = [];
			this._fill();
		}
		get length() {
			return this._dp.length;
		}
		addItem(it: unknown) {
			this._dp.addItem(it);
		}
		addItemAt(it: unknown, i: number) {
			this._dp.addItemAt(it, i);
		}
		removeAll() {
			this._dp.removeAll();
		}
		removeItem(it: unknown) {
			return this._dp.removeItem(it);
		}
		removeItemAt(i: number) {
			return this._dp.removeItemAt(i);
		}
		replaceItemAt(it: unknown, i: number) {
			return this._dp.replaceItemAt(it, i);
		}
		getItemAt(i: number) {
			return this._dp.getItemAt(i);
		}
		sortItems(...a: unknown[]) {
			return this._dp.sort(...a);
		}
		sortItemsOn(f: unknown, o: unknown = null) {
			return this._dp.sortOn(f, o);
		}
		get selectedIndex() {
			return this._sel.length ? this._sel[this._sel.length - 1]! : -1;
		}
		set selectedIndex(v: number) {
			this.selectedIndices = v === -1 ? null : [v];
		}
		get selectedIndices(): any {
			return this._sel.slice();
		}
		set selectedIndices(v: number[] | null) {
			this._sel = v ? v.slice() : [];
			this._mark();
		}
		get selectedItem() {
			return this._sel.length ? this._dp.getItemAt(this.selectedIndex) : null;
		}
		set selectedItem(it: unknown) {
			this.selectedIndex = this._dp.getItemIndex(it);
		}
		get selectedItems(): any {
			return this._sel.map((i) => this._dp.getItemAt(i));
		}
		set selectedItems(v: unknown[] | null) {
			this.selectedIndices = v ? v.map((it) => this._dp.getItemIndex(it)).filter((i) => i !== -1) : null;
		}
		clearSelection() {
			this.selectedIndex = -1;
		}
		isItemSelected(it: unknown) {
			return this.selectedItems.includes(it);
		}
		get labelField() {
			return this._labelField;
		}
		set labelField(v: string) {
			this._labelField = v;
			this._fill();
		}
		get labelFunction() {
			return this._labelFunction;
		}
		set labelFunction(v: ((it: unknown) => unknown) | null) {
			this._labelFunction = v;
			this._fill();
		}
		itemToLabel(it: any) {
			if (this._labelFunction) return String(this._labelFunction(it));
			return it[this._labelField] !== null && it[this._labelField] !== undefined ? String(it[this._labelField]) : "";
		}
		/** The options, for a control that shows them. */
		_options(host: Element, keep: number) {
			while (host.children.length > keep) host.lastElementChild!.remove();
			for (const it of this._dp._d) {
				const o = htmlEl("option") as HTMLOptionElement;
				o.value = itemData(it);
				if (this._ui.size > 1) o.style.cssText = ROW;
				o.textContent = this.itemToLabel(it);
				host.appendChild(o);
			}
		}
		_fill() {
			this._options(this._ui, 0);
			this._mark();
		}
		_mark() {
			const o = this._ui.options;
			if (o) for (let i = 0; i < o.length; i++) o[i].selected = this._sel.includes(i);
		}
		/** What the control has selected. */
		_read() {
			const o = this._ui.options,
				now: number[] = [];
			for (let i = 0; i < o.length; i++) if (o[i].selected) now.push(i);
			return now;
		}
		/** The control has a new selection. */
		_chosen() {}
	}

	class List extends SelectableList {
		override _cls = "List";
		_rowHeight = 20;
		private _row: HTMLOptionElement | null = null;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "List", 100, 100);
			// (the row is told before the click: the click on a row comes first to the row)
			this.addEventListener(FMouseEvent.CLICK, () => {
				const row = this._row;
				this._row = null;
				// (WebKit selects after the mouse is up)
				const now = row && !this.allowMultipleSelection ? [row.index] : this._read();
				const i = row ? row.index : (now[now.length - 1] ?? -1);
				if (i < 0) return;
				const ev = new ListEvent(ListEvent.ITEM_CLICK, false, true, 0, i, i, this._dp.getItemAt(i));
				this.dispatchEvent(ev);
				if (ev.isDefaultPrevented()) return this._mark();
				this._take(now);
			});
		}
		private _take(now: number[]) {
			const same = now.join() === this._sel.join();
			this._sel = now;
			if (!same) this.dispatchEvent(new FEvent(FEvent.CHANGE));
		}
		override _pressed(e: Event) {
			super._pressed(e);
			this._keyed = false;
			this._row = (e.target as Element).closest("option");
		}
		/** The keyboard (the mouse is told with its click). */
		override _chosen() {
			if (this._keyed) this._take(this._read());
		}
		get allowMultipleSelection() {
			return !!this._p.allowMultipleSelection;
		}
		set allowMultipleSelection(v: boolean) {
			if (!!v === this.allowMultipleSelection) return;
			this._p.allowMultipleSelection = !!v;
			this._ui.multiple = !!v;
			if (!v && this._sel.length > 1) this._sel = [this._sel.pop()!];
			this._mark();
		}
		get rowHeight() {
			return this._rowHeight;
		}
		set rowHeight(v: number) {
			this._rowHeight = v;
		}
		get rowCount() {
			return Math.ceil((this._h - 2) / this._rowHeight);
		}
		set rowCount(v: number) {
			this.height = this._rowHeight * v + 2;
		}
		scrollToIndex(i: number) {
			this._ui.options[i]?.scrollIntoView({ block: "nearest" });
		}
		scrollToSelected() {
			this.scrollToIndex(this.selectedIndex);
		}
	}

	class ComboBox extends SelectableList {
		override _cls = "ComboBox";
		_typed: string | null = null;
		_shown = "";
		restrict: string | null = null;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "ComboBox", 100, 22);
			if (this._root.localName === "span") this._box();
		}
		/** An editable one: what is typed counts. */
		private _box() {
			this._ui = this._root.querySelector("input");
			this._root.addEventListener("input", () =>
				safely(() => {
					this._typed = this._shown = this._ui.value;
					this._sel = [];
					this.dispatchEvent(new FEvent(FEvent.CHANGE, true));
				}),
			);
			this._root.addEventListener("keydown", (e) => safely(() => void ((e as KeyboardEvent).key === "Enter" && this.dispatchEvent(new ComponentEvent(ComponentEvent.ENTER)))));
		}
		private get _edit() {
			return this._root.localName === "span";
		}
		override _fill() {
			if (this._edit) this._options(this._root.querySelector("datalist")!, 0);
			else this._options(this._ui, this._p.prompt ? 1 : 0);
			this._later();
		}
		override _mark() {
			this._later();
		}
		override _drawn() {
			let i = this.selectedIndex;
			if (i === -1 && (this.prompt !== null || this.editable || this.length === 0)) i = Math.max(-1, Math.min(i, this.length - 1));
			else {
				this._typed = null;
				i = Math.max(0, Math.min(i, this.length - 1));
			}
			if (this.selectedIndex !== i) this._sel = i < 0 ? [] : [i];
			this._shown = i === -1 && this._typed !== null ? this._typed : i > -1 ? this.itemToLabel(this._dp.getItemAt(i)) : "";
			if (this._edit) this._ui.value = this._shown;
			else this._ui.selectedIndex = this._p.prompt ? i + 1 : i;
		}
		override set selectedIndex(v: number) {
			super.selectedIndex = v;
		}
		override get selectedIndex() {
			return super.selectedIndex;
		}
		override _chosen() {
			if (this._edit) return;
			const i = this._ui.selectedIndex - (this._p.prompt ? 1 : 0);
			// (a row of its list tells like one without an item; what it shows follows when it is drawn)
			if (!this._keyed) this.dispatchEvent(new ListEvent(ListEvent.ITEM_CLICK, false, true, 0, i, -1, null));
			this._keyed = false;
			this._sel = i < 0 ? [] : [i];
			this._typed = null;
			this.dispatchEvent(new FEvent(FEvent.CHANGE));
			this._later();
		}
		get selectedLabel() {
			if (this._typed !== null) return this._typed;
			return this.selectedIndex === -1 ? null : this.itemToLabel(this.selectedItem);
		}
		get value() {
			if (this._typed !== null) return this._typed;
			const it: any = this.selectedItem;
			if (it === null) throw L.fail(TypeError, 1009, "Cannot access a property or method of a null object reference.");
			return !this.editable && it.data !== null && it.data !== undefined ? it.data : this.itemToLabel(it);
		}
		get text() {
			return this._shown;
		}
		set text(v: string) {
			if (!this.editable) return;
			this._shown = v;
			this._ui.value = v;
		}
		get editable() {
			return !!this._p.editable;
		}
		set editable(v: boolean) {
			if (!!v === this.editable) return;
			this._p.editable = !!v;
			const spec = controlSpec("ComboBox", { ...this._p, $id: this.name, items: undefined }, false)!;
			const made = build(spec);
			this._root.replaceWith(made);
			this._root = made;
			this._ui = made.matches("select") ? made : made.querySelector("input");
			if (v) this._box();
			this._fill();
		}
		get prompt() {
			return this._p.prompt || null;
		}
		set prompt(v: string | null) {
			const had = !!this._p.prompt;
			this._p.prompt = v === "" ? null : v;
			if (this._edit) this._ui.placeholder = v ?? "";
			else if (v && !had) {
				const o = htmlEl("option") as HTMLOptionElement;
				o.hidden = true;
				o.textContent = v;
				this._ui.prepend(o);
			} else if (v) this._ui.options[0].textContent = v;
			else if (had) this._ui.options[0].remove();
			this._later();
		}
		get rowCount() {
			return this._p.rowCount ?? 5;
		}
		set rowCount(v: number) {
			this._p.rowCount = v;
		}
		get dropdown() {
			return this;
		}
		get textField() {
			return this;
		}
		open() {
			this._ui.showPicker?.();
		}
		close() {}
	}

	/** What TextInput and TextArea share: a control the user types in. */
	class TextBox extends UIComponent {
		override _cls = "TextBox";
		_most: number;
		_multi = false;
		_html: string | null = null;
		restrict: string | null;
		constructor(node: SVGElement | undefined, ct: any, kind: string, w: number, h: number) {
			super(node, ct, kind, w, h, { editable: true });
			this._most = this._p.maxChars || 0;
			this._ui.removeAttribute("maxlength");
			this.restrict = this._p.restrict || null;
			typing(this._fo, this);
			this._fo.addEventListener("keydown", (e) => safely(() => void ((e as KeyboardEvent).key === "Enter" && this.dispatchEvent(new ComponentEvent(ComponentEvent.ENTER, true)))));
		}
		/** The user changed it. */
		_typed() {
			this._html = null;
			this.dispatchEvent(new FEvent(FEvent.CHANGE, true));
		}
		get text() {
			return this._ui.value.replace(/\r\n|\n/g, "\r");
		}
		set text(v: string) {
			this._html = null;
			this._ui.value = String(v ?? "").replace(/\r/g, "\n");
		}
		get htmlText() {
			return this._html ?? this.text;
		}
		set htmlText(v: string) {
			const t = new TextField();
			t.htmlText = v;
			this.text = t.text;
			this._html = v;
		}
		appendText(s: string) {
			this.text += s;
		}
		get length() {
			return this.text.length;
		}
		get maxChars() {
			return this._most;
		}
		set maxChars(v: number) {
			this._most = v;
		}
		get editable() {
			return this._p.editable !== false;
		}
		set editable(v: boolean) {
			this._p.editable = !!v;
			this._ui.readOnly = !v;
		}
		get displayAsPassword() {
			return !!this._p.displayAsPassword;
		}
		set displayAsPassword(v: boolean) {
			this._p.displayAsPassword = !!v;
			if (this._ui.localName === "input") this._ui.type = v ? "password" : "text";
		}
		get selectionBeginIndex() {
			return this._ui.selectionStart ?? 0;
		}
		get selectionEndIndex() {
			return this._ui.selectionEnd ?? 0;
		}
		setSelection(a: number, b: number) {
			this._ui.setSelectionRange(a, b);
		}
		get textField() {
			return this;
		}
	}

	class TextInput extends TextBox {
		override _cls = "TextInput";
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "TextInput", 100, 22);
		}
	}

	class TextArea extends TextBox {
		override _cls = "TextArea";
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "TextArea", 100, 100);
			this._multi = true;
			if (this._p.wordWrap === undefined) this._p.wordWrap = true;
		}
		get wordWrap() {
			return this._p.wordWrap !== false;
		}
		set wordWrap(v: boolean) {
			this._p.wordWrap = !!v;
			this._ui.wrap = v ? "soft" : "off";
		}
		get verticalScrollPosition() {
			return this._ui.scrollTop;
		}
		set verticalScrollPosition(v: number) {
			this._ui.scrollTop = v;
		}
		get horizontalScrollPosition() {
			return this._ui.scrollLeft;
		}
		set horizontalScrollPosition(v: number) {
			this._ui.scrollLeft = v;
		}
		get maxVerticalScrollPosition() {
			return Math.max(0, this._ui.scrollHeight - this._ui.clientHeight);
		}
		get maxHorizontalScrollPosition() {
			return Math.max(0, this._ui.scrollWidth - this._ui.clientWidth);
		}
		horizontalScrollPolicy = "auto";
		verticalScrollPolicy = "auto";
	}

	class Label extends UIComponent {
		override _cls = "Label";
		_html: string | null = null;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "Label", 100, 22, { text: "Label" });
		}
		get text() {
			return this._root.textContent ?? "";
		}
		set text(v: string) {
			this._html = null;
			this._root.textContent = v;
		}
		get htmlText() {
			return this._html ?? this.text;
		}
		set htmlText(v: string) {
			const t = new TextField();
			t.htmlText = v;
			this.text = t.text;
			this._html = v;
		}
		get autoSize() {
			return this._p.autoSize ?? "none";
		}
		set autoSize(v: string) {
			this._p.autoSize = v;
		}
		get wordWrap() {
			return !!this._p.wordWrap;
		}
		set wordWrap(v: boolean) {
			this._p.wordWrap = !!v;
			this._root.style.whiteSpace = v ? "normal" : "nowrap";
		}
		get selectable() {
			return !!this._p.selectable;
		}
		set selectable(v: boolean) {
			this._p.selectable = !!v;
			this._root.style.userSelect = v ? "text" : "none";
		}
		get condenseWhite() {
			return !!this._p.condenseWhite;
		}
		set condenseWhite(v: boolean) {
			this._p.condenseWhite = !!v;
		}
		get textField() {
			return this;
		}
	}

	class NumericStepper extends UIComponent {
		override _cls = "NumericStepper";
		_min: number;
		_max: number;
		_step: number;
		_value: number;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "NumericStepper", 80, 22, {});
			const p = this._p;
			this._min = p.minimum ?? 0;
			this._max = p.maximum ?? 10;
			this._step = p.stepSize ?? 1;
			this._value = p.value ?? 1;
			this._root.addEventListener("change", () => safely(() => this._set(Number(this._ui.value), true)));
			// (it keeps all keys to itself)
			this.addEventListener("keyDown", (e: any) => e.stopImmediatePropagation());
			this._root.addEventListener("keydown", (e) => {
				const k = (e as KeyboardEvent).key;
				const to = k === "End" ? this._max : k === "Home" ? this._min : k === "ArrowUp" ? this.nextValue : k === "ArrowDown" ? this.previousValue : k === "Enter" ? Number(this._ui.value) : NaN;
				if (Number.isNaN(to)) return;
				e.preventDefault();
				safely(() => this._set(to, true));
			});
		}
		private _valid(n: number) {
			if (Number.isNaN(n)) return this._value;
			const digits = (String(this._step).split(".")[1] ?? "").length;
			const near = Number((this._step * Math.round(n / this._step)).toFixed(digits));
			return near > this._max ? this._max : near < this._min ? this._min : near;
		}
		private _set(v: number, fire: boolean) {
			if (v === this._value) return;
			this._value = this._valid(v);
			this._ui.value = String(this._value);
			if (fire) this.dispatchEvent(new FEvent(FEvent.CHANGE, true));
		}
		get value() {
			return this._value;
		}
		set value(v: number) {
			this._set(v, false);
		}
		get minimum() {
			return this._min;
		}
		set minimum(v: number) {
			this._min = v;
			this._ui.min = String(v);
			if (this._value < v) this._set(v, false);
		}
		get maximum() {
			return this._max;
		}
		set maximum(v: number) {
			this._max = v;
			this._ui.max = String(v);
			if (this._value > v) this._set(v, false);
		}
		get stepSize() {
			return this._step;
		}
		set stepSize(v: number) {
			this._step = v;
			this._ui.setAttribute("step", String(v));
		}
		private _ok(v: number) {
			return v >= this._min && v <= this._max;
		}
		get nextValue() {
			const v = this._value + this._step;
			return this._ok(v) ? v : this._value;
		}
		get previousValue() {
			const v = this._value - this._step;
			return this._ok(v) ? v : this._value;
		}
		get textField() {
			return this;
		}
	}

	class Slider extends UIComponent {
		override _cls = "Slider";
		_value: number;
		_min: number;
		_max: number;
		_snap: number;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "Slider", 80, 4, {});
			const p = this._p;
			this._value = p.value ?? 0;
			this._min = p.minimum ?? 0;
			this._max = p.maximum ?? 10;
			this._snap = p.snapInterval ?? 0;
			const e = this._ui;
			const tell = (type: string, on: string | null = "thumb", how = "mouse", key = 0) => this.dispatchEvent(new SliderEvent(type, this._value, on, how, key));
			/** The value at the mouse. */
			const at = () => {
				const up = this.direction === "vertical";
				const part = (up ? this.mouseY : this.mouseX) / (up ? this._h : this._w);
				const v = part * (this._max - this._min);
				return up ? this._max - v : this._min + v;
			};
			const drag = (from: number) => (m: PointerEvent) =>
				safely(() => {
					scripts.client = [m.clientX, m.clientY];
					const was = this._value;
					this._set(at() + from);
					if (was === this._value) return;
					if (this.liveDragging) tell(SliderEvent.CHANGE);
					tell(SliderEvent.THUMB_DRAG);
				});
			// (the browser's own control would start a drag on a click on the track)
			e.addEventListener("mousedown", (m: MouseEvent) => m.preventDefault());
			e.addEventListener("pointerdown", (m: PointerEvent) => {
				if (!this.enabled) return;
				m.preventDefault();
				e.focus();
				safely(() => {
					this.dispatchEvent(new ComponentEvent(ComponentEvent.BUTTON_DOWN, true));
					const to = at();
					const span = this._max - this._min;
					// (the thumb is 13 wide, and comes to a point)
					if (Math.abs(to - this._value) * ((this.direction === "vertical" ? this._h : this._w) / (span || 1)) >= 6) {
						this._set(to);
						if (!this.liveDragging) tell(SliderEvent.CHANGE, "track");
						return;
					}
					tell(SliderEvent.THUMB_PRESS);
					const move = drag(this._value - to);
					const up = () =>
						safely(() => {
							window.removeEventListener("pointermove", move);
							window.removeEventListener("pointerup", up, true);
							tell(SliderEvent.THUMB_RELEASE);
							tell(SliderEvent.CHANGE);
						});
					window.addEventListener("pointermove", move);
					// (before the click)
					window.addEventListener("pointerup", up, true);
				});
			});
			e.addEventListener("keydown", (k: KeyboardEvent) => {
				const wide = this.direction !== "vertical";
				const by = this._snap > 0 ? this._snap : 1;
				const key = k.key;
				const to = key === (wide ? "ArrowLeft" : "ArrowDown") ? this._value - by : key === (wide ? "ArrowRight" : "ArrowUp") ? this._value + by : key === (wide ? "Home" : "PageDown") ? this._min : key === (wide ? "End" : "PageUp") ? this._max : NaN;
				if (Number.isNaN(to)) return;
				k.preventDefault();
				safely(() => {
					const was = this._value;
					this._set(to);
					if (was !== this._value) tell(SliderEvent.CHANGE, null, "keyboard", k.keyCode);
				});
			});
		}
		private _places(n: number) {
			return (String(n).split(".")[1] ?? "").length;
		}
		private _set(v: number) {
			const s = this._snap;
			if (s !== 0 && s !== 1) {
				const pow = 10 ** this._places(s);
				v = (Math.round(Math.round(v * pow) / (s * pow)) * (s * pow)) / pow;
			} else v = Math.round(v);
			this._value = Math.max(this._min, Math.min(this._max, v));
			this._ui.value = String(this._value);
		}
		get value() {
			return this._value;
		}
		set value(v: number) {
			this._set(v);
		}
		get minimum() {
			return this._min;
		}
		set minimum(v: number) {
			this._min = v;
			this._ui.min = String(v);
			this._set(Math.max(v, this._value));
		}
		get maximum() {
			return this._max;
		}
		set maximum(v: number) {
			this._max = v;
			this._ui.max = String(v);
			this._set(Math.min(v, this._value));
		}
		get snapInterval() {
			return this._snap;
		}
		set snapInterval(v: number) {
			this._snap = v;
			this._ui.setAttribute("step", v > 0 ? String(v) : "any");
		}
		get tickInterval() {
			return this._p.tickInterval ?? 0;
		}
		set tickInterval(v: number) {
			this._p.tickInterval = v;
		}
		get liveDragging() {
			return !!this._p.liveDragging;
		}
		set liveDragging(v: boolean) {
			this._p.liveDragging = !!v;
		}
		get direction() {
			return this._p.direction ?? "horizontal";
		}
		set direction(v: string) {
			this._p.direction = v;
			const c = this._ui.style;
			c.writingMode = v === "vertical" ? "vertical-lr" : "";
			c.direction = v === "vertical" ? "rtl" : "";
		}
	}

	const colorText = (c: number) => (c & 0xffffff).toString(16).padStart(6, "0");

	class ColorPicker extends UIComponent {
		override _cls = "ColorPicker";
		_color: number;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "ColorPicker", 24, 24, {});
			this._color = parseInt(String(this._p.selectedColor ?? "#000000").slice(1), 16) || 0;
			this._root.addEventListener("pointerdown", () => safely(() => this.dispatchEvent(new ComponentEvent(ComponentEvent.BUTTON_DOWN, true))));
			this._root.addEventListener("change", () =>
				safely(() => {
					this._color = parseInt(this._ui.value.slice(1), 16) || 0;
					this.dispatchEvent(new ColorPickerEvent(ColorPickerEvent.CHANGE, this._color));
				}),
			);
		}
		get selectedColor() {
			return this._early ? 0 : this._color;
		}
		set selectedColor(v: number) {
			if (!this.enabled) return;
			this._color = v;
			this._ui.value = `#${colorText(v)}`;
		}
		get hexValue() {
			return colorText(this.selectedColor);
		}
		get showTextField() {
			return this._p.showTextField !== false;
		}
		set showTextField(v: boolean) {
			this._p.showTextField = !!v;
		}
		get editable() {
			return this._p.editable !== false;
		}
		set editable(v: boolean) {
			this._p.editable = !!v;
		}
		get textField() {
			return this;
		}
		open() {
			this._ui.showPicker?.();
		}
		close() {}
	}

	class ProgressBar extends UIComponent {
		override _cls = "ProgressBar";
		_value = 0;
		_min = 0;
		_max = 0;
		_source: any = null;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "ProgressBar", 150, 4, {});
			this._paintBar();
			if (this._p.sourceName) queueMicrotask(() => safely(() => (this.source = this.parent?.getChildByName(this._p.sourceName))));
		}
		private _paintBar() {
			const e = this._ui as HTMLProgressElement;
			if (this.indeterminate) e.removeAttribute("value");
			else e.value = this.percentComplete / 100;
		}
		get mode() {
			return this._p.mode ?? "event";
		}
		set mode(v: string) {
			if (this.mode === v) return;
			this._min = this._max = this._value = 0;
			this._p.mode = v;
			this._p.indeterminate = v !== "manual";
			this._paintBar();
		}
		get indeterminate() {
			return this._p.indeterminate ?? this.mode !== "manual";
		}
		set indeterminate(v: boolean) {
			if (this.mode !== "manual") return;
			this._p.indeterminate = !!v;
			this._paintBar();
		}
		get direction() {
			return this._p.direction ?? "right";
		}
		set direction(v: string) {
			this._p.direction = v;
			this._ui.dir = v === "left" ? "rtl" : "";
		}
		get minimum() {
			return this._min;
		}
		set minimum(v: number) {
			if (this.mode !== "manual") return;
			this._min = v;
			this._paintBar();
		}
		get maximum() {
			return this._max;
		}
		set maximum(v: number) {
			this.setProgress(this._value, v);
		}
		get value() {
			return this._value;
		}
		set value(v: number) {
			this.setProgress(v, this._max);
		}
		get percentComplete() {
			return this._max <= this._min || this._value <= this._min ? 0 : Math.max(0, Math.min(100, ((this._value - this._min) / (this._max - this._min)) * 100));
		}
		setProgress(v: number, max: number) {
			if (this.mode === "manual") this._now(v, max, false);
		}
		private _now(v: number, max: number, tell: boolean) {
			if (v === this._value && max === this._max) return;
			this._value = v;
			this._max = max;
			this._paintBar();
			if (!tell) return;
			const e = new FProgressEvent("progress");
			e.bytesLoaded = v;
			e.bytesTotal = max;
			this.dispatchEvent(e);
			if (max > 0 && v >= max) this.dispatchEvent(new FEvent(FEvent.COMPLETE));
		}
		reset() {
			this._now(0, 0, false);
			const s = this._source;
			this._source = null;
			this.source = s;
		}
		get source() {
			return this._source;
		}
		set source(s: any) {
			this._source = s;
			if (!s?.addEventListener || this.mode !== "event") return;
			s.addEventListener("progress", (e: any) => this._now(e.bytesLoaded, e.bytesTotal, true));
			s.addEventListener(FEvent.COMPLETE, () => this._now(this._max, this._max, true));
		}
	}

	class UILoader extends UIComponent {
		override _cls = "UILoader";
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "UILoader", 100, 100, {});
			this._ui.addEventListener("load", () => safely(() => this.dispatchEvent(new FEvent(FEvent.COMPLETE))));
		}
		get source() {
			return this._p.source || null;
		}
		set source(v: any) {
			this._p.source = v;
			if (this.autoLoad) this.load();
		}
		load(r: any = null) {
			const s = r?.url ?? this._p.source;
			if (s) this._ui.src = String(s?.url ?? s);
		}
		unload() {
			this._ui.removeAttribute("src");
		}
		get autoLoad() {
			return this._p.autoLoad !== false;
		}
		set autoLoad(v: boolean) {
			this._p.autoLoad = !!v;
		}
		get scaleContent() {
			return this._p.scaleContent !== false;
		}
		set scaleContent(v: boolean) {
			this._p.scaleContent = !!v;
			this._ui.style.objectFit = v ? (this.maintainAspectRatio ? "contain" : "fill") : "none";
		}
		get maintainAspectRatio() {
			return this._p.maintainAspectRatio !== false;
		}
		set maintainAspectRatio(v: boolean) {
			this._p.maintainAspectRatio = !!v;
			this.scaleContent = this.scaleContent;
		}
		get percentLoaded() {
			return this._ui.naturalWidth ? 100 : 0;
		}
		get content() {
			return this._ui;
		}
	}

	class DataGridColumn {
		dataField: string;
		headerText: string;
		width = 100;
		sortable = true;
		editable = true;
		resizable = true;
		visible = true;
		constructor(name = "") {
			this.dataField = name;
			this.headerText = name;
		}
	}

	class DataGrid extends SelectableList {
		override _cls = "DataGrid";
		columns: DataGridColumn[] = [];
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "DataGrid", 100, 100);
			this._root.addEventListener("click", (e) =>
				safely(() => {
					const r = (e.target as Element).closest("tr") as HTMLTableRowElement | null;
					if (!r || r.parentElement?.localName !== "tbody") return;
					const i = r.sectionRowIndex;
					this._sel = [i];
					this._mark();
					this.dispatchEvent(new ListEvent(ListEvent.ITEM_CLICK, false, true, (e.target as HTMLTableCellElement).cellIndex, i, i, this._dp.getItemAt(i)));
					this.dispatchEvent(new FEvent(FEvent.CHANGE));
				}),
			);
		}
		addColumn(c: string | DataGridColumn) {
			const col = typeof c === "string" ? new DataGridColumn(c) : c;
			this.columns.push(col);
			this._fill();
			return col;
		}
		getColumnAt(i: number) {
			return this.columns[i];
		}
		getColumnCount() {
			return this.columns.length;
		}
		removeColumnAt(i: number) {
			return this.columns.splice(i, 1)[0];
		}
		override _fill() {
			const rows = this._dp._d;
			const cols = this.columns.length ? this.columns : Object.keys(rows[0] ?? {}).map((n) => new DataGridColumn(n));
			const made = build(controlSpec("DataGrid", { dataProvider: rows.map((r) => Object.fromEntries(cols.map((c) => [c.headerText, r[c.dataField]]))) }, false)!);
			this._root.replaceChildren(...made.childNodes);
			this._mark();
		}
		override _mark() {
			this._root.querySelectorAll("tbody tr").forEach((r, i) => ((r as HTMLElement).style.background = this._sel.includes(i) ? "#d9e8f5" : ""));
		}
	}

	const made = {
		UIComponent,
		Button,
		LabelButton,
		CheckBox,
		RadioButton,
		RadioButtonGroup,
		ComboBox,
		List,
		TextInput,
		TextArea,
		Label,
		NumericStepper,
		Slider,
		ColorPicker,
		ProgressBar,
		UILoader,
		DataGrid,
		DataGridColumn,
		DataProvider,
		ComponentEvent,
		ListEvent,
		SliderEvent,
		ColorPickerEvent,
		DataChangeEvent,
		DataChangeType,
		ProgressBarMode: { EVENT: "event", POLLED: "polled", MANUAL: "manual" },
		ProgressBarDirection: { RIGHT: "right", LEFT: "left" },
		SliderDirection: { HORIZONTAL: "horizontal", VERTICAL: "vertical" },
		ButtonLabelPlacement: { RIGHT: "right", LEFT: "left", TOP: "top", BOTTOM: "bottom" },
		ScrollPolicy: { ON: "on", OFF: "off", AUTO: "auto" },
		StyleManager: {
			setStyle: (n: string, v: unknown) => void (globalStyles[n] = v),
			getStyle: (n: string) => globalStyles[n] ?? null,
			clearStyle: (n: string) => void delete globalStyles[n],
			setComponentStyle: () => {},
			clearComponentStyle: () => {},
			getComponentStyle: () => null,
		},
		itemLabel,
	};
	return made;
}
