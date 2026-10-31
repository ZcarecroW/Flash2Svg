<script lang="ts">
	import { onMount } from "svelte";
	import { hostSkin, inCep, node, onHostEvent, onThemeChange, openInBrowser, revealInExplorer } from "./lib/cep.ts";
	import {
		defaultOutput,
		docInfo,
		formatExt,
		libraryBitmaps,
		librarySounds,
		loadDocSettings,
		runExport,
		saveDocSettings,
		type BitmapInfo,
		type DocInfo,
		type ExportResult,
		type SoundInfo,
	} from "./lib/exporter.ts";
	import {
		applyPartial,
		applyPreset,
		BUILTIN_PRESETS,
		deletePreset,
		findPreset,
		panel,
		persist,
		resetSettings,
		savePreset,
		userPresets,
	} from "./lib/state.svelte.ts";
	import Section from "./Section.svelte";
	import Budget from "./Budget.svelte";
	import Preview from "./Preview.svelte";
	import LottiePreview from "./LottiePreview.svelte";
	import Icon, { type IconName } from "./Icon.svelte";
	import Info from "./Info.svelte";
	import Tooltip from "./Tooltip.svelte";
	import { runSelfTestIfRequested } from "./lib/selftest.ts";
	import { skinColors } from "./lib/skin.ts";
	import { choice } from "../core/model.ts";

	let info = $state<DocInfo>({ open: false });
	let busy = $state(false);
	let cancelled = false;
	let progress = $state(0);
	let message = $state("");
	let error = $state("");
	let notice = $state("");
	let result = $state<ExportResult | null>(null);
	let presets = $state(userPresets());
	let bitmaps = $state<BitmapInfo[] | null>(null);
	let sounds = $state<SoundInfo[] | null>(null);
	let newPreset = $state("");

	const formats: { id: string; name: string; icon: IconName; hint: string }[] = [
		{
			id: "auto",
			name: "Automatic",
			icon: "magic-wand",
			hint: "The JS player when sounds or mouse handlers need it, else CSS or SMIL, whichever suits (CSS plays transforms on the compositor).",
		},
		{ id: "smil", name: "SMIL", icon: "code", hint: "Plays everywhere, also in <img>. Smallest for tweens." },
		{ id: "css", name: "CSS", icon: "css3", hint: "CSS @keyframes: easy to pause / restyle from a page." },
		{ id: "player", name: "JS player", icon: "cursor-pointer", hint: "Exact Flash semantics, buttons, sounds, play/stop/goto API." },
		{ id: "static", name: "Frames", icon: "layers", hint: "One still SVG per frame (no animation)." },
		{ id: "lottie", name: "Lottie", icon: "animation-14", hint: "Lottie JSON for lottie-web, dotLottie, Skottie and the iOS / Android players." },
		{ id: "dotlottie", name: ".lottie", icon: "archive", hint: "dotLottie: the Lottie animation and its bitmaps in one compressed file." },
		{ id: "gif", name: "GIF", icon: "image-2", hint: "Animated GIF (256 colours a frame): a fallback where SVG doesn't play, e.g. e-mail." },
		{
			id: "webp",
			name: "WebP",
			icon: "image-2",
			hint: "Animated WebP: smaller than GIF, full colour with alpha; a fallback for apps and mails that show WebP.",
		},
	];

	const lottie = $derived(panel.export.format === "lottie" || panel.export.format === "dotlottie");
	const placeholder = $derived(info.open ? defaultOutput(info, undefined, formatExt(panel.export.format)) || "Save the FLA first, or pick a file" : "");
	const docLabel = $derived(
		info.open
			? `${info.name} · ${info.isSymbol ? "symbol " : ""}${info.timeline} · ${info.frameCount} fr @ ${info.frameRate} fps${info.type === "htmlcanvas" ? " · HTML5 Canvas" : ""}`
			: "No document open",
	);
	// a range typed the wrong way round, or past the end, is fixed at export: say so now
	const rangeNote = $derived.by(() => {
		if (panel.frames !== "range") return "";
		const a = panel.rangeStart,
			b = panel.rangeEnd,
			n = info.frameCount;
		if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "Empty fields count as the first and the last frame.";
		if (a > b) return `Exports frames ${b} to ${a}.`;
		if (n && b > n) return `The timeline has ${n} frames: exports ${Math.min(a, n)} to ${n}.`;
		return "";
	});

	let refreshes = 0;
	/** Reads the document in front of Animate (`force`: also while an export starts). */
	async function refresh(force = false) {
		if ((busy && !force) || !inCep) return;
		const n = ++refreshes;
		try {
			const prev = info.path;
			const next = await docInfo();
			// a later refresh is under way (a document closed and another opened): its answer counts
			if (n !== refreshes) return;
			info = next;
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

	/**
	 * A copy of a per-name map with `name` set (undefined: removed). Names like "constructor" work;
	 * "__proto__" can't be kept (Svelte's state snapshots drop the key), so it stays at Animate's.
	 */
	function withChoice<T>(map: Record<string, T>, name: string, v: T | undefined): Record<string, T> {
		if (name === "__proto__") return map;
		const out: Record<string, T> = {};
		for (const [k, x] of Object.entries(map)) if (k !== name) Object.defineProperty(out, k, { value: x, enumerable: true, writable: true, configurable: true });
		if (v !== undefined) Object.defineProperty(out, name, { value: v, enumerable: true, writable: true, configurable: true });
		return out;
	}

	const mode = (v: string) => (v === "lossy" || v === "lossless" ? v : undefined);
	const setMode = (name: string, v: string) => (panel.export.imageModes = withChoice(panel.export.imageModes, name, mode(v)));
	const setFullSize = (name: string, on: boolean) => (panel.export.imageFullSize = withChoice(panel.export.imageFullSize, name, on ? true : undefined));
	const setSoundMode = (name: string, v: string) => (panel.export.soundModes = withChoice(panel.export.soundModes, name, mode(v)));

	const soundSetting = (s: SoundInfo) =>
		s.compression === "mp3"
			? s.importedQuality
				? "MP3, imported quality"
				: `MP3, ${s.bitRate} kbps`
			: s.compression === "default"
				? "Default"
				: s.compression === "raw"
					? "Raw"
					: s.compression.toUpperCase();
	const SOUND_FORMATS: Record<string, string> = { mp3: "MP3", opus: "Opus", wav: "WAV", original: "MP3 as imported" };

	const animateSetting = (b: BitmapInfo) =>
		b.compression === "lossless" ? "Lossless" : b.quality < 0 ? "Photo (imported JPEG)" : `Photo, quality ${b.quality}`;

	function applySkin() {
		const s = hostSkin();
		if (!s) return;
		const root = document.documentElement;
		const c = skinColors(s.background);
		root.style.setProperty("--bg", s.background);
		for (const k of ["fg", "muted", "line", "field"] as const) root.style.setProperty("--" + k, c[k]);
		root.dataset.theme = c.dark ? "dark" : "light";
	}

	onMount(() => {
		applySkin();
		onThemeChange(applySkin);
		for (const ev of ["documentChanged", "documentOpened", "documentClosed", "documentSaved", "documentNew", "timelineChanged"]) {
			onHostEvent(`com.adobe.events.flash.${ev}`, () => refresh());
		}
		// also when the panel is clicked into: Animate's events don't always arrive (a script that
		// closes and opens documents at once)
		window.addEventListener("focus", () => refresh());
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
		notice = "";
		result = null;
		busy = true;
		cancelled = false;
		progress = 0;
		message = "Starting";
		try {
			// the document, timeline and playhead now (Animate doesn't report every change)
			await refresh(true);
			if (!info.open) throw new Error("Open a document first.");
			const req = $state.snapshot(panel);
			result = await runExport(
				{
					settings: req.export,
					source: req.source,
					frames: req.frames,
					rangeStart: req.rangeStart,
					rangeEnd: req.rangeEnd,
					output: req.output,
					keepScene: req.keepScene,
				},
				info,
				(p, m) => {
					progress = p;
					message = m;
				},
				() => cancelled,
			);
			if (panel.rememberInDocument) await saveDocSettings(JSON.stringify(req));
			// browsers show Lottie files as text or download them, and open .svgz only from a server
			if (panel.openAfterExport && result.files[0] && !/\.(json|lottie|svgz)$/i.test(result.files[0])) openInBrowser(result.files[0]);
		} catch (e) {
			const err = e as Error;
			if (err.name === "AbortError") notice = "Export cancelled: nothing was written.";
			else error = err.message;
		} finally {
			busy = false;
		}
	}

	/** Arrow keys move through the formats (a radio group: Tab reaches only the chosen one). */
	function formatKey(e: KeyboardEvent) {
		const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
		const to = e.key === "Home" ? 0 : e.key === "End" ? formats.length - 1 : -1;
		if (!step && to < 0) return;
		e.preventDefault();
		const i = formats.findIndex((f) => f.id === panel.export.format);
		const next = formats[to >= 0 ? to : (i + step + formats.length) % formats.length]!;
		panel.export.format = next.id as typeof panel.export.format;
		const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button");
		buttons[formats.indexOf(next)]?.focus();
	}

	function browse() {
		const ext = formatExt(panel.export.format);
		const start = panel.output || placeholder;
		const r = window.cep?.fs.showSaveDialogEx(
			lottie ? "Export Lottie" : "Export SVG",
			start && node?.path.isAbsolute(start) ? node.path.dirname(start) : "",
			[ext.slice(1)],
			start ? (node?.path.basename(start) ?? "animation" + ext) : "animation" + ext,
		);
		if (r && r.err === 0 && r.data) panel.output = r.data.toLowerCase().endsWith(ext) ? r.data : r.data + ext;
	}

	function choosePreset(e: Event) {
		const select = e.target as HTMLSelectElement;
		const v = select.value;
		select.value = "";
		const p = v ? findPreset(v, presets) : undefined;
		if (p) applyPreset(p);
	}

	function addPreset() {
		const n = newPreset.trim();
		if (!n) return;
		if (!savePreset(n)) {
			error = "The preset could not be saved (the panel's storage is full or unavailable).";
			return;
		}
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
		<div class="doc" title={docLabel}><Icon name="file" size={14} /><span>{docLabel}</span></div>
		<div class="bar">
			<span class="with-icon presets">
				<Icon name="bookmarks" />
				<select onchange={choosePreset} aria-label="Apply preset" disabled={busy}>
					<option value="">Presets…</option>
					{#each Object.keys(BUILTIN_PRESETS) as p (p)}<option value={p}>{p}</option>{/each}
					{#if Object.keys(presets).length}
						<option disabled>──────────</option>
						{#each Object.keys(presets) as p (p)}<option value="user:{p}">{p}</option>{/each}
					{/if}
				</select>
			</span>
			{#if busy}
				<button type="button" class="secondary" onclick={() => (cancelled = true)}><Icon name="e-remove" />Cancel</button>
			{:else}
				<button type="button" class="primary" onclick={doExport} disabled={!info.open && inCep}><Icon name="export" />Export</button>
			{/if}
		</div>
		{#if busy}
			<div class="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin="0" aria-valuemax="100">
				<div style="width:{Math.round(progress * 100)}%"></div>
				<span>{message}</span>
			</div>
		{/if}
		{#if error}<div class="error" role="alert"><Icon name="c-warning" /><span>{error}</span></div>{/if}
		{#if notice}<div class="notice" role="status"><Icon name="c-info" /><span>{notice}</span></div>{/if}
	</header>

	<Section title="Output" icon="file-upload" bind:open={panel.open.output}>
		<div class="line"><span class="sub">Format</span><Info topic="format" /></div>
		<div class="formats" role="radiogroup" aria-label="Format" tabindex="-1" onkeydown={formatKey}>
			{#each formats as f (f.id)}
				<button
					type="button"
					role="radio"
					aria-checked={panel.export.format === f.id}
					tabindex={panel.export.format === f.id ? 0 : -1}
					class:on={panel.export.format === f.id}
					title={f.hint}
					onclick={() => (panel.export.format = f.id as typeof panel.export.format)}><Icon name={f.icon} /><span>{f.name}</span></button
				>
			{/each}
		</div>
		<p class="hint">{formats.find((f) => f.id === panel.export.format)?.hint}</p>
		<div class="line">
			<label class="row">
				<span>File</span>
				<span class="file">
					<input type="text" bind:value={panel.output} {placeholder} spellcheck="false" />
					<button type="button" class="only" title="Choose file" aria-label="Choose file" onclick={browse} disabled={!inCep}><Icon name="open-folder" /></button
					>
				</span>
			</label>
			<Info topic="file" />
		</div>
		<div class="line">
			<label class="row">
				<span>Source</span>
				<select bind:value={panel.source}>
					<option value="timeline">Current timeline</option>
					<option value="library">Selected library symbols{info.selectedSymbols?.length ? ` (${info.selectedSymbols.length})` : ""}</option>
					{#if (info.scenes ?? 1) > 1}
						<option value="scenes">All scenes in a row ({info.scenes})</option>
					{/if}
				</select>
			</label>
			<Info topic="source" />
		</div>
		<div class="line">
			<label class="row">
				<span>Frames</span>
				<select bind:value={panel.frames}>
					<option value="all">All</option>
					<option value="current">Current frame</option>
					<option value="range">Range</option>
				</select>
			</label>
			<Info topic="frames" />
		</div>
		{#if panel.frames === "range"}
			<div class="row range">
				<span>From</span>
				<input type="number" min="1" max={info.frameCount ?? 99999} bind:value={panel.rangeStart} aria-label="First frame" />
				<span>to</span>
				<input type="number" min="1" max={info.frameCount ?? 99999} bind:value={panel.rangeEnd} aria-label="Last frame" />
			</div>
			{#if rangeNote}<p class="hint">{rangeNote}</p>{/if}
		{/if}
	</Section>

	{#if panel.export.format !== "static"}
		<Section title="Animation" icon="play-media" bind:open={panel.open.animation}>
			<div class="line">
				<label class="check"><input type="checkbox" bind:checked={panel.export.smooth} /> Smooth tweens</label>
				<Info topic="smooth" />
			</div>
			<div class="line">
				<label class="row">
					<span>Loop</span>
					<select bind:value={panel.export.loop}>
						<option value="auto">Follow timeline (stop() ends)</option>
						<option value="always">Always loop</option>
						<option value="never">Play once</option>
					</select>
				</label>
				<Info topic="loop" />
			</div>
			{#if panel.export.format !== "lottie"}
				<div class="line">
					<label class="row">
						<span>Start</span>
						<select bind:value={panel.export.begin}>
							<option value="auto">Automatically</option>
							<option value="click">On click</option>
							<option value="hover">On hover</option>
							<option value="manual">From script</option>
							{#if !lottie}
								<option value="visible">When visible</option>
								<option value="scroll">On scroll</option>
							{/if}
						</select>
					</label>
					<Info topic="start" />
				</div>
				{#if panel.export.begin === "scroll" && !lottie}
					<div class="line">
						<label class="row">
							<span>Scroll</span>
							<select bind:value={panel.export.scrollRange}>
								<option value="visible">While fully visible</option>
								<option value="crossing">While crossing the screen</option>
								<option value="page">With the whole page</option>
							</select>
						</label>
						<Info topic="scroll" />
					</div>
				{/if}
			{/if}
			{#if !lottie}
				<div class="line">
					<label class="row">
						<span>Delay (s)</span>
						<input type="number" min="0" step="0.1" bind:value={panel.export.delay} />
					</label>
					<Info topic="delay" />
				</div>
			{/if}
			{#if !lottie || (panel.export.format === "dotlottie" && panel.export.begin !== "auto")}
				<div class="line">
					<label class="row">
						<span>Poster</span>
						<select bind:value={panel.export.posterFrame}>
							<option value="first">First frame</option>
							<option value="last">Last frame</option>
						</select>
					</label>
					<Info topic="poster" />
				</div>
			{/if}
			{#if !lottie}
				<div class="line">
					<label class="check"><input type="checkbox" bind:checked={panel.export.reducedMotion} /> Still poster for “reduce motion”</label>
					<Info topic="reducedMotion" />
				</div>
			{:else if panel.export.format === "lottie"}
				<p class="hint">
					Autoplay and looping are set in the Lottie player. After a stop() with movie clips still running, play the marker “intro” once, then “loop”.
				</p>
			{:else}
				<p class="hint">
					The file's state machine “playback” plays it like this (dotlottie-web: <code>stateMachineId: "playback"</code>; from script: fire its event “play”).
				</p>
			{/if}
		</Section>
	{/if}

	<Section title="Graphics &amp; text" icon="shapes" bind:open={panel.open.graphics}>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.export.includeBackground} /> Include stage colour</label>
			<Info topic="background" />
		</div>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.export.embedImages} /> Embed images and sounds</label>
			<Info topic="embed" />
		</div>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.export.textAsOutlines} /> Dynamic text as outlines</label>
			<Info topic="outlines" />
		</div>
		{#if !panel.export.textAsOutlines && !lottie}
			<div class="line">
				<label class="check"><input type="checkbox" bind:checked={panel.export.embedFonts} /> Embed fonts</label>
				<Info topic="fonts" />
			</div>
		{/if}
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.export.includeHiddenLayers} /> Include hidden layers</label>
			<Info topic="hiddenLayers" />
		</div>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.export.includeGuides} /> Include guide layers</label>
			<Info topic="guides" />
		</div>
	</Section>

	<Section title="Images" icon="image" bind:open={panel.open.images}>
		<div class="line">
			<label class="row">
				<span>Photos as</span>
				<select bind:value={panel.export.imageLossy}>
					<option value="jpeg">JPEG (plays everywhere)</option>
					<option value="webp">WebP (smaller)</option>
					<option value="avif">AVIF (smallest)</option>
				</select>
			</label>
			<Info topic="lossy" />
		</div>
		<div class="line">
			<label class="row">
				<span>Lossless as</span>
				<select bind:value={panel.export.imageLossless}>
					<option value="png">PNG (optimised)</option>
					<option value="webp">WebP lossless (smaller)</option>
				</select>
			</label>
			<Info topic="lossless" />
		</div>
		<div class="line">
			<label class="row">
				<span>Quality</span>
				<input type="number" min="0" max="100" bind:value={panel.export.imageQuality} />
				<span class="unit">{panel.export.imageQuality ? "" : "Animate's"}</span>
			</label>
			<Info topic="quality" />
		</div>
		<div class="line">
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
			<Info topic="resolution" />
		</div>
		<div class="line list-head">
			<span class="sub">Bitmaps{bitmaps?.length ? ` (${bitmaps.length})` : ""}</span>
			{#if bitmaps}<button type="button" class="only" title="Read the library again" aria-label="Read the bitmaps again" onclick={loadBitmaps}
					><Icon name="refresh" /></button
				>{/if}
			<Info topic="bitmapList" />
		</div>
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
								<select
									value={choice(panel.export.imageModes, b.name) ?? ""}
									onchange={(e) => {
										const el = e.target as HTMLSelectElement;
										setMode(b.name, el.value);
										// shows what is stored (a name the settings can't keep stays at Animate's)
										el.value = choice(panel.export.imageModes, b.name) ?? "";
									}}
									aria-label="Compression of {b.name}"
								>
									<option value="">{b.compression === "photo" ? "Lossy (Animate)" : "Lossless (Animate)"}</option>
									<option value="lossy">Lossy</option>
									<option value="lossless">Lossless</option>
								</select>
							</td>
							<td class="full">
								<label title="Full size: always every pixel of {b.name}"
									><input
										type="checkbox"
										checked={choice(panel.export.imageFullSize, b.name) === true}
										onchange={(e) => {
											const el = e.target as HTMLInputElement;
											setFullSize(b.name, el.checked);
											el.checked = choice(panel.export.imageFullSize, b.name) === true;
										}}
									/>Full</label
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</Section>

	<Section title="Sounds" icon="sound" bind:open={panel.open.sounds}>
		<p class="hint">Sounds play only in the <i>JS player</i> format (and <i>Automatic</i>, which picks it for documents with sounds).</p>
		<div class="line">
			<label class="row">
				<span>Compressed as</span>
				<select bind:value={panel.export.soundFormat}>
					<option value="mp3">MP3 (plays everywhere)</option>
					<option value="opus">Opus (smaller; Safari 18.4+)</option>
				</select>
			</label>
			<Info topic="soundFormat" />
		</div>
		<div class="line">
			<label class="row">
				<span>Bit rate</span>
				<input type="number" min="0" max="320" step="8" bind:value={panel.export.soundBitrate} />
				<span class="unit">{panel.export.soundBitrate ? "kbps" : "Animate's"}</span>
			</label>
			<Info topic="bitrate" />
		</div>
		<div class="line list-head">
			<span class="sub">Sounds{sounds?.length ? ` (${sounds.length})` : ""}</span>
			{#if sounds}<button type="button" class="only" title="Read the library again" aria-label="Read the sounds again" onclick={loadSounds}
					><Icon name="refresh" /></button
				>{/if}
			<Info topic="soundList" />
		</div>
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
								<select
									value={choice(panel.export.soundModes, snd.name) ?? ""}
									onchange={(e) => {
										const el = e.target as HTMLSelectElement;
										setSoundMode(snd.name, el.value);
										el.value = choice(panel.export.soundModes, snd.name) ?? "";
									}}
									aria-label="Compression of {snd.name}"
								>
									<option value="">{snd.compression === "raw" ? "Uncompressed (Animate)" : "Compressed (Animate)"}</option>
									<option value="lossy">Compressed</option>
									<option value="lossless">Uncompressed (WAV)</option>
								</select>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</Section>

	<Section title="Advanced" icon="gear" bind:open={panel.open.advanced}>
		{#if !lottie}
			<div class="line">
				<label class="row">
					<span>Size</span>
					<select bind:value={panel.export.scale}>
						<option value="fixed">Stage size</option>
						<option value="fit">Fill the space, show all</option>
						<option value="fill">Fill the space, no border</option>
						<option value="stretch">Stretch to the space</option>
					</select>
				</label>
				<Info topic="size" />
			</div>
		{/if}
		<div class="line">
			<label class="row">
				<span>Decimals</span>
				<input type="number" min="0" max="6" bind:value={panel.export.digits} />
			</label>
			<Info topic="digits" />
		</div>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.export.pretty} /> Indent output</label>
			<Info topic="pretty" />
		</div>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.export.svgz} disabled={lottie} /> Compressed .svgz</label>
			<Info topic="svgz" />
		</div>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.rememberInDocument} /> Remember settings in the FLA</label>
			<Info topic="remember" />
		</div>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.openAfterExport} /> Open in browser after export</label>
			<Info topic="openAfter" />
		</div>
		<div class="line">
			<label class="check"><input type="checkbox" bind:checked={panel.keepScene} /> Keep the scene data (for the command line)</label>
			<Info topic="keepScene" />
		</div>
		<div class="line preset-add">
			<input
				type="text"
				placeholder="Save current settings as…"
				aria-label="Preset name"
				maxlength="60"
				bind:value={newPreset}
				onkeydown={(e) => e.key === "Enter" && addPreset()}
			/>
			<button type="button" class="secondary" onclick={addPreset} disabled={!newPreset.trim()}><Icon name="floppy-disk" />Save</button>
			<Info topic="presets" />
		</div>
		{#each Object.keys(presets) as p (p)}
			<div class="row preset">
				<span><Icon name="bookmarks" />{p}</span><button
					type="button"
					class="only"
					title="Delete preset"
					aria-label="Delete preset {p}"
					onclick={() => removePreset(p)}><Icon name="trash" /></button
				>
			</div>
		{/each}
		<button type="button" class="link" onclick={resetSettings}><Icon name="undo" />Reset all settings</button>
	</Section>

	{#if result}
		<Section title="Result" icon="c-check" bind:open={panel.open.preview}>
			<div class="stats">
				{result.files.length} file{result.files.length > 1 ? "s" : ""} · {kb(result.output.reduce((n, o) => n + o.stats.bytes, 0))} · {result.seconds.toFixed(
					1,
				)} s
			</div>
			<div class="actions">
				{#if !/\.(json|lottie|svgz)$/i.test(result.files[0] ?? "")}<button type="button" class="secondary" onclick={() => openInBrowser(result!.files[0]!)}
						><Icon name="globe" />Open in browser</button
					>{/if}
				<button type="button" class="secondary" onclick={() => revealInExplorer(result!.files[0]!)}><Icon name="folder" />Show file</button>
			</div>
			<div class="line"><span class="sub">Size by content</span><Info topic="budget" /></div>
			<Budget {result} />
			{#if result.format === "lottie" || result.format === "dotlottie"}<LottiePreview file={result.files[0]!} format={result.format} />{:else}<Preview
					file={result.files[0]!}
					format={result.format}
				/>{/if}
			{#if result.images.length}
				<details class="warnings">
					<summary
						><Icon name="image" />{result.images.length} image{result.images.length > 1 ? "s" : ""}: {kb(
							result.images.reduce((n, i) => n + i.bytes, 0),
						)}</summary
					>
					<ul>
						{#each result.images as i (i.name)}
							<li>
								{i.name}: {i.format === "original" ? "JPEG from Animate" : i.format.toUpperCase()}{i.mode === "lossless" ? " (lossless)" : ""}{i.width <
									i.sourceWidth || i.height < i.sourceHeight
									? `, ${i.width}×${i.height} of ${i.sourceWidth}×${i.sourceHeight}`
									: ""}, {kb(i.bytes)}
							</li>
						{/each}
					</ul>
				</details>
			{/if}
			{#if result.sounds.length}
				<details class="warnings">
					<summary
						><Icon name="sound" />{result.sounds.length} sound{result.sounds.length > 1 ? "s" : ""}: {kb(
							result.sounds.reduce((n, i) => n + i.bytes, 0),
						)}</summary
					>
					<ul>
						{#each result.sounds as i (i.name)}
							<li>
								{i.name}: {SOUND_FORMATS[i.format] ?? i.format}{i.kbps ? ` ${i.kbps} kbps` : ""}{i.channels === 1 ? " mono" : ""}, {i.seconds.toFixed(2)} s, {kb(
									i.bytes,
								)}
							</li>
						{/each}
					</ul>
				</details>
			{/if}
			{#if result.warnings.length}
				<details class="warnings">
					<summary><Icon name="warning-sign" />{result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}</summary>
					<ul>
						{#each result.warnings as w (w)}<li>{w}</li>{/each}
					</ul>
				</details>
			{/if}
		</Section>
	{/if}
</main>
<Tooltip />
