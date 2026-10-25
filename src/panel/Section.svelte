<script lang="ts">
	import type { Snippet } from "svelte";

	let { title, open = $bindable(true), children }: { title: string; open?: boolean; children: Snippet } = $props();
</script>

<section class:closed={!open}>
	<h2>
		<button aria-expanded={open} onclick={() => (open = !open)}>
			<span class="chev" aria-hidden="true">{open ? "▾" : "▸"}</span>{title}
		</button>
	</h2>
	{#if open}<div class="body">{@render children()}</div>{/if}
</section>
