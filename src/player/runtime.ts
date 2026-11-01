/**
 * Flash2SVG player: a tiny timeline runtime embedded in player-format SVGs.
 * Reads the program from <script type="application/json" id="…-data">, builds the display list
 * from <defs>, and plays it with Flash semantics (movie clip playheads, graphic sync, frame
 * scripts, buttons, sounds). Exposes `svg.flash2svg` for control.
 *
 * This file is bundled (esbuild, minified) into an IIFE string by scripts/build.mjs.
 */
import { evalBezier } from "../core/easing.ts";
import type { PChannel, PFrameSound, PInst, PItem, PListener, PMorph, PProgram, PTimeline, PTrack } from "./format.ts";

/** Build flags: the sound code (Mixer) is only in the runtime of programs with sounds, the
 * morph code (shape tweens) only in that of programs with path morphs. */
declare const __SOUND__: boolean;
declare const __MORPH__: boolean;
/** mouse handlers from frame scripts (PTimeline.ev), the start triggers "visible" and "scroll" */
declare const __EVENTS__: boolean;

const NS = "http://www.w3.org/2000/svg";
const XL = "http://www.w3.org/1999/xlink";
const RAD = Math.PI / 180;

type Listener = (e: { type: string; frame: number; label?: string }) => void;

/** DOM events of the mouse handlers (PListener codes). */
const EVENT_CODES: Record<string, number> = { pointerover: 1, pointerout: 2, pointerdown: 3, pointerup: 4, dblclick: 5, keydown: 6 };

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

// runtime ids start with the (prefixed, page-unique) id of the player svg: inline players don't clash
let uidCounter = 0;

