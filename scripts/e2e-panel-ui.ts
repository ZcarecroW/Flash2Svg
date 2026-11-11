// The panel's interface without Animate: the built panel (dist/extension/panel) in Edge, with a
// stand-in for Animate's CEP host that reports an open document with bitmaps and sounds.
// Checks, at five panel widths (one to three columns) and on Animate's light and dark backgrounds:
//   - no script errors; every icon resolves to a symbol of the sprite (at most 100 Nucleo icons)
//   - every "i" shows its own text on hover, on keyboard focus and pinned by a click, inside the
//     panel, and closes again (pointer out, Escape, a click elsewhere); its guide link opens the
//     right page, and every guide page and heading named in help.ts exists in docs/guide/dist
//   - nothing wider than the panel; the "i" buttons of a section line up
//   - text contrast (WCAG AA) on the four backgrounds; every icon part 3:1 against what is behind
//     it (scripts/lib/icon-contrast.mjs), in both themes, also with each icon button hovered
//   - presets with any name (also "constructor", "__proto__"), and stored settings from other
//     versions (unknown formats, wrong types) don't break anything
//   - the columns of wide panels, and colour grading: LUTs listed, a missing one explained, added,
//     moved, weighed and removed, the before/after strip (with a stand-in for CEP's Node)
// Usage: node scripts/e2e-panel-ui.ts   (after npm run build)
import { chromium, type Page } from "playwright-core";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GUIDE_URL, HELP } from "../src/panel/lib/help.ts";
import { contrast } from "../src/panel/lib/skin.ts";
// @ts-expect-error (a plain module: the user's check from the nucleo-library skill)
import { iconContrast } from "./lib/icon-contrast.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const panelHtml = join(repo, "dist/extension/panel/index.html");
if (!existsSync(panelHtml)) throw new Error("Build first: npm run build");
const url = pathToFileURL(panelHtml).href;

const problems: string[] = [];
const fail = (m: string) => {
	problems.push(m);
	console.log("  FAIL " + m);
};

// ---- the help texts' guide links point at pages and headings that exist
const guideDist = join(repo, "docs/guide/dist");
if (existsSync(guideDist)) {
	for (const [k, h] of Object.entries(HELP) as [string, { guide?: string }][]) {
		if (!h.guide) continue;
		const [page, anchor] = h.guide.split("#");
		const file = join(guideDist, page!);
		if (!existsSync(file)) fail(`help ${k}: guide page ${page} is missing`);
		else if (anchor && !readFileSync(file, "utf8").includes(`id="${anchor}"`)) fail(`help ${k}: ${page} has no heading #${anchor}`);
	}
} else console.log("  (docs/guide/dist not built: guide links not checked)");

// ---- the sprite: licence limit, and every icon the components name is in it
const sprite = readFileSync(join(repo, "src/panel/icons.svg"), "utf8");
const symbols = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]!));
if (symbols.size > 100) fail(`${symbols.size} Nucleo icons: the licence allows 100 in a public repository`);
const names = [...readFileSync(join(repo, "src/panel/Icon.svelte"), "utf8").matchAll(/\| "([^"]+)"/g)].map((m) => m[1]!);
for (const n of names) if (!symbols.has(n)) fail(`Icon.svelte names "${n}", which isn't in icons.svg`);
for (const s of symbols) if (!names.includes(s)) fail(`icons.svg has "${s}", which Icon.svelte doesn't name (unused icon)`);

