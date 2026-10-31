import { DEFAULT_SETTINGS, type ExportSettings } from "../../core/compile.ts";

export interface PanelSettings {
	export: ExportSettings;
	source: "timeline" | "library" | "scenes";
	frames: "all" | "current" | "range";
	rangeStart: number;
	rangeEnd: number;
	output: string;
	rememberInDocument: boolean;
	openAfterExport: boolean;
	/** Keep the extracted scene data next to the output (<name>.scene/, for the command line). */
	keepScene: boolean;
	open: Record<string, boolean>;
}

const KEY = "flash2svg.settings.v4";
const PRESETS = "flash2svg.presets.v4";

export const BUILTIN_PRESETS: Record<string, Partial<ExportSettings>> = {
	"Web animation (SMIL)": { format: "smil", smooth: true, loop: "auto", embedImages: true },
	"CSS animation": { format: "css", smooth: true, loop: "auto", embedImages: true },
	"Interactive (JS player)": { format: "player", smooth: true, loop: "auto", embedImages: true },
	"Still frames": { format: "static", includeBackground: true },
	"Smallest file": { format: "smil", digits: 1, embedImages: false, textAsOutlines: false, imageResolution: 1 },
	"Inkscape / Illustrator (static)": { format: "static", textAsOutlines: true, embedImages: true, digits: 3 },
};

/**
 * The values each choice may take: settings stored by another version (in the FLA, in a preset,
 * in the panel's storage) can name ones this one doesn't have; those keep their default.
 */
const CHOICES: { [K in keyof ExportSettings]?: readonly string[] } = {
	format: ["auto", "smil", "css", "player", "static", "lottie", "dotlottie", "gif", "webp"],
	loop: ["auto", "always", "never"],
	begin: ["auto", "click", "hover", "manual", "visible", "scroll"],
	scrollRange: ["visible", "crossing", "page"],
	scale: ["fixed", "fit", "fill", "stretch"],
	posterFrame: ["first", "last"],
	imageLossy: ["jpeg", "webp", "avif"],
	imageLossless: ["png", "webp"],
	soundFormat: ["mp3", "opus"],
};
const PANEL_CHOICES = { source: ["timeline", "library", "scenes"], frames: ["all", "current", "range"] } as const;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Per-name choices ({ bitmap: "lossy" }): only string keys with allowed values. */
function nameMap<T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> {
	const out: Record<string, T> = {};
	if (!v || typeof v !== "object" || Array.isArray(v)) return out;
	for (const [k, x] of Object.entries(v)) if (ok(x)) Object.defineProperty(out, k, { value: x, enumerable: true, writable: true, configurable: true });
	return out;
}
const isMode = (x: unknown): x is "lossy" | "lossless" => x === "lossy" || x === "lossless";
const isTrue = (x: unknown): x is true => x === true;

/**
 * The export settings in `raw` that this version knows and that have the right type; the rest
 * is left out (numbers may be null: an emptied field; the compiler uses the default then).
 */
export function cleanSettings(raw: unknown): Partial<ExportSettings> {
	const out: Record<string, unknown> = {};
	if (!raw || typeof raw !== "object") return out;
	const r = raw as Record<string, unknown>;
	for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof ExportSettings)[]) {
		if (!own(r, k)) continue;
		const v = r[k],
			d = DEFAULT_SETTINGS[k];
		if (k === "imageModes" || k === "soundModes") out[k] = nameMap(v, isMode);
		else if (k === "imageFullSize") out[k] = nameMap(v, isTrue);
		else if (CHOICES[k]) {
			if (typeof v === "string" && CHOICES[k]!.includes(v)) out[k] = v;
		} else if (typeof d === "number") {
			if (v === null || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
		} else if (typeof v === typeof d) out[k] = v;
	}
	return out as Partial<ExportSettings>;
}

function defaults(): PanelSettings {
	return {
		export: { ...DEFAULT_SETTINGS },
		source: "timeline",
		frames: "all",
		rangeStart: 1,
		rangeEnd: 1,
		output: "",
		rememberInDocument: false,
		openAfterExport: false,
		keepScene: false,
		open: { output: true, animation: true, graphics: false, images: false, sounds: false, advanced: false, preview: true },
	};
}

