/**
 * Flash2SVG player: a tiny timeline runtime embedded in player-format SVGs.
 * Reads the program from <script type="application/json" id="…-data">, builds the display list
 * from <defs>, and plays it with Flash semantics (movie clip playheads, graphic sync, frame
 * scripts, buttons, sounds). Exposes `svg.flash2svg` for control.
 *
 * This file is bundled (esbuild, minified) into an IIFE string by scripts/build.mjs.
 */
import { evalBezier } from "../core/easing.ts";
import type { PInst, PItem, PProgram, PTimeline, PTrack } from "./format.ts";

const NS = "http://www.w3.org/2000/svg";
const XL = "http://www.w3.org/1999/xlink";
const RAD = Math.PI / 180;

type Listener = (e: { type: string; frame: number; label?: string }) => void;

function trackAt(P: PProgram, tr: PTrack | undefined, t: number, def: number): number {
	if (tr === undefined) return def;
	if (typeof tr === "number") return tr;
	const n = tr.length;
	if (t <= tr[0]!) return tr[1]!;
	for (let i = 0; i + 3 < n; i += 3) {
		const t1 = tr[i + 3]!;
		if (t < t1) {
			const t0 = tr[i]!,
				v0 = tr[i + 1]!,
				e = tr[i + 2]!,
				v1 = tr[i + 4]!;
			if (e === 0) return v0;
			const u = (t - t0) / (t1 - t0);
			const p = e === 1 ? u : evalBezier(P.bz[e - 2]!, u);
			return v0 + (v1 - v0) * p;
		}
	}
	return tr[n - 2]!;
}

function el(name: string, attrs?: Record<string, string>): SVGElement {
	const e = document.createElementNS(NS, name) as SVGElement;
	if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]!);
	return e;
}
function use(id: string): SVGElement {
	const u = el("use");
	u.setAttributeNS(XL, "xlink:href", "#" + id);
	return u;
}

let uidCounter = 0;

/** A running timeline (root, movie clip, graphic or button instance). */
class Clip {
	readonly node: SVGGElement;
	frame = 0;
	playing = true;
	private items = new Map<PItem, Inst>();
	private layerNodes: SVGGElement[] = [];
	private maskIds: string[] = [];
	readonly tl: PTimeline;
	readonly P: PProgram;
	readonly player: Player;
	readonly kind: number; // -1 root, 0 mc, 1 graphic, 2 button
	private enteredFrame = -1;
	buttonState = 0;

	constructor(player: Player, tl: PTimeline, kind: number) {
		this.player = player;
		this.P = player.P;
		this.tl = tl;
		this.kind = kind;
		this.fresh = player.inTick;
		this.node = el("g") as SVGGElement;
		tl.ly.forEach((l, i) => {
			let g = el("g") as SVGGElement;
			if (l.m) {
				const id = `f2s_m${uidCounter++}`;
				const mask = el("mask", { id });
				const inner = el("g", { filter: `url(#${this.P.mf})` }) as SVGGElement;
				mask.appendChild(inner);
				this.node.appendChild(mask);
				this.maskIds[i] = id;
				g = inner;
			}
			this.layerNodes.push(g);
		});
		// masked layers are grouped under the mask
		let current: { mask: number; g: SVGGElement } | null = null;
		tl.ly.forEach((l, i) => {
			if (l.m) return;
			const g = this.layerNodes[i]!;
			if (l.mb !== undefined && this.maskIds[l.mb]) {
				if (!current || current.mask !== l.mb) {
					current = { mask: l.mb, g: el("g", { mask: `url(#${this.maskIds[l.mb]})` }) as SVGGElement };
					this.node.appendChild(current.g);
				}
				current.g.appendChild(g);
			} else {
				current = null;
				this.node.appendChild(g);
			}
		});
	}

	/** Runs frame scripts for the frame just entered; returns false if a goto changed the frame. */
	private runActions(): void {
		if (this.enteredFrame === this.frame) return;
		this.enteredFrame = this.frame;
		const acts = this.tl.ac?.[this.frame];
		const label = this.labelAt(this.frame);
		if (this.kind === -1) this.player.emit({ type: "frame", frame: this.frame, label });
		this.playSounds();
		if (!acts) return;
		for (const a of acts) {
			if (a[0] === 0) this.playing = false;
			else if (a[0] === 1) this.playing = true;
			else {
				const target = this.resolve(a[1]!);
				this.playing = a[2] === 1;
				this.frame = target;
				this.enteredFrame = -1;
				this.runActions();
				return;
			}
		}
	}

