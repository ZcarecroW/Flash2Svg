/**
 * Part of the Flash API for the components that scroll: TileList, ScrollPane and UIScrollBar (with
 * ScrollEvent), for the documents that use them. They behave as Animate's own, measured against
 * Flash Player (tests/fixtures/as3/f96-panes.as); what they show are HTML boxes (control-markup.ts).
 * They build on the components' part (parts/controls.ts), which comes before this one.
 */
import { tileGrid, tileSpec } from "../control-markup.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function panes(L: any): Record<string, unknown> {
	const { FEvent, FMouseEvent, htmlEl, svgEl, scripts, UIComponent, SelectableList, ListEvent } = L;
	const build = L.$build;
	const safely = (f: () => void) => scripts.safely(f);

	class ScrollEvent extends FEvent {
		static SCROLL = "scroll";
		direction: string;
		delta: number;
		position: number;
		constructor(type: string, direction = "vertical", delta = 0, position = 0) {
			super(type, false, false);
			this.direction = direction;
			this.delta = delta;
			this.position = position;
		}
		clone() {
			return new ScrollEvent(this.type, this.direction, this.delta, this.position);
		}
		toString() {
			return this.formatToString("ScrollEvent", "type", "bubbles", "cancelable", "direction", "delta", "position");
		}
	}

	/** Tiles of pictures and labels (fl.controls.TileList): a grid laid out as Flash Player lays it out. */
	class TileList extends SelectableList {
		_cls = "TileList";
		_sourceField = "source";
		private _tile = -1;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "TileList", 100, 100);
			// (as a List: the click's item first, then the selection)
			this.addEventListener(FMouseEvent.CLICK, () => {
				const i = this._tile;
				this._tile = -1;
				if (i < 0 || !this.enabled) return;
				const per = this._grid().perRow;
				const ev = new ListEvent(ListEvent.ITEM_CLICK, false, true, i % per, Math.floor(i / per), i, this._dp.getItemAt(i));
				this.dispatchEvent(ev);
				if (ev.isDefaultPrevented()) return;
				this._take(this.allowMultipleSelection && this._sel.includes(i) ? this._sel.filter((x: number) => x !== i) : this.allowMultipleSelection ? [...this._sel, i] : [i]);
			});
			this._root.addEventListener("keydown", (e: Event) => safely(() => this._key(e as KeyboardEvent)));
		}
		private _take(now: number[]) {
			const same = now.join() === this._sel.join();
			this._sel = now;
			this._mark();
			if (!same) this.dispatchEvent(new FEvent(FEvent.CHANGE));
		}
		_pressed(e: Event) {
			super._pressed(e);
			const t = (e.target as Element).closest('[role="option"]');
			this._tile = t ? Array.prototype.indexOf.call(this._root.children, t) : -1;
		}
		/** The arrow keys move the selection through the grid. */
		private _key(e: KeyboardEvent) {
			const per = this._grid().perRow;
			const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -per, ArrowDown: per, Home: -Infinity, End: Infinity };
			const d = step[e.key];
			if (d === undefined || !this.length) return;
			e.preventDefault();
			const i = Math.max(0, Math.min(this.length - 1, (this.selectedIndex < 0 ? 0 : this.selectedIndex) + (Number.isFinite(d) ? d : d > 0 ? this.length : -this.length)));
			this._take([i]);
			this.scrollToIndex(i);
		}
		_grid() {
			return tileGrid(this.length, this._w, this._h, this._p);
		}
		/** The grid's columns, rows and scrolling, from the parameters and the size. */
		_layout() {
			const g = this._grid();
			const c = this._root.style;
			const policy = this._p.scrollPolicy === "on" ? "scroll" : this._p.scrollPolicy === "off" ? "hidden" : "auto";
			c.gridTemplateColumns = `repeat(${g.perRow},${this.columnWidth}px)`;
			c.gridAutoRows = `${this.rowHeight}px`;
			c.overflowX = g.scrollX ? policy : "hidden";
			c.overflowY = g.scrollY ? policy : "hidden";
		}
		private _src(it: any): string | undefined {
			const v = it?.[this._sourceField];
			return typeof v === "string" ? (this._sourceField === "source" && it.file ? it.file : v) : undefined;
		}
		_fill() {
			this._root.replaceChildren(...this._dp._d.map((it: any, i: number) => build(tileSpec(this.itemToLabel(it), this._src(it), this._sel.includes(i)))));
			this._layout();
		}
		_mark() {
			const kids = this._root.children;
			for (let i = 0; i < kids.length; i++) {
				const on = this._sel.includes(i);
				const t = kids[i] as HTMLElement;
				t.setAttribute("aria-selected", String(on));
				t.style.background = on ? "#cfe3f2" : "";
			}
		}
		_read() {
			return this._sel.slice();
		}
		setSize(w: number, h: number) {
			super.setSize(w, h);
			this._layout();
		}
		get sourceField() {
			return this._sourceField;
		}
		set sourceField(v: string) {
			this._sourceField = v;
			this._fill();
		}
		get allowMultipleSelection() {
			return !!this._p.allowMultipleSelection;
		}
		set allowMultipleSelection(v: boolean) {
			this._p.allowMultipleSelection = !!v;
			if (!v && this._sel.length > 1) this._sel = [this._sel.pop()!];
			this._mark();
		}
		get columnWidth() {
			return Number(this._p.columnWidth) || 50;
		}
		set columnWidth(v: number) {
			this._p.columnWidth = v;
			this._layout();
		}
		get rowHeight() {
			return Number(this._p.rowHeight) || 50;
		}
		set rowHeight(v: number) {
			this._p.rowHeight = v;
			this._layout();
		}
		get direction() {
			return this._p.direction === "vertical" ? "vertical" : "horizontal";
		}
		set direction(v: string) {
			this._p.direction = v;
			this._layout();
		}
		get scrollPolicy() {
			return this._p.scrollPolicy ?? "auto";
		}
		set scrollPolicy(v: string) {
			this._p.scrollPolicy = v;
			this._layout();
		}
		get columnCount() {
			return this._grid().cols;
		}
		/** (sets the width: that many columns, and a scroll bar if they don't all fit) */
		set columnCount(v: number) {
			if (!v) return;
			const policy = this.scrollPolicy;
			const bar = (Math.ceil(this.length / v) > Math.floor(this._h / this.rowHeight) && policy === "auto") || policy === "on";
			this.width = this.columnWidth * v + (this.direction === "vertical" && bar ? 15 : 0);
		}
		get rowCount() {
			return this._grid().rows;
		}
		set rowCount(v: number) {
			if (!v) return;
			const policy = this.scrollPolicy;
			const bar = (Math.ceil(this.length / v) > Math.floor(this._w / this.columnWidth) && policy === "auto") || policy === "on";
			this.height = this.rowHeight * v + (this.direction === "horizontal" && bar ? 15 : 0);
		}
		scrollToIndex(i: number) {
			(this._root.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest", inline: "nearest" });
		}
		scrollToSelected() {
			this.scrollToIndex(this.selectedIndex);
		}
	}

	/** A box that scrolls what it holds (fl.containers.ScrollPane): a symbol of the library, a picture, a display object. */
	class ScrollPane extends UIComponent {
		_cls = "ScrollPane";
		_content: any = null;
		_hPos = 0;
		_vPos = 0;
		private _quiet = false;
		private _drag: [number, number, number, number] | null = null;
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "ScrollPane", 100, 100, {});
			this._root.addEventListener("scroll", () => safely(() => this._scrolled()));
			this._root.addEventListener("pointerdown", (e: PointerEvent) => {
				if (!this.scrollDrag) return;
				this._drag = [e.clientX, e.clientY, this._hPos, this._vPos];
				this._root.setPointerCapture?.(e.pointerId);
			});
			this._root.addEventListener("pointermove", (e: PointerEvent) =>
				safely(() => {
					const d = this._drag;
					if (!d) return;
					this.horizontalScrollPosition = d[2] - (e.clientX - d[0]);
					this.verticalScrollPosition = d[3] - (e.clientY - d[1]);
				}),
			);
			const stop = () => (this._drag = null);
			this._root.addEventListener("pointerup", stop);
			this._root.addEventListener("pointercancel", stop);
			// (the export drew a symbol's first frame: scripts get the symbol itself, playing)
			const s = this._p.source;
			if (typeof s === "string" && s && !/[./]/.test(s) && scripts.classOf(s)) this._load(s);
		}
		private _load(v: any) {
			this._root.replaceChildren();
			this._content = null;
			this._hPos = this._vPos = 0;
			if (v === null || v === undefined || v === "") return;
			if (typeof v === "object" && v._node) return void this._hold(v);
			const src = String(v?.url ?? v);
			const K = /[./]/.test(src) ? null : scripts.classOf(src);
			if (K) {
				this._hold(new K());
				this.dispatchEvent(new FEvent(FEvent.INIT));
				this.dispatchEvent(new FEvent(FEvent.COMPLETE));
				return;
			}
			const img = htmlEl("img") as HTMLImageElement;
			img.draggable = false;
			img.style.cssText = "display:block;max-width:none";
			img.addEventListener("load", () => safely(() => this.dispatchEvent(new FEvent(FEvent.COMPLETE))));
			img.addEventListener("error", () => safely(() => this.dispatchEvent(new (L.IOErrorEvent ?? FEvent)("ioError"))));
			img.src = src;
			this._root.appendChild(img);
			this._content = img;
		}
		/** A display object in the pane: in an <svg> of its own, playing. */
		private _hold(o: any) {
			const b = o.getBounds ? o.getBounds(o) : { right: o.width, bottom: o.height };
			const svg = svgEl("svg", { width: String(Math.max(0, b.x + b.width || o.width)), height: String(Math.max(0, b.y + b.height || o.height)), style: "display:block;overflow:visible" });
			svg.appendChild(o._node);
			this._root.appendChild(svg);
			this._content = o;
			if (o._c) scripts.orphans.add(o._c);
		}
		get source() {
			return this._p.source ?? "";
		}
		set source(v: any) {
			this._p.source = v;
			this._load(v);
		}
		get content() {
			return this._content ?? (this._root.querySelector("img,svg") as any);
		}
		load(r: any) {
			this.source = r?.url ?? r;
		}
		refreshPane() {
			this._load(this._p.source);
		}
		update() {}
		get percentLoaded() {
			const c = this._content;
			return !c || (c instanceof HTMLImageElement && !c.complete) ? 0 : 100;
		}
		get bytesLoaded() {
			return this.percentLoaded ? 1 : 0;
		}
		get bytesTotal() {
			return this._content ? 1 : 0;
		}
		get scrollDrag() {
			return !!this._p.scrollDrag;
		}
		set scrollDrag(v: boolean) {
			this._p.scrollDrag = !!v;
			this._root.style.cursor = v ? "grab" : "";
		}
		get horizontalScrollPolicy() {
			return this._p.horizontalScrollPolicy ?? "auto";
		}
		set horizontalScrollPolicy(v: string) {
			this._p.horizontalScrollPolicy = v;
			this._root.style.overflowX = v === "on" ? "scroll" : v === "off" ? "hidden" : "auto";
		}
		get verticalScrollPolicy() {
			return this._p.verticalScrollPolicy ?? "auto";
		}
		set verticalScrollPolicy(v: string) {
			this._p.verticalScrollPolicy = v;
			this._root.style.overflowY = v === "on" ? "scroll" : v === "off" ? "hidden" : "auto";
		}
		/** What it holds, how big. */
		private _size(): [number, number] {
			const c = this.content;
			if (!c) return [0, 0];
			if (c instanceof HTMLImageElement) return [c.naturalWidth, c.naturalHeight];
			if (c instanceof Element) return [+(c.getAttribute("width") ?? 0), +(c.getAttribute("height") ?? 0)];
			return [c.width, c.height];
		}
		/** The room for the content and the scroll bars Flash Player shows (15 each). */
		private _room() {
			const [cw, ch] = this._size();
			const hp = this.horizontalScrollPolicy,
				vp = this.verticalScrollPolicy;
			let ah = this._h;
			let v = vp === "on" || (vp === "auto" && ch > ah);
			let aw = this._w - (v ? 15 : 0);
			const h = hp === "on" || (hp === "auto" && cw > aw);
			if (h) ah -= 15;
			if (h && !v && vp === "auto" && ch > ah) {
				v = true;
				aw -= 15;
			}
			return { maxH: Math.max(0, cw - aw), maxV: Math.max(0, ch - ah) };
		}
		get maxHorizontalScrollPosition() {
			return this._room().maxH;
		}
		get maxVerticalScrollPosition() {
			return this._room().maxV;
		}
		get horizontalScrollPosition() {
			return this._hPos;
		}
		set horizontalScrollPosition(v: number) {
			this._to("horizontal", v);
		}
		get verticalScrollPosition() {
			return this._vPos;
		}
		set verticalScrollPosition(v: number) {
			this._to("vertical", v);
		}
		private _to(dir: string, v: number) {
			const r = this._room();
			const across = dir === "horizontal";
			const to = Math.max(0, Math.min(across ? r.maxH : r.maxV, +v || 0));
			const was = across ? this._hPos : this._vPos;
			if (to === was) return;
			if (across) this._hPos = to;
			else this._vPos = to;
			this._quiet = true;
			if (across) this._root.scrollLeft = to;
			else this._root.scrollTop = to;
			queueMicrotask(() => (this._quiet = false));
			this.dispatchEvent(new ScrollEvent(ScrollEvent.SCROLL, dir, to - was, to));
		}
		/** The visitor scrolled the box. */
		private _scrolled() {
			if (this._quiet) return;
			const e = this._root;
			const r = this._room();
			const h = Math.min(r.maxH, Math.round(e.scrollLeft)),
				v = Math.min(r.maxV, Math.round(e.scrollTop));
			if (h !== this._hPos) {
				const d = h - this._hPos;
				this._hPos = h;
				this.dispatchEvent(new ScrollEvent(ScrollEvent.SCROLL, "horizontal", d, h));
			}
			if (v !== this._vPos) {
				const d = v - this._vPos;
				this._vPos = v;
				this.dispatchEvent(new ScrollEvent(ScrollEvent.SCROLL, "vertical", d, v));
			}
		}
	}

	/** A scroll bar (fl.controls.UIScrollBar), the browser's own, scrolling a text field or what a script says. */
	class UIScrollBar extends UIComponent {
		_cls = "UIScrollBar";
		_min = 0;
		_max = 0;
		_pos = 0;
		_page = 10;
		_lineSize = 1;
		_pageSize = 0;
		_target: any = null;
		private _quiet = false;
		private _onTarget = () => this._follow();
		constructor(node?: SVGElement, ct?: any) {
			super(node, ct, "UIScrollBar", 15, 100, {});
			this._root.addEventListener("scroll", () => safely(() => this._dragged()));
		}
		/** Its target by name, once it has a parent to look in. */
		private _find() {
			const name = this._p.scrollTargetName;
			if (!this._target && name) {
				const t = this.parent?.getChildByName?.(name);
				if (t) this._attach(t);
			}
		}
		/** Drawn (after the script that made it): the target's scroll range, and the target told, as Flash Player does. */
		_drawn() {
			const had = !!this._target;
			this._find();
			// (a target found by its name is drawn for on the next frame's draw, after its scripts, as in Flash Player)
			if (this._target && !had) {
				const draw = () => {
					this.removeEventListener(FEvent.EXIT_FRAME, draw);
					this._drawn();
				};
				const frame = () => {
					this.removeEventListener(FEvent.ENTER_FRAME, frame);
					this.addEventListener(FEvent.EXIT_FRAME, draw);
				};
				this.addEventListener(FEvent.ENTER_FRAME, frame);
				return;
			}
			if (this._target) {
				this._props();
				// (and the target is set to it, which the target announces)
				this.setScrollPosition(this._target[this.direction === "horizontal" ? "scrollH" : "scrollV"], true);
			}
			this._paint();
		}
		/** The range from the target: a text field's lines (a page of 10), or its width. */
		private _props() {
			const t = this._target;
			if (!t || !("scrollV" in t)) return;
			const across = this.direction === "horizontal";
			this.setScrollProperties(across ? t.width : 10, across ? 0 : 1, across ? t.maxScrollH : t.maxScrollV);
		}
		/** (its length first, its thickness second, whichever way it goes) */
		get width() {
			return this.direction === "horizontal" ? this._w : this._h;
		}
		set width(v: number) {
			super.width = v;
		}
		get height() {
			return this.direction === "horizontal" ? this._h : this._w;
		}
		set height(v: number) {
			super.height = v;
		}
		get direction() {
			return this._p.direction === "horizontal" ? "horizontal" : "vertical";
		}
		set direction(v: string) {
			this._p.direction = v;
			const across = v === "horizontal";
			const c = this._root.style;
			c.overflowX = across ? "scroll" : "hidden";
			c.overflowY = across ? "hidden" : "scroll";
			this._paint();
		}
		get scrollTarget() {
			this._find();
			return this._target;
		}
		set scrollTarget(t: any) {
			this._attach(t);
			if (t) this._later();
		}
		/** Listens to a target (the draw that found it by name draws for it later). */
		private _attach(t: any) {
			this._target?.removeEventListener?.(FEvent.SCROLL, this._onTarget);
			this._target?.removeEventListener?.(FEvent.CHANGE, this._onTarget);
			this._target = t;
			if (!t) return;
			t.addEventListener(FEvent.SCROLL, this._onTarget);
			t.addEventListener(FEvent.CHANGE, this._onTarget);
		}
		get scrollTargetName() {
			return this._target?.name ?? this._p.scrollTargetName ?? "";
		}
		set scrollTargetName(v: string) {
			this._p.scrollTargetName = v;
			this.scrollTarget = this.parent?.getChildByName?.(v) ?? null;
		}
		/** The target scrolled (or its text changed): the bar follows, with its own event, not setting the target back. */
		private _inEdit = false;
		private _follow() {
			const t = this._target;
			if (!t || !("scrollV" in t) || this._inEdit || !this.enabled) return;
			this._inEdit = true;
			try {
				this._props();
				this.setScrollPosition(t[this.direction === "horizontal" ? "scrollH" : "scrollV"], true);
			} finally {
				this._inEdit = false;
			}
		}
		update() {
			this._drawn();
		}
		setScrollProperties(page: number, min: number, max: number, pageScroll = 0) {
			this._page = page;
			this._min = Math.max(0, min);
			const t = this._target;
			this._max = t && "scrollV" in t ? Math.min(max, this.direction === "horizontal" ? t.maxScrollH : t.maxScrollV) : max;
			if (pageScroll >= 0) this._pageSize = pageScroll;
			this._pos = Math.max(min, Math.min(max, this._pos));
			this._paint();
		}
		get scrollPosition() {
			return this._pos;
		}
		set scrollPosition(v: number) {
			this.setScrollPosition(v, true);
		}
		/** The new position, its event, then the target (the event comes before the target moves). */
		setScrollPosition(v: number, fire = true) {
			const to = Math.max(this._min, Math.min(this._max, +v || 0));
			const was = this._pos;
			if (to !== was) {
				this._pos = to;
				this._paint();
				if (fire) this.dispatchEvent(new ScrollEvent(ScrollEvent.SCROLL, this.direction, to - was, to));
			}
			// (the target is set either way, unless it is what moved)
			const t = this._target;
			if (t && "scrollV" in t && !this._inEdit) {
				if (this.direction === "horizontal") t.scrollH = this._pos;
				else t.scrollV = this._pos;
			}
		}
		get minScrollPosition() {
			return this._min;
		}
		set minScrollPosition(v: number) {
			this.setScrollProperties(this._page, v, this._max);
		}
		get maxScrollPosition() {
			return this._max;
		}
		set maxScrollPosition(v: number) {
			this.setScrollProperties(this._page, this._min, v);
		}
		get pageSize() {
			return this._page;
		}
		set pageSize(v: number) {
			this._page = v;
			this._paint();
		}
		get lineScrollSize() {
			return this._lineSize;
		}
		set lineScrollSize(v: number) {
			this._lineSize = v;
		}
		get pageScrollSize() {
			return this._pageSize || this._page;
		}
		set pageScrollSize(v: number) {
			this._pageSize = v;
		}
		/** The browser's bar shows the range: what it scrolls over is as long as the range and a page. */
		private _paint() {
			const e = this._root;
			const across = this.direction === "horizontal";
			const span = Math.max(0, this._max - this._min);
			const long = across ? this._w : this._h;
			const inner = e.firstElementChild as HTMLElement | null;
			if (inner) inner.style[across ? "width" : "height"] = `${span ? (long * (span + this._page)) / Math.max(1, this._page) : long}px`;
			const room = across ? e.scrollWidth - e.clientWidth : e.scrollHeight - e.clientHeight;
			this._quiet = true;
			const at = span ? ((this._pos - this._min) / span) * room : 0;
			if (across) e.scrollLeft = at;
			else e.scrollTop = at;
			queueMicrotask(() => (this._quiet = false));
		}
		/** The visitor moved the bar. */
		private _dragged() {
			if (this._quiet) return;
			const e = this._root;
			const across = this.direction === "horizontal";
			const room = across ? e.scrollWidth - e.clientWidth : e.scrollHeight - e.clientHeight;
			if (room <= 0) return;
			const at = across ? e.scrollLeft : e.scrollTop;
			this.setScrollPosition(Math.round(this._min + (at / room) * (this._max - this._min)), true);
		}
	}


	return {
		TileList,
		ScrollPane,
		UIScrollBar,
		ScrollBar: UIScrollBar,
		ScrollEvent,
		ScrollBarDirection: { HORIZONTAL: "horizontal", VERTICAL: "vertical" },
	};
}
