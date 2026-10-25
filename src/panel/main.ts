// Animate 2022/2023 run CEP 11 (Chromium 88), which predates structuredClone.
if (typeof globalThis.structuredClone !== "function") {
	(globalThis as { structuredClone?: unknown }).structuredClone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
}

import { mount } from "svelte";
import App from "./App.svelte";
import "./panel.css";

mount(App, { target: document.getElementById("app")! });
