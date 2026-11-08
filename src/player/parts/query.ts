/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The part of jQuery that frame scripts use on an HTML5 Canvas document's components (Animate's
 * snippets go through it): the elements are in the document, with the instance names as ids.
 */
export default function query(L: any): Record<string, unknown> {
	const s = L.scripts;
	const box = () => s.player.svg as Element;
	const hooks = new Map<EventTarget, [string, (...a: any[]) => void, EventListener][]>();
	const shown = new WeakMap<Element, string>();
	class Q {
		length = 0;
		[i: number]: any;
		constructor(list: ArrayLike<any>) {
			this.length = list.length;
			for (let i = 0; i < list.length; i++) this[i] = list[i];
		}
		get els(): any[] {
			return Array.from(this as unknown as ArrayLike<any>);
		}
		each(f: (i: number, e: any) => unknown) {
			this.els.forEach((e, i) => f.call(e, i, e));
			return this;
		}
		get(i?: number) {
			return i === undefined ? this.els : this[i];
		}
		eq(i: number) {
			return new Q(this[i] ? [this[i]] : []);
		}
		first() {
			return this.eq(0);
		}
		find(sel: string) {
			return new Q(this.els.flatMap((e) => [...e.querySelectorAll(sel)]));
		}
		parent() {
			return new Q(this.els.map((e) => e.parentNode));
		}
		on(type: string, sel: any, fn?: any) {
			if (typeof sel === "function") [sel, fn] = [null, sel];
			for (const e of this.els) {
				const hear = ((ev: Event) => {
					const at = sel ? (ev.target as Element).closest?.(sel) : e;
					if (at) s.safely(() => fn.call(at, ev, (ev as any).detail));
				}) as EventListener;
				e.addEventListener(type, hear);
				const list = hooks.get(e) ?? [];
				list.push([type, fn, hear]);
				hooks.set(e, list);
			}
			return this;
		}
		off(type?: string, fn?: any) {
			if (typeof fn !== "function") fn = undefined;
			for (const e of this.els) {
				const list = hooks.get(e) ?? [];
				hooks.set(
					e,
					list.filter(([t, f, hear]) => {
						if ((type && t !== type) || (fn && f !== fn)) return true;
						e.removeEventListener(t, hear);
						return false;
					}),
				);
			}
			return this;
		}
		one(type: string, sel: any, fn?: any) {
			const f = fn ?? sel;
			const once = (...a: unknown[]) => {
				this.off(type, once);
				f(...a);
			};
			return fn ? this.on(type, sel, once) : this.on(type, once);
		}
		trigger(type: string, detail?: unknown) {
			for (const e of this.els) e.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
			return this;
		}
		val(v?: unknown) {
			if (v === undefined) return this[0]?.value;
			for (const e of this.els) e.value = v;
			return this;
		}
		prop(n: string, v?: unknown) {
			if (v === undefined) return this[0]?.[n];
			for (const e of this.els) e[n] = v;
			return this;
		}
		attr(n: string, v?: unknown) {
			if (v === undefined) return this[0]?.getAttribute(n) ?? undefined;
			for (const e of this.els) e.setAttribute(n, String(v));
			return this;
		}
		removeAttr(n: string) {
			for (const e of this.els) e.removeAttribute(n);
			return this;
		}
		text(v?: unknown) {
			if (v === undefined) return this.els.map((e) => e.textContent).join("");
			for (const e of this.els) e.textContent = v;
			return this;
		}
		html(v?: string) {
			if (v === undefined) return this[0]?.innerHTML.replaceAll(' xmlns="http://www.w3.org/1999/xhtml"', "");
			for (const e of this.els) e.innerHTML = v;
			return this;
		}
		css(n: string | Record<string, string>, v?: string) {
			if (typeof n === "string" && v === undefined) return this[0] ? getComputedStyle(this[0]).getPropertyValue(n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)) : undefined;
			const all = typeof n === "string" ? { [n]: v! } : n;
			for (const e of this.els) for (const k in all) e.style[k] = all[k];
			return this;
		}
		hide() {
			for (const e of this.els) {
				if (e.style.display !== "none") shown.set(e, e.style.display);
				e.style.display = "none";
			}
			return this;
		}
		show() {
			for (const e of this.els) e.style.display = shown.get(e) ?? "";
			return this;
		}
		toggle(on?: boolean) {
			return (on ?? this[0]?.style.display === "none") ? this.show() : this.hide();
		}
		addClass(c: string) {
			for (const e of this.els) e.classList.add(...c.split(/\s+/));
			return this;
		}
		removeClass(c: string) {
			for (const e of this.els) e.classList.remove(...c.split(/\s+/));
			return this;
		}
		toggleClass(c: string) {
			for (const e of this.els) e.classList.toggle(c);
			return this;
		}
		hasClass(c: string) {
			return this.els.some((e) => e.classList.contains(c));
		}
		focus() {
			this[0]?.focus();
			return this;
		}
		blur() {
			this[0]?.blur();
			return this;
		}
		click(f?: any) {
			return f ? this.on("click", f) : this.each((_i, e) => e.click());
		}
		change(f?: any) {
			return f ? this.on("change", f) : this.trigger("change");
		}
		next(sel?: string) {
			return new Q(this.els.flatMap((e) => (e.nextElementSibling && (!sel || e.nextElementSibling.matches(sel)) ? [e.nextElementSibling] : [])));
		}
		prev(sel?: string) {
			return new Q(this.els.flatMap((e) => (e.previousElementSibling && (!sel || e.previousElementSibling.matches(sel)) ? [e.previousElementSibling] : [])));
		}
		closest(sel: string) {
			return new Q(this.els.flatMap((e) => (e.closest?.(sel) ? [e.closest(sel)] : [])));
		}
		children(sel?: string) {
			return new Q(this.els.flatMap((e) => [...e.children].filter((c) => !sel || c.matches(sel))));
		}
		is(sel: string) {
			return this.els.some((e) => e.matches?.(sel));
		}
		// jQuery UI, as far as the components Animate publishes use it
		checkboxradio() {
			return this;
		}
		controlgroup() {
			return this;
		}
		/** A DatePicker's field: its date read and set in its format (jQuery UI's mm/dd/yy by default). */
		datepicker(a?: any, b?: any, c?: any): any {
			const e = this[0];
			if (!e) return this;
			const o = (picks.get(e) ?? picks.set(e, { dateFormat: "mm/dd/yy" }).get(e))!;
			if (a === "getDate") return readDate(e.value, String(o.dateFormat));
			if (a === "setDate") {
				const d = b instanceof Date ? b : typeof b === "string" ? readDate(b, String(o.dateFormat)) : typeof b === "number" ? new Date(Date.now() + b * 864e5) : null;
				e.value = d ? writeDate(d, String(o.dateFormat)) : "";
				return this;
			}
			if (a === "option") {
				if (typeof b === "string" && c === undefined) return o[b];
				Object.assign(o, typeof b === "string" ? { [b]: c } : b);
				return this;
			}
			if (a === "show") return void openPicker(e), this;
			if (a && typeof a === "object") Object.assign(o, a);
			return this;
		}
	}
	/** Options of DatePicker fields. */
	const picks = new WeakMap<Element, Record<string, unknown>>();
	const NAMES = { D: "Sun Mon Tue Wed Thu Fri Sat", DD: "Sunday Monday Tuesday Wednesday Thursday Friday Saturday", M: "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", MM: "January February March April May June July August September October November December" } as Record<string, string>;
	const pad = (n: number) => String(n).padStart(2, "0");
	/** A date in jQuery UI's format letters (d dd D DD m mm M MM y yy). */
	function writeDate(d: Date, f: string): string {
		return f.replace(/dd|DD|d|D|mm|MM|m|M|yy|y/g, (t) => {
			switch (t) {
				case "d":
					return String(d.getDate());
				case "dd":
					return pad(d.getDate());
				case "D":
				case "DD":
					return NAMES[t]!.split(" ")[d.getDay()]!;
				case "m":
					return String(d.getMonth() + 1);
				case "mm":
					return pad(d.getMonth() + 1);
				case "M":
				case "MM":
					return NAMES[t]!.split(" ")[d.getMonth()]!;
				case "y":
					return pad(d.getFullYear() % 100);
				default:
					return String(d.getFullYear());
			}
		});
	}
	/** A date read in such a format (its numbers), or null. */
	function readDate(v: string, f: string): Date | null {
		const order = f.match(/dd|d|mm|m|yy|y/g) ?? [];
		const nums = v.match(/\d+/g);
		if (!nums || nums.length < order.length) return null;
		let day = 1,
			month = 0,
			year = new Date().getFullYear();
		order.forEach((t, i) => {
			const n = +nums[i]!;
			if (t[0] === "d") day = n;
			else if (t[0] === "m") month = n - 1;
			else year = t === "y" ? 2000 + n : n;
		});
		const d = new Date(year, month, day);
		return Number.isNaN(+d) ? null : d;
	}
	/** The browser's own date picker for a DatePicker's field: the date goes into the field in its format. */
	function openPicker(field: HTMLInputElement) {
		const o = picks.get(field) ?? { dateFormat: "mm/dd/yy" };
		const pick = document.createElementNS("http://www.w3.org/1999/xhtml", "input") as HTMLInputElement;
		pick.type = "date";
		pick.tabIndex = -1;
		pick.style.cssText = "position:absolute;left:0;top:100%;width:1px;height:1px;opacity:0;pointer-events:none";
		const now = readDate(field.value, String(o.dateFormat));
		if (now) pick.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		pick.addEventListener("change", () => {
			const [y, m, d] = pick.value.split("-").map(Number);
			if (y) {
				field.value = writeDate(new Date(y, m! - 1, d), String(o.dateFormat));
				field.dispatchEvent(new Event("input", { bubbles: true }));
				field.dispatchEvent(new Event("change", { bubbles: true }));
			}
			pick.remove();
		});
		pick.addEventListener("blur", () => setTimeout(() => pick.remove(), 0));
		(field.parentNode as HTMLElement).style.position ||= "relative";
		field.parentNode!.appendChild(pick);
		try {
			pick.showPicker();
		} catch {
			pick.remove();
		}
	}
	// (a click on a DatePicker's field opens the browser's date picker)
	box().addEventListener("click", (e) => {
		const t = e.target as HTMLInputElement;
		if (t?.matches?.("input.jqueryui-datepicker")) openPicker(t);
	});
	const $ = (x: any) => {
		if (typeof x === "function") return void queueMicrotask(() => s.safely(x));
		if (typeof x !== "string") return new Q(x ? [x] : []);
		if (x === "#dom_overlay_container") return new Q([box()]);
		try {
			return new Q(box().querySelectorAll(x));
		} catch {
			return new Q([]);
		}
	};
	return { $ };
}