	private playSounds() {
		if (this.player.muted || !this.tl.sd) return;
		for (const s of this.tl.sd) if (s[0] === this.frame) this.player.sound(s[1], s[2], s[3], s[4]);
	}

	labelAt(f: number): string | undefined {
		if (!this.tl.lb) return undefined;
		for (const k in this.tl.lb) if (this.tl.lb[k] === f) return k;
		return undefined;
	}

	resolve(target: number | string): number {
		if (typeof target === "number") return Math.max(0, Math.min(this.tl.n - 1, target));
		const f = this.tl.lb?.[target];
		return f === undefined ? (/^\d+$/.test(target) ? Math.max(0, Math.min(this.tl.n - 1, +target - 1)) : this.frame) : f;
	}

	/** A clip created during a tick shows its first frame on that tick and advances from the next. */
	fresh = false;

	/** Advances one frame (movie clips & root); graphics/buttons are driven by their parent. */
	tick() {
		if (this.kind === 0 || this.kind === -1) {
			if (this.fresh) {
				this.fresh = false;
			} else if (this.playing) {
				let next = this.frame + 1;
				if (next >= this.tl.n) next = this.kind === -1 && !this.player.loop ? this.frame : 0;
				if (this.kind === -1 && next === this.frame && next === this.tl.n - 1) {
					this.playing = false;
					this.player.emit({ type: "end", frame: this.frame });
				}
				this.frame = next;
			}
			this.runActions();
		}
		this.fresh = false;
		this.sync();
		for (const inst of this.items.values()) {
			const c = inst.clip;
			if (!c) continue;
			if (c.kind === 1) c.setFrame(graphicFrame(inst.it as PInst, this.frame, c.tl.n));
			c.tick();
		}
		this.updateAdvance();
	}

	/** Whether the next tick moves this clip exactly one frame forward (drives interpolation). */
	adv = false;
	private updateAdvance() {
		if (this.kind === 0 || this.kind === -1) this.adv = this.playing && this.frame + 1 < this.tl.n;
	}

	/** Creates/removes item nodes for the current frame. */
	sync() {
		this.tl.ly.forEach((l, li) => {
			const g = this.layerNodes[li]!;
			let before: Element | null = null;
			// iterate top-down so we can insert in order
			for (let i = l.it.length - 1; i >= 0; i--) {
				const it = l.it[i]!;
				const active = this.frame >= it.s && this.frame < it.e;
				let inst = this.items.get(it);
				if (active && !inst) {
					inst = new Inst(this, it);
					this.items.set(it, inst);
					g.insertBefore(inst.node, before);
					const c = inst.clip;
					if (c && c.kind === 1) c.setFrame(graphicFrame(it as PInst, this.frame, c.tl.n));
				} else if (!active && inst) {
					inst.node.remove();
					this.items.delete(it);
					inst = undefined;
				}
				if (inst) before = inst.node;
			}
		});
	}

	/** Updates attributes; `frac` = progress (0..1) towards the next frame. */
	render(frac: number) {
		const t = this.frame + (this.adv ? frac : 0);
		const vw = this.tl.vw;
		if (vw) this.node.setAttribute("transform", matrixOf(this.P, vw, t, 0, 0));
		for (const inst of this.items.values()) inst.render(t, frac, this);
	}

	/** Graphic symbols/buttons: frame chosen by the parent. */
	setFrame(f: number) {
		if (f !== this.frame) {
			this.frame = f;
			this.sync();
		}
	}

	gotoFrame(f: number, play: boolean) {
		this.frame = f;
		this.playing = play;
		this.enteredFrame = -1;
		this.runActions();
		this.sync();
	}
}

/** A display-list entry of a clip. */
class Inst {
	readonly node: SVGElement;
	readonly it: PItem;
	readonly owner: Clip;
	clip: Clip | null = null;
	private cm: SVGElement | null = null;
	private seqIndex = -1;
	private filterRef = "";

