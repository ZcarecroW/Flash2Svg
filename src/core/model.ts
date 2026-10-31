/**
 * Scene model: the JSON document written by the JSFL extractor (src/jsfl/extract.jsfl)
 * and consumed by the compiler. Everything here is plain data in Animate's own units:
 * pixels, degrees, 0-based frame indices, colour amounts 0-255 and percents 0-100.
 */

import type { EmbeddedFont } from "./fonts.ts";

export const SCENE_MODEL_VERSION = 1;

/** [a, b, c, d, tx, ty] — same layout as Animate's Matrix object. */
export type Mat = [number, number, number, number, number, number];

export interface Point {
	x: number;
	y: number;
}

export interface SceneModel {
	version: number;
	app: { version: string; platform: "win" | "mac" };
	doc: DocInfo;
	/** Ids of the timelines being exported (keys of `timelines`); one SVG is produced per root. */
	roots: string[];
	/**
	 * All scenes exported in a row: their timeline ids in order; `roots` is then ["scene:all"],
	 * the joined timeline core/scenes.ts makes.
	 */
	sceneOrder?: string[];
	timelines: Record<string, TimelineData>;
	/** Shape/text artwork rendered through Animate's SVG exporter, keyed by atlas id. */
	atlas: Record<string, AtlasItem>;
	bitmaps: Record<string, BitmapData>;
	sounds: Record<string, SoundData>;
	/** Fonts embedded for dynamic and input text (set by encodeFonts, see fonts.ts). */
	fonts?: EmbeddedFont[];
	warnings: string[];
}

/** Settings from Animate's Accessibility panel (only what is set). */
export interface AccInfo {
	name?: string;
	description?: string;
	shortcut?: string;
	/** "Make object accessible" off */
	silent?: boolean;
	/** "Make child objects accessible" off */
	forceSimple?: boolean;
	tabIndex?: number;
}

export interface DocInfo {
	name: string;
	acc?: AccInfo;
	/** "Flash" (ActionScript 3), "htmlcanvas", "webgl", ... */
	type: string;
	width: number;
	height: number;
	frameRate: number;
	backgroundColor: string;
}

export type TimelineKind = "scene" | "movie clip" | "graphic" | "button";

export interface TimelineData {
	id: string;
	name: string;
	kind: TimelineKind;
	frameCount: number;
	/** Layers in Animate order: index 0 is the TOP layer. */
	layers: LayerData[];
	/** Root scene timelines only: baked camera, one entry per frame, when the camera is enabled. */
	camera?: CameraFrame[];
	/** 9-slice rectangle for symbols that use it (informational). */
	scalingGrid?: { left: number; top: number; right: number; bottom: number };
}

export type LayerType = "normal" | "guide" | "guided" | "mask" | "masked" | "folder" | "camera";

export interface LayerData {
	name: string;
	type: LayerType;
	visible: boolean;
	/** Index (in the same layers array) of the folder/mask/guide this layer belongs to, or -1. */
	parent: number;
	frameCount: number;
	keyframes: Keyframe[];
	/** Layer parenting (Animate 2020+): per-frame rig matrices when the layer has a rig parent. */
	rig?: (Mat | null)[];
	/** Advanced layer effects (Animate 2020+), at keyframes, when present. */
	effects?: LayerEffect[];
}

export interface LayerEffect {
	frame: number;
	color?: ColorTransform;
	filters?: FilterData[];
	blendMode?: string;
}

export interface Keyframe {
	/** 0-based index of the first frame of this keyframe span. */
	index: number;
	duration: number;
	label?: { name: string; type: "name" | "comment" | "anchor" };
	/** Frame script (AS3 or canvas JS), used to detect stop()/play()/gotoAndPlay(). */
	script?: string;
	tween?: TweenData;
	sound?: FrameSound;
	elements: ElementData[];
}

export type ElementData = InstanceElement | ShapeElement | BitmapElement | TextElement | VideoElement | UnsupportedElement;

