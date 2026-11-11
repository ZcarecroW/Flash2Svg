// Finds icon parts that disappear into what is behind them (the user's rule, 2026-11-11). Copy this file into a
// project's tests and call it from Playwright:
//   const bad = await iconContrast(page);              // every visible icon on the page
//   const bad = await iconContrast(page, ".toolbar");  // only icons inside one area
// It measures what is really on screen: the icons are hidden, the viewport is captured, and every painted part
// (fill and stroke, opacity included) is laid over the real pixels behind it, at the exact pixels the part covers
// (SVG isPointInFill / isPointInStroke). Textures, gradients, pseudo-elements and overlays all count, and a part
// drawn on another part of the same icon is judged against that part. The typical (median) pixel decides: every
// part needs 3:1 (WCAG 1.4.11, non-text contrast); soft duo layers (opacity under 1) are decoration and need 1.2:1.
// Skipped: hidden or tiny icons, SVGs over 96 px (diagrams, charts), icons in disabled controls (WCAG exempts inactive controls), logos (class "logo",
// data-logo) and anything inside data-contrast="skip". Parts drawn with <use> or <text>, or painted with a
// gradient or pattern, are reported for a look by eye. Returns one line per problem; empty means all is well.

export async function iconContrast(page, selector = null) {
  const problems = new Set();
  const total = await page.evaluate(tag, selector);
  const done = new Set();
  for (let round = 0; round < 400 && done.size < total; round++) {
    const ids = await page.evaluate(prepare, [...done]);
    if (!ids.measure.length) {
      ids.skip.forEach((i) => done.add(i));
      if (!ids.skip.length) break;
      continue;
    }
    const png = (await page.screenshot({ type: "png", scale: "device" })).toString("base64");
    for (const line of await page.evaluate(measure, { png, ids: ids.measure })) problems.add(line);
    [...ids.measure, ...ids.skip].forEach((i) => done.add(i));
  }
  await page.evaluate(() => document.querySelectorAll("[data-icx]").forEach((e) => e.removeAttribute("data-icx")));
  return [...problems];
}

// Marks the icons to check with data-icx="<n>" and returns how many.
function tag(selector) {
  const root = selector ? document.querySelector(selector) : document;
  if (!root) return 0;
  let n = 0;
  for (const svg of root.querySelectorAll("svg")) {
    if (svg.parentElement?.closest("svg")) continue; // nested svg: part of its outer icon
    const box = svg.getBoundingClientRect();
    const s = getComputedStyle(svg);
    if (box.width < 4 || box.height < 4 || s.visibility === "hidden" || s.display === "none") continue;
    if (svg.checkVisibility && !svg.checkVisibility({ opacityProperty: true })) continue;
    if (box.width > 96 || box.height > 96) continue; // a diagram, chart or illustration, not an icon
    if (svg.closest("[data-contrast='skip'], [data-logo], :disabled, [aria-disabled='true']") || /logo/i.test(svg.getAttribute("class") ?? "")) continue;
    svg.setAttribute("data-icx", String(n++));
  }
  return n;
}

// Brings the first unchecked icon into view, then hides every unchecked icon that is fully in view and not covered.
function prepare(done) {
  const seen = new Set(done.map(String));
  const left = [...document.querySelectorAll("[data-icx]")].filter((e) => !seen.has(e.getAttribute("data-icx")));
  if (!left.length) return { measure: [], skip: [] };
  left[0].scrollIntoView({ block: "nearest", inline: "nearest" }); // nearest: a hovered control stays under the mouse
  const W = innerWidth;
  const H = innerHeight;
  const measure = [];
  const skip = [];
  for (const svg of left) {
    const r = svg.getBoundingClientRect();
    const inView = r.left >= 0 && r.top >= 0 && r.right <= W && r.bottom <= H;
    const hit = inView ? document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2) : null;
    const mine = hit && (svg.contains(hit) || hit.contains(svg));
    if (inView && mine) {
      svg.dataset.icxVis = svg.style.visibility;
      svg.style.visibility = "hidden";
      measure.push(svg.getAttribute("data-icx"));
    } else if (svg === left[0]) {
      skip.push(svg.getAttribute("data-icx")); // can't be brought into view uncovered
    }
  }
  return { measure, skip };
}

