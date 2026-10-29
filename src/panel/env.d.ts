declare module "*.css";
declare module "*.svelte" {
	import type { Component } from "svelte";
	const component: Component<Record<string, unknown>>;
	export default component;
}

/** True only in `build.mjs --selftest` builds: release builds contain no self-test code. */
declare const __SELFTEST__: boolean;