/** A video component (AS3 FLVPlayback, HTML5 Canvas Video): a linked video file, placed by its bounds. */
export interface VideoElement extends ElementBase {
	kind: "video";
	/** as set in the component */
	src: string;
	/** the file copied next to scene.json (videos/…), when it was found */
	file?: string;
	autoplay: boolean;
	loop: boolean;
	muted: boolean;
	controls: boolean;
	poster?: string;
	matrix: Mat;
}

interface ElementBase {
	/** Bounds in the parent timeline's space (as reported by Animate). */
	bounds: { left: number; top: number; width: number; height: number };
}

export interface InstanceElement extends ElementBase {
	kind: "instance";
	/** Key into SceneModel.timelines. */
	symbol: string;
	symbolType: "movie clip" | "graphic" | "button";
	name: string;
	matrix: Mat;
	/** Transformation point, in the instance's local coordinates. */
	transformPoint: Point;
	color: ColorTransform | null;
	filters: FilterData[];
	blendMode: string;
	visible: boolean;
	cacheAsBitmap: boolean;
	acc?: AccInfo;
	/** Graphic symbols: "loop" | "play once" | "single frame" | "loop reverse" | "play once reverse". */
	loop?: string;
	firstFrame?: number;
	lastFrame?: number;
	is3D?: boolean;
}

export interface ShapeElement extends ElementBase {
	kind: "shape";
	/** Key into SceneModel.atlas. Raw shapes, drawing objects, groups and primitives. */
	atlas: string;
	/** Gradients drawn with "Linear RGB" interpolation, as "#rrggbb,#rrggbb|0,255" signatures. */
	linearRGB?: string[];
	/** Strokes that keep their width when scaled (scale "none"), as "#rrggbb|width". */
	fixedStrokes?: string[];
	/** Library bitmaps used as fills (Animate's SVG export only links them by file name). */
	bitmapFills?: BitmapFill[];
}

export interface BitmapFill {
	/** Key into SceneModel.bitmaps. */
	bitmap: string;
	/** Library name. */
	name: string;
	/** "Clip" instead of repeat: Animate extends the edge pixels outside the bitmap. */
	clipped: boolean;
}

export interface BitmapElement extends ElementBase {
	kind: "bitmap";
	bitmap: string;
	matrix: Mat;
}

export interface TextElement extends ElementBase {
	kind: "text";
	textType: "static" | "dynamic" | "input";
	/** Outline rendering through the SVG exporter (always available). */
	atlas: string;
	matrix: Mat;
	name: string;
	width: number;
	height: number;
	text: string;
	runs: TextRun[];
	multiline: boolean;
	selectable: boolean;
	acc?: AccInfo;
	/** "Show border around text" (dynamic and input text): a white field with a black outline. */
	border?: boolean;
	/** Filters on the field (drop shadow, glow...). */
	filters?: FilterData[];
}

export interface TextRun {
	text: string;
	face: string;
	size: number;
	fillColor: string;
	bold: boolean;
	italic: boolean;
	alignment: string;
	letterSpacing: number;
	lineSpacing: number;
	/** A link set on the run (Properties › Options › Link), and its target window. */
	url?: string;
	target?: string;
}

export interface UnsupportedElement extends ElementBase {
	kind: "unsupported";
	what: string;
}

export interface ColorTransform {
	mode: string;
	/** Multipliers in percent (100 = identity). */
	rP: number;
	gP: number;
	bP: number;
	aP: number;
	/** Offsets (-255..255). */
	rA: number;
	gA: number;
	bA: number;
	aA: number;
}

export interface FilterData {
	name: string;
	enabled: boolean;
	[prop: string]: unknown;
}

