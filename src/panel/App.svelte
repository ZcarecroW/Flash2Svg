<script lang="ts">
	import { onMount } from "svelte";
	import { hostSkin, inCep, node, onHostEvent, onThemeChange, openInBrowser, revealInExplorer } from "./lib/cep.ts";
	import { defaultOutput, docInfo, loadDocSettings, runExport, saveDocSettings, type DocInfo, type ExportResult } from "./lib/exporter.ts";
	import { applyPartial, applyPreset, BUILTIN_PRESETS, deletePreset, panel, persist, resetSettings, savePreset, userPresets } from "./lib/state.svelte.ts";
	import Section from "./Section.svelte";
	import Preview from "./Preview.svelte";
	import { runSelfTestIfRequested } from "./lib/selftest.ts";

	let info = $state<DocInfo>({ open: false });
	let busy = $state(false);
	let cancelled = false;
	let progress = $state(0);
	let message = $state("");
	let error = $state("");
	let result = $state<ExportResult | null>(null);
	let presets = $state(userPresets());
	let newPreset = $state("");

	const formats = [
		{ id: "smil", name: "SMIL", hint: "Plays everywhere, also in <img>. Smallest for tweens." },
		{ id: "css", name: "CSS", hint: "CSS @keyframes: easy to pause / restyle from a page." },
		{ id: "player", name: "JS player", hint: "Exact Flash semantics, buttons, sounds, play/stop/goto API." },
		{ id: "static", name: "Frames", hint: "One still SVG per frame (no animation)." },
	] as const;

	const placeholder = $derived(info.open ? defaultOutput(info) || "Save the FLA first, or pick a file" : "");
	const docLabel = $derived(
		info.open ? `${info.name} · ${info.isSymbol ? "symbol " : ""}${info.timeline} · ${info.frameCount} fr @ ${info.frameRate} fps${info.type === "htmlcanvas" ? " · HTML5 Canvas" : ""}` : "No document open",
	);

	async function refresh() {
		if (busy || !inCep) return;
		try {
			const prev = info.path;
			info = await docInfo();
			if (info.open && info.path !== prev) {
				const saved = await loadDocSettings().catch(() => null);
				if (saved) {
					applyPartial(saved);
					panel.rememberInDocument = true;
				}
				if (panel.rangeEnd < 1 || panel.rangeEnd > (info.frameCount ?? 1)) panel.rangeEnd = info.frameCount ?? 1;
			}
		} catch (e) {
			error = (e as Error).message;
		}
	}

	function applySkin() {
		const s = hostSkin();
		if (!s) return;
		const root = document.documentElement;
		root.style.setProperty("--bg", s.background);
		root.dataset.theme = s.dark ? "dark" : "light";
	}

	onMount(() => {
		applySkin();
		onThemeChange(applySkin);
		for (const ev of ["documentChanged", "documentOpened", "documentClosed", "documentSaved", "documentNew", "timelineChanged"]) {
			onHostEvent(`com.adobe.events.flash.${ev}`, refresh);
		}
		refresh();
		if (inCep) runSelfTestIfRequested().catch((e) => (error = "Self-test: " + (e as Error).message));
	});

	$effect(() => {
		// persist any settings change
		JSON.stringify(panel);
		persist();
	});

	async function doExport() {
		error = "";
		result = null;
		busy = true;
		cancelled = false;
		progress = 0;
		message = "Starting";
		try {
			await refresh();
			if (!info.open) throw new Error("Open a document first.");
			const req = $state.snapshot(panel);
			result = await runExport(
				{ settings: req.export, source: req.source, frames: req.frames, rangeStart: req.rangeStart, rangeEnd: req.rangeEnd, output: req.output },
				info,
				(p, m) => {
					progress = p;
					message = m;
				},
				() => cancelled,
			);
			if (panel.rememberInDocument) await saveDocSettings(JSON.stringify(req));
			if (panel.openAfterExport && result.files[0]) openInBrowser(result.files[0]);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function browse() {
		const start = panel.output || placeholder;
		const r = window.cep?.fs.showSaveDialogEx("Export SVG", start ? node?.path.dirname(start) ?? "" : "", ["svg"], start ? node?.path.basename(start) ?? "animation.svg" : "animation.svg");
		if (r && r.err === 0 && r.data) panel.output = r.data.toLowerCase().endsWith(".svg") ? r.data : r.data + ".svg";
	}

	function choosePreset(e: Event) {
		const v = (e.target as HTMLSelectElement).value;
		(e.target as HTMLSelectElement).value = "";
		if (!v) return;
		const p = BUILTIN_PRESETS[v] ?? presets[v];
		if (p) applyPreset(p);
	}

	function addPreset() {
		const n = newPreset.trim();
		if (!n) return;
		savePreset(n);
		presets = userPresets();
		newPreset = "";
	}

	function removePreset(n: string) {
		deletePreset(n);
		presets = userPresets();
	}

	const kb = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);
</script>

<main>
	<header>
		<div class="doc" title={docLabel}>{docLabel}</div>
		<div class="bar">
			<select class="presets" onchange={choosePreset} aria-label="Apply preset" disabled={busy}>
				<option value="">Presets…</option>
				{#each Object.keys(BUILTIN_PRESETS) as p (p)}<option value={p}>{p}</option>{/each}
				{#if Object.keys(presets).length}
					<option disabled>──────────</option>
					{#each Object.keys(presets) as p (p)}<option value={p}>{p}</option>{/each}
				{/if}
			</select>
			{#if busy}
				<button class="secondary" onclick={() => (cancelled = true)}>Cancel</button>
			{:else}
				<button class="primary" onclick={doExport} disabled={!info.open && inCep}>Export</button>
			{/if}
		</div>
		{#if busy}
			<div class="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin="0" aria-valuemax="100">
				<div style="width:{Math.round(progress * 100)}%"></div>
				<span>{message}</span>
			</div>
		{/if}
		{#if error}<div class="error" role="alert">{error}</div>{/if}
	</header>

	<Section title="Output" bind:open={panel.open.output}>
		<div class="formats" role="radiogroup" aria-label="Format">
			{#each formats as f (f.id)}
				<button role="radio" aria-checked={panel.export.format === f.id} class:on={panel.export.format === f.id} title={f.hint} onclick={() => (panel.export.format = f.id)}>{f.name}</button>
			{/each}
		</div>
		<p class="hint">{formats.find((f) => f.id === panel.export.format)?.hint}</p>
		<label class="row">
			<span>File</span>
			<span class="file">
				<input type="text" bind:value={panel.output} placeholder={placeholder} spellcheck="false" />
				<button class="icon" title="Choose file" onclick={browse}>…</button>
			</span>
		</label>
		<label class="row">
			<span>Source</span>
			<select bind:value={panel.source}>
				<option value="timeline">Current timeline</option>
				<option value="library">Selected library symbols{info.selectedSymbols?.length ? ` (${info.selectedSymbols.length})` : ""}</option>
			</select>
		</label>
		<label class="row">
			<span>Frames</span>
			<select bind:value={panel.frames}>
				<option value="all">All</option>
				<option value="current">Current frame</option>
				<option value="range">Range</option>
			</select>
		</label>
		{#if panel.frames === "range"}
			<div class="row range">
				<span>From</span>
				<input type="number" min="1" max={info.frameCount ?? 99999} bind:value={panel.rangeStart} />
				<span>to</span>
				<input type="number" min={panel.rangeStart} max={info.frameCount ?? 99999} bind:value={panel.rangeEnd} />
			</div>
		{/if}
	</Section>

	{#if panel.export.format !== "static"}
		<Section title="Animation" bind:open={panel.open.animation}>
			<label class="check"><input type="checkbox" bind:checked={panel.export.smooth} /> Smooth tweens (interpolate between frames)</label>
			<label class="row">
				<span>Loop</span>
				<select bind:value={panel.export.loop}>
					<option value="auto">Follow timeline (stop() ends)</option>
					<option value="always">Always loop</option>
					<option value="never">Play once</option>
				</select>
			</label>
			<label class="row">
				<span>Start</span>
				<select bind:value={panel.export.begin}>
					<option value="auto">Automatically</option>
					<option value="click">On click</option>
					<option value="hover">On hover</option>
					<option value="manual">From script</option>
				</select>
			</label>
			<label class="row">
				<span>Delay (s)</span>
				<input type="number" min="0" step="0.1" bind:value={panel.export.delay} />
			</label>
			<label class="row">
				<span>Poster</span>
				<select bind:value={panel.export.posterFrame}>
					<option value="first">First frame</option>
					<option value="last">Last frame</option>
				</select>
			</label>
		</Section>
	{/if}

	<Section title="Graphics &amp; text" bind:open={panel.open.graphics}>
		<label class="check"><input type="checkbox" bind:checked={panel.export.includeBackground} /> Include stage colour</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.embedImages} /> Embed images and sounds</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.textAsOutlines} /> Dynamic text as outlines</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.includeHiddenLayers} /> Include hidden layers</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.includeGuides} /> Include guide layers</label>
	</Section>

	<Section title="Advanced" bind:open={panel.open.advanced}>
		<label class="row">
			<span>Decimals</span>
			<input type="number" min="0" max="6" bind:value={panel.export.digits} />
		</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.pretty} /> Indent output</label>
		<label class="check"><input type="checkbox" bind:checked={panel.rememberInDocument} /> Remember settings in the FLA</label>
		<label class="check"><input type="checkbox" bind:checked={panel.openAfterExport} /> Open in browser after export</label>
		<div class="row preset-add">
			<input type="text" placeholder="Save current settings as…" bind:value={newPreset} onkeydown={(e) => e.key === "Enter" && addPreset()} />
			<button class="secondary" onclick={addPreset} disabled={!newPreset.trim()}>Save</button>
		</div>
		{#each Object.keys(presets) as p (p)}
			<div class="row preset"><span>{p}</span><button class="icon" title="Delete preset" onclick={() => removePreset(p)}>✕</button></div>
		{/each}
		<button class="link" onclick={resetSettings}>Reset all settings</button>
	</Section>

	{#if result}
		<Section title="Result" bind:open={panel.open.preview}>
			<div class="stats">
				{result.files.length} file{result.files.length > 1 ? "s" : ""} · {kb(result.output.reduce((n, o) => n + o.stats.bytes, 0))} · {result.seconds.toFixed(1)} s
			</div>
			<div class="actions">
				<button class="secondary" onclick={() => openInBrowser(result!.files[0]!)}>Open in browser</button>
				<button class="secondary" onclick={() => revealInExplorer(result!.files[0]!)}>Show file</button>
			</div>
			<Preview file={result.files[0]!} format={panel.export.format} />
			{#if result.warnings.length}
				<details class="warnings">
					<summary>{result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}</summary>
					<ul>{#each result.warnings as w (w)}<li>{w}</li>{/each}</ul>
				</details>
			{/if}
		</Section>
	{/if}
</main>