const DOC = {
	open: true,
	name: "banner.fla",
	path: "file:///C|/work/banner.fla",
	type: "Flash",
	width: 550,
	height: 400,
	frameRate: 24,
	timeline: "Scene 1",
	isSymbol: false,
	frameCount: 120,
	currentFrame: 0,
	selectedSymbols: ["Button A", "Logo"],
	scenes: 2,
};
const BITMAPS = [
	{ name: "photos/beach sunset at the end of a very long day, final version (2).jpg", width: 4000, height: 3000, compression: "photo", quality: -1 },
	{ name: "icon.png", width: 64, height: 64, compression: "lossless", quality: 0 },
	{ name: "constructor", width: 10, height: 10, compression: "photo", quality: 80 },
	{ name: "__proto__", width: 10, height: 10, compression: "lossless", quality: 0 },
];
const SOUNDS = [
	{ name: "music/loop.mp3", original: "mp3", compression: "mp3", bitRate: 128, importedQuality: true },
	{ name: "beep.wav", original: "raw", compression: "raw", bitRate: 0, importedQuality: false },
];

/** Animate's host as the panel sees it: a skin colour, and answers to the panel's JSFL calls. */
function fakeHost({ bg, doc, bitmaps, sounds }: { bg: [number, number, number]; doc: object; bitmaps: object[]; sounds: object[] }) {
	const w = window as unknown as Record<string, unknown>;
	w.__opened = [];
	w.open = (u: string) => ((w.__opened as string[]).push(u), null);
	w.__adobe_cep__ = {
		getHostEnvironment: () => JSON.stringify({ appSkinInfo: { panelBackgroundColor: { color: { red: bg[0], green: bg[1], blue: bg[2] } }, baseFontSize: 11 } }),
		getSystemPath: () => "file:///C:/fake/extension",
		addEventListener: () => {},
		evalScript(script: string, cb: (r: string) => void) {
			let r = "";
			if (script.includes("typeof Flash2Svg")) r = "true";
			else if (script.includes("Flash2Svg.info()")) r = JSON.stringify(doc);
			else if (script.includes("Flash2Svg.bitmaps()")) r = JSON.stringify(bitmaps);
			else if (script.includes("Flash2Svg.sounds()")) r = JSON.stringify(sounds);
			setTimeout(() => cb(r), 2);
		},
	};
}

const SKINS: Record<string, [number, number, number]> = { dark: [50, 50, 50], darkest: [29, 29, 29], light: [184, 184, 184], lightest: [240, 240, 240] };
const browser = await chromium.launch({ channel: "msedge", headless: true });

async function openPanel(width: number, skin: [number, number, number], storage?: Record<string, string>): Promise<{ page: Page; errors: string[] }> {
	const page = await browser.newPage({ viewport: { width, height: 760 } });
	const errors: string[] = [];
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	page.on("pageerror", (e) => errors.push(e.message));
	await page.addInitScript(fakeHost, { bg: skin, doc: DOC, bitmaps: BITMAPS, sounds: SOUNDS });
	if (storage)
		await page.addInitScript((s: Record<string, string>) => {
			if (!sessionStorage.getItem("seeded")) {
				for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
				sessionStorage.setItem("seeded", "1");
			}
		}, storage);
	await page.goto(url);
	await page.waitForSelector("main section");
	await page.waitForFunction(() => document.querySelector(".doc")?.textContent?.includes("banner.fla"));
	return { page, errors };
}

/** Opens every folded section (and the conditional rows: Start "On scroll"). */
async function unfold(page: Page) {
	for (const b of await page.$$('section h2 button[aria-expanded="false"]')) await b.click();
	const start = page.locator("label.row", { hasText: "Start" }).locator("select");
	if (await start.count()) await start.selectOption("scroll");
	await page.waitForFunction(() => !document.body.textContent?.includes("Reading the library"));
}

const tipVisible = (page: Page) => page.$eval("body", () => !!document.getElementById("tip"));

