<script lang="ts" module>
	/** The panel's icons: symbols of the sprite src/panel/icons.svg (listed in icons.txt), inlined by build.mjs. */
	export type IconName =
		| "c-info"
		| "export"
		| "e-remove"
		| "bookmarks"
		| "file"
		| "file-upload"
		| "play-media"
		| "shapes"
		| "image"
		| "sound"
		| "gear"
		| "c-check"
		| "open-folder"
		| "folder"
		| "globe"
		| "refresh"
		| "undo"
		| "floppy-disk"
		| "trash"
		| "button-play"
		| "button-pause"
		| "warning-sign"
		| "c-warning"
		| "magic-wand"
		| "code"
		| "css3"
		| "cursor-pointer"
		| "layers"
		| "animation-14"
		| "archive"
		| "image-2"
		| "ctrl-down"
		| "ctrl-right";
</script>

<script lang="ts">
	/** A sprite icon in the text colour; decorative (the control around it carries the label). */
	let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} aria-hidden="true" focusable="false"><use href="#i-{name}" /></svg>
