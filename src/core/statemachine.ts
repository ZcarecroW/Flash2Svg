/**
 * The dotLottie state machine (dotLottie 2.0, s/<id>.json) that plays an export the way the SVG
 * output does: through once and stop, loop, or (a stop() while movie clips keep running) the
 * intro once and then the tail over and over; started automatically, on a click, on hover or by
 * the page (the "play" event input). Players run it when asked for it, e.g. dotlottie-web's
 * `stateMachineId: "playback"`; without it they play the plain animation.
 */
import type { BeginMode } from "./emit/animate.ts";

type Json = Record<string, unknown>;

export const STATE_MACHINE_ID = "playback";

export interface PlaybackPlan {
	/** The animation's id in the archive. */
	animation: string;
	/** Loops as a whole. */
	loop: boolean;
	begin: BeginMode;
	/** Marker names: the first pass up to the tail and the tail (a stop() with running clips), the frame shown before the start. */
	intro?: string;
	tail?: string;
	poster?: string;
}

/** The state machine (stills need none). */
export function playbackStateMachine(p: PlaybackPlan): Json {
	// a state entered again keeps the frame it was at: the first one starts at frame 0
	const play = (name: string, extra: Json): Json => ({
		name,
		type: "PlaybackState",
		animation: p.animation,
		autoplay: true,
		...extra,
		transitions: [] as Json[],
	});
	const states: Json[] = [];
	const inputs: Json[] = [];
	const interactions: Json[] = [];
	const onEvent = (input: string, toState: string): Json => ({ type: "Transition", toState, guards: [{ type: "Event", inputName: input }] });
	let first: string;
	if (p.intro && p.tail) {
		// stop(): the intro once, then the tail
		states.push(play("intro", { segment: p.intro, loop: false }), play("tail", { segment: p.tail, loop: true }));
		(states[0]!.transitions as Json[]).push(onEvent("introDone", "tail"));
		inputs.push({ type: "Event", name: "introDone" });
		interactions.push({ type: "OnComplete", stateName: "intro", actions: [{ type: "Fire", inputName: "introDone" }] });
		first = "intro";
	} else {
		states.push(play("play", { loop: p.loop }));
		first = "play";
	}
	states[0]!.entryActions = [{ type: "SetFrame", value: 0 }];
	if (p.begin === "auto") return { initial: first, states, ...(inputs.length ? { inputs } : {}), ...(interactions.length ? { interactions } : {}) };
	// the poster until the start; "play" (a click, hover or the page) starts and restarts it
	inputs.push({ type: "Event", name: "play" });
	const idle: Json = { name: "idle", type: "PlaybackState", animation: p.animation, autoplay: false, loop: false, transitions: [onEvent("play", first)] };
	if (p.poster) idle.segment = p.poster;
	for (const s of states) (s.transitions as Json[]).unshift(onEvent("play", first));
	if (p.begin === "click") interactions.push({ type: "Click", actions: [{ type: "Fire", inputName: "play" }] });
	if (p.begin === "hover") interactions.push({ type: "PointerEnter", actions: [{ type: "Fire", inputName: "play" }] });
	return { initial: "idle", states: [idle, ...states], inputs, interactions };
}