for (const width of [220, 300, 480, 700, 1100]) {
	for (const skinName of width === 300 ? ["dark", "lightest"] : ["dark"]) {
		const label = `${width}px ${skinName}`;
		console.log(`panel ${label}`);
		const { page, errors } = await openPanel(width, SKINS[skinName]!);
		await unfold(page);

		// icons
		const missing = await page.$$eval("use", (us) => us.map((u) => u.getAttribute("href")!).filter((h) => !document.querySelector(h)));
		if (missing.length) fail(`${label}: icons without a symbol: ${[...new Set(missing)].join(", ")}`);

		// nothing wider than the panel
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		if (overflow > 0) fail(`${label}: the panel scrolls sideways by ${overflow}px`);
		const wide = await page.$$eval("main *", (els) =>
			els
				.filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5 && (e as HTMLElement).offsetParent !== null)
				.map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "")),
		);
		if (wide.length) fail(`${label}: wider than the panel: ${[...new Set(wide)].slice(0, 6).join(", ")}`);

		// the "i" buttons of a section line up at its right edge (of each column, where settings
		// stand two to a row)
		const ragged = await page.$$eval("section", (secs) =>
			secs
				.map((s) => {
					const byColumn = new Map<number, number[]>();
					for (const b of s.querySelectorAll(".line > button.info")) {
						const left = Math.round(b.parentElement!.getBoundingClientRect().left);
						(byColumn.get(left) ?? byColumn.set(left, []).get(left)!).push(Math.round(b.getBoundingClientRect().right));
					}
					const off = [...byColumn.values()].some((xs) => Math.max(...xs) - Math.min(...xs) > 1);
					return off ? s.querySelector("h2")!.textContent!.trim() : "";
				})
				.filter(Boolean),
		);
		// wide panels: sections side by side, the header on one line
		const cols = await page.$$eval(".columns > .col", (c) => c.length);
		const want = width >= 980 ? 3 : width >= 620 ? 2 : 1;
		if (cols !== want) fail(`${label}: ${cols} column(s) of sections, expected ${want}`);
		if (width >= 620) {
			const [doc, bar] = await page.$$eval("header .doc, header .bar", (e) => e.map((x) => x.getBoundingClientRect().top));
			if (Math.abs(doc! - bar!) > 8) fail(`${label}: the header isn't on one line`);
		}
		if (ragged.length) fail(`${label}: the "i" buttons don't line up in ${ragged.join(", ")}`);

		// every "i": hover shows its text inside the panel, leaving closes it
		const infos = await page.$$("button.info");
		const seen = new Set<string>();
		for (const b of infos) {
			const name = (await b.getAttribute("aria-label"))!.replace(/^About /, "");
			const topic = Object.entries(HELP).find(([, h]) => h.label === name);
			if (!topic) {
				fail(`${label}: "i" for "${name}" has no help text`);
				continue;
			}
			seen.add(topic[0]);
			await page.mouse.move(0, 0);
			await page.waitForFunction(() => !document.getElementById("tip"), null, { timeout: 2000 }).catch(() => fail(`${label}: tip didn't close before ${name}`));
			await b.scrollIntoViewIfNeeded();
			await b.hover();
			const shown = await page.waitForSelector("#tip", { timeout: 1500 }).catch(() => null);
			if (!shown) {
				fail(`${label}: hovering "i" ${name} shows no tip`);
				continue;
			}
			const t = await page.$eval("#tip", (el) => {
				const r = el.getBoundingClientRect();
				return {
					text: el.querySelector("p")!.textContent,
					l: r.left,
					r: r.right,
					t: r.top,
					b: r.bottom,
					vw: document.documentElement.clientWidth,
					vh: innerHeight,
				};
			});
			if (t.text !== topic[1].text) fail(`${label}: tip of ${name} shows another text`);
			if (t.l < 0 || t.r > t.vw || t.t < 0 || t.b > t.vh)
				fail(`${label}: tip of ${name} leaves the panel (${t.l.toFixed(0)},${t.t.toFixed(0)})-(${t.r.toFixed(0)},${t.b.toFixed(0)}) of ${t.vw}×${t.vh}`);
			const describedBy = await b.getAttribute("aria-describedby");
			if (describedBy !== "tip") fail(`${label}: "i" ${name} isn't described by its open tip`);
		}
		// (videoBitrate shows with the formats it is for)
		const expected = Object.keys(HELP).filter((k) => !["budget", "stateMachine", "videoBitrate"].includes(k));
		const unseen = expected.filter((k) => !seen.has(k));
		if (unseen.length) fail(`${label}: no "i" found for ${unseen.join(", ")}`);
		await page.mouse.move(0, 0);
		await page.waitForTimeout(300);
		if (await tipVisible(page)) fail(`${label}: the tip stays after the pointer left`);

		if (width === 300 && skinName === "dark") {
			// pinned by a click: stays without the pointer, its link opens the guide, a click elsewhere closes
			const first = page.locator("button.info").first();
			await first.click();
			await page.mouse.move(width - 2, 700);
			await page.waitForTimeout(400);
			if (!(await tipVisible(page))) fail("a clicked tip doesn't stay");
			await page.locator("#tip button.link").click();
			const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
			if (opened[0] !== GUIDE_URL + HELP.format.guide) fail(`the guide link opened ${opened[0]}`);
			if (await tipVisible(page)) fail("the tip stays after its link was clicked");
			await first.click();
			await page.mouse.click(5, 700);
			if (await tipVisible(page)) fail("a click elsewhere doesn't close a pinned tip");
			// keyboard: Tab onto an "i" shows it, Escape closes it
			await page.mouse.click(5, 5);
			let onInfo = false;
			for (let i = 0; i < 40 && !onInfo; i++) {
				await page.keyboard.press("Tab");
				onInfo = await page.evaluate(() => document.activeElement?.classList.contains("info") ?? false);
			}
			if (!onInfo) fail('Tab never reaches an "i"');
			else {
				if (!(await page.waitForSelector("#tip", { timeout: 1000 }).catch(() => null))) fail('keyboard focus on an "i" shows no tip');
				await page.keyboard.press("Escape");
				if (await tipVisible(page)) fail("Escape doesn't close the tip");
			}
		}

		if (width === 300 && skinName === "dark") {
			// the format tiles are a radio group: Tab reaches the chosen one, arrows move the choice
			await page.locator('.formats button[aria-checked="true"]').focus();
			await page.keyboard.press("ArrowRight");
			const after = await page.evaluate(() => [
				document.activeElement?.textContent?.trim(),
				document.querySelector('.formats [aria-checked="true"]')?.textContent?.trim(),
			]);
			if (after[0] !== "CSS" || after[1] !== "CSS") fail(`ArrowRight from SMIL went to ${after.join(" / ")}`);
			await page.keyboard.press("End");
			if ((await page.evaluate(() => document.querySelector('.formats [aria-checked="true"]')?.textContent?.trim())) !== "WebP")
				fail("End doesn't choose the last format");
			await page.keyboard.press("ArrowRight");
			if ((await page.evaluate(() => document.querySelector('.formats [aria-checked="true"]')?.textContent?.trim())) !== "Automatic")
				fail("ArrowRight doesn't wrap around");
			const tabbable = await page.$$eval(".formats button", (bs) => bs.filter((b) => (b as HTMLElement).tabIndex >= 0).length);
			if (tabbable !== 1) fail(`${tabbable} format tiles are in the Tab order, expected 1`);
			await page.locator(".formats button", { hasText: "SMIL" }).click();
		}

		// contrast of the text on this background (WCAG AA 4.5:1)
		const colors = await page.evaluate(() => {
			const c = (sel: string, prop = "color") => {
				const el = document.querySelector(sel);
				return el ? getComputedStyle(el).getPropertyValue(prop) : "";
			};
			return { bg: getComputedStyle(document.body).backgroundColor, fg: c("main"), muted: c(".hint"), sub: c(".sub"), info: c("button.info") };
		});
		const toHex = (s: string) =>
			"#" +
			(s.match(/\d+/g) ?? [])
				.slice(0, 3)
				.map((v) => (+v).toString(16).padStart(2, "0"))
				.join("");
		for (const k of ["fg", "muted", "sub"] as const) {
			const ratio = contrast(toHex(colors[k]), toHex(colors.bg));
			if (ratio < 4.5) fail(`${label}: ${k} text ${colors[k]} on ${colors.bg}: contrast ${ratio.toFixed(2)} < 4.5`);
		}
		if (errors.length) fail(`${label}: script errors: ${errors.join(" | ")}`);
		await page.close();
	}
}

