<script lang="ts">
	import type { Snippet } from "svelte";
	import Icon, { type IconName } from "./Icon.svelte";

	let { title, icon, open = $bindable(true), children }: { title: string; icon: IconName; open?: boolean; children: Snippet } = $props();
</script>

<section class:closed={!open}>
	<h2>
		<button type="button" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="chev"><Icon name={open ? "ctrl-down" : "ctrl-right"} size={10} /></span><Icon name={icon} />{title}
		</button>
	</h2>
	{#if open}<div class="body">{@render children()}</div>{/if}
</section>
