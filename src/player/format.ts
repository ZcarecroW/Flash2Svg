/**
 * Compact program format embedded in player SVGs (JSON in a <script type="application/json">).
 * Kept small: numbers are rounded, tracks are flat arrays.
 */

/**
 * Track: a constant number, or a flat array [t0, v0, e0, t1, v1, e1, ...]
 * where e = 0 hold, 1 linear, n >= 2 -> bezier P.bz[n - 2].
 */
export type PTrack = number | number[];

export interface PProgram {
	v: 1;
	fps: number;
	w: number;
	h: number;
	/** root timeline id */
	root: string;
	/** shared timing functions [x1, y1, x2, y2] */
	bz: [number, number, number, number][];
	tl: Record<string, PTimeline>;
	/** sounds by id */
	snd: Record<string, PSound>;
	/** id of the filter used inside masks */
	mf: string;
	/** ids of the filters painting white / black with the alpha kept (alpha and erase masks) */
	wf?: string;
	bf?: string;
	/** not looping: the root ends after this many ticks (frame scripts loop it; default: on its last frame) */
	on?: number;
	/** the poster frame (root, 0-based; default 0): shown still when the system asks for reduced motion */
	pf?: number;
}

export interface PTimeline {
	/** frame count */
	n: number;
	/** labels name -> frame */
	lb?: Record<string, number>;
	/** frame -> actions: [0]=stop [1]=play [2, target, play(0/1)]=goto; [9, from, before, ...] = only on passes [from, before) over the frame */
	ac?: Record<number, (number | string)[][]>;
	/** mouse handlers added by frame scripts */
	ev?: PListener[];
	/** layers bottom to top */
	ly: PLayer[];
	/** frame sounds */
	sd?: PFrameSound[];
	/** camera view transform tracks (x y rot skw sx sy), root scenes */
	vw?: PTrack[];
	/** 1 = placed inside an instance with `sa`: masks ignore the inherited alpha */
	ia?: 1;
	/**
	 * 1 = draws hairlines (non-scaling strokes), here or in a symbol inside: their geometry follows
	 * every transform, so the browser can't keep the artwork rastered; its instances are moved by
	 * the player itself, not as Web Animations (see the runtime).
	 */
	hl?: 1;
}

/**
 * A mouse handler added by a frame script: [frame (0-based) that adds it, instance path ("" the
 * timeline itself), event (0 click, 1 over, 2 out, 3 down, 4 up, 5 double click), ...actions].
 * Actions: [0, target] stop, [1, target] play, [2, target, frame (0-based) or label, play 0/1]
 * goto, [3, target] next frame, [4, target] previous frame, [5, target, 0/1] visible, [6, url,
 * window] open a web page. Targets are paths as in core/snippets.ts ("" this timeline, "/" the
 * root, ".." the parent, "@" the instance the listener is on, instance names below).
 */
export type PListener = [number, string, number, ...(number | string)[][]];

/**
 * [url, seconds, lead]: the length of the sound in the file and the encoder delay at its start
 * (seconds; decoders that don't skip it on their own leave it in). Older programs: the url.
 */
export type PSound = string | [string, number, number];

/**
 * [frame, soundId, sync (0 event, 1 start, 2 stop, 3 stream), loops, durationFrames, in, out, envelope]
 * in/out: seconds in the file, each loop plays from in to out (absent: the whole sound).
 * envelope: flat [t, left, right, ...], t in seconds from the start of playback (it runs on
 * across loops), volumes 0..1; absent = full volume.
 */
export type PFrameSound = [number, string, number, number, number, number?, number?, number[]?];

export interface PLayer {
	/** 1 = mask layer */
	m?: 1;
	/** mask by alpha: 1 = keep ("alpha" blend), 2 = cut out ("erase" blend) */
	mm?: 1 | 2;
	/** alpha masks: the element's bounds [x, y, w, h] (outside them everything stays) */
	mx?: number[];
	/** index (in ly) of the mask layer masking this layer */
	mb?: number;
	it: PItem[];
}

export type PItem = PArt | PSeq | PInst | PRef;

interface PBase {
	/** start frame, end frame (exclusive) */
	s: number;
	e: number;
}
/** artwork / bitmap / text: a def id to <use> */
export interface PArt extends PBase {
	k: "a";
	r: string;
	/** ARIA attributes (text drawn as outlines: its words) */
	ac?: Record<string, string>;
}
export interface PRef extends PBase {
	k: "r";
	/** raw node markup (bitmaps, text) */
	x: string;
}
export interface PSeq extends PBase {
	k: "q";
	/** def ids per frame ("" where a morph part draws the frame) */
	rs: string[];
	/** shape tweens: the blend ratio (local frames) */
	rt?: PTrack;
	/** shape tweens: frames drawn by blending a drawing (path morphs) */
	mp?: PMorph[];
	/** 1 = one step per frame (the morphs don't blend between frames) */
	st?: 1;
}

/**
 * Frames [a, b) of the span (0 = its first frame) drawn by a copy of the group `r` (its ids made
 * unique) whose attributes are blended; `rt`: own blend ratio instead of the item's.
 */
export interface PMorph {
	a: number;
	b: number;
	r: string;
	rt?: PTrack;
	c: PChannel[];
}

/**
 * [element (index in the copy's querySelectorAll("*")), attribute, kind (0 path, 1 colour,
 * 2 number, 3 matrix), path commands (M L Q Z, one letter per number group), values at ratio 0,
 * values at ratio 1] or, for values that don't follow the ratio, [..., values per frame of the part].
 */
export type PChannel = [number, string, number, string, number[], number[]] | [number, string, number, string, number[][]];
export interface PInst extends PBase {
	k: "i";
	/** symbol timeline id */
	y: string;
	/** 0 movie clip, 1 graphic, 2 button */
	t: 0 | 1 | 2;
	/** instance name */
	nm?: string;
	/** ARIA attributes (Accessibility panel) and description */
	ac?: Record<string, string>;
	ad?: string;
	/** transform tracks x y rot skw sx sy tpx tpy */
	tr: PTrack[];
	/** colour tracks rP gP bP aP rA gA bA aA (absent = identity) */
	c?: PTrack[];
	/** 1 = colour needs a matrix at some point (otherwise plain opacity is used throughout) */
	cm?: 1;
	/** alpha applies to each shape inside, as in Flash (inherited): 1 = fill-opacity, 2 = stroke-opacity, 3 = both */
	sa?: number;
	/** filters: [frame, filterId] */
	f?: [number, string][];
	/** css blend mode */
	b?: string;
	/** graphic ranges: [start, end, loop(0 loop,1 once,2 single,3 loop rev,4 once rev), first, last] */
	g?: [number, number, number, number, number][];
	/** hidden */
	hd?: 1;
	/** Id of a filter that paints the instance white (invert blend). */
	w?: string;
	/** Subtract blend: id of the white filter for the two inverting copies around the instance. */
	su?: string;
}