// ---- icons: every part stands out from what is behind it (3:1), in both themes, also hovered
{
	console.log("icon contrast");
	/** The sprite's symbols drawn into each icon (the same pixels): the check measures real parts, not <use>. */
	const inlineIcons = (page: Page) =>
		page.evaluate(() => {
			for (const svg of document.querySelectorAll("svg.icon")) {
				const use = svg.querySelector("use");
				const sym = use && document.getElementById((use.getAttribute("href") ?? "").slice(1));
				if (!use || !sym) continue;
				svg.setAttribute("viewBox", sym.getAttribute("viewBox") ?? "0 0 16 16");
				for (const c of sym.children) svg.appendChild(c.cloneNode(true));
				use.remove();
			}
		});
	for (const skinName of ["dark", "lightest"]) {
		const { page } = await openPanel(700, SKINS[skinName]!);
		await unfold(page);
		await inlineIcons(page);
		for (const line of await iconContrast(page)) fail(`icons, ${skinName}: ${line}`);
		// each enabled button with an icon, hovered (its border and background may change)
		const count = await page.$$eval("button:not(:disabled)", (bs) => bs.filter((b) => b.querySelector("svg.icon")).length);
		for (let i = 0; i < count; i++) {
			const b = page
				.locator("button:not(:disabled)")
				.filter({ has: page.locator("svg.icon") })
				.nth(i);
			if (!(await b.isVisible())) continue;
			await b.scrollIntoViewIfNeeded();
			await b.hover();
			await b.evaluate((x) => x.setAttribute("data-hovered", ""));
			for (const line of await iconContrast(page, "[data-hovered]")) fail(`icons, ${skinName}, hovered: ${line}`);
			await b.evaluate((x) => x.removeAttribute("data-hovered"));
		}
		await page.mouse.move(0, 0);
		await page.close();
	}
}

