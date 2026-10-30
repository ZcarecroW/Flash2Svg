<script lang="ts">
	import type { SizeParts } from "../core/compile.ts";
	import type { ExportResult } from "./lib/exporter.ts";

	/** What the exported files are made of (all outputs together), and the biggest drawings. */
	let { result }: { result: ExportResult } = $props();

	const kb = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

	const PARTS: { key: keyof SizeParts | "linked"; label: string; title: string }[] = [
		{ key: "drawing", label: "Drawing", title: "Shapes, text, structure, filters and masks" },
		{ key: "animation", label: "Animation", title: "SMIL animations, CSS or the player's timeline data" },
		{ key: "images", label: "Images", title: "Embedded bitmaps" },
		{ key: "sounds", label: "Sounds", title: "Embedded sounds" },
		{ key: "runtime", label: "Player", title: "The JS player's script" },
		{ key: "linked", label: "Linked files", title: "Bitmaps and sounds written next to the SVG" },
	];

	const budget = $derived.by(() => {
		const parts: Record<string, number> = { linked: result.linkedBytes };
		const drawings = new Map<string, { name: string; count: number; bytes: number }>();
		for (const o of result.output) {
			for (const [k, v] of Object.entries(o.stats.parts)) parts[k] = (parts[k] ?? 0) + v;
			for (const d of o.stats.drawings) {
				const g = drawings.get(d.name) ?? { name: d.name, count: 0, bytes: 0 };
				g.count += d.count;
				g.bytes += d.bytes;
				drawings.set(d.name, g);
			}
		}
		const total = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
		const shown = PARTS.filter((p) => (parts[p.key] ?? 0) > 0).map((p) => ({ ...p, bytes: parts[p.key]!, share: parts[p.key]! / total }));
		return { shown, drawings: [...drawings.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 8) };
	});
</script>

<div class="budget" role="img" aria-label="Size by content: {budget.shown.map((p) => `${p.label} ${kb(p.bytes)}`).join(', ')}">
	{#each budget.shown as p (p.key)}
		<span class="part-{p.key}" style="flex: {p.share} 0 0" title="{p.label}: {kb(p.bytes)}"></span>
	{/each}
</div>
<ul class="legend">
	{#each budget.shown as p (p.key)}
		<li title={p.title}><i class="part-{p.key}"></i>{p.label} {kb(p.bytes)}</li>
	{/each}
</ul>
{#if budget.drawings.length}
	<details class="warnings">
		<summary>Biggest drawings</summary>
		<ul>
			{#each budget.drawings as d (d.name)}
				<li>{d.name}: {kb(d.bytes)}{d.count > 1 ? ` (${d.count} drawings)` : ""}</li>
			{/each}
		</ul>
	</details>
{/if}
