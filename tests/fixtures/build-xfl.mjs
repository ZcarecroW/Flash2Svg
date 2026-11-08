// Writes the test documents JSFL can't make as XFL folders (tests/fixtures/xfl/<name>/): armatures,
// variable-width strokes, art and pattern brushes. build-fixtures.jsfl opens them in Animate and
// saves them as FLA.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HEAD = `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://ns.adobe.com/xfl/2008/"`;

/** A folder Animate opens as a document. `library`: file name -> content of LIBRARY; `root`: other files next to DOMDocument.xml. */
function writeXfl(root, name, dom, library = {}, files = {}) {
	const dir = join(root, name);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(join(dir, "LIBRARY"), { recursive: true });
	writeFileSync(join(dir, name + ".xfl"), "PROXY-CS5");
	writeFileSync(join(dir, "DOMDocument.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n${dom}\n`);
	for (const [file, xml] of Object.entries(library)) writeFileSync(join(dir, "LIBRARY", file), xml);
	for (const [file, xml] of Object.entries(files)) writeFileSync(join(dir, file), xml);
}

/** `extra`: markup before the symbols (brush definitions). */
const documentTag = (w, h, fps, symbols, body, extra = "") =>
	`<DOMDocument ${HEAD} width="${w}" height="${h}" frameRate="${fps}" currentTimeline="1" xflVersion="23.0" creatorInfo="Adobe Animate" platform="Windows" versionInfo="Saved by Animate Windows 23.0" majorVersion="23" buildNumber="0">${extra}<symbols>${symbols
		.map((s) => `<Include href="${s}.xml"/>`)
		.join("")}</symbols><timelines><DOMTimeline name="Scene 1"><layers>${body}</layers></DOMTimeline></timelines></DOMDocument>`;

/** A one-frame graphic symbol with the given elements. */
const symbolXml = (name, elements, type = "graphic") =>
	`<DOMSymbolItem ${HEAD} name="${name}" symbolType="${type}"><timeline><DOMTimeline name="${name}"><layers><DOMLayer name="Layer_1" color="#4F80FF" current="true" isSelected="true"><frames><DOMFrame index="0" keyMode="9728"><elements>${elements}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;

/** A filled polygon; points in pixels. */
function polygon(points, color) {
	const tw = points.map(([x, y]) => `${Math.round(x * 20)} ${Math.round(y * 20)}`);
	const edges = tw.map((p, i) => `!${p}|${tw[(i + 1) % tw.length]}`).join("");
	return `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="${edges}"/></edges></DOMShape>`;
}

// ------------------------------------------------------------------ matrices
const rotated = (w, x, y) => ({ a: Math.cos(w), b: Math.sin(w), c: -Math.sin(w), d: Math.cos(w), tx: x, ty: y });
function inverse(m) {
	const det = m.a * m.d - m.b * m.c;
	return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, tx: (m.c * m.ty - m.d * m.tx) / det, ty: (m.b * m.tx - m.a * m.ty) / det };
}
/** Applies `f`, then `t`. */
const multiply = (f, t) => ({
	a: t.a * f.a + t.c * f.b,
	b: t.b * f.a + t.d * f.b,
	c: t.a * f.c + t.c * f.d,
	d: t.b * f.c + t.d * f.d,
	tx: t.a * f.tx + t.c * f.ty + t.tx,
	ty: t.b * f.tx + t.d * f.ty + t.ty,
});
const matrixXml = (m) => `<Matrix a="${m.a}" b="${m.b}" c="${m.c}" d="${m.d}" tx="${m.tx}" ty="${m.ty}"/>`;

// ------------------------------------------------------------------ armatures

/**
 * A pose layer of a chain of symbol instances, as Animate stores it: the instances at the first
 * pose, per frame the change of each one (betweenFrameMatrixList), the bones with their poses.
 * `chain`: { name, root: {x, y}, bones: [{ symbol, length }], poses: [{ at, angles: [per bone] }] }
 * Angles are relative to the parent bone and tween linearly from pose to pose.
 */
function armatureLayer({ name, root, bones, poses, frames, color = "#4F4FFF", start = 0, end = frames, locked = false }, ids) {
	const anglesAt = (f) => {
		let i = 0;
		while (i < poses.length - 2 && f >= poses[i + 1].at) i++;
		const p = poses[i],
			q = poses[i + 1] ?? p;
		const u = q === p ? 0 : Math.min(1, (f - p.at) / (q.at - p.at));
		return p.angles.map((v, k) => v + (q.angles[k] - v) * u);
	};
	/** Each bone's joint and direction at a frame. */
	const joints = (f) => {
		const a = anglesAt(f);
		let { x, y } = root,
			w = 0;
		return bones.map((b, i) => {
			w += a[i];
			const j = { x, y, w };
			x += b.length * Math.cos(w);
			y += b.length * Math.sin(w);
			return j;
		});
	};
	const first = joints(0);
	const instances = bones
		.map(
			(b, i) =>
				`<DOMSymbolInstance libraryItemName="${b.symbol}" name="ikNode_${ids + i}"${b.clip ? "" : ` symbolType="graphic" loop="loop"`} referenceID="${guid(ids + i)}"><matrix>${matrixXml(
					rotated(first[i].w, first[i].x, first[i].y),
				)}</matrix><transformationPoint><Point/></transformationPoint></DOMSymbolInstance>`,
		)
		.join("");
	let between = "";
	bones.forEach((_, i) => {
		const base = inverse(rotated(first[i].w, first[i].x, first[i].y));
		for (let f = 0; f < frames; f++) {
			const j = joints(f)[i];
			between += matrixXml(multiply(base, rotated(j.w, j.x, j.y)));
		}
	});
	const list = (fn) => Array.from({ length: frames }, (_, f) => fn(f).toFixed(6)).join(",");
	const durations = poses.map((p, k) => (poses[k + 1]?.at ?? frames) - p.at);
	const node = (i) => {
		const loc = `${(first[i].x / 12.8).toFixed(6)}, ${(first[i].y / 12.8).toFixed(6)}`;
		const x = i ? bones[i - 1].length * 20 : root.x * 20;
		const y = i ? 0 : root.y * 20;
		const states = poses.map((p, k) => `<State duration="${durations[k]}" angle="${p.angles[i]}" x="${x}" y="${y}" blendMode="1"/>`).join("");
		const attrs = `name="ikNode_${ids + i}"${i < bones.length - 1 ? ` boneName="ikBoneName${ids + i}"` : ""} location="${loc}" xArray="${list((f) => joints(f)[i].x * 20)}" yArray="${list((f) => joints(f)[i].y * 20)}" angleArray="${list((f) => joints(f)[i].w)}" referenceID="${guid(ids + i)}" speed="1"`;
		return `<ChildNode ${attrs}><states>${states}</states>${i < bones.length - 1 ? `<childNodes>${node(i + 1)}</childNodes>` : ""}</ChildNode>`;
	};
	const rootLoc = `${(root.x / 12.8).toFixed(6)}, ${(root.y / 12.8).toFixed(6)}`;
	const blank = (index, duration) => (duration > 0 ? `<DOMFrame index="${index}" duration="${duration}" keyMode="9728"><elements/></DOMFrame>` : "");
	return `<DOMLayer name="${name}" color="${color}"${locked ? ` locked="true"` : ""} autoNamed="false" animationType="IK pose" poseLocations="${poses.map((p) => p.at).join(",")}"><frames>${blank(0, start)}<DOMFrame index="${start}" duration="${frames}" tweenType="IK pose" keyMode="9732" isIKPose="true"><elements>${instances}</elements><betweenFrameMatrixList>${between}</betweenFrameMatrixList><IKTree name="${name}" treeName="ikTreeName${ids}"><IKNode name="ikNode_${ids}" boneName="ikBoneName${ids}" location="${rootLoc}" referenceID="${guid(ids)}" speed="1"><childNodes>${node(0)}</childNodes></IKNode><states>${durations.map((d) => `<IKState duration="${d}" blendMode="1"/>`).join("")}</states></IKTree></DOMFrame>${blank(start + frames, end - start - frames)}</frames></DOMLayer>`;
}
const guid = (i) => `0000000${i % 10}-0000-4000-8000-${String(i).padStart(12, "0")}`;

/** A segment from its joint (the registration point) along x. */
const segment = (length, width, color) => polygon([[0, -width / 2], [length, -width / 2], [length, width / 2], [0, width / 2]], color);

/** A movie clip with the given layers. */
const clipXml = (name, layers) => `<DOMSymbolItem ${HEAD} name="${name}"><timeline><DOMTimeline name="${name}"><layers>${layers}</layers></DOMTimeline></timeline></DOMSymbolItem>`;

/** A movie clip of keyframes, each with the given elements for 6 frames. */
const blinkXml = (name, ...keyframes) =>
	clipXml(
		name,
		`<DOMLayer name="Layer_1" color="#4F80FF"><frames>${keyframes.map((e, i) => `<DOMFrame index="${i * 6}" duration="6" keyMode="9728"><elements>${e}</elements></DOMFrame>`).join("")}</frames></DOMLayer>`,
	);

/**
 * A pose layer of a shape with bones, as Animate stores it: a symbol of type "ik container" with
 * the shape of every frame, placed as a graphic; the bones only say how it was made.
 */
function shapeArmatureLayer({ name, container, x, y, frames, poseAt }) {
	const bones = poseAt.length;
	const nodes = Array.from({ length: bones }, (_, i) => {
		const states = poseAt.map((at, k) => `<State duration="${(poseAt[k + 1] ?? frames) - at}" angle="${k % 2 ? 0.5 : -0.5}" x="${i ? 2000 : 0}" y="0"/>`).join("");
		return `<ChildNode name="ikNode_${i + 2}" boneName="ikBoneName${i + 2}" location="${((i * 100) / 12.8).toFixed(6)}, 0.000000" nodeType="lsd" speed="1"><states>${states}</states>`;
	});
	return `<DOMLayer name="${name}" color="#9933CC" autoNamed="false" animationType="IK pose" poseLocations="${poseAt.join(",")}"><frames><DOMFrame index="0" duration="${frames}" tweenType="IK pose" keyMode="9732" isIKPose="true"><elements><DOMSymbolInstance libraryItemName="${container}" name="" symbolType="graphic" loop="play once"><matrix><Matrix tx="${x}" ty="${y}"/></matrix><transformationPoint><Point/></transformationPoint></DOMSymbolInstance></elements><betweenFrameMatrixList>${"<Matrix/>".repeat(frames)}</betweenFrameMatrixList><IKTree name="${name}" treeName="ikTreeName9"><IKNode name="ikNode_1" boneName="ikBoneName1" location="0.000000, 0.000000" nodeType="lsd" speed="1"><childNodes>${nodes.join("<childNodes>")}${"</ChildNode></childNodes>".repeat(bones)}</IKNode><states>${poseAt.map((at, k) => `<IKState duration="${(poseAt[k + 1] ?? frames) - at}"/>`).join("")}</states></IKTree></DOMFrame></frames></DOMLayer>`;
}

/** The container: a strip of `length` px bending by `bendAt(f)` radians per 100 px. */
function bendingStrip(name, frames, length, width, color, bendAt) {
	const N = 24;
	const frame = (f) => {
		const k = bendAt(f) / 100;
		const mid = (s) => (Math.abs(k) < 1e-6 ? [s, 0] : [Math.sin(k * s) / k, (1 - Math.cos(k * s)) / k]);
		const side = (s, off) => {
			const [x, y] = mid(s);
			return [x - off * Math.sin(k * s), y + off * Math.cos(k * s)];
		};
		const pts = [];
		for (let i = 0; i <= N; i++) pts.push(side((i / N) * length, -width / 2));
		for (let i = N; i >= 0; i--) pts.push(side((i / N) * length, width / 2));
		return `<DOMFrame index="${f}" keyMode="9728"><elements>${polygon(pts, color)}</elements></DOMFrame>`;
	};
	return `<DOMSymbolItem ${HEAD} name="${name}" symbolType="ik container"><timeline><DOMTimeline name="${name}"><layers><DOMLayer name="Layer 1" color="#4FFF4F" current="true" isSelected="true"><frames>${Array.from({ length: frames }, (_, f) => frame(f)).join("")}</frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
}

/**
 * A stroked path with a width profile. `markers`: [position 0..1, left, right, corner?], left and
 * right as shares of the stroke's weight (0.5 + 0.5 = its full weight). `edges` in twips.
 */
function widthStroke(edges, weight, color, markers, extra = "") {
	const list = markers.map(([p, l, r, c]) => `<WidthMarker position="${p}" left="${l}" right="${r}"${c ? ` type="corner"` : ""}/>`).join("");
	return `<DOMShape><strokes><StrokeStyle index="1"><SolidStroke scaleMode="normal" weight="${weight}"${extra}><fill><SolidColor color="${color}"/></fill><VariablePointWidth>${list}</VariablePointWidth></SolidStroke></StrokeStyle></strokes><edges><Edge strokeStyle="1" edges="${edges}"/></edges></DOMShape>`;
}
const twips = (x, y) => `${Math.round(x * 20)} ${Math.round(y * 20)}`;
/** Connected straight pieces. */
const lines = (...p) => p.slice(1).map((q, i) => `!${twips(...p[i])}|${twips(...q)}`).join("");
/** Connected quadratic pieces: [start, control, end, control, end, ...]. */
const curves = (...p) => {
	let s = "";
	for (let i = 0; i + 2 < p.length; i += 2) s += `!${twips(...p[i])}[${twips(...p[i + 1])} ${twips(...p[i + 2])}`;
	return s;
};

// ------------------------------------------------------------------ art and pattern brushes

/**
 * Paint brush definitions as Animate keeps them (PaintBrushDefinitions.xml): per brush its
 * parameters as JSON, the art as an SVG document in it. `brushes`: { type: "ArtBrush" |
 * "PatternBrush", name, guid, svg (inner markup), w, h (the art's size), params }.
 */
function brushDefinitions(brushes) {
	const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;");
	const defs = brushes.map((b, i) => {
		const svg = `<?xml version = "1.0" standalone = "no" ?>\n<svg version = "1.1" xmlns = "http://www.w3.org/2000/svg" width = "${b.w}px" height = "${b.h}px">\n<rect x="0" y="0" width="${b.w}" height="${b.h}" fill="none" stroke="none"/>\n${b.svg}\n</svg>\n`;
		const param = { FlashArtBrushMinorVersion: "0", FlashArtBrushVersion: "1", FlashPaintBrushType: b.type, guid: b.guid, maximumTiltWidthPercentage: "", maximumWidthPercentage: "100.00", minimumTiltWidthPercentage: "", minimumWidthPercentage: "100.00", name: b.name, ...b.params, svgData: svg, svgID: "" };
		return `<paintbrushdefinition index="${i + 1}" brushParam='${esc(JSON.stringify(param))}'/>`;
	});
	return `<paintbrushdefinitions ${HEAD}>${defs.join("")}</paintbrushdefinitions>`;
}

/** A drawing of strokes, each made with paint brush `def` (index in the definitions) along `edges` (twips). */
const brushShape = (...strokes) =>
	`<DOMShape><strokes>${strokes
		.map(({ def, weight, color }, i) => `<StrokeStyle index="${i + 1}"><PaintBrushStroke scaleMode="normal" weight="${weight}" paintBrushDefinition="${def}"><fill><SolidColor color="${color}"/></fill></PaintBrushStroke></StrokeStyle>`)
		.join("")}</strokes><edges>${strokes.map(({ edges }, i) => `<Edge strokeStyle="${i + 1}" edges="${edges}"/>`).join("")}</edges></DOMShape>`;
const brushStroke = (edges, def, weight, color) => brushShape({ edges, def, weight, color });

export function buildXflFixtures(root) {
	// art and pattern brushes (the Paint Brush tool), brushes of our own: a leaf stretched along the
	// stroke, a diamond repeated along it; on curves, a line and a symbol that turns and scales
	{
		const brushes = [
			{ type: "ArtBrush", name: "Leaf", guid: "F2500001-0000-4000-8000-000000000001", w: 60, h: 20, svg: `<path d="M 0 10 C 15 -2 45 -2 60 10 C 45 22 15 22 0 10 Z" fill="#000000" stroke="none"/>`, params: { artDirection: "0", diameter: "20", flipArt: "false", foldAdjust: "1", leftEdgePercentage: "20.00", rightEdgePercentage: "80.00", scaleOptionm: "2" } },
			{ type: "PatternBrush", name: "Diamonds", guid: "F2500001-0000-4000-8000-000000000002", w: 12, h: 12, svg: `<path d="M 6 0 L 12 6 L 6 12 L 0 6 Z" fill="#000000" stroke="none"/>`, params: { FlipAcross: "0", FlipAlong: "0", adjustment: "2", cornerValue: "2", spacing: "0" } },
		];
		const layer = (name, frames) => `<DOMLayer name="${name}" color="#4FFF4F"><frames>${frames}</frames></DOMLayer>`;
		const still = (e) => `<DOMFrame index="0" duration="24" keyMode="9728"><elements>${e}</elements></DOMFrame>`;
		const inst = (m) => `<DOMSymbolInstance libraryItemName="brushed" symbolType="graphic" loop="loop"><matrix>${matrixXml(m)}</matrix><transformationPoint><Point/></transformationPoint></DOMSymbolInstance>`;
		writeXfl(
			root,
			"f101-brushes",
			documentTag(
				500,
				400,
				24,
				["brushed"],
				layer("leafCurve", still(brushStroke(curves([40, 80], [140, 0], [240, 80], [340, 160], [440, 80]), 1, 20, "#228844"))) +
					layer("leafLine", still(brushStroke(lines([40, 170], [240, 200]), 1, 30, "#AA4422"))) +
					layer("diamonds", still(brushStroke(curves([260, 220], [360, 160], [460, 240]), 2, 14, "#3355CC"))) +
					layer(
						"turning",
						`<DOMFrame index="0" duration="23" keyMode="22017" tweenType="motion" motionTweenSnap="true"><elements>${inst({ a: 1, b: 0, c: 0, d: 1, tx: 130, ty: 310 })}</elements></DOMFrame><DOMFrame index="23" keyMode="22017"><elements>${inst({ a: 0.6, b: 0.8, c: -1.3, d: 0.75, tx: 130, ty: 310 })}</elements></DOMFrame>`,
					),
				`<brushdefinitions><Include href="PaintBrushDefinitions.xml"/></brushdefinitions>`,
			),
			{ "brushed.xml": symbolXml("brushed", brushShape({ edges: curves([-90, 20], [0, -60], [90, 20]), def: 1, weight: 24, color: "#118899" }, { edges: lines([-90, 40], [90, 40]), def: 2, weight: 12, color: "#AA2266" })) },
			{ "PaintBrushDefinitions.xml": brushDefinitions(brushes) },
		);
	}

	// variable-width strokes (the Width tool): profiles along lines and curves; on a symbol that
	// turns and scales; in a shape tween from one profile to another
	const taper = [[0, 0, 0], [0.5, 0.5, 0.5], [1, 0, 0]];
	const bulge = [[0, 0.5, 0.5], [0.25, 0.1, 0.1], [0.5, 0.8, 0.8], [0.75, 0.1, 0.1], [1, 0.5, 0.5]];
	const lopsided = [[0, 0.1, 0.5], [0.5, 0.9, 0.1], [1, 0.1, 0.5]];
	const shaped = (e) => `<DOMFrame index="0" duration="24" keyMode="9728"><elements>${e}</elements></DOMFrame>`;
	const plainLayer = (name, frames) => `<DOMLayer name="${name}" color="#4FFF4F"><frames>${frames}</frames></DOMLayer>`;
	writeXfl(
		root,
		"f70-width",
		documentTag(
			500,
			400,
			24,
			["brushy"],
			plainLayer("line", shaped(widthStroke(lines([30, 40], [230, 40]), 30, "#3366CC", taper))) +
				plainLayer("wave", shaped(widthStroke(curves([260, 60], [320, -20], [380, 60], [440, 140], [480, 40]), 24, "#CC3366", bulge))) +
				plainLayer("sided", shaped(widthStroke(curves([30, 150], [130, 80], [230, 150]), 40, "#22AA55", lopsided))) +
				plainLayer("corner", shaped(widthStroke(lines([260, 130], [360, 180], [460, 120]), 26, "#AA7722", [[0, 0.1, 0.1], [0.5, 0.6, 0.6, true], [1, 0.1, 0.1]]))) +
				plainLayer(
					"turning",
					`<DOMFrame index="0" duration="23" keyMode="22017" tweenType="motion" motionTweenSnap="true"><elements><DOMSymbolInstance libraryItemName="brushy" symbolType="graphic" loop="loop"><matrix><Matrix tx="130" ty="290"/></matrix><transformationPoint><Point/></transformationPoint></DOMSymbolInstance></elements></DOMFrame><DOMFrame index="23" keyMode="22017"><elements><DOMSymbolInstance libraryItemName="brushy" symbolType="graphic" loop="loop"><matrix><Matrix a="0.5" b="0.866" c="-1.2" d="0.7" tx="130" ty="290"/></matrix><transformationPoint><Point/></transformationPoint></DOMSymbolInstance></elements></DOMFrame>`,
				) +
				plainLayer(
					"tween",
					`<DOMFrame index="0" duration="23" keyMode="17922" tweenType="shape"><elements>${widthStroke(lines([280, 260], [460, 260]), 30, "#6633AA", taper)}</elements></DOMFrame><DOMFrame index="23" keyMode="17922"><elements>${widthStroke(curves([280, 330], [370, 250], [460, 330]), 30, "#6633AA", bulge)}</elements></DOMFrame>`,
				),
		),
		{ "brushy.xml": symbolXml("brushy", widthStroke(curves([-80, 20], [0, -60], [80, 20]), 28, "#118899", taper)) },
	);
	// armatures inside a movie clip (bones on a clip that plays on), placed twice; on a locked layer,
	// starting after the first frame, ending before the layer does
	writeXfl(
		root,
		"f69-iknested",
		documentTag(
			400,
			300,
			24,
			["walker", "blink", "seg"],
			`<DOMLayer name="clips" color="#FF4FFF"><frames><DOMFrame index="0" duration="48" keyMode="9728"><elements>` +
				`<DOMSymbolInstance libraryItemName="walker" name="a"><matrix><Matrix tx="60" ty="80"/></matrix><transformationPoint><Point/></transformationPoint></DOMSymbolInstance>` +
				`<DOMSymbolInstance libraryItemName="walker" name="b"><matrix><Matrix a="0.7" b="0.3" c="-0.3" d="0.7" tx="230" ty="70"/></matrix><transformationPoint><Point/></transformationPoint></DOMSymbolInstance>` +
				`</elements></DOMFrame></frames></DOMLayer>` +
				armatureLayer(
					{
						name: "Armature_2",
						root: { x: 40, y: 220 },
						start: 6,
						frames: 30,
						end: 48,
						locked: true,
						color: "#FF8000",
						bones: [
							{ symbol: "seg", length: 80 },
							{ symbol: "seg", length: 80 },
						],
						poses: [
							{ at: 0, angles: [-0.4, 0.8] },
							{ at: 29, angles: [0.3, -0.8] },
						],
					},
					20,
				),
		),
		{
			"walker.xml": clipXml(
				"walker",
				armatureLayer(
					{
						name: "Armature_1",
						root: { x: 0, y: 0 },
						frames: 24,
						bones: [
							{ symbol: "blink", clip: true, length: 60 },
							{ symbol: "seg", length: 80 },
						],
						poses: [
							{ at: 0, angles: [0.2, 0.5] },
							{ at: 12, angles: [1.1, -0.9] },
							{ at: 23, angles: [0.2, 0.5] },
						],
					},
					10,
				),
			),
			"blink.xml": blinkXml("blink", segment(60, 14, "#CC3333"), segment(60, 14, "#33AA33")),
			"seg.xml": symbolXml("seg", segment(80, 12, "#3366CC")),
		},
	);
	const wave = (f) => 0.9 * Math.sin((f / 39) * 2 * Math.PI);
	writeXfl(
		root,
		"f68-ikshape",
		documentTag(
			500,
			300,
			24,
			["lsd_1"],
			shapeArmatureLayer({ name: "Armature_9", container: "lsd_1", x: 80, y: 150, frames: 40, poseAt: [0, 10, 30, 39] }) +
				`<DOMLayer name="below" color="#FFFF4F"><frames><DOMFrame index="0" duration="40" keyMode="9728"><elements>${polygon([[20, 20], [480, 20], [480, 280], [20, 280]], "#FFF4E0")}</elements></DOMFrame></frames></DOMLayer>`,
		),
		{ "lsd_1.xml": bendingStrip("lsd_1", 40, 320, 40, "#CC3366", wave) },
	);
	writeXfl(
		root,
		"f67-ik",
		documentTag(
			550,
			400,
			24,
			["seg", "hand", "dot"],
			// a plain layer above and below: the armature keeps its place in the stacking order
			`<DOMLayer name="above" color="#FF4FFF"><frames><DOMFrame index="0" duration="60" keyMode="9728"><elements><DOMSymbolInstance libraryItemName="dot" symbolType="graphic" loop="loop"><matrix><Matrix tx="150" ty="200"/></matrix><transformationPoint><Point/></transformationPoint></DOMSymbolInstance></elements></DOMFrame></frames></DOMLayer>` +
				armatureLayer(
					{
						name: "Armature_1",
						root: { x: 100, y: 200 },
						frames: 60,
						bones: [
							{ symbol: "seg", length: 100 },
							{ symbol: "seg", length: 100 },
							{ symbol: "hand", length: 60 },
						],
						poses: [
							{ at: 0, angles: [0, 0, 0] },
							{ at: 20, angles: [-0.6, 1.0, 0.8] },
							{ at: 40, angles: [0.5, -0.9, -0.7] },
							{ at: 59, angles: [0, 0, 0] },
						],
					},
					1,
				) +
				`<DOMLayer name="below" color="#FFFF4F"><frames><DOMFrame index="0" duration="60" keyMode="9728"><elements>${polygon([[20, 20], [530, 20], [530, 380], [20, 380]], "#EEF4FF")}</elements></DOMFrame></frames></DOMLayer>`,
		),
		{
			"seg.xml": symbolXml("seg", segment(100, 20, "#3366CC")),
			"hand.xml": symbolXml("hand", segment(60, 30, "#CC6633")),
			"dot.xml": symbolXml("dot", polygon([[-12, -12], [12, -12], [12, 12], [-12, 12]], "#22AA55")),
		},
	);
}