export interface TweenData {
	/** "classic" = old motion tween, "motionObject" = object based tween, "shape" = shape tween. */
	type: "classic" | "motionObject" | "shape";
	/** Classic ease amount -100..100 (negative = ease in / accelerate). */
	easing: number;
	/** Custom ease curves (Bezier points: anchor, ctrl, ctrl, anchor, ...) keyed by property group. */
	customEase?: Partial<Record<EaseProperty, Point[]>>;
	rotate: "none" | "auto" | "clockwise" | "counter-clockwise";
	rotateTimes: number;
	orientToPath: boolean;
	scale: boolean;
	snap: boolean;
	sync: boolean;
	/** True when the layer follows a motion guide. */
	guided: boolean;
	/**
	 * Ground truth sampled through frame.tweenObj, one sample per frame of the span
	 * (index 0 = the keyframe itself). Present for classic and motion-object tweens.
	 */
	samples?: TweenSample[];
	/** Shape tweens: one atlas item per frame of the span. */
	shapeFrames?: string[];
}

export type EaseProperty = "all" | "position" | "rotation" | "scale" | "color" | "filters";

export interface TweenSample {
	matrix: Mat;
	color: ColorTransform | null;
	filters?: FilterData[];
}

export interface CameraFrame {
	x: number;
	y: number;
	zoom: number;
	rotation: number;
	tint?: { color: string; percent: number };
	colorFilter?: { brightness: number; contrast: number; saturation: number; hue: number };
}

export interface AtlasItem {
	/** Path of the SVG file written by Animate, relative to the scene.json folder. */
	file: string;
	/** Where the artwork came from, for diagnostics. */
	source: string;
	/** How far Animate moved the artwork when it was pasted into the atlas (subtract it). */
	offset?: Point;
}

export interface BitmapData {
	name: string;
	/** The pixels without loss (PNG); older models: the bitmap as Animate compresses it (JPEG or PNG). */
	file: string;
	width: number;
	height: number;
	smoothing: boolean;
	/** Animate's compression setting for the bitmap (absent in older models). */
	compression?: "photo" | "lossless";
	/** "Photo" bitmaps: Animate's JPEG quality, -1 = the imported JPEG's own. */
	quality?: number;
	/** "Photo" bitmaps: the JPEG Animate publishes (for imported JPEGs the original file). */
	jpeg?: string;
	/**
	 * Set by encodeImages (images.ts) when it wrote fewer pixels than width x height (the bitmap is
	 * shown smaller): the file's size. The bitmap is still drawn width x height big.
	 */
	pixels?: [number, number];
}

export interface SoundData {
	name: string;
	/** WAV (PCM) for sounds imported as WAV/AIFF, the original file for imported MP3s. */
	file: string;
	/** How the sound was imported (absent in older models). */
	original?: "raw" | "mp3";
	/**
	 * Length in 44.1 kHz samples. Animate pads the WAV it exports with silence; this is where the
	 * sound really ends (absent in older models).
	 */
	samples?: number;
	/** Animate's compression setting for the sound (Library › Properties). */
	compression?: "default" | "adpcm" | "mp3" | "raw" | "speech";
	/** MP3 compression: kbit/s. */
	bitRate?: number;
	/** Imported MP3s: "Use imported MP3 quality". */
	importedQuality?: boolean;
	/** ADPCM, Raw, Speech: sample rate in Hz. */
	sampleRate?: number;
	/** ADPCM: bits per sample. */
	bits?: number;
	/** Convert stereo to mono (set with the compression). */
	mono?: boolean;
	/** Set by encodeSounds (audio.ts): where the file starts in the sound (44.1 kHz samples)... */
	trim?: number;
	/** ...how long it plays (seconds)... */
	seconds?: number;
	/** ...and the encoder delay at its start (seconds; decoders that read a gapless header skip it). */
	lead?: number;
}

export interface FrameSound {
	sound: string;
	sync: "event" | "start" | "stop" | "stream";
	loopMode: "repeat" | "loop";
	loops: number;
	effect: string;
	/**
	 * Volume envelope ("Edit sound envelope"): [position in 44.1 kHz samples from the start of
	 * playback (it runs on across loops), left, right (0..32768)]. Absent = full volume.
	 */
	envelope?: [number, number, number][];
	/** In and out point in 44.1 kHz samples; every loop plays from start to end. */
	limits?: { start: number; end: number };
}