// Shows the icons again and judges every part against the captured pixels behind it.
async function measure({ png, ids }) {
  const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  const shot = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const dpr = bmp.width / innerWidth;
  const one = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    one.clearRect(0, 0, 1, 1);
    one.fillStyle = "#000";
    one.fillStyle = css;
    one.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = one.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const lum = (r, g, b) => {
    const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const x = lum(a[0], a[1], a[2]);
    const y = lum(b[0], b[1], b[2]);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const name = (el) => {
    const host = el.closest("button, a, [role], label, li, td, .tile, .badge, .card-head, .chip, [data-tip]") ?? el.parentElement;
    const text = (host?.getAttribute("aria-label") || host?.getAttribute("data-tip") || host?.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const cls = host && typeof host.className === "string" && host.className.trim() ? "." + host.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const tagName = host ? host.tagName.toLowerCase() + cls : "svg";
    return text ? `${tagName} "${text}"` : tagName;
  };
  const out = [];
  for (const id of ids) {
    const svg = document.querySelector(`[data-icx="${id}"]`);
    if (!svg) continue;
    svg.style.visibility = svg.dataset.icxVis ?? "";
    delete svg.dataset.icxVis;
    const r = svg.getBoundingClientRect();
    const x0 = Math.max(0, Math.floor(r.left * dpr));
    const y0 = Math.max(0, Math.floor(r.top * dpr));
    const x1 = Math.min(bmp.width, Math.ceil(r.right * dpr));
    const y1 = Math.min(bmp.height, Math.ceil(r.bottom * dpr));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 2 || h < 2) continue;
    // What each pixel shows while the parts are painted one by one, starting from the real background.
    const cur = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * bmp.width + (x0 + x)) * 4;
      const d = (y * w + x) * 3;
      cur[d] = shot[s]; cur[d + 1] = shot[s + 1]; cur[d + 2] = shot[s + 2];
    }
    let groupAlpha = 1;
    for (let n = svg; n; n = n.parentElement) groupAlpha *= Number(getComputedStyle(n).opacity);
    const parts = [];
    let eye = "";
    for (const part of svg.querySelectorAll("path, circle, rect, line, polyline, polygon, ellipse, text, use")) {
      if (part.closest("defs, mask, clipPath, symbol, pattern, marker")) continue;
      const ps = getComputedStyle(part);
      if (ps.display === "none" || ps.visibility === "hidden") continue;
      const tagName = part.tagName.toLowerCase();
      if (tagName === "use" || tagName === "text") { eye = `drawn with <${tagName}>`; continue; }
      let alpha = groupAlpha;
      for (let g = part; g && g !== svg; g = g.parentElement) alpha *= Number(getComputedStyle(g).opacity);
      const paints = [];
      for (const prop of ["fill", "stroke"]) {
        const paint = ps[prop];
        if (!paint || paint === "none") continue;
        if (prop === "stroke" && !(parseFloat(ps.strokeWidth) > 0)) continue;
        if (prop === "fill" && tagName === "line") continue;
        if (paint.startsWith("url(")) { eye = "painted with a gradient or pattern"; continue; }
        const c = rgba(paint);
        const a = c[3] * alpha * Number(ps[prop + "Opacity"] || 1);
        if (a > 0.01) paints.push({ prop, c, a });
      }
      if (!paints.length) continue;
      const m = part.getScreenCTM();
      if (!m) continue;
      const inv = m.inverse();
      const px = new Map(); // pixel index -> paint (stroke wins over fill, it is painted on top)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const pt = new DOMPoint((x0 + x + 0.5) / dpr, (y0 + y + 0.5) / dpr).matrixTransform(inv);
        let hitPaint = null;
        for (const p of paints) if (p.prop === "fill" ? part.isPointInFill(pt) : part.isPointInStroke(pt)) hitPaint = p;
        if (hitPaint) px.set(y * w + x, hitPaint);
      }
      if (px.size) parts.push({ part, px, soft: paints.every((p) => p.a < 0.99) });
    }
    // Paint in document order; a part is judged where it stays visible (not covered by a later solid part), and
    // not where it lies on an earlier part of the same icon in the same colour (merged by design, e.g. an outline
    // over its own fill).
    const owner = new Map(); // pixel index -> paint that last covered it solidly
    for (let i = 0; i < parts.length; i++) {
      const { part, px, soft } = parts[i];
      const later = parts.slice(i + 1).flatMap((q) => [...q.px].filter(([, p]) => p.a >= 0.99).map(([k]) => k));
      const covered = new Set(later);
      const ratios = [];
      for (const [k, p] of px) {
        const d = k * 3;
        const under = [cur[d], cur[d + 1], cur[d + 2]];
        const seen = [0, 1, 2].map((j) => p.c[j] * p.a + under[j] * (1 - p.a));
        const below = owner.get(k);
        const merged = below && p.a >= 0.99 && [0, 1, 2].every((j) => Math.abs(below.c[j] - p.c[j]) <= 2);
        if (!covered.has(k) && !merged) ratios.push({ r: ratio(seen, under), under, c: p.c });
        cur[d] = seen[0]; cur[d + 1] = seen[1]; cur[d + 2] = seen[2];
        if (p.a >= 0.99) owner.set(k, p);
      }
      if (!ratios.length) continue;
      ratios.sort((a, b) => a.r - b.r);
      const mid = ratios[Math.floor(ratios.length / 2)];
      const need = soft ? 1.2 : 3;
      if (mid.r < need) {
        const which = part.closest("[data-color='color-2'], .nc-c2") ? "second colour" : soft ? "soft layer" : "main colour";
        out.push(`${name(svg)}: ${which} ${hex(mid.c)} on ${hex(mid.under)} is ${mid.r.toFixed(2)}:1, needs ${need}:1`);
      }
    }
    if (eye) out.push(`${name(svg)}: ${eye}, check it by eye`);
  }
  return out;
}
