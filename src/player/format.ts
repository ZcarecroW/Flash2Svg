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
	/** sound id -> url */
	snd: Record<string, string>;
	/** id of the filter used inside masks */
	mf: string;
}

export interface PTimeline {
	/** frame count */
	n: number;
	/** labels name -> frame */
	lb?: Record<string, number>;
	/** frame -> actions: [0]=stop [1]=play [2, target, play(0/1)]=goto */
	ac?: Record<number, (number | string)[][]>;
	/** layers bottom to top */
	ly: PLayer[];
	/** frame sounds: [frame, soundId, sync(0 event,1 start,2 stop,3 stream), loops, durationFrames] */
	sd?: [number, string, number, number, number][];
}

export interface PLayer {
	/** 1 = mask layer */
	m?: 1;
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
}
export interface PRef extends PBase {
	k: "r";
	/** raw node markup (bitmaps, text) */
	x: string;
}
export interface PSeq extends PBase {
	k: "q";
	/** def ids per frame */
	rs: string[];
}
export interface PInst extends PBase {
	k: "i";
	/** symbol timeline id */
	y: string;
	/** 0 movie clip, 1 graphic, 2 button */
	t: 0 | 1 | 2;
	/** instance name */
	nm?: string;
	/** transform tracks x y rot skw sx sy tpx tpy */
	tr: PTrack[];
	/** colour tracks rP gP bP aP rA gA bA aA (absent = identity) */
	c?: PTrack[];
	/** 1 = colour needs a matrix at some point (otherwise plain opacity is used throughout) */
	cm?: 1;
	/** filters: [frame, filterId] */
	f?: [number, string][];
	/** css blend mode */
	b?: string;
	/** graphic ranges: [start, end, loop(0 loop,1 once,2 single,3 loop rev,4 once rev), first, last] */
	g?: [number, number, number, number, number][];
	/** hidden */
	hd?: 1;
}
