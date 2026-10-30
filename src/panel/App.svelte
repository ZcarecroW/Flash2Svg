<script lang="ts">
	import { onMount } from "svelte";
	import { hostSkin, inCep, node, onHostEvent, onThemeChange, openInBrowser, revealInExplorer } from "./lib/cep.ts";
	import { defaultOutput, docInfo, formatExt, libraryBitmaps, librarySounds, loadDocSettings, runExport, saveDocSettings, type BitmapInfo, type DocInfo, type ExportResult, type SoundInfo } from "./lib/exporter.ts";
	import { applyPartial, applyPreset, BUILTIN_PRESETS, deletePreset, panel, persist, resetSettings, savePreset, userPresets } from "./lib/state.svelte.ts";
	import Section from "./Section.svelte";
	import Budget from "./Budget.svelte";
	import Preview from "./Preview.svelte";
	import LottiePreview from "./LottiePreview.svelte";
	import { runSelfTestIfRequested } from "./lib/selftest.ts";

	let info = $state<DocInfo>({ open: false });
	let busy = $state(false);
	let cancelled = false;
	let progress = $state(0);
	let message = $state("");
	let error = $state("");
	let result = $state<ExportResult | null>(null);
	let presets = $state(userPresets());
	let bitmaps = $state<BitmapInfo[] | null>(null);
	let sounds = $state<SoundInfo[] | null>(null);
	let newPreset = $state("");

	const formats = [
		{ id: "smil", name: "SMIL", hint: "Plays everywhere, also in <img>. Smallest for tweens." },
		{ id: "css", name: "CSS", hint: "CSS @keyframes: easy to pause / restyle from a page." },
		{ id: "player", name: "JS player", hint: "Exact Flash semantics, buttons, sounds, play/stop/goto API." },
		{ id: "static", name: "Frames", hint: "One still SVG per frame (no animation)." },
		{ id: "lottie", name: "Lottie", hint: "Lottie JSON for lottie-web, dotLottie, Skottie and the iOS / Android players." },
		{ id: "dotlottie", name: ".lottie", hint: "dotLottie: the Lottie animation and its bitmaps in one compressed file." },
	] as const;

	const lottie = $derived(panel.export.format === "lottie" || panel.export.format === "dotlottie");
	const placeholder = $derived(info.open ? defaultOutput(info, undefined, formatExt(panel.export.format)) || "Save the FLA first, or pick a file" : "");
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
				bitmaps = null;
				sounds = null;
				if (panel.open.images) loadBitmaps();
				if (panel.open.sounds) loadSounds();
			}
		} catch (e) {
			error = (e as Error).message;
		}
	}

	/** The document's bitmaps, read when the Images section is open (a library scan costs time). */
	async function loadBitmaps() {
		if (!inCep || !info.open) return;
		try {
			bitmaps = await libraryBitmaps();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	/** The document's sounds, read when the Sounds section is open. */
	async function loadSounds() {
		if (!inCep || !info.open) return;
		try {
			sounds = await librarySounds();
		} catch (e) {
			error = (e as Error).message;
		}
	}

	$effect(() => {
		if (panel.open.images && bitmaps === null && info.open) loadBitmaps();
	});
	$effect(() => {
		if (panel.open.sounds && sounds === null && info.open) loadSounds();
	});

	function setMode(name: string, v: string) {
		const modes = { ...panel.export.imageModes };
		if (v === "lossy" || v === "lossless") modes[name] = v;
		else delete modes[name];
		panel.export.imageModes = modes;
	}

	function setFullSize(name: string, on: boolean) {
		const full = { ...panel.export.imageFullSize };
		if (on) full[name] = true;
		else delete full[name];
		panel.export.imageFullSize = full;
	}

	function setSoundMode(name: string, v: string) {
		const modes = { ...panel.export.soundModes };
		if (v === "lossy" || v === "lossless") modes[name] = v;
		else delete modes[name];
		panel.export.soundModes = modes;
	}

	const soundSetting = (s: SoundInfo) =>
		s.compression === "mp3" ? (s.importedQuality ? "MP3, imported quality" : `MP3, ${s.bitRate} kbps`) : s.compression === "default" ? "Default" : s.compression === "raw" ? "Raw" : s.compression.toUpperCase();
	const SOUND_FORMATS: Record<string, string> = { mp3: "MP3", opus: "Opus", wav: "WAV", original: "MP3 as imported" };

	const animateSetting = (b: BitmapInfo) => (b.compression === "lossless" ? "Lossless" : b.quality < 0 ? "Photo (imported JPEG)" : `Photo, quality ${b.quality}`);

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
		if (__SELFTEST__ && inCep) runSelfTestIfRequested().catch((e) => (error = "Self-test: " + (e as Error).message));
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
			// browsers show Lottie files as text or download them
			if (panel.openAfterExport && result.files[0] && !/\.(json|lottie)$/i.test(result.files[0])) openInBrowser(result.files[0]);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	function browse() {
		const ext = formatExt(panel.export.format);
		const start = panel.output || placeholder;
		const r = window.cep?.fs.showSaveDialogEx(lottie ? "Export Lottie" : "Export SVG", start ? node?.path.dirname(start) ?? "" : "", [ext.slice(1)], start ? node?.path.basename(start) ?? "animation" + ext : "animation" + ext);
		if (r && r.err === 0 && r.data) panel.output = r.data.toLowerCase().endsWith(ext) ? r.data : r.data + ext;
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
			{#if panel.export.format !== "lottie"}
				<label class="row">
					<span>Start</span>
					<select bind:value={panel.export.begin}>
						<option value="auto">Automatically</option>
						<option value="click">On click</option>
						<option value="hover">On hover</option>
						<option value="manual">From script</option>
					</select>
				</label>
			{/if}
			{#if !lottie}
				<label class="row">
					<span>Delay (s)</span>
					<input type="number" min="0" step="0.1" bind:value={panel.export.delay} />
				</label>
			{/if}
			{#if !lottie || (panel.export.format === "dotlottie" && panel.export.begin !== "auto")}
				<label class="row">
					<span>Poster</span>
					<select bind:value={panel.export.posterFrame}>
						<option value="first">First frame</option>
						<option value="last">Last frame</option>
					</select>
				</label>
			{/if}
			{#if !lottie}
				<label class="check" title="Visitors who turned animations off in their system settings see the poster frame (the JS player plays on a click)"><input type="checkbox" bind:checked={panel.export.reducedMotion} /> Still poster for “reduce motion”</label>
			{:else if panel.export.format === "lottie"}
				<p class="hint">Autoplay and looping are set in the Lottie player. After a stop() with movie clips still running, play the marker “intro” once, then “loop”.</p>
			{:else}
				<p class="hint">The file's state machine “playback” plays it like this (dotlottie-web: <code>stateMachineId: "playback"</code>; from script: fire its event “play”).</p>
			{/if}
		</Section>
	{/if}

	<Section title="Graphics &amp; text" bind:open={panel.open.graphics}>
		<label class="check"><input type="checkbox" bind:checked={panel.export.includeBackground} /> Include stage colour</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.embedImages} /> Embed images and sounds</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.textAsOutlines} /> Dynamic text as outlines</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.includeHiddenLayers} /> Include hidden layers</label>
		<label class="check"><input type="checkbox" bind:checked={panel.export.includeGuides} /> Include guide layers</label>
	</Section>

	<Section title="Images" bind:open={panel.open.images}>
		<p class="hint">Animate's bitmap properties decide per bitmap: <i>Photo (JPEG)</i> is compressed with loss, <i>Lossless (PNG/GIF)</i> stays exactly as it is. Change it for single bitmaps below.</p>
		<label class="row">
			<span>Photos as</span>
			<select bind:value={panel.export.imageLossy}>
				<option value="jpeg">JPEG (plays everywhere)</option>
				<option value="webp">WebP (smaller)</option>
				<option value="avif">AVIF (smallest)</option>
			</select>
		</label>
		<label class="row">
			<span>Lossless as</span>
			<select bind:value={panel.export.imageLossless}>
				<option value="png">PNG (optimised)</option>
				<option value="webp">WebP lossless (smaller)</option>
			</select>
		</label>
		<label class="row">
			<span>Quality</span>
			<input type="number" min="0" max="100" bind:value={panel.export.imageQuality} title="0 = each bitmap's quality from Animate" />
		</label>
		<p class="hint">Quality 0 uses each bitmap's own setting from Animate (imported JPEGs stay unchanged when exported as JPEG). Transparent photos are written as WebP, as JPEG can't keep transparency.</p>
		<label class="row">
			<span>Resolution</span>
			<select bind:value={panel.export.imageResolution}>
				<option value={0}>Every pixel</option>
				<option value={1}>1× the size shown</option>
				<option value={1.5}>1.5× the size shown</option>
				<option value={2}>2× (sharp on HiDPI screens)</option>
				<option value={3}>3× the size shown</option>
			</select>
		</label>
		<p class="hint">Bitmaps that are only ever shown smaller (scaled down, in symbols, tweens, under the camera) are made smaller, down to this multiple of their largest size on stage. Bitmaps without smoothing and repeating fills keep every pixel; tick <i>Full</i> for others that should.</p>
		{#if !info.open}
			<p class="hint">Open a document to list its bitmaps.</p>
		{:else if bitmaps === null}
			<p class="hint">Reading the library…</p>
		{:else if !bitmaps.length}
			<p class="hint">The document has no bitmaps.</p>
		{:else}
			<table class="bitmaps">
				<tbody>
					{#each bitmaps as b (b.name)}
						<tr>
							<td class="name" title="{b.name} · {b.width}×{b.height} · {animateSetting(b)}">{b.name}</td>
							<td class="mode">
								<select value={panel.export.imageModes[b.name] ?? ""} onchange={(e) => setMode(b.name, (e.target as HTMLSelectElement).value)} aria-label="Compression of {b.name}">
									<option value="">{b.compression === "photo" ? "Lossy (Animate)" : "Lossless (Animate)"}</option>
									<option value="lossy">Lossy</option>
									<option value="lossless">Lossless</option>
								</select>
							</td>
							<td class="full">
								<label title="Full size: always every pixel of {b.name}"><input type="checkbox" checked={!!panel.export.imageFullSize[b.name]} onchange={(e) => setFullSize(b.name, (e.target as HTMLInputElement).checked)} />Full</label>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<button class="link" onclick={loadBitmaps}>Reload list</button>
		{/if}
	</Section>

	<Section title="Sounds" bind:open={panel.open.sounds}>
		<p class="hint">Sounds play in the <i>JS player</i> format. Animate's sound properties decide per sound: <i>Raw</i> stays uncompressed (WAV), every other setting is compressed.</p>
		<label class="row">
			<span>Compressed as</span>
			<select bind:value={panel.export.soundFormat}>
				<option value="mp3">MP3 (plays everywhere)</option>
				<option value="opus">Opus (smaller; Safari 18.4+)</option>
			</select>
		</label>
		<label class="row">
			<span>Bit rate</span>
			<input type="number" min="0" max="320" step="8" bind:value={panel.export.soundBitrate} title="kbit/s on MP3's scale; 0 = each sound's setting from Animate" />
		</label>
		<p class="hint">Bit rate 0 uses each sound's MP3 setting from Animate (otherwise 128 kbps stereo / 64 mono, less for low sample rates); imported MP3s at their own quality stay as they are. Opus sounds as good at half the bit rate. Every sound is cut to the part the frames play.</p>
		{#if !info.open}
			<p class="hint">Open a document to list its sounds.</p>
		{:else if sounds === null}
			<p class="hint">Reading the library…</p>
		{:else if !sounds.length}
			<p class="hint">The document has no sounds.</p>
		{:else}
			<table class="bitmaps">
				<tbody>
					{#each sounds as snd (snd.name)}
						<tr>
							<td class="name" title="{snd.name} · {soundSetting(snd)}">{snd.name}</td>
							<td class="mode">
								<select value={panel.export.soundModes[snd.name] ?? ""} onchange={(e) => setSoundMode(snd.name, (e.target as HTMLSelectElement).value)} aria-label="Compression of {snd.name}">
									<option value="">{snd.compression === "raw" ? "Uncompressed (Animate)" : "Compressed (Animate)"}</option>
									<option value="lossy">Compressed</option>
									<option value="lossless">Uncompressed (WAV)</option>
								</select>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<button class="link" onclick={loadSounds}>Reload list</button>
		{/if}
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
				{#if !/\.(json|lottie)$/i.test(result.files[0] ?? "")}<button class="secondary" onclick={() => openInBrowser(result!.files[0]!)}>Open in browser</button>{/if}
				<button class="secondary" onclick={() => revealInExplorer(result!.files[0]!)}>Show file</button>
			</div>
			<Budget {result} />
			{#if result.format === "lottie" || result.format === "dotlottie"}<LottiePreview file={result.files[0]!} format={result.format} />{:else}<Preview file={result.files[0]!} format={result.format} />{/if}
			{#if result.images.length}
				<details class="warnings">
					<summary>{result.images.length} image{result.images.length > 1 ? "s" : ""}: {kb(result.images.reduce((n, i) => n + i.bytes, 0))}</summary>
					<ul>
						{#each result.images as i (i.name)}
							<li>{i.name}: {i.format === "original" ? "JPEG from Animate" : i.format.toUpperCase()}{i.mode === "lossless" ? " (lossless)" : ""}{i.width < i.sourceWidth || i.height < i.sourceHeight ? `, ${i.width}×${i.height} of ${i.sourceWidth}×${i.sourceHeight}` : ""}, {kb(i.bytes)}</li>
						{/each}
					</ul>
				</details>
			{/if}
			{#if result.sounds.length}
				<details class="warnings">
					<summary>{result.sounds.length} sound{result.sounds.length > 1 ? "s" : ""}: {kb(result.sounds.reduce((n, i) => n + i.bytes, 0))}</summary>
					<ul>
						{#each result.sounds as i (i.name)}
							<li>{i.name}: {SOUND_FORMATS[i.format] ?? i.format}{i.kbps ? ` ${i.kbps} kbps` : ""}{i.channels === 1 ? " mono" : ""}, {i.seconds.toFixed(2)} s, {kb(i.bytes)}</li>
						{/each}
					</ul>
				</details>
			{/if}
			{#if result.warnings.length}
				<details class="warnings">
					<summary>{result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}</summary>
					<ul>{#each result.warnings as w (w)}<li>{w}</li>{/each}</ul>
				</details>
			{/if}
		</Section>
	{/if}
</main>
