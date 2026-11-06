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
	}
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