// ---- contrast on the other UI brightnesses
for (const skinName of ["darkest", "light"]) {
	const { page } = await openPanel(300, SKINS[skinName]!);
	const r = await page.evaluate(() => [
		getComputedStyle(document.body).backgroundColor,
		getComputedStyle(document.querySelector(".doc")!).color,
		getComputedStyle(document.querySelector("main")!).color,
	]);
	const toHex = (s: string) =>
		"#" +
		(s.match(/\d+/g) ?? [])
			.slice(0, 3)
			.map((v) => (+v).toString(16).padStart(2, "0"))
			.join("");
	for (const [what, c] of [
		["muted", r[1]!],
		["text", r[2]!],
	] as const) {
		const ratio = contrast(toHex(c), toHex(r[0]!));
		if (ratio < 4.5) fail(`${skinName}: ${what} ${c} on ${r[0]}: contrast ${ratio.toFixed(2)}`);
	}
	console.log(`panel ${skinName}: contrast checked`);
	await page.close();
}

// ---- presets with awkward names, and stored settings from other versions
{
	console.log("presets and stored settings");
	const stored = {
		"flash2svg.settings.v4": JSON.stringify({
			export: {
				format: "tiff",
				digits: "three",
				loop: "sometimes",
				imageModes: { "a.png": "lossy", "b.png": "blurry", __proto__x: 1 },
				smooth: false,
				extra: 1,
			},
			source: "everything",
			frames: "range",
			rangeStart: 5,
			rangeEnd: null,
			open: { output: "yes", advanced: true },
		}),
		"flash2svg.presets.v4": JSON.stringify({ broken: { format: 42 }, "Old SVG": { format: "css", digits: 4 } }),
	};
	const { page, errors } = await openPanel(300, SKINS.dark!, stored);
	const state = await page.evaluate(() => JSON.parse(localStorage.getItem("flash2svg.settings.v4")!));
	if (state.export.format !== "smil") fail(`an unknown stored format became ${state.export.format}`);
	if (state.export.digits !== 2) fail(`stored digits "three" became ${state.export.digits}`);
	if (state.export.loop !== "auto") fail(`stored loop "sometimes" became ${state.export.loop}`);
	if (state.export.smooth !== false) fail("a valid stored setting (smooth off) was lost");
	if (JSON.stringify(state.export.imageModes) !== '{"a.png":"lossy"}') fail(`stored bitmap modes became ${JSON.stringify(state.export.imageModes)}`);
	if (state.source !== "timeline" || state.frames !== "range" || state.rangeStart !== 5)
		fail(`stored panel fields became ${state.source}/${state.frames}/${state.rangeStart}`);
	if ("extra" in state.export) fail("an unknown stored setting was kept");
	const checked = async (format: string) => page.$eval(`.formats button[aria-checked="true"]`, (b) => b.textContent!.trim()).then((t) => t === format);
	if (!(await checked("SMIL"))) fail("no format button is selected after an unknown stored format");

	await unfold(page);
	// presets named like Object's own properties
	for (const [name, format] of [
		["constructor", "CSS"],
		["__proto__", "JS player"],
		["Web animation (SMIL)", "GIF"],
	] as const) {
		await page.locator(".formats button", { hasText: format }).click();
		await page.fill('input[aria-label="Preset name"]', name);
		await page.locator(".preset-add button", { hasText: "Save" }).click();
		await page.locator(".formats button", { hasText: "Frames" }).click();
		await page.selectOption("header select", `user:${name}`);
		if (!(await checked(format))) fail(`preset "${name}" doesn't apply its format ${format}`);
	}
	const listed = await page.$$eval(".preset > span", (s) => s.map((x) => x.textContent!.trim()));
	for (const n of ["constructor", "__proto__", "Web animation (SMIL)", "Old SVG", "broken"])
		if (!listed.includes(n)) fail(`preset "${n}" isn't listed (${listed.join(", ")})`);
	// the built-in preset of the same name still applies the built-in settings
	await page.selectOption("header select", "Web animation (SMIL)");
	if (!(await checked("SMIL"))) fail("the built-in preset is hidden by a user preset of the same name");
	await page.selectOption("header select", "user:broken");
	if (!(await checked("SMIL"))) fail("a stored preset with a broken format changed the format");
	await page.locator('.preset button[aria-label="Delete preset __proto__"]').click();
	const after = await page.$$eval(".preset > span", (s) => s.map((x) => x.textContent!.trim()));
	if (after.includes("__proto__")) fail("preset __proto__ can't be deleted");
	// per-bitmap choices for names like Object's: "constructor" is stored and shown; "__proto__"
	// can't be kept (Svelte's state drops the key) but breaks nothing: the list shows what is stored
	await page.selectOption('select[aria-label="Compression of constructor"]', "lossless");
	await page.selectOption('select[aria-label="Compression of __proto__"]', "lossy");
	const fullBox = page.locator("tr", { hasText: "__proto__" }).locator('input[type="checkbox"]');
	await fullBox.click();
	if (
		(await fullBox.isChecked()) !==
		!!(await page.evaluate(() =>
			Object.prototype.hasOwnProperty.call(JSON.parse(localStorage.getItem("flash2svg.settings.v4")!).export.imageFullSize, "__proto__"),
		))
	)
		fail('"Full" of the bitmap named __proto__ shows another state than the stored one');
	await page.waitForTimeout(100);
	const modes = await page.evaluate(() => JSON.parse(localStorage.getItem("flash2svg.settings.v4")!).export);
	if (modes.imageModes.constructor !== "lossless") fail(`the choice for a bitmap named constructor wasn't stored: ${JSON.stringify(modes.imageModes)}`);
	if ((await page.inputValue('select[aria-label="Compression of constructor"]')) !== "lossless") fail("the bitmap named constructor doesn't show its choice");
	const shown = await page.inputValue('select[aria-label="Compression of __proto__"]');
	const kept = Object.prototype.hasOwnProperty.call(modes.imageModes, "__proto__") ? modes.imageModes["__proto__"] : "";
	if (shown !== kept) fail(`the bitmap named __proto__ shows "${shown}", stored is "${kept}"`);
	await page.selectOption('select[aria-label="Compression of constructor"]', "");
	const back = await page.evaluate(() => JSON.parse(localStorage.getItem("flash2svg.settings.v4")!).export.imageModes);
	if (Object.prototype.hasOwnProperty.call(back, "constructor")) fail("the choice for constructor can't be taken back");
	// a range typed backwards is explained
	await page.fill('input[aria-label="First frame"]', "90");
	await page.fill('input[aria-label="Last frame"]', "10");
	if (!(await page.locator(".hint", { hasText: "Exports frames 10 to 90" }).count())) fail("a backwards range isn't explained");
	await page.fill('input[aria-label="Last frame"]', "500");
	if (!(await page.locator(".hint", { hasText: "The timeline has 120 frames" }).count())) fail("a range past the end isn't explained");
	if (errors.length) fail(`presets: script errors: ${errors.join(" | ")}`);
	await page.close();
}

