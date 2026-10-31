<script lang="ts">
	import Icon from "./Icon.svelte";
	import { openUrl } from "./lib/cep.ts";
	import { GUIDE_URL, HELP } from "./lib/help.ts";
	import { hideTip, keepTip, leaveTip, tip } from "./lib/tip.svelte.ts";

	/** The panel's single tooltip, placed at its "i" button inside the panel's width. */
	let el = $state<HTMLDivElement | null>(null);
	let pos = $state.raw({ x: 0, y: 0, above: false, arrow: 0 });
	const help = $derived(tip.topic ? HELP[tip.topic] : null);

	function place() {
		const a = tip.anchor;
		if (!a || !el) return;
		const r = a.getBoundingClientRect();
		const w = el.offsetWidth,
			h = el.offsetHeight;
		const vw = document.documentElement.clientWidth,
			vh = window.innerHeight;
		const cx = r.left + r.width / 2;
		const x = Math.max(6, Math.min(vw - w - 6, cx - w / 2));
		// below the button, unless only above has room
		const above = r.bottom + 8 + h > vh - 4 && r.top - 8 - h >= 4;
		pos = { x, y: above ? r.top - 8 - h : r.bottom + 8, above, arrow: Math.max(8, Math.min(w - 8, cx - x)) };
	}

	// a new anchor or text: measure and place it (effects run before the browser paints)
	$effect(() => {
		void tip.topic;
		place();
	});

	/** Scrolled or resized: the tip follows its "i", and closes once that leaves the panel. */
	function follow() {
		const a = tip.anchor;
		if (!a) return;
		const r = a.getBoundingClientRect();
		if (r.bottom < 0 || r.top > window.innerHeight || !a.isConnected) hideTip();
		else place();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === "Escape" && tip.anchor) {
			const a = tip.anchor;
			hideTip();
			if (document.activeElement && el?.contains(document.activeElement)) a.focus();
		}
	}

	function onPointerDown(e: PointerEvent) {
		// a click outside closes a pinned tip
		const t = e.target as Node;
		if (tip.anchor && !tip.anchor.contains(t) && !el?.contains(t)) hideTip();
	}
</script>

<svelte:window onkeydown={onKey} onpointerdown={onPointerDown} onresize={follow} />
<svelte:document onscroll={follow} />

{#if help}
	<div
		bind:this={el}
		id="tip"
		role="tooltip"
		class="tip"
		class:above={pos.above}
		style="left:{pos.x}px;top:{pos.y}px;--arrow:{pos.arrow}px"
		onmouseenter={keepTip}
		onmouseleave={() => leaveTip()}
	>
		<p>{help.text}</p>
		{#if help.guide}
			<button type="button" class="link" onclick={() => (openUrl(GUIDE_URL + help.guide), hideTip())}
				><Icon name="globe" size={12} />More in the user guide</button
			>
		{/if}
	</div>
{/if}