	constructor(owner: Clip, it: PItem) {
		this.owner = owner;
		this.it = it;
		const P = owner.P;
		switch (it.k) {
			case "a":
				this.node = use(it.r);
				break;
			case "r": {
				const g = el("g");
				g.innerHTML = it.x;
				this.node = g;
				break;
			}
			case "q":
				this.node = el("g");
				break;
			case "i": {
				const g = el("g");
				const sym = P.tl[it.y];
				if (sym && !it.hd) {
					this.clip = new Clip(owner.player, sym, it.t);
					g.appendChild(this.clip.node);
					if (it.nm) {
						g.setAttribute("data-name", it.nm);
						owner.player.named.set(it.nm, this.clip);
					}
					if (it.t === 2) this.button(g);
					this.clip.sync();
				}
				if (it.b) g.setAttribute("style", `mix-blend-mode:${it.b}`);
				this.node = g;
				break;
			}
		}
	}

	private button(g: SVGElement) {
		const set = (s: number) => {
			if (this.clip) {
				this.clip.buttonState = s;
				this.clip.setFrame(Math.min(s, this.clip.tl.n - 1));
				this.clip.render(0);
			}
		};
		g.style.cursor = "pointer";
		g.addEventListener("pointerenter", () => set(1));
		g.addEventListener("pointerleave", () => set(0));
		g.addEventListener("pointerdown", () => set(2));
		g.addEventListener("pointerup", () => set(1));
	}

	render(t: number, frac: number, _owner: Clip) {
		const it = this.it;
		const P = this.owner.P;
		if (it.k === "q") {
			const i = Math.min(it.rs.length - 1, Math.floor(t) - it.s);
			if (i !== this.seqIndex) {
				this.seqIndex = i;
				this.node.replaceChildren(use(it.rs[i]!));
			}
			return;
		}
		if (it.k !== "i") return;
		const tr = it.tr;
		this.node.setAttribute("transform", matrixOf(P, tr, t, trackAt(P, tr[6], t, 0), trackAt(P, tr[7], t, 0)));

		if (it.c) {
			const cv = it.c.map((tk, i) => trackAt(P, tk, t, i < 4 ? 100 : 0));
			if (!it.cm) {
				this.node.setAttribute("opacity", String(Math.max(0, cv[3]!) / 100));
			} else {
				if (!this.cm) {
					const id = `f2s_c${uidCounter++}`;
					const f = el("filter", { id, "color-interpolation-filters": "sRGB" });
					this.cm = el("feColorMatrix", { type: "matrix" });
					f.appendChild(this.cm);
					this.owner.player.defs.appendChild(f);
					this.colorWrap(id);
				}
				const v = [cv[0]! / 100, 0, 0, 0, cv[4]! / 255, 0, cv[1]! / 100, 0, 0, cv[5]! / 255, 0, 0, cv[2]! / 100, 0, cv[6]! / 255, 0, 0, 0, cv[3]! / 100, cv[7]! / 255];
				this.cm.setAttribute("values", v.map(r4).join(" "));
			}
		}
		if (it.f) {
			let ref = it.f[0]![1];
			for (const [ft, id] of it.f) if (ft <= t) ref = id;
			if (ref !== this.filterRef) {
				this.filterRef = ref;
				const target = (this.clip?.node as SVGElement | undefined) ?? this.node;
				if (ref) target.setAttribute("filter", `url(#${ref})`);
				else target.removeAttribute("filter");
			}
		}
		const clip = this.clip;
		if (!clip) return;
		if (it.t === 1) {
			// a graphic interpolates when its parent does and it advances in step
			const parent = this.owner;
			clip.adv = parent.adv && graphicFrame(it, parent.frame + 1, clip.tl.n) === clip.frame + 1;
		}
		clip.render(frac);
	}

	private colorWrap(id: string) {
		// colour filter on an inner group so Animate filters (on the clip node) stay separate
		const g = el("g", { filter: `url(#${id})` });
		while (this.node.firstChild) g.appendChild(this.node.firstChild);
		this.node.appendChild(g);
	}
}

