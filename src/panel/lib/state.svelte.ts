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

function load(): PanelSettings {
	const d = defaults();
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const s = JSON.parse(raw) as Partial<PanelSettings>;
			return { ...d, ...s, export: { ...d.export, ...(s.export ?? {}) }, open: { ...d.open, ...(s.open ?? {}) } };
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

export function applyPartial(json: string) {
	try {
		const s = JSON.parse(json) as Partial<PanelSettings>;
		if (s.export) Object.assign(panel.export, s.export);
		for (const k of ["source", "frames", "rangeStart", "rangeEnd", "output"] as const) {
			if (s[k] !== undefined) (panel as unknown as Record<string, unknown>)[k] = s[k];
		}
	} catch {
		/* ignore */
	}
}

export function userPresets(): Record<string, Partial<ExportSettings>> {
	try {
		return JSON.parse(localStorage.getItem(PRESETS) ?? "{}");
	} catch {
		return {};
	}
}

export function savePreset(name: string) {
	const all = userPresets();
	// per-bitmap and per-sound choices belong to the document, not to a preset
	const { imageModes: _, imageFullSize: ___, soundModes: __, ...settings } = $state.snapshot(panel.export);
	all[name] = settings;
	localStorage.setItem(PRESETS, JSON.stringify(all));
}

export function deletePreset(name: string) {
	const all = userPresets();
	delete all[name];
	localStorage.setItem(PRESETS, JSON.stringify(all));
}

export function applyPreset(p: Partial<ExportSettings>) {
	Object.assign(panel.export, { ...DEFAULT_SETTINGS, ...p, imageModes: panel.export.imageModes, imageFullSize: panel.export.imageFullSize, soundModes: panel.export.soundModes });
}

export function resetSettings() {
	const d = defaults();
	Object.assign(panel, d);
}
