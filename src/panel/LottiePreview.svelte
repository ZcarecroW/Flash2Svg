<script lang="ts">
	import Icon from "./Icon.svelte";
	import Info from "./Info.svelte";
	import type { DotLottie } from "@lottiefiles/dotlottie-web";
	import type { AnimationItem } from "lottie-web";
	import { node } from "./lib/cep.ts";
	import { dotLottie, lottieWeb } from "./lib/lottie-players.ts";
	import { STATE_MACHINE_ID } from "../core/statemachine.ts";

	// Plays a Lottie export in lottie-web (JSON) or dotLottie (.lottie, or JSON on request), the
	// .lottie's state machine included: what the people using the file will see.
	let { file, format }: { file: string; format: "lottie" | "dotlottie" } = $props();

	type Player = "lottie-web" | "dotlottie";
	let chosen = $state<Player>("lottie-web");
	const player: Player = $derived(format === "dotlottie" ? "dotlottie" : chosen);
	let interactive = $state(true);
	let box = $state<HTMLDivElement | null>(null);
	let playing = $state(true);
	let frame = $state(0);
	let total = $state(0);
	let fps = $state(24);
	let ratio = $state(4 / 3);
	let hasMachine = $state(false);
	let stateName = $state("");
	let error = $state("");
	let busy = $state(true);
	const machine = $derived(hasMachine && interactive && player === "dotlottie");

	let anim: AnimationItem | null = null;
	let dl: DotLottie | null = null;
	let timer = 0;
	let loads = 0;

	function teardown() {
		clearInterval(timer);
		anim?.destroy();
		anim = null;
		dl?.destroy();
		dl = null;
		if (box) box.textContent = "";
	}

	async function load(target: HTMLDivElement, f: string, p: Player, sm: boolean) {
		const nd = node!;
		const token = ++loads;
		busy = true;
		error = "";
		stateName = "";
		hasMachine = false;
		frame = 0;
		try {
			if (p === "lottie-web") {
				const lottie = await lottieWeb();
				const data = JSON.parse(nd.fs.readFileSync(f, "utf8"));
				// linked bitmaps sit next to the JSON
				const dir = nd.url.pathToFileURL(nd.path.dirname(f)).href + "/";
				for (const a of data.assets ?? []) if (a.p && !a.e && !String(a.p).startsWith("data:")) a.u = dir + (a.u ?? "");
				if (token !== loads) return;
				ratio = data.w / data.h || 4 / 3;
				fps = data.fr || 24;
				total = Math.max(1, (data.op ?? 1) - (data.ip ?? 0));
				anim = lottie.loadAnimation({
					container: target,
					renderer: "svg",
					loop: true,
					autoplay: true,
					animationData: data,
					rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
				});
				playing = true;
				timer = window.setInterval(() => {
					if (anim) frame = anim.currentFrame;
				}, 100);
			} else {
				const Player = await dotLottie();
				const bytes = nd.fs.readFileSync(f);
				if (token !== loads) return;
				const canvas = document.createElement("canvas");
				target.appendChild(canvas);
				const data = format === "dotlottie" ? new Uint8Array(bytes).buffer : bytes.toString("utf8");
				const d = new Player({ canvas, data, loop: true, autoplay: true, renderConfig: { autoResize: true, freezeOnOffscreen: false } });
				dl = d;
				await new Promise<void>((resolve, reject) => {
					d.addEventListener("load", () => resolve());
					d.addEventListener("loadError", (e) => reject(new Error(`dotLottie could not load the file${e.error?.message ? `: ${e.error.message}` : ""}`)));
				});
				if (token !== loads) return;
				const size = d.animationSize();
				ratio = size.width / size.height || 4 / 3;
				total = Math.max(1, d.totalFrames);
				fps = d.duration > 0 ? total / d.duration : 24;
				hasMachine = !!d.manifest?.stateMachines?.some((m) => m.id === STATE_MACHINE_ID);
				if (hasMachine && sm) {
					d.stateMachineLoad(STATE_MACHINE_ID);
					d.stateMachineStart();
				}
				playing = d.isPlaying;
				timer = window.setInterval(() => {
					if (!dl) return;
					frame = dl.currentFrame;
					playing = dl.isPlaying;
					if (hasMachine && sm) stateName = dl.stateMachineGetCurrentState();
				}, 100);
			}
		} catch (e) {
			if (token === loads) error = (e as Error).message;
		} finally {
			if (token === loads) busy = false;
		}
	}

	$effect(() => {
		const target = box,
			f = file,
			p = player,
			sm = interactive;
		if (!target || !node) return;
		void load(target, f, p, sm);
		return () => {
			loads++;
			teardown();
		};
	});

	function toggle() {
		playing = !playing;
		if (anim) playing ? anim.play() : anim.pause();
		if (dl) playing ? dl.play() : dl.pause();
	}

	function seek(e: Event) {
		const f = parseFloat((e.target as HTMLInputElement).value);
		frame = f;
		if (anim) playing ? anim.goToAndPlay(f, true) : anim.goToAndStop(f, true);
		dl?.setFrame(f);
	}

	function restart() {
		dl?.stateMachineStop();
		dl?.stateMachineStart();
	}
</script>

<div class="preview" data-state={busy ? "loading" : error ? "error" : "ready"}>
	<div class="stage" style:aspect-ratio={ratio} bind:this={box}></div>
	{#if error}<p class="error">{error}</p>{/if}
	<div class="controls">
		<button type="button" class="only" onclick={toggle} disabled={busy || machine} aria-label={playing ? "Pause" : "Play"}
			><Icon name={playing ? "button-pause" : "button-play"} /></button
		>
		<input type="range" min="0" max={Math.max(0, total - 1)} step="1" value={frame} oninput={seek} disabled={busy || machine} aria-label="Frame" />
		<span class="time">{(frame / fps).toFixed(2)}s</span>
	</div>
	<div class="controls">
		{#if format === "lottie"}
			<label class="row">
				<span>Player</span>
				<select bind:value={chosen}>
					<option value="lottie-web">lottie-web</option>
					<option value="dotlottie">dotLottie</option>
				</select>
			</label>
		{/if}
		{#if hasMachine}
			<label class="check"><input type="checkbox" bind:checked={interactive} /> State machine</label>
			<Info topic="stateMachine" />
			{#if machine}
				<span class="time state">{stateName}</span>
				<button type="button" class="only" onclick={restart} title="Start the state machine again" aria-label="Start again"><Icon name="refresh" /></button>
			{/if}
		{/if}
	</div>
</div>
