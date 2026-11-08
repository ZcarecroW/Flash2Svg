/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * What the code of a document's own classes (src/core/as3/classes.ts) needs of the player, for the
 * documents that have such classes: bound method closures, super(...) of the player's classes,
 * interfaces, an Object's text.
 */
export default function classes(L: any): Record<string, unknown> {
	const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
	Object.assign(L.scripts.helpers, {
		// (a method taken as a value: bound to its object, the same function each time)
		m: (o: any, k: string) => {
			let b = o.$m;
			if (!b) Object.defineProperty(o, "$m", { value: (b = {}) });
			return (b[k] ??= o[k].bind(o));
		},
		// (super(...) of a class of the player's: what its constructor makes with them)
		base: (o: any, B: any, a: unknown[]) => {
			if (B === Error || B.prototype instanceof Error) {
				o.message = a[0] === undefined ? "" : String(a[0]);
				if (a[1] !== undefined) o.errorID = a[1];
				return;
			}
			Object.defineProperties(o, Object.getOwnPropertyDescriptors(Reflect.construct(B, a)));
		},
		iface: (name: string, bases: any[]) => {
			const I: any = function () {};
			I.$n = name;
			I.$b = bases;
			const meets = (i: any): boolean => i === I || i.$b.some(meets);
			Object.defineProperty(I, Symbol.hasInstance, {
				value: (x: any) => {
					if (x === null || typeof x !== "object") return false;
					for (let c = x.constructor; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) if (own(c, "$i") && c.$i.some(meets)) return true;
					return false;
				},
			});
			return I;
		},
		objStr: (o: any) => `[object ${L.bareName(o)}]`,
	});
	const s = L.scripts;
	// the registry: each class made when first asked for
	let user: { c: Record<string, any>; n: Record<string, string> } | null = null;
	try {
		user = s.code.$c?.(s.api, s.helpers) ?? null;
	} catch (e) {
		console.error(e);
	}
	/** A class with AS3 code of the document's own in it (not only one Animate made). */
	const ownCode = (cls: any) => {
		for (let x = cls; x && x !== L.MovieClip && x !== Function.prototype; x = Object.getPrototypeOf(x)) if (own(x, "$n") && !s.generated.has(x)) return true;
		return false;
	};
	Object.assign(s, {
		userClass(name: string): any {
			if (!user) return undefined;
			let key = user.n[name];
			if (key === undefined) for (const q in user.n) if (q.slice(q.lastIndexOf(".") + 1) === name) key = user.n[q];
			if (key === undefined) return undefined;
			// (made when first asked for: its statics are set up then, which may go wrong)
			try {
				return user.c[key];
			} catch (e) {
				console.error(e);
				return undefined;
			}
		},
		classFor(c: any): any {
			const name = c.kind === -1 ? s.P.dc : s.classNames.get(c.tl);
			if (!name) return null;
			const K = s.classOf(name);
			return K && ownCode(K) ? K : null;
		},
		// (an error in its constructor stops there: the object is made)
		make(c: any, cls: any, unbuilt = false): any {
			s.making = { c, cls };
			try {
				const o = Reflect.construct(cls, unbuilt ? [s.helpers.NEW] : []);
				if (unbuilt) s.unbuilt.add(o);
				return o;
			} catch (e) {
				console.error(e);
				return s.clips.get(c);
			} finally {
				s.making = null;
			}
		},
	});
	return {};
}
