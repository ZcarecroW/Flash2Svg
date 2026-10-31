/**
 * <flash2svg-player src="hero.svg"></flash2svg-player> — puts an export into the page as inline
 * SVG, so its scripts run (JS player, code snippets, start triggers) and CSS scroll timelines
 * work, without copying its markup by hand. Loaded when it comes near the screen
 * (`loading="eager"`: at once); its children show until then. The SVG goes into the element
 * itself, not a shadow root: the player finds its <svg> through document.currentScript, which
 * is null inside shadow trees.
 *
 *   element.player      the JS player's API (svg.flash2svg) once loaded, else null
 *   element.svg         the <svg> once loaded
 *   events              "load" (detail: the svg), "error"
 */
const SVG_NS = "http://www.w3.org/2000/svg";

export class Flash2SvgPlayer extends HTMLElement {
	static observedAttributes = ["src"];
	private io: IntersectionObserver | null = null;
	private loaded = "";
	svg: SVGSVGElement | null = null;

	get player(): unknown {
		return (this.svg as unknown as { flash2svg?: unknown } | null)?.flash2svg ?? null;
	}

	connectedCallback() {
		if (!this.style.display) this.style.display = "inline-block";
		this.schedule();
	}

	disconnectedCallback() {
		this.io?.disconnect();
		this.io = null;
	}

	attributeChangedCallback() {
		if (this.isConnected) this.schedule();
	}

	private schedule() {
		this.io?.disconnect();
		const src = this.getAttribute("src");
		if (!src || src === this.loaded) return;
		if (this.getAttribute("loading") === "eager" || typeof IntersectionObserver !== "function") return void this.load(src);
		this.io = new IntersectionObserver(
			(es) => {
				if (!es.some((e) => e.isIntersecting)) return;
				this.io?.disconnect();
				this.io = null;
				void this.load(src);
			},
			{ rootMargin: "200px" },
		);
		this.io.observe(this);
	}

	private async load(src: string) {
		this.loaded = src;
		try {
			const res = await fetch(src);
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			const doc = new DOMParser().parseFromString(await res.text(), "image/svg+xml");
			const root = doc.documentElement;
			if (root.namespaceURI !== SVG_NS || root.localName !== "svg") throw new Error("not an SVG");
			if (this.getAttribute("src") !== src) return;
			const svg = document.importNode(root, true) as unknown as SVGSVGElement;
			// scripts from a parsed document don't run when inserted: new ones do
			const scripts = [...svg.querySelectorAll("script")].filter((s) => !/json/i.test(s.getAttribute("type") ?? ""));
			for (const s of scripts) s.remove();
			this.replaceChildren(svg);
			for (const old of scripts) {
				const s = document.createElementNS(SVG_NS, "script");
				for (const a of old.getAttributeNames()) s.setAttribute(a, old.getAttribute(a)!);
				s.textContent = old.textContent;
				svg.appendChild(s);
			}
			this.svg = svg;
			this.dispatchEvent(new CustomEvent("load", { detail: svg }));
		} catch (e) {
			this.loaded = "";
			this.dispatchEvent(new CustomEvent("error", { detail: e }));
		}
	}
}

if (typeof customElements !== "undefined" && !customElements.get("flash2svg-player")) customElements.define("flash2svg-player", Flash2SvgPlayer);
