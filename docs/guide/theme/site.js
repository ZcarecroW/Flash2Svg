// Flash2SVG guide: theme, menu, copy buttons, demo tabs, search. No dependencies; lottie-web is
// loaded only when a Lottie tab is opened.
(() => {
	const root = document.documentElement;
	const store = (k, v) => {
		try {
			if (v === undefined) return localStorage.getItem(k);
			localStorage.setItem(k, v);
		} catch {
			/* private mode: per-visit only */
		}
	};

	// ------------------------------------------------------------ theme
	document.querySelector(".top__theme")?.addEventListener("click", () => {
		const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
		root.dataset.theme = dark ? "light" : "dark";
		store("f2s-theme", root.dataset.theme);
	});

	// ------------------------------------------------------------ menu (narrow screens)
	const nav = document.getElementById("nav");
	const menu = document.querySelector(".top__menu");
	menu?.addEventListener("click", () => {
		const open = nav.classList.toggle("open");
		menu.setAttribute("aria-expanded", String(open));
	});

	// ------------------------------------------------------------ copy code
	for (const b of document.querySelectorAll(".code__copy"))
		b.addEventListener("click", async () => {
			await navigator.clipboard.writeText(b.nextElementSibling.textContent);
			b.classList.add("done");
			setTimeout(() => b.classList.remove("done"), 1500);
		});

	// ------------------------------------------------------------ demos: one tab per format
	let lottieReady = null;
	const lottie = () =>
		(lottieReady ??= new Promise((ok, fail) => {
			const s = document.createElement("script");
			s.src = document.querySelector('script[src*="site."]').src.replace(/site\.[^/]+$/, "lottie_svg.min.js");
			s.onload = () => ok(window.lottie);
			s.onerror = fail;
			document.head.appendChild(s);
		}));
	const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const startLottie = async (box) => {
		const l = await lottie();
		const a = l.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: !still, path: box.dataset.src });
		box._anim = a;
	};
	for (const fig of document.querySelectorAll(".demo")) {
		const stage = fig.querySelector(".demo__stage");
		const get = fig.querySelector(".demo__get");
		const alt = fig.querySelector("figcaption")?.textContent || `${fig.dataset.demo} demo`;
		for (const tab of fig.querySelectorAll("[role=tab]"))
			tab.addEventListener("click", () => {
				for (const t of fig.querySelectorAll("[role=tab]")) t.setAttribute("aria-selected", String(t === tab));
				const { format, src } = tab.dataset;
				stage.querySelector(".demo__lottie")?._anim?.destroy();
				const [w, h] = (stage.style.aspectRatio || "16/9").split("/").map((x) => x.trim());
				let el;
				if (format === "player") {
					el = document.createElement("object");
					el.type = "image/svg+xml";
					el.data = src;
					el.setAttribute("aria-label", alt);
				} else if (format === "dotlottie") {
					// an archive for the dotLottie players (their 2 MB player isn't worth loading here)
					el = document.createElement("p");
					el.className = "demo__note";
					el.innerHTML = `A <strong>.lottie</strong> archive (${tab.title.split(",")[0]}): <a href="${src}" download>download it</a> and open it in a dotLottie player, for example <a href="https://lottiefiles.com/preview" rel="noopener">lottiefiles.com/preview</a>.`;
				} else if (format === "lottie") {
					el = document.createElement("div");
					el.className = "demo__lottie";
					el.dataset.src = src;
					el.setAttribute("role", "img");
					el.setAttribute("aria-label", alt);
				} else {
					el = new Image(+w, +h);
					el.src = src;
					el.alt = alt;
				}
				stage.replaceChildren(el);
				if (format === "lottie") startLottie(el);
				if (get) get.href = src;
			});
		const first = stage.querySelector(".demo__lottie");
		if (first) startLottie(first);
	}

	// ------------------------------------------------------------ search
	const q = document.getElementById("q");
	const hits = document.querySelector(".search__hits");
	let index = null;
	const load = () => (index ??= fetch(new URL("search.json", document.baseURI)).then((r) => r.json()));
	q?.addEventListener("focus", load, { once: true });
	let sel = -1;
	const show = (list) => {
		hits.replaceChildren(
			...list.map((h, i) => {
				const li = document.createElement("li");
				const a = document.createElement("a");
				a.href = h.href;
				a.setAttribute("role", "option");
				a.setAttribute("aria-selected", String(i === sel));
				a.innerHTML = `${h.title}<small></small>`;
				a.querySelector("small").textContent = h.sub;
				li.appendChild(a);
				return li;
			}),
		);
		hits.hidden = !list.length;
	};
	let results = [];
	q?.addEventListener("input", async () => {
		const words = q.value.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
		sel = -1;
		if (!words.length) return show((results = []));
		const pages = await load();
		const scored = [];
		for (const p of pages) {
			const text = p.x.toLowerCase();
			if (!words.every((w) => text.includes(w) || p.t.toLowerCase().includes(w))) continue;
			let score = words.reduce((n, w) => n + (p.t.toLowerCase().includes(w) ? 10 : 0), 0);
			// the heading closest to the words
			let best = null;
			for (const [id, h] of p.h) {
				const s = words.filter((w) => h.toLowerCase().includes(w)).length;
				if (s && (!best || s > best.s)) best = { id, h, s };
			}
			if (best) score += best.s * 5;
			const at = text.indexOf(words[0]);
			const snippet = at >= 0 ? p.x.slice(Math.max(0, at - 40), at + 80).trim() : "";
			scored.push({ score, title: best ? `${p.t} › ${best.h}` : p.t, href: `${p.p}.html${best ? `#${best.id}` : ""}`, sub: snippet ? `…${snippet}…` : "" });
		}
		results = scored.sort((a, b) => b.score - a.score).slice(0, 8);
		show(results);
	});
	q?.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			sel = Math.max(0, Math.min(results.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
			show(results);
		} else if (e.key === "Enter" && results[Math.max(0, sel)]) location.href = results[Math.max(0, sel)].href;
		else if (e.key === "Escape") {
			q.value = "";
			show((results = []));
		}
	});
	document.addEventListener("click", (e) => {
		if (!e.target.closest(".search")) hits.hidden = true;
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "/" && document.activeElement !== q && !e.target.closest("input, textarea")) {
			e.preventDefault();
			q.focus();
		}
	});

	// ------------------------------------------------------------ "on this page": the section in view
	const toc = [...document.querySelectorAll(".toc a")];
	if (toc.length && "IntersectionObserver" in window) {
		const byId = new Map(toc.map((a) => [a.hash.slice(1), a]));
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries)
					if (e.isIntersecting) {
						for (const a of toc) a.removeAttribute("aria-current");
						byId.get(e.target.id)?.setAttribute("aria-current", "true");
					}
			},
			{ rootMargin: "-10% 0px -75% 0px" },
		);
		for (const id of byId.keys()) {
			const h = document.getElementById(id);
			if (h) io.observe(h);
		}
	}
})();
