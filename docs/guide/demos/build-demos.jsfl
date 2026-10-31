/*
 * Builds the user guide's demo documents (docs/guide/demos/fla/*.fla): small ActionScript 3
 * animations, each showing a feature. Run by docs/guide/tools/demos.mjs, which then extracts them
 * with the exporter (docs/guide/demos/extract-demos.jsfl) into docs/guide/demos/models/.
 *
 * JSFL is ES3: no JSON, no let/arrow functions, no Object.keys.
 */
(function () {
	var here = fl.scriptURI.replace(/\/[^\/]*$/, "");
	var repo = here.replace(/\/docs\/guide\/demos$/, "");
	var assets = repo + "/tests/fixtures/assets";
	var outDir = here + "/fla";
	FLfile.createFolder(outDir);
	var log = [];
	var only = null;
	if (FLfile.exists(outDir + "/only.txt")) {
		var list = FLfile.read(outDir + "/only.txt").replace(/\s+/g, "");
		if (list) only = "," + list + ",";
	}

	// the guide's palette
	var NAVY = "#14213D", INK = "#0B1226", CORAL = "#FF6B6B", AMBER = "#FFC145", TEAL = "#2EC4B6", SKY = "#4D96FF", VIOLET = "#9B5DE5", WHITE = "#F8FAFC", MIST = "#94A3B8";

	var doc, lib;
	function newDoc(w, h, fps, bg) {
		doc = fl.createDocument("timeline");
		lib = doc.library;
		doc.width = w;
		doc.height = h;
		doc.frameRate = fps;
		doc.backgroundColor = bg || NAVY;
		return doc;
	}
	function tl() { return doc.getTimeline(); }
	function noStroke() { doc.setCustomStroke({ style: "noStroke" }); }
	function fill(color) { doc.setCustomFill({ style: "solid", color: color }); }
	function rect(l, t, r, b, color, round) {
		doc.selectNone();
		fill(color);
		noStroke();
		doc.addNewRectangle({ left: l, top: t, right: r, bottom: b }, round || 0, false, true);
	}
	function oval(cx, cy, rx, ry, color) {
		doc.selectNone();
		fill(color);
		noStroke();
		doc.addNewOval({ left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry }, false, true);
	}
	function radialOval(cx, cy, r, colors, alphas) {
		doc.selectNone();
		doc.setCustomFill({ style: "radialGradient", colorArray: colors, alphaArray: alphas || [100, 100], posArray: [0, 255], matrix: { a: r / 819.2 * 2, b: 0, c: 0, d: r / 819.2 * 2, tx: cx, ty: cy } });
		noStroke();
		doc.addNewOval({ left: cx - r, top: cy - r, right: cx + r, bottom: cy + r }, false, true);
	}
	// Shapes beyond rectangles and ovals: shapes of the same fill drawn over each other merge, and
	// the only shape of a frame can be turned (fl.drawingLayer paths looked drawn but weren't
	// saved with the document; fl.objectDrawingMode can't be switched on from a script).
	function frameElements() {
		var t = tl();
		return t.layers[t.currentLayer].frames[t.currentFrame].elements;
	}
	function paintWith(paint) {
		doc.selectNone();
		if (typeof paint == "function") paint();
		else fill(paint);
		noStroke();
	}
	function square(cx, cy, r) {
		var s = r / Math.SQRT2;
		doc.addNewRectangle({ left: cx - s, top: cy - s, right: cx + s, bottom: cy + s }, 0, false, true);
	}
	/** Turns the frame's only shape. */
	function turn(angle) {
		doc.selectNone();
		doc.selection = frameElements();
		doc.rotateSelection(angle);
		doc.selectNone();
	}
	/** An eight-pointed star on an empty frame: a square turned 45 degrees and another one over it. */
	function star8(cx, cy, r, paint) {
		paintWith(paint);
		square(cx, cy, r);
		turn(45);
		paintWith(paint);
		square(cx, cy, r);
		// one gradient over all of it (the turn turned the first square's)
		if (typeof paint == "function") {
			doc.selection = frameElements();
			paint();
			doc.selectNone();
		}
	}
	/** A square standing on its corner, on an empty frame. */
	function diamond(cx, cy, r, paint) {
		paintWith(paint);
		square(cx, cy, r);
		turn(45);
	}
	/** A cog: a disc with round teeth. */
	function gear(r, teeth, color, hole) {
		oval(0, 0, r * 0.8, r * 0.8, color);
		for (var i = 0; i < teeth; i++) {
			var a = i * 2 * Math.PI / teeth;
			oval(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84, r * 0.17, r * 0.17, color);
		}
		if (hole) oval(0, 0, r * 0.28, r * 0.28, hole);
	}
	function symbol(name, type, drawFn) {
		lib.addNewItem(type, name);
		lib.editItem(name);
		drawFn();
		doc.exitEditMode();
	}
	function layer(name) {
		var t = tl();
		var idx = t.addNewLayer(name, "normal", true);
		t.setSelectedLayers(idx);
		t.currentLayer = idx;
		return idx;
	}
	function place(name, x, y, frame) {
		var t = tl();
		if (frame !== undefined) t.currentFrame = frame;
		doc.selectNone();
		lib.addItemToDocument({ x: x, y: y }, name);
		return doc.selection[0];
	}
	function text(l, t, r, b, s, size, color, opts) {
		opts = opts || {};
		doc.selectNone();
		doc.addNewText({ left: l, top: t, right: r, bottom: b }, s);
		doc.selectNone();
		var tt = tl(), els = tt.layers[tt.currentLayer].frames[tt.currentFrame].elements;
		var el = els[els.length - 1];
		// (always set: a new field takes the text tool's last type)
		el.textType = opts.type || "static";
		if (opts.type && opts.type != "static") el.lineType = opts.multiline ? "multiline" : "single line";
		el.setTextAttr("face", opts.face || "Arial");
		el.setTextAttr("size", size);
		el.setTextAttr("fillColor", color);
		el.setTextAttr("bold", !!opts.bold);
		if (opts.align) el.setTextAttr("alignment", opts.align);
		if (opts.letterSpacing) el.setTextAttr("letterSpacing", opts.letterSpacing);
		return el;
	}
	/** Classic tween on the current layer: `name` at frame `from`, changed by `mod` at frame `to`. */
	function tween(name, x, y, from, to, mod, frameFn) {
		var t = tl(), li = t.currentLayer;
		if (from > 0 && t.layers[li].frameCount < from) t.insertFrames(from - t.layers[li].frameCount, false, t.layers[li].frameCount);
		if (from > 0) { t.insertBlankKeyframe(from); }
		var el = place(name, x, y, from);
		t.insertKeyframe(to);
		t.currentFrame = to;
		mod(t.layers[li].frames[to].elements[0]);
		t.setSelectedFrames(from, from + 1);
		t.createMotionTween();
		if (frameFn) frameFn(t.layers[li].frames[from]);
		return el;
	}
	function extendAll(count) {
		var t = tl();
		for (var i = 0; i < t.layers.length; i++) {
			if (t.layers[i].frameCount < count) {
				t.setSelectedLayers(i);
				t.insertFrames(count - t.layers[i].frameCount, false, t.layers[i].frameCount);
			}
		}
	}
	function cleanup() {
		var t = tl();
		for (var i = t.layers.length - 1; i >= 0; i--) {
			var l = t.layers[i];
			if ((l.name == "Layer_1" || l.name == "Layer 1") && t.layers.length > 1) {
				var empty = true;
				for (var f = 0; f < l.frameCount; f++) if (l.frames[f].elements.length) { empty = false; break; }
				if (empty) t.deleteLayer(i);
			}
		}
	}
	function select(e) { doc.selectNone(); e.selected = true; }
	function build(name, fn) {
		if (only && only.indexOf("," + name + ",") < 0) return;
		try {
			fn();
			cleanup();
			var uri = outDir + "/" + name + ".fla";
			if (FLfile.exists(uri)) FLfile.remove(uri);
			log.push(name + ": " + (fl.saveDocument(doc, uri) ? "saved" : "SAVE FAILED"));
			fl.closeDocument(doc, false);
		} catch (e) {
			log.push(name + ": ERROR " + e + (e.lineNumber ? " line " + e.lineNumber : ""));
			try { fl.closeDocument(doc, false); } catch (e2) {}
		}
	}
	function spinTween(frames) {
		var t = tl();
		t.insertKeyframe(frames - 1);
		t.setSelectedFrames(0, 1);
		t.createMotionTween();
		t.layers[t.currentLayer].frames[0].motionTweenRotate = "clockwise";
		t.layers[t.currentLayer].frames[0].motionTweenRotateTimes = 1;
	}

	// ------------------------------------------------------------------ camera: Animate's camera pans and zooms
	build("camera", function () {
		newDoc(640, 300, 30, "#87CEEB");
		layer("sky");
		doc.selectNone();
		doc.setCustomFill({ style: "linearGradient", colorArray: ["#3B82F6", "#BFE3FF"], posArray: [0, 255], matrix: { a: 0, b: 0.25, c: -0.25, d: 0, tx: 640, ty: 150 } });
		noStroke();
		doc.addNewRectangle({ left: -200, top: -100, right: 1500, bottom: 400 }, 0, false, true);
		layer("sun");
		radialOval(980, 70, 46, ["#FFF7AE", AMBER]);
		layer("far");
		var far = [[60, 130], [520, 120], [1050, 140], [1450, 130]];
		for (var h = 0; h < far.length; h++) oval(far[h][0], far[h][1] + 140, 300, 150, "#7FB685");
		layer("near");
		var near = [[150, 210], [700, 215], [1250, 220]];
		for (h = 0; h < near.length; h++) oval(near[h][0], near[h][1] + 90, 380, 100, "#3E8E5E");
		layer("trees");
		for (var i = 0; i < 9; i++) {
			var x = -100 + i * 170;
			rect(x - 4, 220, x + 4, 250, "#5B3A29");
			oval(x, 200, 22, 30, "#1F6F43");
		}
		extendAll(120);
		var t = tl();
		var cam = t.camera;
		cam.cameraEnabled = true;
		var ci = -1;
		for (i = 0; i < t.layers.length; i++) if (t.layers[i].layerType == "camera" || /camera/i.test(t.layers[i].name)) ci = i;
		t.setSelectedLayers(ci);
		t.insertKeyframe(119);
		t.currentFrame = 119;
		try { cam.setZoom(119, 140); } catch (e) { log.push("camera zoom: " + e); }
		var ce = t.layers[ci].frames[119].elements[0];
		ce.x = ce.x + 620;
		t.setSelectedFrames(0, 1);
		t.createMotionTween();
		t.layers[ci].frames[0].tweenEasing = 30;
	});

	// ------------------------------------------------------------------ morph: shape tweens as one moving drawing
	build("morph", function () {
		newDoc(480, 270, 30);
		layer("shape");
		var t = tl(), li = t.currentLayer;
		function gradient(angle) {
			var r = angle * Math.PI / 180, k = 0.09;
			doc.setCustomFill({ style: "linearGradient", colorArray: [CORAL, AMBER, VIOLET], posArray: [0, 128, 255], matrix: { a: k * Math.cos(r), b: k * Math.sin(r), c: -k * Math.sin(r), d: k * Math.cos(r), tx: 240, ty: 135 } });
			noStroke();
		}
		doc.selectNone(); gradient(0);
		doc.addNewOval({ left: 180, top: 75, right: 300, bottom: 195 }, false, true);
		t.insertBlankKeyframe(36); t.currentFrame = 36;
		doc.selectNone(); gradient(90);
		star8(240, 135, 80, function () { gradient(90); });
		t.insertBlankKeyframe(72); t.currentFrame = 72;
		doc.selectNone(); gradient(180);
		doc.addNewRectangle({ left: 175, top: 70, right: 305, bottom: 200 }, 24, false, true);
		t.insertBlankKeyframe(107); t.currentFrame = 107;
		doc.selectNone(); gradient(360);
		doc.addNewOval({ left: 180, top: 75, right: 300, bottom: 195 }, false, true);
		for (var k = 0; k < 3; k++) {
			t.setSelectedFrames(k * 36, k * 36 + 1);
			t.setFrameProperty("tweenType", "shape");
			t.layers[li].frames[k * 36].tweenEasing = -40;
		}
	});

	// ------------------------------------------------------------------ gears: nested movie clips
	build("gears", function () {
		newDoc(480, 270, 30);
		symbol("big", "movie clip", function () { gear(70, 14, AMBER, NAVY); spinTween(120); });
		symbol("small", "movie clip", function () {
			gear(36, 7, TEAL, NAVY);
			var t = tl();
			t.insertKeyframe(59);
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
			t.layers[0].frames[0].motionTweenRotate = "counter-clockwise";
			t.layers[0].frames[0].motionTweenRotateTimes = 1;
		});
		symbol("light", "movie clip", function () {
			// blinks: on 10 frames, off 10
			oval(0, 0, 6, 6, CORAL);
			var t = tl();
			t.insertBlankKeyframe(10);
			t.insertFrames(9, false, 10);
		});
		layer("gears");
		place("big", 190, 140, 0);
		var s1 = place("small", 296, 88, 0);
		var s2 = place("small", 300, 196, 0);
		s2.rotation = 20;
		layer("lights");
		place("light", 420, 40, 0);
		var l2 = place("light", 444, 40, 0);
		extendAll(1);
	});

	// ------------------------------------------------------------------ scroll: an animation the page's scrolling runs
	build("scroll", function () {
		newDoc(640, 220, 30);
		symbol("wheel", "movie clip", function () { gear(30, 9, AMBER, NAVY); });
		layer("track");
		rect(40, 168, 600, 172, "#22304F");
		layer("fill");
		symbol("bar", "graphic", function () { rect(0, -2, 560, 2, TEAL); });
		tween("bar", 40, 170, 0, 59, function (e) { e.scaleX = 1; }, null).scaleX = 0.002;
		layer("wheel");
		tween("wheel", 70, 132, 0, 59, function (e) { e.x = 570; e.rotation = 0; }, function (f) { f.motionTweenRotate = "clockwise"; f.motionTweenRotateTimes = 3; });
		layer("caption");
		text(40, 30, 600, 70, "Scroll the page", 30, WHITE, { bold: true, align: "center" });
		extendAll(60);
	});

	// ------------------------------------------------------------------ hero: the home page
	build("hero", function () {
		newDoc(640, 360, 30);
		symbol("dot", "graphic", function () { radialOval(0, 0, 9, [WHITE, SKY]); });
		symbol("orbit", "movie clip", function () {
			// three dots on a ring, turning once in 3 s
			var ring = [[CORAL, 0], [AMBER, 120], [TEAL, 240]];
			for (var i = 0; i < ring.length; i++) {
				var a = ring[i][1] * Math.PI / 180;
				oval(Math.cos(a) * 118, Math.sin(a) * 118, 9, 9, ring[i][0]);
			}
			spinTween(90);
		});
		layer("glow");
		radialOval(320, 160, 150, [SKY, NAVY], [45, 0]);
		layer("orbit");
		place("orbit", 320, 160, 0);
		layer("morph");
		var t = tl(), li = t.currentLayer;
		oval(320, 160, 56, 56, CORAL);
		t.insertBlankKeyframe(30); t.currentFrame = 30;
		star8(320, 160, 70, AMBER);
		t.insertBlankKeyframe(60); t.currentFrame = 60;
		diamond(320, 160, 64, TEAL);
		t.insertBlankKeyframe(89); t.currentFrame = 89;
		oval(320, 160, 56, 56, CORAL);
		for (var k = 0; k < 3; k++) {
			t.setSelectedFrames(k * 30, k * 30 + 1);
			t.setFrameProperty("tweenType", "shape");
			t.layers[li].frames[k * 30].tweenEasing = 60;
		}
		symbol("title", "movie clip", function () {
			text(-160, -24, 160, 24, "Flash2SVG", 40, WHITE, { bold: true, align: "center", letterSpacing: 2 });
		});
		layer("title");
		var title = tween("title", 320, 320, 0, 24, function (e) { e.y = 300; select(e); doc.setInstanceAlpha(100); doc.selectNone(); }, function (f) { f.tweenEasing = 100; });
		select(title); doc.setInstanceAlpha(0); doc.selectNone();
		var t2 = tl();
		select(t2.layers[t2.currentLayer].frames[24].elements[0]);
		doc.addFilter("glowFilter");
		doc.setFilterProperty("color", 0, SKY);
		doc.setFilterProperty("blurX", 0, 14);
		doc.setFilterProperty("blurY", 0, 14);
		doc.setFilterProperty("strength", 0, 120);
		doc.selectNone();
		extendAll(90);
	});

	// ------------------------------------------------------------------ easing: Animate's eases, exact
	build("easing", function () {
		newDoc(640, 300, 30);
		symbol("ball", "movie clip", function () { radialOval(0, 0, 15, [WHITE, CORAL]); });
		var rows = [
			["No ease", function (f) { f.tweenEasing = 0; }],
			["Ease in (−100)", function (f) { f.tweenEasing = -100; }],
			["Ease out (100)", function (f) { f.tweenEasing = 100; }],
			["Custom: bounce", function (f) {
				f.hasCustomEase = true;
				f.setCustomEase("all", [{ x: 0, y: 0 }, { x: 0.25, y: 0 }, { x: 0.45, y: 1 }, { x: 0.55, y: 1 }, { x: 0.62, y: 0.78 }, { x: 0.72, y: 0.78 }, { x: 0.78, y: 1 }, { x: 0.84, y: 0.92 }, { x: 0.94, y: 0.92 }, { x: 1, y: 1 }]);
			}],
			["Custom: overshoot", function (f) {
				f.hasCustomEase = true;
				f.setCustomEase("all", [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.55, y: 1.3 }, { x: 1, y: 1 }]);
			}]
		];
		layer("rails");
		for (var i = 0; i < rows.length; i++) rect(170, 48 + i * 52, 610, 50 + i * 52, "#22304F");
		layer("labels");
		for (i = 0; i < rows.length; i++) text(16, 38 + i * 52, 160, 60 + i * 52, rows[i][0], 14, MIST);
		for (i = 0; i < rows.length; i++) {
			layer("ball" + i);
			tween("ball", 180, 49 + i * 52, 0, 44, function (e) { e.x = 600; }, rows[i][1]);
		}
		extendAll(66);
	});

	// ------------------------------------------------------------------ mask: a spotlight over text
	build("mask", function () {
		newDoc(480, 200, 30, INK);
		layer("stripes");
		for (var i = 0; i < 12; i++) rect(i * 40, 0, i * 40 + 20, 200, i % 2 ? "#1F2B4D" : "#26355E");
		var tx = text(20, 60, 460, 140, "MASKS", 96, AMBER, { bold: true, align: "center", letterSpacing: 8 });
		symbol("spot", "graphic", function () { oval(0, 0, 70, 70, WHITE); });
		layer("spot");
		tween("spot", 60, 100, 0, 44, function (e) { e.x = 420; }, function (f) { f.tweenEasing = 40; });
		var t = tl();
		t.insertKeyframe(89);
		t.currentFrame = 89;
		t.layers[t.currentLayer].frames[89].elements[0].x = 60;
		t.setSelectedFrames(44, 45);
		t.createMotionTween();
		t.layers[t.currentLayer].frames[44].tweenEasing = 40;
		var mi = t.currentLayer, ci = mi + 1;
		t.layers[mi].layerType = "mask";
		t.layers[ci].layerType = "masked";
		t.layers[ci].parentLayer = t.layers[mi];
		extendAll(90);
	});

	// ------------------------------------------------------------------ filters: Animate's filters, animated
	build("filters", function () {
		newDoc(600, 220, 30);
		symbol("tile", "movie clip", function () { rect(-44, -44, 44, 44, SKY, 14); rect(-18, -18, 18, 18, WHITE, 6); });
		var specs = [
			["dropShadowFilter", function () { doc.setFilterProperty("distance", 0, 2); doc.setFilterProperty("blurX", 0, 4); doc.setFilterProperty("blurY", 0, 4); }, function () { doc.setFilterProperty("distance", 0, 14); doc.setFilterProperty("blurX", 0, 16); doc.setFilterProperty("blurY", 0, 16); }],
			["glowFilter", function () { doc.setFilterProperty("color", 0, AMBER); doc.setFilterProperty("strength", 0, 40); doc.setFilterProperty("blurX", 0, 6); doc.setFilterProperty("blurY", 0, 6); }, function () { doc.setFilterProperty("color", 0, AMBER); doc.setFilterProperty("strength", 0, 200); doc.setFilterProperty("blurX", 0, 24); doc.setFilterProperty("blurY", 0, 24); }],
			["bevelFilter", function () { doc.setFilterProperty("distance", 0, 2); }, function () { doc.setFilterProperty("distance", 0, 8); doc.setFilterProperty("blurX", 0, 10); doc.setFilterProperty("blurY", 0, 10); }],
			["blurFilter", function () { doc.setFilterProperty("blurX", 0, 0); doc.setFilterProperty("blurY", 0, 0); }, function () { doc.setFilterProperty("blurX", 0, 14); doc.setFilterProperty("blurY", 0, 14); doc.setFilterProperty("quality", 0, "high"); }]
		];
		for (var i = 0; i < specs.length; i++) {
			layer("f" + i);
			var e = tween("tile", 90 + i * 140, 110, 0, 29, function () {}, function (f) { f.tweenEasing = -50; });
			var t = tl(), li = t.currentLayer;
			select(t.layers[li].frames[0].elements[0]); doc.addFilter(specs[i][0]); specs[i][1](); doc.selectNone();
			select(t.layers[li].frames[29].elements[0]); doc.addFilter(specs[i][0]); specs[i][2](); doc.selectNone();
			// and back
			t.insertKeyframe(59);
			t.currentFrame = 59;
			select(t.layers[li].frames[59].elements[0]); doc.removeAllFilters(); doc.addFilter(specs[i][0]); specs[i][1](); doc.selectNone();
			t.setSelectedFrames(29, 30);
			t.createMotionTween();
			t.layers[li].frames[29].tweenEasing = 50;
		}
		extendAll(60);
	});

	// ------------------------------------------------------------------ blend: blend modes
	build("blend", function () {
		newDoc(480, 270, 30, "#0F172A");
		symbol("r", "movie clip", function () { oval(0, 0, 70, 70, "#FF2D55"); });
		symbol("g", "movie clip", function () { oval(0, 0, 70, 70, "#30D158"); });
		symbol("b", "movie clip", function () { oval(0, 0, 70, 70, "#0A84FF"); });
		var parts = [["r", 0], ["g", 120], ["b", 240]];
		for (var i = 0; i < parts.length; i++) {
			layer(parts[i][0]);
			var a = (parts[i][1] - 90) * Math.PI / 180;
			var e = tween(parts[i][0], 240 + Math.cos(a) * 18, 135 + Math.sin(a) * 18, 0, 44, function (el) { el.x = 240 + Math.cos(a) * 62; el.y = 135 + Math.sin(a) * 62; }, function (f) { f.tweenEasing = 60; });
			var t = tl(), li = t.currentLayer;
			t.layers[li].frames[0].elements[0].blendMode = "screen";
			t.layers[li].frames[44].elements[0].blendMode = "screen";
			t.insertKeyframe(89);
			t.currentFrame = 89;
			t.layers[li].frames[89].elements[0].x = 240 + Math.cos(a) * 18;
			t.layers[li].frames[89].elements[0].y = 135 + Math.sin(a) * 18;
			t.setSelectedFrames(44, 45);
			t.createMotionTween();
			t.layers[li].frames[44].tweenEasing = 60;
		}
		extendAll(90);
	});

	// ------------------------------------------------------------------ button: a button and a code snippet (JS player)
	build("button", function () {
		newDoc(480, 240, 30);
		symbol("ball", "movie clip", function () { radialOval(0, 0, 22, [WHITE, CORAL]); });
		symbol("play", "button", function () {
			var t = tl(), colors = [SKY, "#6AA8FF", "#2F6FD6", SKY];
			for (var i = 0; i < 4; i++) {
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(-62, -20, 62, 20, colors[i], 20);
				if (i < 3) text(-50, -11, 50, 11, i == 1 ? "Play ›" : "Play", 16, WHITE, { bold: true, align: "center" });
			}
		});
		layer("floor");
		rect(40, 200, 440, 204, "#22304F");
		layer("ball");
		var t = tl(), li = t.currentLayer;
		place("ball", 90, 176, 0);
		// up, down, up, down: four bounces across
		var keys = [[0, 90, 176], [10, 160, 70], [20, 230, 176], [30, 300, 96], [40, 370, 176], [50, 410, 130], [60, 440, 176]];
		for (var k = 1; k < keys.length; k++) {
			t.insertKeyframe(keys[k][0]);
			t.currentFrame = keys[k][0];
			var e = t.layers[li].frames[keys[k][0]].elements[0];
			e.x = keys[k][1]; e.y = keys[k][2];
		}
		for (k = 0; k < keys.length - 1; k++) {
			t.setSelectedFrames(keys[k][0], keys[k][0] + 1);
			t.createMotionTween();
			t.layers[li].frames[keys[k][0]].tweenEasing = keys[k][2] > 150 ? 100 : -100;
		}
		layer("button");
		place("play", 240, 36, 0).name = "btn_play";
		extendAll(61);
		layer("labels");
		t = tl();
		t.insertKeyframe(1);
		t.layers[t.currentLayer].frames[1].name = "bounce";
		layer("actions");
		t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = [
			"/* Click to Go to Frame and Play */",
			"stop();",
			"",
			"btn_play.addEventListener(MouseEvent.CLICK, fl_ClickToGoToAndPlayFromFrame);",
			"",
			"function fl_ClickToGoToAndPlayFromFrame(event:MouseEvent):void",
			"{",
			"\tgotoAndPlay(\"bounce\");",
			"}"
		].join("\n");
		t.insertKeyframe(60);
		t.layers[t.currentLayer].frames[60].actionScript = "stop();";
	});

	// ------------------------------------------------------------------ banner: an intro once, then a loop, three times
	build("banner", function () {
		newDoc(300, 250, 24, "#1E1B4B");
		symbol("headline", "movie clip", function () { text(-140, -22, 140, 22, "Spring Sale", 34, WHITE, { bold: true, align: "center" }); });
		symbol("sub", "movie clip", function () { text(-140, -12, 140, 12, "Up to 40 % off — this week only", 14, "#C7D2FE", { align: "center" }); });
		symbol("cta", "movie clip", function () { rect(-70, -20, 70, 20, AMBER, 20); text(-60, -10, 60, 10, "Shop now", 15, "#1E1B4B", { bold: true, align: "center" }); });
		layer("headline");
		var h = tween("headline", 150, 60, 0, 14, function (e) { e.y = 90; select(e); doc.setInstanceAlpha(100); doc.selectNone(); }, function (f) { f.tweenEasing = 100; });
		select(h); doc.setInstanceAlpha(0); doc.selectNone();
		layer("sub");
		var s = tween("sub", 150, 140, 8, 20, function (e) { select(e); doc.setInstanceAlpha(100); doc.selectNone(); }, null);
		select(s); doc.setInstanceAlpha(0); doc.selectNone();
		layer("cta");
		var c = tween("cta", 150, 190, 18, 30, function (e) { e.scaleX = e.scaleY = 1; }, function (f) { f.tweenEasing = 100; });
		c.scaleX = c.scaleY = 0.2;
		// the loop: the button pulses
		var t = tl(), li = t.currentLayer;
		t.insertKeyframe(40); t.insertKeyframe(50);
		t.currentFrame = 40;
		var p = t.layers[li].frames[40].elements[0];
		p.scaleX = p.scaleY = 1.12;
		t.setSelectedFrames(30, 31); t.createMotionTween(); t.layers[li].frames[30].tweenEasing = -60;
		t.setSelectedFrames(40, 41); t.createMotionTween(); t.layers[li].frames[40].tweenEasing = 60;
		extendAll(51);
		layer("labels");
		t = tl();
		t.insertKeyframe(30);
		t.layers[t.currentLayer].frames[30].name = "loop";
		layer("actions");
		t = tl();
		t.insertKeyframe(50);
		// Animate's code snippet idiom: loop three times, then stop
		t.layers[t.currentLayer].frames[50].actionScript = [
			"if (!this.loops) this.loops = 0;",
			"if (++this.loops < 3) gotoAndPlay(\"loop\");",
			"else stop();"
		].join("\n");
	});

	// ------------------------------------------------------------------ sound: a sound on every bounce (JS player)
	build("sound", function () {
		newDoc(480, 220, 30);
		doc.importFile(assets + "/beep.wav", true);
		var snd = null;
		for (var i = 0; i < lib.items.length; i++) if (lib.items[i].itemType == "sound") snd = lib.items[i];
		symbol("ball", "movie clip", function () { radialOval(0, 0, 20, [WHITE, TEAL]); });
		layer("floor");
		rect(60, 190, 420, 194, "#22304F");
		layer("ball");
		var t = tl(), li = t.currentLayer;
		place("ball", 240, 40, 0);
		t.insertKeyframe(15); t.insertKeyframe(30);
		t.layers[li].frames[15].elements[0].y = 168;
		t.setSelectedFrames(0, 1); t.createMotionTween(); t.layers[li].frames[0].tweenEasing = -100;
		t.setSelectedFrames(15, 16); t.createMotionTween(); t.layers[li].frames[15].tweenEasing = 100;
		extendAll(30);
		layer("sound");
		t = tl();
		t.insertKeyframe(15);
		if (snd) {
			t.layers[t.currentLayer].frames[15].soundLibraryItem = snd;
			t.layers[t.currentLayer].frames[15].soundSync = "event";
		}
		log.push("sound: " + (snd ? snd.name : "none"));
	});

	// ------------------------------------------------------------------ text: live text with its font embedded
	build("text", function () {
		newDoc(560, 240, 30);
		layer("heading");
		text(30, 24, 530, 64, "Static text becomes outlines", 26, WHITE, { bold: true });
		layer("body");
		var d = text(30, 80, 530, 150, "Dynamic text stays text: selectable, searchable, read aloud — and its font comes along as a small WOFF2 subset.", 17, "#CBD5E1", { type: "dynamic", multiline: true, face: "Georgia" });
		d.name = "body";
		layer("counter");
		var t = tl(), li = t.currentLayer;
		var words = ["3", "2", "1", "Go!"];
		for (var i = 0; i < words.length; i++) {
			if (i > 0) t.insertBlankKeyframe(i * 15);
			t.currentFrame = i * 15;
			text(30, 170, 200, 220, words[i], 36, i == 3 ? AMBER : TEAL, { type: "dynamic", bold: true });
		}
		extendAll(60);
	});

	// ------------------------------------------------------------------ photo: a bitmap, slowly zoomed ("Ken Burns")
	build("photo", function () {
		newDoc(480, 270, 24, "#000000");
		doc.importFile(assets + "/photo.jpg", true);
		var bmp = null;
		for (var i = 0; i < lib.items.length; i++) if (lib.items[i].itemType == "bitmap") bmp = lib.items[i];
		if (!bmp) throw new Error("photo import failed");
		symbol("picture", "movie clip", function () { lib.addItemToDocument({ x: 0, y: 0 }, bmp.name); var e = doc.selection[0]; e.x = -bmp.hPixels / 2; e.y = -bmp.vPixels / 2; });
		layer("photo");
		tween("picture", 240, 135, 0, 119, function (e) { e.scaleX = e.scaleY = 2.6; e.x = 210; e.y = 120; }, function (f) { f.tweenEasing = 0; }).scaleX = 2.05;
		var t = tl();
		t.layers[t.currentLayer].frames[0].elements[0].scaleY = 2.05;
		layer("frame");
		doc.selectNone();
		doc.setCustomFill({ style: "noFill" });
		doc.setCustomStroke({ style: "solid", color: "#FFFFFF", thickness: 6, capType: "none", joinType: "miter" });
		doc.addNewRectangle({ left: 3, top: 3, right: 477, bottom: 267 }, 0, true, false);
		extendAll(120);
	});

	FLfile.write(outDir + "/build-log.txt", log.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