/** translate(x,y) rotate(rot) skewX(skw) scale(sx,sy) translate(-tp) as a matrix() string. */
function matrixOf(P: PProgram, tr: PTrack[], t: number, tpx: number, tpy: number): string {
	const x = trackAt(P, tr[0], t, 0),
		y = trackAt(P, tr[1], t, 0),
		rot = trackAt(P, tr[2], t, 0) * RAD,
		skw = Math.tan(trackAt(P, tr[3], t, 0) * RAD),
		sx = trackAt(P, tr[4], t, 1),
		sy = trackAt(P, tr[5], t, 1);
	const cos = Math.cos(rot),
		sin = Math.sin(rot);
	const a = cos * sx,
		b = sin * sx,
		c = (cos * skw - sin) * sy,
		d = (sin * skw + cos) * sy;
	return `matrix(${r4(a)} ${r4(b)} ${r4(c)} ${r4(d)} ${r4(x - (a * tpx + c * tpy))} ${r4(y - (b * tpx + d * tpy))})`;
}

function r4(v: number): string {
	return String(Math.round(v * 10000) / 10000);
}

function graphicFrame(it: PInst, frame: number, count: number): number {
	const ranges = it.g;
	if (!ranges || !ranges.length || count <= 0) return 0;
	let r = ranges[0]!;
	for (const g of ranges) if (frame >= g[0]) r = g;
	const off = Math.max(0, frame - r[0]);
	const first = Math.max(0, Math.min(count - 1, r[3]));
	const last = r[4] >= 0 ? Math.min(count - 1, r[4]) : -1;
	switch (r[2]) {
		case 2:
			return first;
		case 1:
			return Math.min(first + off, last >= first ? last : count - 1);
		case 4:
			return Math.max(first - off, last >= 0 && last <= first ? last : 0);
		case 3:
			if (last >= 0 && last <= first) return first - (off % (first - last + 1));
			return (((first - off) % count) + count) % count;
		default:
			if (last >= first && last >= 0 && last < count - 1) return first + (off % (last - first + 1));
			return (first + off) % count;
	}
}

class Player {
	readonly P: PProgram;
	readonly svg: SVGSVGElement;
	readonly defs: SVGDefsElement;
	root!: Clip;
	loop = true;
	muted = false;
	speed = 1;
	named = new Map<string, Clip>();
	inTick = false;
	private listeners: Record<string, Listener[]> = {};
	private time = 0; // seconds since last tick
	private raf = 0;
	private last = 0;
	private running = false;
	private audio = new Map<string, HTMLAudioElement[]>();

	constructor(svg: SVGSVGElement, P: PProgram, loop: boolean) {
		this.svg = svg;
		this.P = P;
		this.loop = loop;
		this.defs = (svg.querySelector("defs") as SVGDefsElement) ?? (svg.insertBefore(el("defs"), svg.firstChild) as SVGDefsElement);
		this.reset();
	}

	reset() {
		this.root?.node.remove();
		this.named.clear();
		this.root = new Clip(this, this.P.tl[this.P.root]!, -1);
		this.root.node.setAttribute("class", "f2s-stage");
		this.svg.appendChild(this.root.node);
		this.root.gotoFrame(0, true);
		this.time = 0;
		this.root.render(0);
	}

	emit(e: { type: string; frame: number; label?: string }) {
		for (const l of this.listeners[e.type] ?? []) l(e);
	}

	on(type: string, fn: Listener) {
		(this.listeners[type] ??= []).push(fn);
	}

	sound(id: string, sync: number, loops: number, frames: number) {
		const url = this.P.snd[id];
		if (!url) return;
		const list = this.audio.get(id) ?? [];
		this.audio.set(id, list);
		if (sync === 2) {
			list.forEach((a) => a.pause());
			return;
		}
		if (sync === 1 && list.some((a) => !a.paused)) return; // "start": only if not playing
		const a = new Audio(url);
		let left = Math.max(1, loops);
		a.addEventListener("ended", () => {
			if (--left > 0) a.play().catch(() => {});
		});
		if (sync === 3) setTimeout(() => a.pause(), (frames / this.P.fps) * 1000);
		a.play().catch(() => {});
		list.push(a);
	}