// ---- colour grading: the LUT list, with a stand-in for the panel's Node (fs and path)
{
	console.log("colour grading (LUTs)");
	const cube = (kind: "warm" | "invert") => {
		const lines = ["LUT_3D_SIZE 2"];
		for (let b = 0; b < 2; b++)
			for (let g = 0; g < 2; g++)
				for (let r = 0; r < 2; r++) lines.push(kind === "warm" ? `${0.1 + 0.9 * r} ${0.05 + 0.9 * g} ${0.8 * b}` : `${1 - r} ${1 - g} ${1 - b}`);
		return lines.join("\n");
	};
	const page = await browser.newPage({ viewport: { width: 700, height: 760 } });
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	await page.addInitScript(fakeHost, { bg: SKINS.dark!, doc: DOC, bitmaps: BITMAPS, sounds: SOUNDS });
	await page.addInitScript(
		({ files, stored }: { files: Record<string, string>; stored: string }) => {
			const w = window as unknown as Record<string, unknown>;
			const back = (p: string) => p.replace(/\//g, "\\");
			const path = {
				sep: "\\",
				basename: (p: string, ext?: string) => {
					const b = back(p).replace(/^.*\\/, "");
					return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
				},
				dirname: (p: string) => back(p).replace(/\\[^\\]*$/, ""),
				extname: (p: string) => /\.[^.\\]*$/.exec(p)?.[0] ?? "",
				join: (...a: string[]) => a.join("\\"),
				isAbsolute: (p: string) => /^[A-Za-z]:/.test(p),
				normalize: back,
			};
			const fs = {
				statSync: (p: string) => {
					if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
					return { size: files[p]!.length, mtimeMs: 1, isDirectory: () => false };
				},
				readFileSync: (p: string) => new TextEncoder().encode(files[p]!),
			};
			w.require = (m: string) => (m === "fs" ? fs : m === "path" ? path : {});
			w.cep = { fs: { showOpenDialogEx: () => ({ err: 0, data: ["C:\\luts\\invert.cube"] }) } };
			if (!sessionStorage.getItem("seeded")) {
				localStorage.setItem("flash2svg.settings.v4", stored);
				sessionStorage.setItem("seeded", "1");
			}
		},
		{
			files: { "C:\\luts\\warm.cube": cube("warm"), "C:\\luts\\invert.cube": cube("invert") },
			stored: JSON.stringify({
				luts: [{ path: "C:\\luts\\warm.cube", strength: 100, on: true }, { path: "C:\\luts\\gone.cube", strength: 50 }, { path: 42 }],
				open: { colour: true },
			}),
		},
	);
	await page.goto(url);
	await page.waitForSelector(".lut");
	const names = async () => JSON.stringify(await page.$$eval(".lut .name span", (s) => s.map((x) => x.textContent)));
	if ((await names()) !== '["warm.cube","gone.cube"]') fail(`stored LUTs listed as ${await names()}`);
	const err = await page.waitForSelector("section .error", { timeout: 2000 }).catch(() => null);
	if (!err || !(await err.textContent())?.includes("gone.cube isn't there any more")) fail("a missing LUT file isn't explained");
	await page.locator('button[aria-label="Remove gone.cube"]').click();
	if (!(await page.waitForSelector(".swatches", { timeout: 2000 }).catch(() => null))) fail("no before/after strip");
	if (await page.locator("section .error").count()) fail("the error stays after the missing LUT was removed");
	const firstSwatches = () => page.$$eval(".swatches .strip", (s) => s.map((x) => getComputedStyle(x.querySelector("i")!).backgroundColor));
	// the warm LUT: black becomes (0.1, 0.05, 0) = rgb(26, 13, 0)
	const [before, after] = await firstSwatches();
	if (before !== "rgb(0, 0, 0)" || after !== "rgb(26, 13, 0)") fail(`the strip shows ${before} -> ${after} for black`);
	await page.locator("button", { hasText: "Add LUT" }).click();
	if ((await names()) !== '["warm.cube","invert.cube"]') fail(`after adding: ${await names()}`);
	// warm, then inverted: black -> (0.9, 0.95, 1), within a level (the tables are 32-bit floats)
	await page
		.waitForFunction(
			() => {
				const c = getComputedStyle(document.querySelectorAll(".swatches .strip")[1]!.querySelector("i")!).backgroundColor.match(/\d+/g)!.map(Number);
				return [229.5, 242.25, 255].every((v, k) => Math.abs(c[k]! - v) <= 1);
			},
			null,
			{ timeout: 2000 },
		)
		.catch(async () =>
			fail(
				`the strip doesn't follow the second LUT: ${JSON.stringify(await page.$$eval(".swatches .strip i:first-child", (s) => s.map((x) => getComputedStyle(x).backgroundColor)))}`,
			),
		);
	await page.locator('button[aria-label="Move invert.cube up"]').click();
	if ((await names()) !== '["invert.cube","warm.cube"]') fail(`after moving: ${await names()}`);
	await page.locator('input[aria-label="Strength of invert.cube"]').fill("0");
	await page.locator('input[aria-label="Use warm.cube"]').uncheck();
	await page.waitForFunction(() => !document.querySelector(".swatches"), null, { timeout: 2000 }).catch(() => fail("the strip stays with nothing to grade"));
	await page.waitForTimeout(100);
	const kept = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("flash2svg.settings.v4")!).luts));
	const want = JSON.stringify([
		{ path: "C:\\luts\\invert.cube", strength: 0, on: true },
		{ path: "C:\\luts\\warm.cube", strength: 100, on: false },
	]);
	if (kept !== want) fail(`stored LUTs: ${kept}`);
	if (errors.length) fail(`LUTs: script errors: ${errors.join(" | ")}`);
	await page.close();
}

await browser.close();
console.log(problems.length ? `\nPanel UI: ${problems.length} problem(s)` : "\nPanel UI: all good");
process.exitCode = problems.length ? 1 : 0;
