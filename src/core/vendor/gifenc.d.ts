// Types for gifenc 1.0 (pure JavaScript GIF encoder; the package ships none).
declare module "gifenc" {
	export type Palette = number[][];
	export interface FrameOptions {
		palette?: Palette;
		/** ms (written in hundredths) */
		delay?: number;
		/** -1 once, 0 forever, n extra times */
		repeat?: number;
		transparent?: boolean;
		transparentIndex?: number;
		/** GIF disposal method (0–3) */
		dispose?: number;
		colorDepth?: number;
	}
	export interface Encoder {
		writeFrame(index: Uint8Array, width: number, height: number, opts?: FrameOptions): void;
		finish(): void;
		bytes(): Uint8Array;
	}
	export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder;
	export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean | number; clearAlpha?: boolean }): Palette;
	export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: "rgb565" | "rgb444" | "rgba4444"): Uint8Array;
}
