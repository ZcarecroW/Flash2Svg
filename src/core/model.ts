/**
 * Scene model: the JSON document written by the JSFL extractor (src/jsfl/extract.jsfl)
 * and consumed by the compiler. Everything here is plain data in Animate's own units:
 * pixels, degrees, 0-based frame indices, colour amounts 0-255 and percents 0-100.
 */

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
	timelines: Record<string, TimelineData>;
	/** Shape/text artwork rendered through Animate's SVG exporter, keyed by atlas id. */
	atlas: Record<string, AtlasItem>;
	bitmaps: Record<string, BitmapData>;
	sounds: Record<string, SoundData>;
	warnings: string[];
}

export interface DocInfo {
	name: string;
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

export type ElementData = InstanceElement | ShapeElement | BitmapElement | TextElement | UnsupportedElement;

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
	/** Group/drawing object members that are symbol instances cannot be animated; flagged here. */
	containsInstances?: boolean;
	/** Gradients drawn with "Linear RGB" interpolation, as "#rrggbb,#rrggbb|0,255" signatures. */
	linearRGB?: string[];
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
	file: string;
	width: number;
	height: number;
	smoothing: boolean;
}

export interface SoundData {
	name: string;
	file: string;
}

export interface FrameSound {
	sound: string;
	sync: "event" | "start" | "stop" | "stream";
	loopMode: "repeat" | "loop";
	loops: number;
	effect: string;
}