/** A copy of a morph's drawing (group `id`), its ids (gradients...) made unique. */
function copyArt(svg: SVGSVGElement, id: string): Element {
	const c = (svg.ownerDocument.getElementById(id) as Element).cloneNode(true) as Element;
	c.removeAttribute("id");
	const map: Record<string, string> = {};
	for (const e of c.querySelectorAll("[id]")) e.id = map[e.id] = `${svg.id}_c${uidCounter++}`;
	for (const e of c.querySelectorAll("*"))
		for (const a of e.attributes) if (a.value.indexOf("#") >= 0) a.value = a.value.replace(/#([^)\s]+)/g, (m, x: string) => (map[x] ? "#" + map[x] : m));
	return c;
}

/** A morph channel's attribute text at blend ratio r (or frame position fi in the part). */
function morphValue(ch: PChannel, r: number, fi: number): string {
	let v: number[];
	if (ch.length > 5) {
		const e = ch[5] as number[];
		v = (ch[4] as number[]).map((x, i) => x + (e[i]! - x) * r);
	} else {
		const f = ch[4] as number[][];
		const k = Math.max(0, Math.min(f.length - 1, fi)),
			k0 = Math.floor(k),
			k1 = Math.min(f.length - 1, k0 + 1);
		v = f[k0]!.map((x, i) => x + (f[k1]![i]! - x) * (k - k0));
	}
	const kind = ch[2];
	if (kind === 1) {
		const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
		return `rgba(${c(v[0]!)},${c(v[1]!)},${c(v[2]!)},${c(v[3]!) / 255})`;
	}
	if (kind === 2) return "" + v[0];
	if (kind === 3) return `matrix(${v.join(",")})`;
	let d = "",
		i = 0;
	for (const c of ch[3]) {
		d += c;
		for (let n = c === "Q" ? 4 : c === "Z" ? 0 : 2; n > 0; n--) d += Math.round(v[i++]! * 100) / 100 + (n > 1 ? "," : "");
	}
	return d;
}

/** A running timeline (root, movie clip, graphic or button instance). */
class Clip {
	readonly node: SVGGElement;
	frame = 0;
	playing = true;
	readonly items = new Map<PItem, Inst>();
	private layerNodes: SVGGElement[] = [];
	private maskIds: string[] = [];
	readonly tl: PTimeline;
	readonly P: PProgram;
	readonly player: Player;
	readonly kind: number; // -1 root, 0 mc, 1 graphic, 2 button
	private enteredFrame = -1;
	/** times each frame was entered (counted stops) */
	private passes: number[] = [];
	buttonState = 0;
	/** the clip whose instance this clip is, and that instance (null: the root) */
	up: Clip | null = null;
	inst: Inst | null = null;
	/** mouse handlers of this timeline already added (a frame entered again doesn't add them twice) */
	heard: Set<PListener> | null = null;

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
				const id = `${player.svg.id}_m${uidCounter++}`;
				// alpha/erase masks work by alpha over a big area (erase: white but where the content is)
				const area = { x: "-1e5", y: "-1e5", width: "2e5", height: "2e5" };
				const mask = el("mask", l.mm ? { id, maskUnits: "userSpaceOnUse", ...area } : { id });
				if (l.mm === 2 || l.mx) mask.appendChild(el("rect", { ...area, fill: "#fff" }));
				if (l.mx) mask.appendChild(el("rect", { x: "" + l.mx[0], y: "" + l.mx[1], width: "" + l.mx[2], height: "" + l.mx[3] }));
				// inside an instance whose shapes inherit its alpha: the mask must not
				const inner = el("g", {
					filter: `url(#${l.mm === 1 ? this.P.wf : l.mm === 2 ? this.P.bf : this.P.mf})`,
					...(tl.ia ? { "fill-opacity": "1", "stroke-opacity": "1" } : {}),
				}) as SVGGElement;
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

	/**
	 * Runs frame scripts for the frame just entered. A goto enters its frame at once; scripts that
	 * jump in a circle (a frame's own gotoAndPlay to itself) are followed 16 hops a tick, as the
	 * other formats do (timing.ts: playhead), and then the frame reached shows.
	 */
	runActions(hops = 0): void {
		if (this.enteredFrame === this.frame) return;
		this.enteredFrame = this.frame;
		const acts = this.tl.ac?.[this.frame];
		const label = this.labelAt(this.frame);
		if (__EVENTS__)
			for (const l of this.tl.ev ?? [])
				if (l[0] === this.frame && !(this.heard ??= new Set()).has(l)) {
					this.heard.add(l);
					listen(this.player, this, l);
				}
		if (this.kind === -1) this.player.emit({ type: "frame", frame: this.frame, label });
		this.playSounds();
		if (!acts) return;
		const pass = (this.passes[this.frame] = (this.passes[this.frame] ?? 0) + 1);
		for (let a of acts) {
			// [9, from, before, ...action]: only on those passes over the frame
			if (a[0] === 9) {
				if (pass < +a[1]! || (+a[2]! && pass >= +a[2]!)) continue;
				a = a.slice(3);
			}
			if (a[0] === 0) this.playing = false;
			else if (a[0] === 1) this.playing = true;
			else {
				const target = this.resolve(a[1]!);
				this.playing = a[2] === 1;
				this.frame = target;
				if (hops < 15) {
					this.enteredFrame = -1;
					this.runActions(hops + 1);
				} else this.enteredFrame = target;
				return;
			}
		}
	}

	/** Event, start and stop sounds of the frame just entered (buttons: of the state just entered). */
	playSounds() {
		const m = this.player.mixer;
		if (!__SOUND__ || !m || !this.tl.sd) return;
		for (const e of this.tl.sd) if (e[0] === this.frame && e[2] !== 3) m.trigger(e);
	}

	private streams?: Map<PFrameSound, Voice>;
	/** Removed from the stage: its stream sounds (and those of clips inside) end. */
	stopStreams() {
		if (!__SOUND__) return;
		this.streams?.forEach((v) => v.stop());
		this.streams?.clear();
		for (const inst of this.items.values()) inst.clip?.stopStreams();
	}
	/**
	 * Stream sounds follow the playhead (Flash): they play while it moves through their frames and
	 * from the position of the frame it is on (also after a goto), and stop when it stops or leaves.
	 */
	streamSync() {
		const m = this.player.mixer;
		const sd = this.tl.sd;
		if (!__SOUND__ || !m || !sd) return;
		for (const e of sd) {
			if (e[2] !== 3) continue;
			const map = (this.streams ??= new Map());
			let v = map.get(e);
			const pos = (this.frame - e[0]) / this.P.fps;
			const on = this.playing && pos >= 0 && this.frame < e[0] + e[4] && this.node.isConnected && !this.player.muted;
			// (between ticks the clock runs up to a frame ahead of the playhead; more means a jump)
			if (v && (v.done || !on || Math.abs(v.pos() - pos) > 2 / this.P.fps)) {
				v.stop();
				map.delete(e);
				v = undefined;
			}
			if (on && !v) map.set(e, m.voice(e, pos));
		}
	}

	/** Frames, play states and counted passes of this timeline and the ones in it (see Player.seek). */
	snap(): string {
		const cap = this.tl.pc;
		let k = this.frame + (this.playing ? "+" : "-") + (cap ? this.passes.map((p) => Math.min(p, cap)) : "");
		for (const i of this.items.values()) if (i.clip) k += "(" + i.clip.snap() + ")";
		return k;
	}

	labelAt(f: number): string | undefined {
		if (!this.tl.lb) return undefined;
		for (const k in this.tl.lb) if (this.tl.lb[k] === f) return k;
		return undefined;
	}

	resolve(target: number | string): number {
		if (typeof target === "number") return Math.max(0, Math.min(this.tl.n - 1, target));
		// own labels only: "toString" or "constructor" aren't frames
		const lb = this.tl.lb;
		const f = lb && Object.prototype.hasOwnProperty.call(lb, target) ? lb[target] : undefined;
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
				this.frame = this.frame + 1 >= this.tl.n ? 0 : this.frame + 1;
			}
			this.runActions();
			this.streamSync();
			// not looping: the root ends on arriving at its last frame, or after the first pass when
			// frame scripts loop it
			if (this.kind === -1 && !this.player.loop && this.playing && (this.P.on ? ++this.age >= this.P.on - 1 : this.frame === this.tl.n - 1)) {
				this.playing = false;
				this.ended = true;
				this.player.emit({ type: "end", frame: this.frame });
			}
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
	/**
	 * Whether its time runs on into the next tick: advancing, or wrapping from the last frame to the
	 * first. (Web Animations then play through the last frame and are set back once, at the wrap.)
	 */
	flows = false;
	/** The time its Web Animations follow (as `t` in render, but running on through the last frame). */
	tw = 0;
	updateAdvance() {
		if (this.kind === 0 || this.kind === -1) {
			this.adv = this.playing && this.frame + 1 < this.tl.n;
			this.flows = this.playing && (this.adv || this.kind === 0 || this.player.loop);
		}
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
					for (const e of inst.els.length ? inst.els : [inst.node]) g.insertBefore(e, before);
					const c = inst.clip;
					if (c && c.kind === 1) c.setFrame(graphicFrame(it as PInst, this.frame, c.tl.n));
				} else if (!active && inst) {
					for (const e of inst.els.length ? inst.els : [inst.node]) e.remove();
					inst.clip?.stopStreams();
					inst.dispose();
					this.items.delete(it);
					inst = undefined;
				}
				if (inst) before = inst.els[0] ?? inst.node;
			}
		});
	}

	/** Updates attributes; `frac` = progress (0..1) towards the next frame. */
	render(frac: number) {
		const t = this.frame + (this.adv ? frac : 0);
		this.tw = this.frame + (this.flows ? frac : 0);
		const vw = this.tl.vw;
		if (vw) {
			// the camera moves the whole stage: a Web Animation too (no repaint of the scene)
			if (WAAPI && !this.tl.hl) {
				this.vanim ??= animate(this.player, this.node, vw, vw, null, 0, this.tl.n);
				sync(this.player, this.vanim, (this.tw / this.P.fps) * 1000, this.player.live && this.flows);
			} else this.node.setAttribute("transform", matrixOf(this.P, vw, t, 0, 0));
		}
		for (const inst of this.items.values()) inst.render(t, frac, this);
	}

	private vanim: Animation | null = null;
	/** Taken off the stage: its animations (and those of everything inside) end. */
	dispose() {
		if (this.vanim) {
			this.vanim.cancel();
			this.player.anims.delete(this.vanim);
		}
		for (const inst of this.items.values()) inst.dispose();
		if (__EVENTS__ && this.heard) unlisten(this.player, this);
	}

	/** Graphic symbols/buttons: frame chosen by the parent. */
	setFrame(f: number) {
		if (f === this.frame) return;
		this.frame = f;
		this.sync();
		// nested graphics follow at once (not only on the next tick)
		for (const inst of this.items.values()) {
			const c = inst.clip;
			if (c && c.kind === 1) c.setFrame(graphicFrame(inst.it as PInst, f, c.tl.n));
		}
	}

	/** Root only: stopped because the end was reached without looping (not by a stop() script). */
	ended = false;
	/** Root only: ticks played since the last goto (see PProgram.on). */
	age = 0;

	gotoFrame(f: number, play: boolean) {
		this.ended = false;
		this.age = 0;
		this.frame = f;
		this.playing = play;
		this.enteredFrame = -1;
		this.runActions();
		this.streamSync();
		this.sync();
		this.updateAdvance();
	}
}

