/**
 * Labels as states, buttons as transitions: the dotLottie state machine for a root timeline that
 * Animate's code snippets make interactive (snippets.ts). The .lottie then holds the whole root
 * timeline (not only the first pass): every place playback can start — frame 1, the targets of
 * frame-script jumps and of the buttons — is a state that plays a segment up to the next stop(),
 * jump or the end (where Flash goes round to frame 1). gotoAndStop targets are still states.
 * Clicks on named instances fire the jumps (dotLottie Click interactions with the layer's name,
 * which is the instance's); web pages open with OpenUrl. Other actions are warned about.
 */
import type { FrameAction, Program } from "./program.ts";
import type { HandlerAction } from "./snippets.ts";

type Json = Record<string, unknown>;

export interface InteractivePlan {
	/** markers to add: name, start frame, duration (dotLottie plays [tm, tm + dr]) */
	markers: { cm: string; tm: number; dr: number }[];
	stateMachine: Json;
	warnings: string[];
}

/** True if the root timeline has mouse handlers a state machine can follow. */
export function hasRootInteractions(prog: Program): boolean {
	return !!prog.interactions?.some((i) => i.on && (i.event === "click" || i.event === "down" || i.event === "up") && i.actions.some(followed));
}

const followed = (a: HandlerAction) => a.type === "url" || (a.type === "goto" && (a.target === "" || a.target === "/"));

export function interactiveStateMachine(prog: Program, animation: string): InteractivePlan {
	const n = prog.frameCount;
	const warnings: string[] = [];
	const resolve = (t: number | string): number | null => {
		if (typeof t === "number") return t >= 1 && t <= n ? t - 1 : null;
		const l = prog.labels.find((x) => x.name === t);
		return l ? l.frame : null;
	};
	// where playback can start: [frame, plays]
	const entries = new Map<string, { frame: number; play: boolean }>();
	const entry = (frame: number, play: boolean) => {
		const name = play ? `f${frame + 1}` : `still${frame + 1}`;
		if (!entries.has(name)) entries.set(name, { frame, play });
		return name;
	};
	const first = entry(0, true);
	const actionsAt = (f: number): FrameAction[] => (prog.actions[f] ?? []).filter((a) => !a.passes);
	// each playing state: up to a stop(), a jump, or the end
	const segments = new Map<string, { end: number; next: string | null }>();
	const pending = [first];
	const walk = (name: string) => {
		const { frame } = entries.get(name)!;
		for (let f = frame; f < n; f++) {
			for (const a of actionsAt(f)) {
				if (a.type === "stop") return segments.set(name, { end: f, next: null });
				if (a.type === "goto") {
					const t = resolve(a.target);
					if (t === null) continue;
					const to = entry(t, a.play);
					pending.push(to);
					return segments.set(name, { end: f, next: to });
				}
			}
		}
		// the end: Flash goes round to frame 1
		segments.set(name, { end: n - 1, next: first });
	};
	// the buttons' targets
	const clicks: { layer: string; action: Json }[] = [];
	for (const i of prog.interactions ?? []) {
		if (!i.on || !(i.event === "click" || i.event === "down" || i.event === "up")) {
			warnings.push(`The ${i.event} handler on ${i.on || "the timeline"} isn't part of the .lottie state machine (clicks on named instances are)`);
			continue;
		}
		for (const a of i.actions) {
			if (a.type === "url") clicks.push({ layer: i.on, action: { type: "OpenUrl", url: a.url, target: a.window === "_self" ? "_top" : a.window || "_blank" } });
			else if (a.type === "goto" && (a.target === "" || a.target === "/")) {
				const t = resolve(a.frame);
				if (t === null) continue;
				const to = entry(t, a.play);
				pending.push(to);
				clicks.push({ layer: i.on, action: { type: "Fire", inputName: `go_${to}` } });
			} else
				warnings.push(`${a.type}() in the click handler on ${i.on} isn't part of the .lottie state machine (jumps of the root timeline and web pages are)`);
		}
	}
	for (let k = 0; k < pending.length; k++) {
		const name = pending[k]!;
		if (entries.get(name)!.play && !segments.has(name)) walk(name);
	}
	// states and their markers
	const markers: InteractivePlan["markers"] = [];
	const names = [...entries.keys()];
	const inputs: Json[] = names.map((s) => ({ type: "Event", name: `go_${s}` }));
	const interactions: Json[] = [];
	const states: Json[] = names.map((name) => {
		const { frame, play } = entries.get(name)!;
		const seg = play ? segments.get(name)! : { end: frame, next: null };
		const marker = `state ${name}`;
		markers.push({ cm: marker, tm: frame, dr: seg.end - frame });
		const transitions: Json[] = names.map((to) => ({ type: "Transition", toState: to, guards: [{ type: "Event", inputName: `go_${to}` }] }));
		if (play && seg.next && seg.end > frame) {
			inputs.push({ type: "Event", name: `done_${name}` });
			transitions.push({ type: "Transition", toState: seg.next, guards: [{ type: "Event", inputName: `done_${name}` }] });
			interactions.push({ type: "OnComplete", stateName: name, actions: [{ type: "Fire", inputName: `done_${name}` }] });
		}
		// a segment of one frame is a still (dotLottie would play the whole animation for it)
		const plays = play && seg.end > frame;
		return {
			name,
			type: "PlaybackState",
			animation,
			segment: marker,
			autoplay: plays,
			loop: false,
			entryActions: [{ type: "SetFrame", value: frame }],
			transitions,
		};
	});
	for (const c of clicks) interactions.push({ type: "Click", layerName: c.layer, actions: [c.action] });
	return { markers, stateMachine: { initial: first, states, inputs, interactions }, warnings };
}
