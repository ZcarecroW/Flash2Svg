/**
 * The panel's "i" tips: what a setting does, in a few sentences, and where the user guide says
 * more. `guide` is a page of https://zcarecrow.github.io/Flash2Svg/ with its heading's anchor
 * (scripts/e2e-panel-ui.ts checks that every one exists in docs/guide/dist).
 */
export const GUIDE_URL = "https://zcarecrow.github.io/Flash2Svg/";

export interface Help {
	/** What the tip is about (the button's accessible name says "About <label>"). */
	label: string;
	text: string;
	guide?: string;
}

export const HELP = {
	format: {
		label: "Format",
		text: "How the file animates. Not sure? Automatic picks the JS player when the document has sounds or mouse handlers, otherwise CSS, or SMIL when that is clearly smaller (shape tweens). GIF and WebP are pictures for places where SVG doesn't play.",
		guide: "formats.html#at-a-glance",
	},
	file: {
		label: "File",
		text: "Where the export is written. Empty: next to the FLA, named after it. The extension always follows the format, and a relative name is placed next to the FLA.",
		guide: "panel.html#output",
	},
	source: {
		label: "Source",
		text: "Current timeline: the scene or symbol you are editing. Selected library symbols: one file per symbol selected in the Library (good for icon sets). All scenes in a row: the scenes play one after another, as in Flash.",
		guide: "panel.html#output",
	},
	frames: {
		label: "Frames",
		text: "All frames, the frame under the playhead (always a still SVG), or a range: first and last frame, counted from 1 as in Animate's timeline.",
		guide: "panel.html#output",
	},
	smooth: {
		label: "Smooth tweens",
		text: "On: tweens glide between frames at the screen's frame rate. Off: one step per frame, exactly like the SWF. Frame-by-frame animation looks the same either way.",
		guide: "animation.html#tweens-and-easing",
	},
	loop: {
		label: "Loop",
		text: "Follow timeline: frame scripts such as stop() and gotoAndPlay() decide, as in Flash; without them the timeline loops. Always loop and Play once override the scripts.",
		guide: "panel.html#animation",
	},
	start: {
		label: "Start",
		text: "When the animation starts: on load, on a click or hover, when your page's script starts it, when half of it is on screen, or driven by the scroll position. The last two need scripts: in an <img> they just play.",
		guide: "interactivity.html#start-modes",
	},
	scroll: {
		label: "Scroll range",
		text: "The stretch of scrolling that plays the animation from first to last frame. CSS follows the scroll only in an SVG placed inline in the page; SMIL and the JS player also in an <object> of the same site.",
		guide: "interactivity.html#on-scroll",
	},
	delay: {
		label: "Delay",
		text: "Seconds to wait before the animation starts (after the start event).",
		guide: "panel.html#animation",
	},
	poster: {
		label: "Poster",
		text: "The frame shown where the animation can't play (for example in e-mail clients) and to visitors who turned animations off.",
		guide: "panel.html#animation",
	},
	reducedMotion: {
		label: "Still poster for reduce motion",
		text: "Visitors who turned animations off in their system settings see the poster frame, still. The JS player then plays after a click.",
		guide: "accessibility.html#reduced-motion",
	},
	background: {
		label: "Include stage colour",
		text: "Paints the stage colour behind the animation. Off: transparent, so the page shows through.",
		guide: "panel.html#graphics-text",
	},
	embed: {
		label: "Embed images and sounds",
		text: "On: one self-contained file. Off: bitmaps and sounds are written next to it (bitmaps/, sounds/) and linked: a smaller file, but more requests, and they don't show when the SVG is used as an <img>.",
		guide: "images-sounds.html#linked-instead-of-embedded",
	},
	outlines: {
		label: "Dynamic text as outlines",
		text: "Draws dynamic and input text as shapes, exactly as in Animate. Off: real text that can be selected, searched and read aloud. Static text is always drawn as shapes.",
		guide: "text.html#dynamic-and-input-text",
	},
	fonts: {
		label: "Embed fonts",
		text: "The installed fonts of dynamic text go into the file as small WOFF2 subsets of the characters used. Fonts whose licence forbids embedding are left out (the browser then uses a similar font).",
		guide: "text.html#dynamic-and-input-text",
	},
	hiddenLayers: {
		label: "Include hidden layers",
		text: "Exports the layers hidden in Animate's timeline, as Flash publishes them. Untick to leave them out.",
		guide: "panel.html#graphics-text",
	},
	guides: {
		label: "Include guide layers",
		text: "Guide layers never show in a published SWF. Tick to export them anyway.",
		guide: "panel.html#graphics-text",
	},
	lossy: {
		label: "Photos as",
		text: "The format of bitmaps compressed with loss (Animate's Photo (JPEG) setting). JPEG plays everywhere; WebP is smaller and plays in all current browsers; AVIF is smallest (Safari from 16.4). A photo with transparency becomes WebP.",
		guide: "images-sounds.html#images",
	},
	lossless: {
		label: "Lossless as",
		text: "The format of bitmaps that keep every pixel (Animate's Lossless (PNG/GIF) setting, icons, pixel art): optimised PNG, or WebP lossless, usually smaller. Both are exact.",
		guide: "images-sounds.html#images",
	},
	quality: {
		label: "Image quality",
		text: "1 to 100 for bitmaps compressed with loss. 0 uses each bitmap's own quality from Animate; imported JPEGs exported as JPEG then stay byte for byte.",
		guide: "images-sounds.html#images",
	},
	resolution: {
		label: "Resolution",
		text: "Bitmaps only ever shown smaller than their pixels are written smaller, down to this multiple of their largest size on stage. 2× stays sharp on HiDPI screens; Every pixel never scales down.",
		guide: "images-sounds.html#resolution",
	},
	bitmapList: {
		label: "Bitmaps",
		text: "Each bitmap of the library. Lossy or Lossless overrides Animate's compression for that bitmap; Full keeps all its pixels (for details that are zoomed into). Bitmaps without smoothing and repeating fills always keep every pixel.",
		guide: "images-sounds.html#resolution",
	},
	soundFormat: {
		label: "Compressed as",
		text: "Sounds play only in the JS player. MP3 plays everywhere; Opus sounds as good at about half the bit rate and plays in all current browsers (Safari from 18.4).",
		guide: "images-sounds.html#sounds",
	},
	bitrate: {
		label: "Bit rate",
		text: "kbit/s on MP3's scale (Opus gets about half). 0 uses each sound's MP3 setting from Animate, else 128 stereo / 64 mono (less for low sample rates); imported MP3s at their own quality stay byte for byte.",
		guide: "images-sounds.html#sounds",
	},
	soundList: {
		label: "Sounds",
		text: "Each sound of the library: compressed, or uncompressed WAV (exact, but about ten times larger), instead of its setting in Animate. Every sound is cut to the part the frames play.",
		guide: "images-sounds.html#sounds",
	},
	size: {
		label: "Size",
		text: "Stage size: a fixed size in pixels. The others fill the space the page gives the SVG, like Flash's scale modes: show all, no border (cropped), or stretched.",
		guide: "panel.html#advanced",
	},
	digits: {
		label: "Decimals",
		text: "Precision of coordinates on screen (0 to 6). Parts shown larger get more decimals, parts shown smaller fewer. 1 makes smaller files; raise it if fine details wobble.",
		guide: "performance.html#decimals",
	},
	pretty: {
		label: "Indent output",
		text: "Line breaks and indents, for reading the file. Makes it bigger: leave it off for publishing.",
		guide: "panel.html#advanced",
	},
	svgz: {
		label: "Compressed .svgz",
		text: "gzip inside, for design tools and servers that send .svgz with Content-Encoding: gzip. Browsers don't open .svgz files from disk; on the web, plain SVG compressed by the server is smaller.",
		guide: "performance.html#compression",
	},
	remember: {
		label: "Remember settings in the FLA",
		text: "Saves these settings inside the document with each export, so they come back whenever it is opened, on any computer.",
		guide: "panel.html#advanced",
	},
	openAfter: {
		label: "Open in browser after export",
		text: "Opens the exported file in your default browser after each export (not Lottie and .svgz files, which browsers don't play from disk).",
		guide: "panel.html#advanced",
	},
	keepScene: {
		label: "Keep the scene data",
		text: "Writes what the exporter read from Animate next to the output, as <name>.scene/. The command line exports it again with other settings, without Animate.",
		guide: "command-line.html",
	},
	presets: {
		label: "Presets",
		text: "Saves the current settings under a name: it appears in the Presets menu at the top. Choices for single bitmaps and sounds stay with the document.",
		guide: "settings.html#presets",
	},
	budget: {
		label: "Size overview",
		text: "What the bytes of the export are spent on, and its biggest drawings: the place to start when a file is too large.",
		guide: "performance.html#read-the-size-overview",
	},
	stateMachine: {
		label: "State machine",
		text: 'Plays the preview as the .lottie file\'s state machine says: its start, loop and clicks, as dotLottie players do with stateMachineId "playback".',
		guide: "lottie.html",
	},
} satisfies Record<string, Help>;

export type HelpTopic = keyof typeof HELP;