/** A display-list entry of a clip. */
class Inst {
	readonly node: SVGElement;
	/** The node, or for the subtract blend the node between two inverting copies of it. */
	els: SVGElement[] = [];
	/** instances: the node carrying the transform, and the one carrying Animate filters */
	private tnode: SVGElement | null = null;
	private fnode: SVGElement | null = null;
	readonly it: PItem;
	readonly owner: Clip;
	clip: Clip | null = null;
	private cm: SVGElement | null = null;
	private seqIndex = -1;
	/** shape tweens: the morph part drawn, copies of each part's drawing (and their elements) */
	private mpart?: PMorph | null;
	private mels?: Element[];
	private mcopies?: Map<PMorph, [Element, Element[]]>;
	private mrat?: number;
	private mfra?: number;
	/** the transform last written (unchanged values aren't written again) */
	private lastM = "";
	/** Web Animations playing the transform and/or the alpha (see animate()) */
	private anims: Animation[] | null = null;
	private animTransform = false;
	private animAlpha = false;
	private filterRef = "";

	constructor(owner: Clip, it: PItem) {
		this.owner = owner;
		this.it = it;
		const P = owner.P;
		switch (it.k) {
			case "a":
				this.node = use(it.r);
				if (it.ac) for (const k in it.ac) this.node.setAttribute(k, it.ac[k]!);
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
					this.clip.up = owner;
					this.clip.inst = this;
					g.appendChild(this.clip.node);
					if (it.nm) {
						g.setAttribute("data-name", it.nm);
						owner.player.named.set(it.nm, this.clip);
					}
					if (it.ac) for (const k in it.ac) g.setAttribute(k, it.ac[k]!);
					if (it.ad) {
						const d = el("desc");
						d.textContent = it.ad;
						g.prepend(d);
					}
					if (it.t === 2) this.button(g);
					if (__EVENTS__ && it.nm && clicks(owner, it.nm)) clickable(g);
					this.clip.sync();
					// its first frame's script runs now, before it advances (a stop() there holds it)
					if (it.t === 0) this.clip.runActions();
				}
				// Animate filters work in the parent's orientation (not rotated with the instance):
				// outer (blend, opacity, colour) > filter > transform > clip
				let node = g;
				if (it.f) {
					this.fnode = el("g");
					this.fnode.appendChild(g);
					node = el("g");
					node.appendChild(this.fnode);
				}
				this.tnode = g;
				if (it.b) node.setAttribute("style", `mix-blend-mode:${it.b}`);
				if (it.w) node.setAttribute("filter", `url(#${it.w})`);
				this.node = node;
				if (it.su) {
					node.id = `${owner.player.svg.id}_s${uidCounter++}`;
					const white = () => {
						const w = el("g", { filter: `url(#${it.su})`, style: "mix-blend-mode:difference" });
						w.appendChild(use(node.id));
						return w;
					};
					this.els = [white(), node, white()];
				} else if (WAAPI && !sym?.hl) {
					// tweened transforms and alpha are Web Animations: the browser plays them (on the
					// compositor, without repainting the artwork); the player only sets them right when
					// the timeline jumps, stops or changes speed. (Not with the subtract blend: <use>
					// copies of the node don't get its animations.)
					this.animTransform = it.tr.some((x) => typeof x === "object");
					this.animAlpha = !!it.c && !it.cm && !it.sa && typeof it.c[3] === "object";
					const alpha = this.animAlpha ? it.c![3]! : null;
					if (this.animTransform && node === g) this.anims = [animate(owner.player, g, it, it.tr, alpha, it.s, it.e)];
					else if (this.animTransform || alpha) {
						this.anims = [];
						if (this.animTransform) this.anims.push(animate(owner.player, g, it.tr, it.tr, null, it.s, it.e));
						if (alpha) this.anims.push(animate(owner.player, node, it.c!, null, alpha, it.s, it.e));
					}
				}
				break;
			}
		}
	}

	private button(g: SVGElement) {
		const set = (s: number) => {
			const c = this.clip;
			if (c) {
				c.buttonState = s;
				const f = Math.min(s, c.tl.n - 1);
				const entered = f !== c.frame;
				c.setFrame(f);
				if (entered) c.playSounds();
				c.render(0);
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
			if (__MORPH__) {
				// shape tweens: frames drawn by blending a copy of the part's drawing
				const mp = it.mp?.find((p) => i >= p.a && i < p.b);
				if (mp) {
					if (mp !== this.mpart) {
						this.mpart = mp;
						this.seqIndex = -1;
						this.mrat = this.mfra = undefined;
						const copies = (this.mcopies ??= new Map());
						let c = copies.get(mp);
						if (!c) {
							const g = copyArt(this.owner.player.svg, mp.r);
							copies.set(mp, (c = [g, [...g.querySelectorAll("*")]]));
						}
						this.mels = c[1];
						this.node.replaceChildren(c[0]);
					}
					const tt = it.st ? Math.floor(t) : t,
						r = trackAt(P, mp.rt ?? it.rt, tt, 0),
						fi = mp.c.some((ch) => ch.length < 6) ? tt - it.s - mp.a : 0;
					// (unchanged values aren't written again: a write makes the browser repaint)
					if (r !== this.mrat || fi !== this.mfra) {
						this.mrat = r;
						this.mfra = fi;
						for (const ch of mp.c) this.mels![ch[0]]!.setAttribute(ch[1], morphValue(ch, r, fi));
					}
					return;
				}
				this.mpart = null;
			}
			if (i !== this.seqIndex) {
				this.seqIndex = i;
				this.node.replaceChildren(...(it.rs[i] ? [use(it.rs[i]!)] : []));
			}
			return;
		}
		if (it.k !== "i") return;
		const tr = it.tr;
		if (this.anims) {
			const player = this.owner.player;
			const ms = ((this.owner.tw - it.s) / P.fps) * 1000;
			const run = player.live && this.owner.flows;
			for (const a of this.anims) sync(player, a, ms, run);
		}
		if (!this.animTransform) {
			const m = matrixOf(P, tr, t, trackAt(P, tr[6], t, 0), trackAt(P, tr[7], t, 0));
			// (unchanged values aren't written again: a write makes the browser repaint)
			if (m !== this.lastM) {
				this.lastM = m;
				(this.tnode ?? this.node).setAttribute("transform", m);
			}
		}

		if (it.c && !this.animAlpha) {
			const cv = it.c.map((tk, i) => trackAt(P, tk, t, i < 4 ? 100 : 0));
			if (!it.cm) {
				const a = String(Math.max(0, cv[3]!) / 100);
				if (!it.sa) this.node.setAttribute("opacity", a);
				else {
					if (it.sa & 1) this.node.setAttribute("fill-opacity", a);
					if (it.sa & 2) this.node.setAttribute("stroke-opacity", a);
				}
			} else {
				if (!this.cm) {
					const id = `${this.owner.player.svg.id}_c${uidCounter++}`;
					const f = el("filter", { id, "color-interpolation-filters": "sRGB" });
					this.cm = el("feColorMatrix", { type: "matrix" });
					f.appendChild(this.cm);
					this.owner.player.defs.appendChild(f);
					this.colorWrap(id);
				}
				const v = [
					cv[0]! / 100,
					0,
					0,
					0,
					cv[4]! / 255,
					0,
					cv[1]! / 100,
					0,
					0,
					cv[5]! / 255,
					0,
					0,
					cv[2]! / 100,
					0,
					cv[6]! / 255,
					0,
					0,
					0,
					cv[3]! / 100,
					cv[7]! / 255,
				];
				this.cm.setAttribute("values", v.map(r4).join(" "));
			}
		}
		if (it.f) {
			let ref = it.f[0]![1];
			for (const [ft, id] of it.f) if (ft <= t) ref = id;
			if (ref !== this.filterRef) {
				this.filterRef = ref;
				const target = this.fnode ?? this.node;
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
			clip.flows = clip.adv;
		}
		clip.render(frac);
	}

	dispose() {
		for (const a of this.anims ?? []) {
			a.cancel();
			this.owner.player.anims.delete(a);
		}
		this.clip?.dispose();
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
	// (commas: valid as an attribute and as CSS)
	return `matrix(${r4(a)},${r4(b)},${r4(c)},${r4(d)},${r4(x - (a * tpx + c * tpy))},${r4(y - (b * tpx + d * tpy))})`;
}

function r4(v: number): string {
	return String(Math.round(v * 10000) / 10000);
}

// ------------------------------------------------------------------ Web Animations

const WAAPI = typeof Element !== "undefined" && typeof Element.prototype.animate === "function";

/**
 * The CSS timing function that takes every changing track from t0 to t1 (keys of the tracks lie at
 * most at the ends), or null when they differ (or an eased segment is cut): then the span is sampled.
 */
function easeBetween(P: PProgram, tracks: (PTrack | undefined)[], t0: number, t1: number): string | null {
	let need: string | null = null;
	for (const tr of tracks) {
		if (typeof tr !== "object") continue;
		let j = -1;
		for (let i = 0; i + 3 < tr.length; i += 3)
			if (tr[i]! <= t0 && t0 < tr[i + 3]!) {
				j = i;
				break;
			}
		// before the first key, after the last one, or no change: it holds
		if (j < 0 || tr[j + 1] === tr[j + 4]) continue;
		const e = tr[j + 2]!;
		const end = tr[j + 3]!;
		let ease: string;
		if (e === 0) {
			// a hold jumps at the end of its segment
			if (end > t1 + 1e-9) continue;
			ease = "step-end";
		} else if (e === 1) ease = "linear";
		else if (Math.abs(tr[j]! - t0) < 1e-9 && Math.abs(end - t1) < 1e-9) ease = `cubic-bezier(${P.bz[e - 2]!.join(",")})`;
		else return null;
		if (need && need !== ease) return null;
		need = ease;
	}
	return need ?? "linear";
}

/**
 * Keyframes for the tracks over their timeline's frames [s, e]: the transform as the same function
 * list in every keyframe (CSS then interpolates each value on its own, like the tracks) and/or the
 * alpha. Cached per `key` (programs are shared by every instance of a symbol).
 */
const kfCache = new WeakMap<object, Keyframe[]>();
function keyframes(P: PProgram, key: object, tr: PTrack[] | null, alpha: PTrack | null, s: number, e: number): Keyframe[] {
	let out = kfCache.get(key);
	if (out) return out;
	const tracks: (PTrack | undefined)[] = [...(tr ?? []), ...(alpha === null ? [] : [alpha])];
	const at = (t: number, offset: number, easing: string): Keyframe => {
		const k: Keyframe = { offset, easing };
		if (tr) {
			const v = (i: number, d: number) => r4(trackAt(P, tr[i], t, d));
			k.transform = `translate(${v(0, 0)}px,${v(1, 0)}px) rotate(${v(2, 0)}deg) skewX(${v(3, 0)}deg) scale(${v(4, 1)},${v(5, 1)}) translate(${r4(-trackAt(P, tr[6], t, 0))}px,${r4(-trackAt(P, tr[7], t, 0))}px)`;
		}
		if (alpha !== null) k.opacity = Math.max(0, Math.min(1, trackAt(P, alpha, t, 100) / 100));
		return k;
	};
	const set = new Set([s, e]);
	for (const x of tracks) if (typeof x === "object") for (let i = 0; i < x.length; i += 3) if (x[i]! > s && x[i]! < e) set.add(x[i]!);
	const times = [...set].sort((a, b) => a - b);
	out = [];
	const span = e - s;
	for (let i = 0; i + 1 < times.length; i++) {
		const t0 = times[i]!,
			t1 = times[i + 1]!;
		const ease = easeBetween(P, tracks, t0, t1);
		if (ease) out.push(at(t0, (t0 - s) / span, ease));
		else {
			// four samples a frame, and one just before the end (a hold that jumps there)
			const n = Math.max(2, Math.ceil((t1 - t0) * 4));
			for (let k = 0; k < n; k++) {
				const t = t0 + ((t1 - t0) * k) / n;
				out.push(at(t, (t - s) / span, "linear"));
			}
			out.push(at(t1 - 1e-4, (t1 - 1e-4 - s) / span, "linear"));
		}
	}
	out.push(at(e, 1, "linear"));
	kfCache.set(key, out);
	return out;
}

/** A paused Web Animation of the tracks on `target` (sync() plays and seeks it). */
function animate(player: Player, target: Element, key: object, tr: PTrack[] | null, alpha: PTrack | null, s: number, e: number): Animation {
	const a = target.animate(keyframes(player.P, key, tr, alpha, s, e), { duration: ((e - s) / player.P.fps) * 1000, fill: "both" });
	a.pause();
	player.anims.add(a);
	return a;
}

/**
 * Puts an animation where the timeline is: at `ms`, playing while its timeline moves on at the
 * player's speed. While it plays it is left alone (the browser keeps it in step); it is only set
 * again when it is off by more than a quarter frame (a goto, a loop, a stall of the page). It is
 * started by its start time, which takes effect at once (play() would start it a frame late, which
 * would look like a drift).
 */
function sync(player: Player, a: Animation, ms: number, run: boolean) {
	const rate = player.speed;
	if (a.playbackRate !== rate) a.playbackRate = rate;
	const now = document.timeline.currentTime as number | null;
	if (run && rate && now !== null) {
		const start = now - ms / rate;
		if (a.startTime === null || Math.abs((a.startTime as number) - start) > 250 / player.P.fps) a.startTime = start;
	} else if (a.playState !== "idle" || held.get(a) !== ms) {
		// (a hair past the frame: one step per frame jumps right at the frame's time, and rounding
		// could land just before it, on the frame before)
		a.currentTime = ms + 1e-6;
		hold(a);
		held.set(a, ms);
	}
}

/** Where each held animation was held (see hold()). */
const held = new WeakMap<Animation, number>();

/**
 * Holds an animation where it is, as plain styles: the browser draws paused animations on the
 * compositor, snapped to whole pixels, so a held frame would look a little off from a still one
 * (edges half a pixel apart). Not rendered (display: none), it stays paused.
 */
function hold(a: Animation) {
	if (a.playState === "idle") return;
	a.pause();
	try {
		a.commitStyles();
		a.cancel();
	} catch {
		// not rendered
	}
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
	private mute = false;
	private rate = 1;
	get speed() {
		return this.rate;
	}
	set speed(v: number) {
		// (0, negative, NaN: time would stand still, run back or break the clock)
		if (!(v > 0 && v < Infinity)) return;
		this.rate = v;
		// playing sounds take the new rate (and their stop times) from their positions
		this.mixer?.voices.forEach((x) => x.hold());
		this.mixer?.startAll();
	}
	named = new Map<string, Clip>();
	inTick = false;
	// no prototype: on("constructor", …) is just another event name
	private listeners: Record<string, Listener[]> = Object.create(null);
	time = 0; // seconds since last tick
	private raf = 0;
	private last = 0;
	running = false;
	/** Not looping, and held: the root stopped (everything holds then, as in SMIL and CSS). */
	get done() {
		return !this.loop && !this.root.playing;
	}
	/** Running, and not held: Web Animations run. */
	get live() {
		return this.running && !this.done;
	}
	/** seconds played (with speed), the time base of sounds */
	clock = 0;
	/** set while seeking: frames passed on the way don't start sounds */
	quiet = false;
	mixer: Mixer | null = null;
	/** the Web Animations of the instances on stage */
	anims = new Set<Animation>();

	constructor(svg: SVGSVGElement, P: PProgram, loop: boolean) {
		this.svg = svg;
		this.P = P;
		this.loop = loop;
		this.defs = (svg.querySelector("defs") as SVGDefsElement) ?? (svg.insertBefore(el("defs"), svg.firstChild) as SVGDefsElement);
		if (__SOUND__ && Object.keys(P.snd).length) this.mixer = new Mixer(this);
		// (capturing: before a button switches its drawing under the pointer)
		if (__EVENTS__) for (const type in EVENT_CODES) svg.addEventListener(type, (e) => hear(this, e), true);
		this.reset();
	}

	/** Mouse handlers added so far: [the timeline whose script added it, the handler]. */
	handlers: [Clip, PListener][] = [];
	/** The instances of click handlers the last press was on. */
	pressed: Set<Node> | null = null;

	reset() {
		this.handlers = [];
		this.mixer?.stopAll();
		this.clock = 0;
		this.root?.dispose();
		this.root?.node.remove();
		this.named.clear();
		this.root = new Clip(this, this.P.tl[this.P.root]!, -1);
		this.root.node.setAttribute("class", "f2s-stage");
		this.svg.appendChild(this.root.node);
		this.root.gotoFrame(0, true);
		this.time = 0;
		this.root.render(0);
	}

	get muted() {
		return this.mute;
	}
	set muted(v: boolean) {
		this.mute = v;
		// silences what is already playing, too
		if (this.mixer) this.mixer.muted = v;
		this.rest();
	}

	emit(e: { type: string; frame: number; label?: string }) {
		for (const l of this.listeners[e.type] ?? []) l(e);
	}

	on(type: string, fn: Listener) {
		(this.listeners[type] ??= []).push(fn);
	}

	private frameLoop = (now: number) => {
		if (!this.running) return;
		// (the frame's time stamp can lie before the play() call that requested it)
		const dt = Math.max(0, Math.min(0.25, (now - this.last) / 1000)) * this.speed;
		this.last = now;
		this.time += dt;
		this.clock += dt;
		const fd = 1 / this.P.fps;
		while (this.time >= fd) {
			this.time -= fd;
			this.step();
		}
		// (held: no tween runs on into the next frame)
		this.root.render(this.done ? 0 : this.time / fd);
		this.raf = requestAnimationFrame(this.frameLoop);
	};

	step() {
		this.inTick = true;
		try {
			// "once": everything holds when the root timeline stops; otherwise a stopped root leaves
			// its movie clips running (Flash). A one-frame root has played its pass on arriving: it ends
			// before its movie clips move on (SMIL and CSS hold them on their first frame too)
			const r = this.root;
			if (!this.loop && r.playing && r.tl.n === 1 && !this.P.on) {
				r.playing = false;
				r.ended = true;
				this.emit({ type: "end", frame: 0 });
			}
			if (this.loop || r.playing) r.tick();
			else r.stopStreams();
		} finally {
			this.inTick = false;
		}
	}

	play() {
		const r = this.root;
		// a non-looping animation that ran to its end plays again from the start
		if (!this.loop && !r.playing && r.ended) r.gotoFrame(0, true);
		r.playing = true;
		r.updateAdvance();
		this.wake();
	}

	/** Runs the frame loop (the root may stay stopped: its movie clips play on). */
	wake() {
		if (this.running) return;
		this.running = true;
		this.last = performance.now();
		if (!this.resting) this.raf = requestAnimationFrame(this.frameLoop);
		this.mixer?.startAll();
	}

	/** Out of view (IntersectionObserver), or in a background tab. */
	offView = false;
	hiddenTab = false;
	private resting = false;
	/**
	 * Rests while out of view or in a background tab: no frames, its time stands still, and it goes
	 * on where it was when it is back (saves the CPU and battery a hidden animation would use). A
	 * player whose sound is on keeps playing out of view, like a video with sound.
	 */
	rest() {
		const r = this.hiddenTab || (this.offView && !(this.mixer && !this.mute));
		if (r === this.resting) return;
		this.resting = r;
		if (!this.running) return;
		if (r) {
			cancelAnimationFrame(this.raf);
			for (const a of this.anims) hold(a);
		} else {
			this.last = performance.now();
			this.raf = requestAnimationFrame(this.frameLoop);
		}
	}

	pause() {
		this.running = false;
		cancelAnimationFrame(this.raf);
		for (const a of this.anims) hold(a);
		// sounds hold with the timeline and go on from there
		this.mixer?.voices.forEach((v) => v.hold());
	}

	stop() {
		this.root.playing = false;
		// (its animations hold now, not on the next frame)
		this.root.updateAdvance();
		this.root.render(this.time * this.P.fps);
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

	/**
	 * Deterministic seek: replays from the start to `seconds` (negative: 0; NaN, Infinity: ignored).
	 * Far ahead, the frames of all timelines repeat at some point: once a state comes again, whole
	 * periods are skipped.
	 */
	seek(seconds: number) {
		if (!(seconds < Infinity)) return;
		seconds = Math.max(0, seconds);
		const wasRunning = this.running;
		this.pause();
		const fd = 1 / this.P.fps;
		const ticks = Math.floor(seconds / fd + 1e-6);
		this.quiet = true;
		try {
			this.reset();
			let seen = ticks > 4096 ? new Map<string, number>() : null;
			for (let i = 0; i < ticks; i++) {
				this.clock += fd;
				this.step();
				if (seen) {
					const k = this.root.snap();
					const j = seen.get(k);
					if (j !== undefined) {
						i += Math.floor((ticks - 1 - i) / (i - j)) * (i - j);
						seen = null;
					} else if (seen.size < 1e5) seen.set(k, i);
					else seen = null;
				}
			}
		} finally {
			this.quiet = false;
		}
		this.time = Math.max(0, seconds - ticks * fd);
		this.clock = seconds;
		this.root.render(this.done ? 0 : this.time / fd);
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
					play: () => {
						c.playing = true;
						c.updateAdvance();
					},
					stop: () => {
						c.playing = false;
						c.updateAdvance();
						this.root.render(this.time * this.P.fps);
					},
					gotoAndPlay: (t: number | string) => c.gotoFrame(c.resolve(typeof t === "number" ? t - 1 : t), true),
					gotoAndStop: (t: number | string) => c.gotoFrame(c.resolve(typeof t === "number" ? t - 1 : t), false),
				}
			: null;
	}
}

/** Scroll scrubbing: on from where it is, back by a seek (frame scripts can't run backwards). */
function scrub(p: Player, seconds: number) {
	const fd = 1 / p.P.fps;
	const from = Math.floor(p.clock / fd + 1e-6);
	const to = Math.floor(seconds / fd + 1e-6);
	if (to < from || p.running) return p.seek(seconds);
	p.quiet = true;
	try {
		for (let i = from; i < to; i++) {
			p.clock += fd;
			p.step();
		}
	} finally {
		p.quiet = false;
	}
	p.time = Math.max(0, seconds - to * fd);
	p.clock = seconds;
	p.root.render(p.done ? 0 : p.time / fd);
}

// ------------------------------------------------------------------ mouse handlers
// (functions, not methods: builds without handlers leave them out)

/** The named instance on a timeline (on stage now). */
function child(c: Clip, name: string): Inst | null {
	for (const i of c.items.values()) if ((i.it as PInst).nm === name) return i;
	return null;
}

/** Follows a target path from clip `c` (see PListener): the timeline and instance it names. */
function walk(c: Clip, path: string, at: Inst | null): { clip: Clip | null; inst: Inst | null } {
	let clip: Clip | null = c;
	let inst: Inst | null = c.inst;
	const segs = path.split("/");
	if (path.startsWith("/")) {
		clip = c.player.root;
		inst = null;
		segs.shift();
	}
	for (const s of segs) {
		if (!s) continue;
		if (s === "@") inst = at;
		else if (s === "..") inst = clip?.up?.inst ?? null;
		else inst = clip ? child(clip, s) : null;
		clip = s === ".." ? (clip?.up ?? null) : (inst?.clip ?? null);
	}
	return { clip, inst };
}

/** Runs a mouse handler's actions (`at`: the instance it listens on) from clip `c`. */
function handle(c: Clip, l: PListener, at: Inst | null) {
	for (let k = 3; k < l.length; k++) {
		const a = l[k] as (number | string)[];
		if (a[0] === 6) {
			const w = String(a[2] || "_blank");
			if (w === "_blank") open(String(a[1]), w, "noopener");
			else open(String(a[1]), w === "_self" ? "_top" : w);
			continue;
		}
		const r = walk(c, String(a[1]), at);
		if (a[0] === 5) {
			if (r.inst) r.inst.node.style.display = a[2] ? "" : "none";
			continue;
		}
		const t = r.clip;
		if (!t) continue;
		if (a[0] === 0 || a[0] === 1) {
			t.playing = a[0] === 1;
			t.updateAdvance();
		} else if (a[0] === 2) t.gotoFrame(t.resolve(a[2]!), a[3] === 1);
		else t.gotoFrame(Math.max(0, Math.min(t.tl.n - 1, t.frame + (a[0] === 3 ? 1 : -1))), false);
	}
}

/** A click handler of clip `c` listens on its instance `name`: it shows the hand cursor (like a button). */
function clicks(c: Clip, name: string): boolean {
	return !!c.heard && c.player.handlers.some(([h, l]) => h === c && l[1] === name && l[2] !== 1 && l[2] !== 2);
}

function listen(p: Player, c: Clip, l: PListener) {
	p.handlers.push([c, l]);
	const inst = l[1] && l[2] !== 1 && l[2] !== 2 ? walk(c, l[1], null).inst : null;
	if (inst) clickable(inst.node);
}

/** Hand cursor; a click handler can also be reached with the keyboard (Tab, then Enter or Space). */
function clickable(g: SVGElement) {
	g.style.cursor = "pointer";
	if (!g.hasAttribute("tabindex")) g.setAttribute("tabindex", "0");
	if (!g.hasAttribute("role")) g.setAttribute("role", "button");
}

function unlisten(p: Player, c: Clip) {
	p.handlers = p.handlers.filter((h) => h[0] !== c);
}

/**
 * One listener per event type on the SVG finds the handlers whose instance it happened in. A
 * click is a press and a release on the same instance: the browser's click event goes to a common
 * ancestor when a button switches its drawing in between.
 */
function hear(p: Player, e: Event) {
	const code = EVENT_CODES[e.type];
	const target = e.target as Node;
	const related = (e as MouseEvent).relatedTarget as Node | null;
	// Enter or Space on a focused instance: a click
	const key = code === 6;
	if (key && (e as KeyboardEvent).key !== "Enter" && (e as KeyboardEvent).key !== " ") return;
	const pressed = code === 3 ? new Set<Node>() : null;
	let acted = false;
	for (const [c, l] of p.handlers.slice()) {
		const click = l[2] === 0;
		if (click ? code !== 3 && code !== 4 && !key : l[2] !== code) continue;
		const inst = l[1] ? walk(c, l[1], null).inst : null;
		const node = l[1] ? inst?.node : c.node;
		if (!node?.contains(target)) continue;
		if (click && code === 3) {
			pressed!.add(node);
			continue;
		}
		if (click && !key && !p.pressed?.has(node)) continue;
		// over / out: entering or leaving the instance, not moving between its parts
		if ((code === 1 || code === 2) && related && node.contains(related)) continue;
		handle(c, l, inst);
		acted = true;
	}
	if (pressed) p.pressed = pressed;
	else if (code === 4) p.pressed = null;
	if (acted && key) e.preventDefault();
	if (acted) {
		p.wake();
		p.root.render(p.time * p.P.fps);
	}
}

// ------------------------------------------------------------------ sound

/** One playing (or waiting) sound. Its position runs on the player's clock, so it can start late. */
class Voice {
	src: AudioBufferSourceNode | null = null;
	el: HTMLAudioElement | null = null;
	done = false;
	readonly m: Mixer;
	readonly e: PFrameSound;
	/** player clock at position 0 */
	readonly born: number;
	constructor(m: Mixer, e: PFrameSound, born: number) {
		this.m = m;
		this.e = e;
		this.born = born;
	}
	pos() {
		return this.m.player.clock - this.born;
	}
	/** Detaches the playing node; the voice starts again (at its position) on the next start(). */
	hold() {
		if (this.src) {
			this.src.onended = null;
			try {
				this.src.stop();
			} catch {}
			this.src = null;
		}
		this.el?.pause();
		this.el = null;
	}
	stop() {
		this.done = true;
		this.hold();
		this.m.voices.delete(this);
	}
}

/**
 * Web Audio playback of frame sounds: in and out points and loops sample exact, volume envelopes,
 * stream sounds on the timeline's clock. Sounds that can't play yet (still decoding, or blocked
 * until the visitor interacts with the page) keep their position and join when they can: a long
 * event sound starts in the middle, a short one that is over by then stays silent.
 * Without Web Audio, or for a file it can't decode, an <audio> element plays instead.
 */
class Mixer {
	readonly player: Player;
	private ac: AudioContext | null = null;
	private out: GainNode | null = null;
	private bufs = new Map<string, AudioBuffer | null>();
	voices = new Set<Voice>();
	held = false;

	constructor(player: Player) {
		this.player = player;
		const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext; __f2sAudio?: AudioContext };
		const AC = w.AudioContext ?? w.webkitAudioContext;
		try {
			// one context for all players on the page
			this.ac = w.__f2sAudio ??= new AC!();
		} catch {
			this.ac = null;
		}
		const ac = this.ac;
		if (ac) {
			this.out = ac.createGain();
			this.out.connect(ac.destination);
			ac.addEventListener("statechange", () => this.startAll());
			if (ac.state !== "running") {
				const unlock = () => void ac.resume().catch(() => {});
				unlock();
				for (const t of ["pointerdown", "keydown", "touchend"]) document.addEventListener(t, unlock, { capture: true, passive: true });
			}
		}
		for (const id in player.P.snd) this.load(id);
		// hidden tabs don't animate: hold the sounds there too
		document.addEventListener("visibilitychange", () => this.hold(document.hidden));
	}

	private info(id: string): [string, number, number] {
		const s = this.player.P.snd[id]!;
		return typeof s === "string" ? [s, 0, 0] : s;
	}

	private load(id: string) {
		const ac = this.ac;
		if (!ac) return void this.bufs.set(id, null);
		fetch(this.info(id)[0])
			.then((r) => r.arrayBuffer())
			.then((b) => ac.decodeAudioData(b))
			.then(
				(b) => this.bufs.set(id, b),
				() => this.bufs.set(id, null),
			)
			.then(() => this.startAll());
	}

	/** Event, start and stop sounds of a frame just entered. */
	trigger(e: PFrameSound) {
		const p = this.player;
		if (p.quiet) return;
		const mine = [...this.voices].filter((v) => v.e[1] === e[1]);
		if (e[2] === 2) return mine.forEach((v) => v.stop());
		// "start": only when that sound isn't playing yet
		if (e[2] === 1 && mine.some((v) => !v.done)) return;
		if (!p.muted) this.voice(e, 0);
	}

	/** A new voice at `pos` seconds into its playback. */
	voice(e: PFrameSound, pos: number): Voice {
		const v = new Voice(this, e, this.player.clock - pos);
		this.voices.add(v);
		this.start(v);
		return v;
	}

	hold(on: boolean) {
		this.held = on;
		if (on) this.voices.forEach((v) => v.hold());
		else this.startAll();
	}

	startAll() {
		this.voices.forEach((v) => this.start(v));
	}

	stopAll() {
		this.voices.forEach((v) => v.stop());
		this.voices.clear();
	}

	private start(v: Voice) {
		if (v.done) return;
		if (v.src || v.el || this.held || !this.player.running) return;
		const e = v.e;
		const id = e[1];
		const buf = this.bufs.get(id);
		if (buf === undefined) return; // still decoding
		const [url, len, lead] = this.info(id);
		const ac = this.ac;
		const speed = this.player.speed;
		const loops = e[3];
		const endless = loops >= 9999;
		const L = len || buf?.duration || 0;
		const a = e[5] ?? 0;
		const b = Math.min(e[6] ?? L, L || Infinity);
		const seg = b - a;
		const off = Math.max(0, v.pos());
		if (!(seg > 0) || (!endless && off >= seg * loops)) return v.stop();
		const at = a + (off % seg);
		const left = endless ? 0 : (seg * loops - off) / speed;
		if (buf && ac && this.out) {
			if (ac.state !== "running") return;
			// decoders that read no gapless header keep the encoder delay at the start
			const skip = buf.duration >= L + lead * 0.9 ? lead : 0;
			const src = ac.createBufferSource();
			src.buffer = buf;
			src.playbackRate.value = speed;
			if (loops > 1) {
				src.loop = true;
				src.loopStart = skip + a;
				src.loopEnd = skip + b;
			}
			const env = e[7];
			(env ? this.envelope(ac, src, env, off, speed) : src).connect(this.out);
			src.onended = () => v.stop();
			src.start(0, skip + at);
			if (left) src.stop(ac.currentTime + left);
			v.src = src;
		} else if (!ac || buf === null) {
			const el = new Audio(url);
			let n = Math.floor(off / seg);
			el.currentTime = at;
			el.playbackRate = speed;
			el.ontimeupdate = () => {
				if (el.currentTime < b && !el.ended) return;
				if (++n < loops) el.currentTime = a;
				else v.stop();
			};
			el.onended = el.ontimeupdate;
			el.play().catch(() => {});
			v.el = el;
		}
	}

	/** Left and right volume over time ([t, left, right, ...] from the start of playback). */
	private envelope(ac: AudioContext, src: AudioNode, env: number[], off: number, speed: number): AudioNode {
		// mono sounds go to both sides first
		const up = ac.createGain();
		up.channelCount = 2;
		up.channelCountMode = "explicit";
		up.channelInterpretation = "speakers";
		const split = ac.createChannelSplitter(2);
		const merge = ac.createChannelMerger(2);
		src.connect(up).connect(split);
		const now = ac.currentTime;
		for (const k of [1, 2]) {
			const g = ac.createGain();
			g.gain.setValueAtTime(envelopeAt(env, k, off), now);
			for (let i = 0; i < env.length; i += 3) if (env[i]! > off) g.gain.linearRampToValueAtTime(env[i + k]!, now + (env[i]! - off) / speed);
			split.connect(g, k - 1).connect(merge, 0, k - 1);
		}
		return merge;
	}

	set muted(v: boolean) {
		if (this.out) this.out.gain.value = v ? 0 : 1;
		if (v) this.stopAll();
	}
}

/** Envelope volume of channel k (1 left, 2 right) at t seconds: linear between points, held outside. */
function envelopeAt(env: number[], k: number, t: number): number {
	if (t <= env[0]!) return env[k]!;
	for (let i = 3; i < env.length; i += 3)
		if (t < env[i]!) {
			const t0 = env[i - 3]!;
			return env[i - 3 + k]! + ((env[i + k]! - env[i - 3 + k]!) * (t - t0)) / (env[i]! - t0);
		}
	return env[env.length - 3 + k]!;
}

// ------------------------------------------------------------------ boot

/** No page around it to scroll: opened by itself, or in a frame of another origin (can't be seen from inside). */
function alone(svg: Element): boolean {
	try {
		return !window.frameElement && (window !== window.top || document.documentElement === svg);
	} catch {
		return true;
	}
}

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
	// rest out of view and in background tabs (see Player.rest)
	if (typeof IntersectionObserver === "function")
		new IntersectionObserver((es) => {
			player.offView = !es[es.length - 1]!.isIntersecting;
			player.rest();
		}).observe(svg);
	document.addEventListener("visibilitychange", () => {
		player.hiddenTab = document.hidden;
		player.rest();
	});
	const delay = parseFloat(svg.getAttribute("data-delay") || "0") * 1000;
	// runs the frame loop: the root plays unless frame 1's script stops it (as in Flash)
	const start = () => setTimeout(() => player.wake(), delay);
	// "reduce motion" in the system settings: the poster frame, still, until a click plays it
	const still = svg.getAttribute("data-reduce") !== "0" && typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
	if ((begin === "auto" || begin === "visible" || begin === "scroll") && still?.matches) {
		player.root.gotoFrame(P.pf ?? 0, false);
		player.root.render(0);
		const go = () => {
			player.root.gotoFrame(0, true);
			player.root.render(0);
			start();
		};
		svg.addEventListener("click", go, { once: true });
	} else if (begin === "auto") {
		start();
		still?.addEventListener("change", () => (still.matches ? player.pause() : player.play()));
	} else if (__EVENTS__ && begin === "visible") {
		// when half on screen (or filling half of it)
		if (typeof IntersectionObserver !== "function") start();
		else
			new IntersectionObserver(
				(es, o) => {
					const e = es[es.length - 1]!;
					if (e.isIntersecting && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= (e.rootBounds?.height ?? innerHeight) / 2)) {
						o.disconnect();
						start();
					}
				},
				{ threshold: [0, 0.25, 0.5] },
			).observe(svg);
	} else if (__EVENTS__ && begin === "scroll" && !alone(svg)) {
		// the scroll position runs the first pass (same ranges as CSS view timelines, triggers.ts):
		// 0 fully on screen (contain), 1 crossing the screen (cover), 2 the page's scroll position
		const m = +(svg.getAttribute("data-scroll") || 0);
		let host: Element | null = null;
		try {
			host = window.frameElement;
		} catch {
			// a page of another origin around it: its own position counts
		}
		const w = host ? window.parent : window;
		const box = host ?? svg;
		const dur = (P.on ?? P.tl[P.root]!.n) / P.fps;
		let q = 0;
		const update = () => {
			q = 0;
			const r = box.getBoundingClientRect();
			const v = w.innerHeight;
			const k = v - r.height;
			const p =
				m === 2
					? w.scrollY / Math.max(1, w.document.documentElement.scrollHeight - v)
					: m === 1
						? (v - r.top) / (v + r.height)
						: k > 0
							? (k - r.top) / k
							: k < 0
								? r.top / k
								: r.top > 0
									? 0
									: 1;
			scrub(player, Math.min(1, Math.max(0, p)) * dur);
		};
		const later = () => void (q ||= requestAnimationFrame(update));
		w.addEventListener("scroll", later, { capture: true, passive: true });
		w.addEventListener("resize", later);
		update();
	} else if (begin === "scroll" || begin === "visible") start();
	else if (begin === "click") svg.addEventListener("click", start, { once: true });
	else if (begin === "hover") {
		// (played to its end without looping: from the start again)
		svg.addEventListener("pointerenter", () => {
			if (player.root.ended) player.root.gotoFrame(0, true);
			player.wake();
		});
		svg.addEventListener("pointerleave", () => player.pause());
	}
	svg.dispatchEvent(new CustomEvent("flash2svg:ready", { detail: api }));
})();