/** The panel's own fields of `s` that are valid. */
function cleanPanel(s: Record<string, unknown>): Partial<PanelSettings> {
	const out: Record<string, unknown> = {};
	for (const k of ["source", "frames"] as const)
		if (typeof s[k] === "string" && (PANEL_CHOICES[k] as readonly string[]).includes(s[k] as string)) out[k] = s[k];
	for (const k of ["rangeStart", "rangeEnd"] as const) if (s[k] === null || (typeof s[k] === "number" && Number.isFinite(s[k]))) out[k] = s[k];
	if (typeof s.output === "string") out.output = s.output;
	for (const k of ["rememberInDocument", "openAfterExport", "keepScene"] as const) if (typeof s[k] === "boolean") out[k] = s[k];
	return out as Partial<PanelSettings>;
}

function load(): PanelSettings {
	const d = defaults();
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const s = JSON.parse(raw) as Record<string, unknown>;
			if (s && typeof s === "object")
				return {
					...d,
					...cleanPanel(s),
					export: { ...d.export, ...cleanSettings(s.export) },
					open: { ...d.open, ...nameMap(s.open, (x): x is boolean => typeof x === "boolean") },
				};
		}
	} catch {
		/* ignore corrupt storage */
	}
	return d;
}

export const panel = $state<PanelSettings>(load());

export function persist() {
	try {
		localStorage.setItem(KEY, JSON.stringify($state.snapshot(panel)));
	} catch {
		/* storage may be unavailable */
	}
}

/** Settings saved in a document (see saveDocSettings): what is valid of them replaces the panel's. */
export function applyPartial(json: string) {
	try {
		const s = JSON.parse(json) as Record<string, unknown>;
		if (!s || typeof s !== "object") return;
		Object.assign(panel.export, cleanSettings(s.export));
		const p = cleanPanel(s);
		for (const k of ["source", "frames", "rangeStart", "rangeEnd", "output"] as const) if (own(p, k)) (panel as unknown as Record<string, unknown>)[k] = p[k];
	} catch {
		/* ignore */
	}
}

export function userPresets(): Record<string, Partial<ExportSettings>> {
	try {
		const all = JSON.parse(localStorage.getItem(PRESETS) ?? "{}") as unknown;
		const out: Record<string, Partial<ExportSettings>> = {};
		if (all && typeof all === "object" && !Array.isArray(all))
			for (const [k, v] of Object.entries(all))
				Object.defineProperty(out, k, { value: cleanSettings(v), enumerable: true, writable: true, configurable: true });
		return out;
	} catch {
		return {};
	}
}

/** The preset called `name` (built in or the user's), if there is one: also for names like "constructor". */
export function findPreset(name: string, user: Record<string, Partial<ExportSettings>>): Partial<ExportSettings> | undefined {
	if (name.startsWith("user:")) return own(user, name.slice(5)) ? user[name.slice(5)] : undefined;
	return own(BUILTIN_PRESETS, name) ? BUILTIN_PRESETS[name] : undefined;
}

/** Saves the settings as a preset; returns false when storage is unavailable or full. */
export function savePreset(name: string): boolean {
	const all = userPresets();
	// per-bitmap and per-sound choices belong to the document, not to a preset
	const { imageModes: _, imageFullSize: ___, soundModes: __, ...settings } = $state.snapshot(panel.export);
	// defineProperty: also a name like "__proto__" becomes a preset of its own
	Object.defineProperty(all, name, { value: settings, enumerable: true, writable: true, configurable: true });
	try {
		localStorage.setItem(PRESETS, JSON.stringify(all));
		return true;
	} catch {
		return false;
	}
}

export function deletePreset(name: string) {
	const all = userPresets();
	delete all[name];
	try {
		localStorage.setItem(PRESETS, JSON.stringify(all));
	} catch {
		/* storage may be unavailable */
	}
}

export function applyPreset(p: Partial<ExportSettings>) {
	Object.assign(panel.export, {
		...DEFAULT_SETTINGS,
		...cleanSettings(p),
		imageModes: panel.export.imageModes,
		imageFullSize: panel.export.imageFullSize,
		soundModes: panel.export.soundModes,
	});
}

export function resetSettings() {
	const d = defaults();
	Object.assign(panel, d);
}
