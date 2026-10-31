<script lang="ts">
	import { node } from "./lib/cep.ts";
	import Icon from "./Icon.svelte";

	let { file, format }: { file: string; format: string } = $props();

	let frame = $state<HTMLIFrameElement | null>(null);
	let playing = $state(true);
	let time = $state(0);
	let duration = $state(0);
	let stamp = $state(Date.now());
	let timer = 0;

	const src = $derived(node ? node.url.pathToFileURL(file).href + "?t=" + stamp : "");

	type PlayerApi = { pause(): void; play(): void; seek(t: number): void; totalFrames: number };

	function svgEl(): (SVGSVGElement & { flash2svg?: PlayerApi }) | null {
		try {
			return (frame?.contentDocument?.documentElement as unknown as SVGSVGElement & { flash2svg?: PlayerApi }) ?? null;
		} catch {
			return null;
		}
	}

	function onLoad() {
		const svg = svgEl();
		if (!svg) return;
		// fit the preview: the stage's proportions, the drawing scaled into them (by its viewBox)
		const vb = svg.viewBox?.baseVal;
		if (vb && vb.width && vb.height && frame) {
			frame.style.aspectRatio = `${vb.width} / ${vb.height}`;
			svg.setAttribute("width", "100%");
			svg.setAttribute("height", "100%");
			svg.style.display = "block";
		}
		playing = true;
		const anims = frame?.contentDocument?.getAnimations?.() ?? [];
		const smil = svg.querySelector("animate,animateTransform");
		const dur = smil?.getAttribute("dur");
		duration = dur ? parseFloat(dur) : anims.length ? Number(anims[0]!.effect?.getComputedTiming().duration ?? 0) / 1000 : 0;
		if (svg.flash2svg) {
			let fps = 24;
			try {
				fps = JSON.parse(svg.querySelector('script[type="application/json"]')?.textContent ?? "{}").fps || 24;
			} catch {
				/* keep default */
			}
			duration = svg.flash2svg.totalFrames / fps;
		}
		clearInterval(timer);
		timer = window.setInterval(() => {
			const s = svgEl();
			if (!s || !playing) return;
			if (format === "smil" || format === "css") time = duration ? (s.getCurrentTime?.() ?? 0) % duration : 0;
		}, 100);
	}

	function toggle() {
		const svg = svgEl();
		if (!svg) return;
		playing = !playing;
		const anims = frame?.contentDocument?.getAnimations?.() ?? [];
		if (svg.flash2svg) playing ? svg.flash2svg.play() : svg.flash2svg.pause();
		else {
			if (playing) svg.unpauseAnimations?.();
			else svg.pauseAnimations?.();
			for (const a of anims) playing ? a.play() : a.pause();
		}
	}

	function seek(e: Event) {
		const t = parseFloat((e.target as HTMLInputElement).value);
		time = t;
		const svg = svgEl();
		if (!svg) return;
		if (svg.flash2svg) {
			svg.flash2svg.seek(t);
			if (!playing) svg.flash2svg.pause();
			return;
		}
		svg.setCurrentTime?.(t);
		for (const a of frame?.contentDocument?.getAnimations?.() ?? []) a.currentTime = t * 1000;
	}

	$effect(() => {
		void file;
		stamp = Date.now();
		return () => clearInterval(timer);
	});
</script>

<div class="preview">
	<iframe bind:this={frame} title="Preview" {src} onload={onLoad}></iframe>
	{#if format !== "static" && duration > 0}
		<div class="controls">
			<button type="button" class="only" onclick={toggle} aria-label={playing ? "Pause" : "Play"}
				><Icon name={playing ? "button-pause" : "button-play"} /></button
			>
			<input type="range" min="0" max={duration} step="0.01" value={time} oninput={seek} aria-label="Time" />
			<span class="time">{time.toFixed(2)}s</span>
		</div>
	{/if}
</div>