	private frameLoop = (now: number) => {
		if (!this.running) return;
		const dt = Math.min(0.25, (now - this.last) / 1000) * this.speed;
		this.last = now;
		this.time += dt;
		const fd = 1 / this.P.fps;
		while (this.time >= fd) {
			this.time -= fd;
			this.step();
		}
		this.root.render(this.time / fd);
		this.raf = requestAnimationFrame(this.frameLoop);
	};

	step() {
		this.inTick = true;
		try {
			this.root.tick();
		} finally {
			this.inTick = false;
		}
	}

	play() {
		this.root.playing = true;
		if (this.running) return;
		this.running = true;
		this.last = performance.now();
		this.raf = requestAnimationFrame(this.frameLoop);
	}

	pause() {
		this.running = false;
		cancelAnimationFrame(this.raf);
	}

	stop() {
		this.root.playing = false;
	}

	gotoAndPlay(target: number | string) {
		this.root.gotoFrame(this.root.resolve(typeof target === "number" ? target - 1 : target), true);
		this.root.render(0);
		this.play();
	}

	gotoAndStop(target: number | string) {
		this.root.gotoFrame(this.root.resolve(typeof target === "number" ? target - 1 : target), false);
		this.root.render(0);
	}

	/** Deterministic seek: replays from the start to `seconds`. */
	seek(seconds: number) {
		const wasRunning = this.running;
		this.pause();
		this.reset();
		const fd = 1 / this.P.fps;
		const ticks = Math.floor(seconds / fd + 1e-6);
		for (let i = 0; i < ticks; i++) this.step();
		this.time = Math.max(0, seconds - ticks * fd);
		this.root.render(this.time / fd);
		if (wasRunning) this.play();
	}

	get currentFrame() {
		return this.root.frame + 1;
	}
	get totalFrames() {
		return this.root.tl.n;
	}
	clip(name: string) {
		const c = this.named.get(name);
		return c
			? {
					play: () => (c.playing = true),
					stop: () => (c.playing = false),
					gotoAndPlay: (t: number | string) => c.gotoFrame(c.resolve(typeof t === "number" ? t - 1 : t), true),
					gotoAndStop: (t: number | string) => c.gotoFrame(c.resolve(typeof t === "number" ? t - 1 : t), false),
				}
			: null;
	}
}

// ------------------------------------------------------------------ boot

(function boot() {
	const script = document.currentScript as SVGScriptElement | null;
	const svg = (script?.ownerSVGElement ?? document.querySelector("svg[data-f2s]")) as SVGSVGElement | null;
	if (!svg) return;
	const dataEl = svg.querySelector('script[type="application/json"]');
	if (!dataEl?.textContent) return;
	const P = JSON.parse(dataEl.textContent) as PProgram;
	const begin = svg.getAttribute("data-begin") || "auto";
	const loop = svg.getAttribute("data-loop") !== "0";
	const poster = svg.querySelector(".f2s-poster");
	const player = new Player(svg, P, loop);
	poster?.remove();
	const api = {
		play: () => player.play(),
		pause: () => player.pause(),
		stop: () => player.stop(),
		gotoAndPlay: (t: number | string) => player.gotoAndPlay(t),
		gotoAndStop: (t: number | string) => player.gotoAndStop(t),
		seek: (s: number) => player.seek(s),
		on: (type: string, fn: Listener) => player.on(type, fn),
		clip: (name: string) => player.clip(name),
		get currentFrame() {
			return player.currentFrame;
		},
		get totalFrames() {
			return player.totalFrames;
		},
		get muted() {
			return player.muted;
		},
		set muted(v: boolean) {
			player.muted = v;
		},
		get speed() {
			return player.speed;
		},
		set speed(v: number) {
			player.speed = v;
		},
	};
	(svg as unknown as { flash2svg: typeof api }).flash2svg = api;
	const delay = parseFloat(svg.getAttribute("data-delay") || "0") * 1000;
	const start = () => setTimeout(() => player.play(), delay);
	if (begin === "auto") start();
	else if (begin === "click") svg.addEventListener("click", start, { once: true });
	else if (begin === "hover") {
		svg.addEventListener("pointerenter", () => player.play());
		svg.addEventListener("pointerleave", () => player.pause());
	}
	svg.dispatchEvent(new CustomEvent("flash2svg:ready", { detail: api }));
})();
