<script lang="ts">
	import Icon from "./Icon.svelte";
	import { HELP, type HelpTopic } from "./lib/help.ts";
	import { hideTip, leaveTip, showTip, tip, togglePin } from "./lib/tip.svelte.ts";

	/** A small "i": explains a setting in the panel's tooltip (see lib/tip.svelte.ts). */
	let { topic }: { topic: HelpTopic } = $props();

	let btn = $state<HTMLButtonElement | null>(null);
	const open = $derived(!!btn && tip.anchor === btn);

	function blur(e: FocusEvent) {
		// focus moving into the tooltip (its guide link) keeps it
		if ((e.relatedTarget as Element | null)?.closest?.("#tip")) return;
		if (open) hideTip();
	}
</script>

<button
	bind:this={btn}
	type="button"
	class="info"
	class:open
	aria-label="About {HELP[topic].label}"
	aria-describedby={open ? "tip" : undefined}
	aria-expanded={open && tip.pinned}
	onmouseenter={() => btn && showTip(btn, topic, 300)}
	onmouseleave={() => leaveTip()}
	onfocus={(e) => btn && (e.target as HTMLElement).matches(":focus-visible") && showTip(btn, topic)}
	onblur={blur}
	onclick={() => btn && togglePin(btn, topic)}><Icon name="c-info" size={14} /></button
>
