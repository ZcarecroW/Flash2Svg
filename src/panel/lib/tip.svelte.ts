/**
 * The one tooltip of the panel (Tooltip.svelte shows it): the "i" buttons (Info.svelte) open it
 * on hover after a moment, at once on keyboard focus, and a click pins it until a click elsewhere
 * or Escape. Moving between "i" buttons while one is open switches at once.
 */
import type { HelpTopic } from "./help.ts";

export const tip = $state<{ topic: HelpTopic | null; anchor: HTMLElement | null; pinned: boolean }>({ topic: null, anchor: null, pinned: false });

let showTimer = 0;
let hideTimer = 0;

export function showTip(anchor: HTMLElement, topic: HelpTopic, delay = 0) {
	clearTimeout(hideTimer);
	clearTimeout(showTimer);
	const open = () => {
		if (tip.anchor !== anchor) tip.pinned = false;
		tip.topic = topic;
		tip.anchor = anchor;
	};
	// another tip is open: switch without waiting
	if (delay > 0 && !tip.anchor) showTimer = window.setTimeout(open, delay);
	else open();
}

export function hideTip(delay = 0) {
	clearTimeout(showTimer);
	clearTimeout(hideTimer);
	const close = () => {
		tip.anchor = null;
		tip.topic = null;
		tip.pinned = false;
	};
	if (delay > 0) hideTimer = window.setTimeout(close, delay);
	else close();
}

/** The pointer reached the tooltip (to click its link): keep it. */
export function keepTip() {
	clearTimeout(hideTimer);
}

/** Pointer left: close unless pinned. */
export function leaveTip(delay = 150) {
	clearTimeout(showTimer);
	if (!tip.pinned) hideTip(delay);
}

export function togglePin(anchor: HTMLElement, topic: HelpTopic) {
	if (tip.anchor === anchor && tip.pinned) return hideTip();
	showTip(anchor, topic);
	tip.pinned = true;
}
