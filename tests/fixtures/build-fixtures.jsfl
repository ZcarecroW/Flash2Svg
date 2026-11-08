/*
 * Builds the test FLA documents used by the end-to-end tests.
 * Run through `node scripts/e2e.mjs --build-fixtures` (which launches Animate with this script).
 * Output: tests/fixtures/fla/*.fla and tests/fixtures/fla/build-log.txt
 *
 * JSFL is ES3 (+E4X): no JSON, no let/arrow functions, no Object.keys.
 */
(function () {
	var root = fl.scriptURI.replace(/\/[^\/]*$/, "");
	var outDir = root + "/fla";
	FLfile.createFolder(outDir);
	var log = [];
	var only = null; // set by e2e runner through fixtures-only.txt (comma separated names)
	if (FLfile.exists(outDir + "/fixtures-only.txt")) {
		only = "," + FLfile.read(outDir + "/fixtures-only.txt").replace(/^\s+|\s+$/g, "").replace(/\s*,\s*/g, ",") + ",";
	}

	var doc, lib;

	function newDoc(type, w, h, fps) {
		doc = fl.createDocument(type || "timeline");
		lib = doc.library;
		doc.width = w || 400;
		doc.height = h || 300;
		doc.frameRate = fps || 24;
		doc.backgroundColor = "#FFFFFF";
		return doc;
	}
	function noStroke() { doc.setCustomStroke({ style: "noStroke" }); }
	function stroke(color, size) {
		doc.setCustomStroke({ style: "solid", color: color, thickness: size || 1, capType: "round", joinType: "round" });
	}
	function fill(color) { doc.setCustomFill({ style: "solid", color: color }); }
	function rect(l, t, r, b, color, strokeColor) {
		doc.selectNone();
		fill(color);
		if (strokeColor) stroke(strokeColor, 2); else noStroke();
		doc.addNewRectangle({ left: l, top: t, right: r, bottom: b }, 0, false, !strokeColor);
	}
	function oval(l, t, r, b, color) {
		doc.selectNone();
		fill(color);
		noStroke();
		doc.addNewOval({ left: l, top: t, right: r, bottom: b }, false, true);
	}
	// Creates a library symbol and draws into its timeline with drawFn().
	function symbol(name, type, drawFn) {
		lib.addNewItem(type, name);
		lib.editItem(name);
		drawFn();
		doc.exitEditMode();
	}
	function tl() { return doc.getTimeline(); }
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
	// Places `name` at frame 0 of the current layer, adds a keyframe at `end` and lets modFn change it there.
	function classicTween(name, x, y, end, modFn, frameFn) {
		var t = tl();
		var li = t.currentLayer;
		t.currentFrame = 0;
		var el = place(name, x, y, 0);
		t.insertKeyframe(end);
		t.currentFrame = end;
		var el2 = t.layers[li].frames[end].elements[0];
		modFn(el2);
		t.setSelectedFrames(0, 1);
		t.createMotionTween();
		var f = t.layers[li].frames[0];
		if (frameFn) frameFn(f);
		return f;
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
	function removeEmptyDefaultLayer() {
		var t = tl();
		for (var i = t.layers.length - 1; i >= 0; i--) {
			var l = t.layers[i];
			if (l.name == "Layer_1" || l.name == "Layer 1") {
				var empty = true;
				for (var f = 0; f < l.frameCount; f++) if (l.frames[f].elements.length) { empty = false; break; }
				if (empty && t.layers.length > 1) t.deleteLayer(i);
			}
		}
	}
	function save(name) {
		removeEmptyDefaultLayer();
		var uri = outDir + "/" + name + ".fla";
		if (FLfile.exists(uri)) FLfile.remove(uri);
		var ok = fl.saveDocument(doc, uri);
		fl.closeDocument(doc, false);
		log.push(name + ": " + (ok ? "saved" : "SAVE FAILED"));
	}
	function build(name, fn) {
		if (only && only.indexOf("," + name + ",") == -1) return;
		// (written as it goes: what was reached when Animate crashes)
		log.push(name + ": building");
		FLfile.write(outDir + "/build-log.txt", log.join("\n"));
		if (fl.__checkpoint) fl.__checkpoint(name);
		try {
			fn();
			save(name);
		} catch (e) {
			log.push(name + ": ERROR " + e + (e.lineNumber ? " line " + e.lineNumber : ""));
			try { fl.closeDocument(doc, false); } catch (e2) {}
		}
	}

	function boxSymbol() {
		symbol("box", "movie clip", function () {
			rect(-30, -20, 30, 20, "#3366CC", "#112244");
			rect(10, -5, 25, 5, "#FFCC00");
		});
	}

	// ---------------------------------------------------------------- f01: static graphics
	build("f01-shapes", function () {
		newDoc("timeline", 400, 300);
		rect(10, 10, 110, 80, "#FF3333", "#000000");
		oval(140, 10, 240, 90, "#33AA33");
		doc.selectNone();
		doc.setCustomFill({
			style: "linearGradient",
			colorArray: ["#FF0000", "#0000FF"],
			posArray: [0, 255],
			matrix: { a: 0.06, b: 0, c: 0, d: 0.06, tx: 320, ty: 50 }
		});
		noStroke();
		doc.addNewRectangle({ left: 270, top: 10, right: 380, bottom: 90 }, 12, false, true);
		doc.selectNone();
		doc.setCustomFill({
			style: "radialGradient",
			colorArray: ["#FFFFFF", "#FFAA00", "#AA0000"],
			posArray: [0, 128, 255],
			matrix: { a: 0.07, b: 0, c: 0, d: 0.07, tx: 60, ty: 200 }
		});
		doc.addNewOval({ left: 10, top: 150, right: 110, bottom: 250 }, false, true);
		layer("lines");
		stroke("#9900CC", 4);
		doc.addNewLine({ x: 140, y: 150 }, { x: 380, y: 280 });
		layer("text");
		doc.selectNone();
		doc.addNewText({ left: 150, top: 200, right: 380, bottom: 230 }, "Static text");
		doc.setElementTextAttr("size", 24);
		doc.setElementTextAttr("fillColor", "#222222");
	});

	// ---------------------------------------------------------------- f02: classic eases
	build("f02-eases", function () {
		newDoc("timeline", 500, 420, 24);
		boxSymbol();
		var rows = [
			["linear", function (f) { f.tweenEasing = 0; }],
			["easeIn", function (f) { f.tweenEasing = -100; }],
			["easeOut", function (f) { f.tweenEasing = 100; }],
			["ease50", function (f) { f.tweenEasing = 50; }],
			["customOvershoot", function (f) {
				f.hasCustomEase = true;
				f.setCustomEase("all", [
					{ x: 0, y: 0 }, { x: 0.2, y: 0.9 }, { x: 0.35, y: 1.25 }, { x: 0.5, y: 1.1 },
					{ x: 0.65, y: 0.95 }, { x: 0.8, y: 1 }, { x: 1, y: 1 }
				]);
			}],
			["perProperty", function (f) {
				f.hasCustomEase = true;
				f.useSingleEaseCurve = false;
				f.setCustomEase("position", [{ x: 0, y: 0 }, { x: 0.7, y: 0 }, { x: 0.9, y: 0.5 }, { x: 1, y: 1 }]);
				f.setCustomEase("scale", [{ x: 0, y: 0 }, { x: 0.1, y: 0.8 }, { x: 0.3, y: 1 }, { x: 1, y: 1 }]);
				f.setCustomEase("rotation", [{ x: 0, y: 0 }, { x: 0.33, y: 0.33 }, { x: 0.66, y: 0.66 }, { x: 1, y: 1 }]);
				f.setCustomEase("color", [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }]);
			}]
		];
		for (var i = 0; i < rows.length; i++) {
			layer(rows[i][0]);
			(function (setup, isPerProperty) {
				classicTween("box", 50, 40 + i * 62, 36, function (el) {
					el.x = 420;
					if (isPerProperty) {
						el.scaleX = 1.6; el.scaleY = 0.6; el.rotation = 45;
						el.colorMode = "alpha"; el.colorAlphaPercent = 30;
					}
				}, setup);
			})(rows[i][1], rows[i][0] == "perProperty");
		}
		extendAll(48);
	});

	// ---------------------------------------------------------------- f03: rotation, scale, color tweens
	build("f03-transforms", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		layer("cw2");
		classicTween("box", 80, 80, 30, function (el) { el.x = 300; }, function (f) {
			f.motionTweenRotate = "clockwise"; f.motionTweenRotateTimes = 2;
		});
		layer("ccw");
		classicTween("box", 80, 160, 30, function (el) { el.rotation = 90; el.scaleX = 2; }, function (f) {
			f.motionTweenRotate = "counter-clockwise"; f.motionTweenRotateTimes = 1;
		});
		layer("tint-skew");
		var f0 = classicTween("box", 80, 240, 30, function (el) {
			el.x = 300; el.skewX = 30; el.skewY = 10;
			doc.selectNone(); el.selected = true;
			doc.setInstanceTint("#FF0000", 80);
		});
		// start keyframe semi-transparent so colour samples are checked against a non-identity start
		var t3 = tl();
		t3.currentFrame = 0;
		doc.selectNone();
		var e0 = t3.layers[t3.currentLayer].frames[0].elements[0];
		e0.selected = true;
		doc.setInstanceAlpha(50);
		layer("offcenter-tp");
		classicTween("box", 200, 40, 30, function (el) {
			el.rotation = 120;
		}, function (f) {
			var e = f.elements[0];
			e.setTransformationPoint({ x: 25, y: 15 });
		});
		extendAll(40);
	});

	// ---------------------------------------------------------------- f04: nested timelines
	build("f04-nested", function () {
		newDoc("timeline", 400, 300, 24);
		symbol("spinner", "movie clip", function () {
			rect(-20, -4, 20, 4, "#CC3300");
			var t = tl();
			t.insertKeyframe(11);
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
			t.layers[0].frames[0].motionTweenRotate = "clockwise";
			t.layers[0].frames[0].motionTweenRotateTimes = 1;
		});
		symbol("counter", "graphic", function () {
			// 6 frames, each with a different-width bar (frame-by-frame)
			for (var i = 0; i < 6; i++) {
				var t = tl();
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(0, 0, 10 + i * 10, 10, "#0066FF");
			}
		});
		layer("mc-full");
		place("spinner", 60, 60, 0);
		layer("mc-partial");
		var t = tl();
		t.insertBlankKeyframe(10);
		place("spinner", 160, 60, 10);
		t.insertBlankKeyframe(30);
		layer("g-loop");
		var g = place("counter", 40, 150, 0); g.loop = "loop"; g.firstFrame = 2;
		layer("g-once");
		g = place("counter", 40, 190, 0); g.loop = "play once";
		layer("g-single");
		g = place("counter", 40, 230, 0); g.loop = "single frame"; g.firstFrame = 4;
		extendAll(48);
	});

	// ---------------------------------------------------------------- f05: shape tween
	build("f05-shapetween", function () {
		newDoc("timeline", 400, 300, 24);
		rect(40, 100, 140, 200, "#FF6600");
		var t = tl();
		t.insertBlankKeyframe(24);
		t.currentFrame = 24;
		oval(250, 80, 370, 200, "#0066FF");
		t.setSelectedFrames(0, 1);
		t.setFrameProperty("tweenType", "shape");
		extendAll(30);
	});

	// ---------------------------------------------------------------- f06: motion object (new tween)
	build("f06-motionobject", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		var el = place("box", 60, 150, 0);
		var t = tl();
		t.createMotionObject(0, 30);
		var last = t.layers[0].frames[0].duration - 1;
		t.currentFrame = last;
		doc.selectNone();
		el = t.layers[0].frames[last].elements[0];
		doc.selection = [el];
		doc.moveSelectionBy({ x: 260, y: -80 });
		doc.rotateSelection(90);
		extendAll(36);
	});

	// ---------------------------------------------------------------- f07: masks
	build("f07-mask", function () {
		newDoc("timeline", 400, 300, 24);
		symbol("disc", "graphic", function () { oval(-60, -60, 60, 60, "#000000"); });
		layer("content");
		rect(0, 0, 400, 300, "#3399FF");
		rect(50, 50, 350, 250, "#FFCC00");
		layer("maskLayer");
		classicTween("disc", 80, 150, 30, function (el) { el.x = 320; el.scaleX = el.scaleY = 1.5; });
		var t = tl();
		var maskIdx = -1, contentIdx = -1;
		for (var i = 0; i < t.layers.length; i++) {
			if (t.layers[i].name == "maskLayer") maskIdx = i;
			if (t.layers[i].name == "content") contentIdx = i;
		}
		log.push("f07 layers: " + maskIdx + "," + contentIdx + " of " + t.layers.length);
		t.layers[maskIdx].layerType = "mask";
		t.layers[contentIdx].layerType = "masked";
		t.layers[contentIdx].parentLayer = t.layers[maskIdx];
		extendAll(36);
	});

	// ---------------------------------------------------------------- f08: filters & blend modes
	build("f08-filters", function () {
		newDoc("timeline", 500, 300, 24);
		boxSymbol();
		layer("bg");
		rect(0, 0, 500, 300, "#88CC88");
		var defs = [
			["blur", function () { doc.addFilter("blurFilter"); doc.setFilterProperty("blurX", 0, 8); doc.setFilterProperty("blurY", 0, 8); }],
			["glow", function () { doc.addFilter("glowFilter"); doc.setFilterProperty("color", 0, "#FF00FF"); }],
			["shadow", function () { doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 8); }],
			["bevel", function () { doc.addFilter("bevelFilter"); }],
			["adjust", function () { doc.addFilter("adjustColorFilter"); doc.setFilterProperty("hue", 0, 90); doc.setFilterProperty("saturation", 0, -50); }],
			["multiply", function (el) { el.blendMode = "multiply"; }],
			["screen", function (el) { el.blendMode = "screen"; }],
			["add", function (el) { el.blendMode = "add"; }],
			["overlay", function (el) { el.blendMode = "overlay"; }],
			["innerShadow", function () { doc.addFilter("dropShadowFilter"); doc.setFilterProperty("inner", 0, true); }]
		];
		for (var i = 0; i < defs.length; i++) {
			layer(defs[i][0]);
			var el = place("box", 60 + (i % 5) * 95, 80 + Math.floor(i / 5) * 130, 0);
			doc.selectNone();
			el.selected = true;
			defs[i][1](el);
			doc.selectNone();
		}
		extendAll(1);
	});

	// ---------------------------------------------------------------- f19: filter variants
	build("f19-filters2", function () {
		newDoc("timeline", 500, 300, 24);
		boxSymbol();
		layer("bg");
		rect(0, 0, 500, 300, "#88CC88");
		function prop(k, v) { doc.setFilterProperty(k, 0, v); }
		var defs = [
			["bevelOuter", function () { doc.addFilter("bevelFilter"); prop("type", "outer"); prop("distance", 6); }],
			["bevelFull", function () { doc.addFilter("bevelFilter"); prop("type", "full"); prop("angle", 120); prop("strength", 200); }],
			["bevelKnockout", function () { doc.addFilter("bevelFilter"); prop("knockout", true); }],
			["glowInner", function () { doc.addFilter("glowFilter"); prop("inner", true); prop("color", "#0000FF"); prop("blurX", 10); prop("blurY", 10); }],
			["glowKnockout", function () { doc.addFilter("glowFilter"); prop("knockout", true); prop("color", "#FFFF00"); }],
			["blurHigh", function () { doc.addFilter("blurFilter"); prop("blurX", 12); prop("blurY", 4); prop("quality", "high"); }],
			["shadowHide", function () { doc.addFilter("dropShadowFilter"); prop("hideObject", true); prop("angle", 200); prop("distance", 6); }],
			["shadowStrong", function () { doc.addFilter("dropShadowFilter"); prop("strength", 300); prop("blurX", 2); prop("blurY", 2); prop("quality", "medium"); }],
			["gradientGlow", function () { doc.addFilter("gradientGlowFilter"); prop("distance", 0); }],
			["gradientBevel", function () { doc.addFilter("gradientBevelFilter"); }]
		];
		for (var i = 0; i < defs.length; i++) {
			layer(defs[i][0]);
			var el = place("box", 60 + (i % 5) * 95, 80 + Math.floor(i / 5) * 130, 0);
			doc.selectNone();
			el.selected = true;
			defs[i][1](el);
			doc.selectNone();
		}
		extendAll(1);
	});

	// ---------------------------------------------------------------- f09: motion guide
	build("f09-guide", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		layer("follower");
		classicTween("box", 50, 250, 36, function (el) { el.x = 350; el.y = 250; }, function (f) {
			f.motionTweenOrientToPath = true;
		});
		var t = tl();
		t.addMotionGuide();
		var gi = t.currentLayer;
		t.currentFrame = 0;
		stroke("#999999", 1);
		doc.addNewLine({ x: 50, y: 250 }, { x: 200, y: 40 });
		doc.addNewLine({ x: 200, y: 40 }, { x: 350, y: 250 });
		extendAll(40);
	});

	// ---------------------------------------------------------------- f10: HTML5 canvas document
	build("f10-canvas", function () {
		newDoc("htmlcanvas", 400, 300, 30);
		boxSymbol();
		layer("anim");
		classicTween("box", 60, 150, 29, function (el) { el.x = 340; el.rotation = 180; }, function (f) { f.tweenEasing = -60; });
		var t = tl();
		layer("actions");
		t.insertKeyframe(29);
		t.layers[t.currentLayer].frames[29].actionScript = "this.stop();";
		extendAll(30);
	});

	// ---------------------------------------------------------------- f11: text kinds
	build("f11-text", function () {
		newDoc("timeline", 400, 300, 24);
		doc.addNewText({ left: 20, top: 20, right: 380, bottom: 60 }, "Static outlines");
		doc.setElementTextAttr("size", 28);
		layer("dyn");
		doc.selectNone();
		doc.addNewText({ left: 20, top: 120, right: 380, bottom: 160 }, "Dynamic text");
		doc.setElementProperty("textType", "dynamic");
		doc.setElementTextAttr("size", 22);
		doc.setElementTextAttr("fillColor", "#AA0000");
	});

	// ---------------------------------------------------------------- f12: frame-by-frame + labels + stop
	build("f12-labels", function () {
		newDoc("timeline", 300, 200, 12);
		var colors = ["#FF0000", "#00AA00", "#0000FF", "#FF00FF"];
		for (var i = 0; i < 4; i++) {
			var t = tl();
			if (i > 0) t.insertBlankKeyframe(i * 3);
			t.currentFrame = i * 3;
			rect(20 + i * 60, 60, 70 + i * 60, 140, colors[i]);
			t.layers[0].frames[i * 3].name = "step" + (i + 1);
		}
		extendAll(12);
		layer("actions");
		var t2 = tl();
		t2.insertKeyframe(11);
		t2.layers[t2.currentLayer].frames[11].actionScript = "stop();";
	});

	// ---------------------------------------------------------------- f13: camera
	build("f13-camera", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		layer("bg");
		rect(0, 0, 400, 300, "#DDEEFF");
		rect(20, 20, 120, 100, "#FF9900");
		rect(280, 180, 380, 280, "#33AA33");
		layer("box");
		place("box", 200, 150, 0);
		extendAll(24);
		var t = tl();
		var cam = t.camera;
		cam.cameraEnabled = true;
		var types = [];
		for (var i = 0; i < t.layers.length; i++) types.push(t.layers[i].name + ":" + t.layers[i].layerType);
		log.push("f13 layers after enabling camera: " + types.join(", "));
		// camera keyframes at 0 and 23, tweened
		var ci = -1;
		for (i = 0; i < t.layers.length; i++) if (t.layers[i].layerType == "camera" || /camera/i.test(t.layers[i].name)) ci = i;
		log.push("f13 camera layer index " + ci);
		if (ci >= 0) {
			t.setSelectedLayers(ci);
			t.insertKeyframe(23);
		}
		t.currentFrame = 23;
		try { cam.setZoom(23, 150); } catch (e) { log.push("setZoom: " + e); }
		try { cam.setRotation(23, 15); } catch (e) { log.push("setRotation: " + e); }
		// no setPosition() in the API: move the camera instance itself
		try {
			var ce = t.layers[ci].frames[23].elements[0];
			ce.x = ce.x + 60;
			ce.y = ce.y + 30;
		} catch (e) { log.push("camera move: " + e); }
		if (ci >= 0) {
			t.setSelectedLayers(ci);
			t.setSelectedFrames(0, 1);
			try { t.createMotionTween(); } catch (e) { log.push("camera tween: " + e); }
		}
		var cams = [];
		for (var f = 0; f < 24; f += 11) {
			var p = cam.getPosition(f);
			cams.push(f + ":" + p.x + "," + p.y + " z" + cam.getZoom(f) + " r" + cam.getRotation(f));
		}
		log.push("f13 camera: " + cams.join(" | "));
	});

	// ---------------------------------------------------------------- f14: layer parenting
	build("f14-parenting", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		symbol("dot", "movie clip", function () { oval(-10, -10, 10, 10, "#CC0000"); });
		layer("arm");
		classicTween("box", 150, 150, 23, function (el) { el.rotation = 90; }, function (f) {
			f.elements[0].setTransformationPoint({ x: -30, y: 0 });
		});
		var t = tl();
		layer("hand");
		// the child has its own tween on top of the parent's motion
		classicTween("box", 210, 150, 23, function (el) { el.y = 175; el.scaleX = el.scaleY = 0.5; }, function (f) {
			f.elements[0].scaleX = f.elements[0].scaleY = 0.5;
		});
		layer("fixed");
		place("box", 300, 60, 0);
		extendAll(24);
		var idx = {};
		for (var j = 0; j < t.layers.length; j++) idx[t.layers[j].name] = j;
		// Animate 24: setRigParentAtFrame(parentLayer, frame) takes the layer object first (the
		// documentation shows (frame, index), which does nothing)
		var pairs = [["hand", 0], ["hand", 23], ["fixed", 0]];
		for (j = 0; j < pairs.length; j++) {
			try {
				t.layers[idx[pairs[j][0]]].setRigParentAtFrame(t.layers[idx.arm], pairs[j][1]);
			} catch (e) { log.push("f14 rig " + pairs[j][0] + ": " + e); }
		}
		try {
			var hand = t.layers[idx.hand];
			var rp = hand.getRigParentAtFrame(0);
			var rm = hand.getRigMatrixAtFrame(12);
			log.push("f14 rig parent: " + (rp && rp.name ? rp.name : rp) + " (" + typeof rp + "), rig matrix@12: " + [rm.a, rm.b, rm.c, rm.d, rm.tx, rm.ty].join(","));
		} catch (e) { log.push("f14 rig: " + e); }
	});

	// ---------------------------------------------------------------- f15: button
	build("f15-button", function () {
		newDoc("timeline", 300, 200, 24);
		symbol("btn", "button", function () {
			var t = tl();
			var colors = ["#CC3333", "#33CC33", "#3333CC", "#000000"];
			for (var i = 0; i < 4; i++) {
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(-50, -25, 50, 25, colors[i]);
			}
		});
		layer("ui");
		place("btn", 150, 100, 0);
	});

	// ---------------------------------------------------------------- f16: sound
	build("f16-sound", function () {
		newDoc("timeline", 300, 200, 24);
		var wav = root + "/assets/beep.wav";
		doc.importFile(wav, true);
		var item = null;
		for (var i = 0; i < lib.items.length; i++) if (lib.items[i].itemType == "sound") item = lib.items[i];
		log.push("f16 sound item: " + (item ? item.name : "none"));
		rect(100, 50, 200, 150, "#996600");
		extendAll(24);
		var t = tl();
		if (item) {
			t.layers[0].frames[0].soundLibraryItem = item;
			t.layers[0].frames[0].soundSync = "event";
		}
	});

	// ---------------------------------------------------------------- f18: bitmaps
	build("f18-bitmap", function () {
		newDoc("timeline", 400, 300, 24);
		doc.importFile(root + "/assets/checker.png", true);
		var item = null;
		for (var i = 0; i < lib.items.length; i++) if (lib.items[i].itemType == "bitmap") item = lib.items[i];
		log.push("f18 bitmap item: " + (item ? item.name : "none"));
		if (!item) throw new Error("bitmap import failed");
		// on the stage, rotated and scaled
		lib.addItemToDocument({ x: 70, y: 70 }, item.name);
		var b = doc.selection[0];
		b.rotation = 25;
		b.scaleX = 1.5;
		// inside a movie clip with a classic tween
		symbol("pic", "movie clip", function () {
			lib.addItemToDocument({ x: 0, y: 0 }, item.name);
		});
		layer("tween");
		classicTween("pic", 120, 200, 23, function (el) {
			el.x = 320;
			el.rotation = -40;
		});
		extendAll(24);
	});

	// ---------------------------------------------------------------- f20: reverse loops, colour effects, visibility, 9-slice, filter tween
	build("f20-misc", function () {
		newDoc("timeline", 500, 300, 24);
		boxSymbol();
		symbol("counter", "graphic", function () {
			for (var i = 0; i < 6; i++) {
				var t = tl();
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(0, 0, 10 + i * 10, 10, "#0066FF");
			}
		});
		symbol("panel", "movie clip", function () {
			rect(0, 0, 60, 40, "#996633", "#000000");
			rect(4, 4, 14, 14, "#FFFFFF");
			rect(46, 26, 56, 36, "#FF0000");
		});
		var panel = lib.items[lib.findItemIndex("panel")];
		panel.scalingGrid = true;
		panel.scalingGridRect = { left: 16, top: 12, right: 44, bottom: 28 };
		layer("g-rev");
		var g = place("counter", 30, 40, 0); g.loop = "loop reverse"; g.firstFrame = 3;
		layer("g-oncerev");
		g = place("counter", 150, 40, 0); g.loop = "play once reverse"; g.firstFrame = 4;
		layer("bright");
		var el = place("box", 300, 50, 0);
		doc.selectNone(); el.selected = true; doc.setInstanceBrightness(-60); doc.selectNone();
		layer("advanced");
		el = place("box", 420, 50, 0);
		el.colorMode = "advanced";
		el.colorRedPercent = 40; el.colorGreenPercent = 100; el.colorBluePercent = 60; el.colorAlphaPercent = 80;
		el.colorRedAmount = 120; el.colorGreenAmount = -40; el.colorBlueAmount = 30; el.colorAlphaAmount = 0;
		layer("invisible");
		el = place("box", 60, 150, 0);
		el.visible = false;
		layer("hidden");
		rect(110, 120, 170, 180, "#FF00FF");
		var t = tl();
		t.layers[t.currentLayer].visible = false;
		layer("nineslice");
		el = place("panel", 220, 120, 0);
		el.scaleX = 3; el.scaleY = 1.5;
		layer("nineslice-rotated");
		el = place("panel", 420, 130, 0);
		el.scaleX = 1.8; el.rotation = 20;
		layer("nineslice-small");
		el = place("panel", 350, 190, 0);
		el.scaleX = 0.4; el.scaleY = 0.5;
		layer("dashed");
		doc.selectNone();
		doc.setCustomStroke({ style: "dashed", color: "#003366", thickness: 4, dash1: 6, dash2: 4, capType: "none", joinType: "miter" });
		doc.addNewLine({ x: 20, y: 280 }, { x: 480, y: 280 });
		layer("blurTween");
		classicTween("box", 60, 230, 23, function (e) {
			e.x = 420;
			doc.selectNone(); e.selected = true;
			doc.addFilter("blurFilter"); doc.setFilterProperty("blurX", 0, 12); doc.setFilterProperty("blurY", 0, 4);
			doc.addFilter("glowFilter"); doc.setFilterProperty("color", 1, "#FF0000"); doc.setFilterProperty("blurX", 1, 10); doc.setFilterProperty("blurY", 1, 10);
			doc.selectNone();
		});
		extendAll(24);
	});

	// ---------------------------------------------------------------- f22: layer effects, gradient shape tween, last frame, text, 9-slice with a nested clip
	build("f22-layers", function () {
		newDoc("timeline", 500, 300, 24);
		boxSymbol();
		log.push("f22 advanced layers: " + doc.useAdvancedLayers);
		symbol("counter", "graphic", function () {
			for (var i = 0; i < 6; i++) {
				var t = tl();
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(0, 0, 10 + i * 10, 10, "#0066FF");
			}
		});
		symbol("panel2", "movie clip", function () {
			rect(0, 0, 60, 40, "#669933", "#000000");
			place("box", 30, 20, 0);
			var e = doc.selection[0];
			e.scaleX = e.scaleY = 0.3;
		});
		var p2 = lib.items[lib.findItemIndex("panel2")];
		p2.scalingGrid = true;
		p2.scalingGridRect = { left: 12, top: 10, right: 48, bottom: 30 };
		var t = tl();
		// layer effects (advanced layers): filter, colour and blend mode on the layer itself
		layer("fxFilter");
		var el = place("box", 60, 50, 0);
		doc.selectNone(); el.selected = true;
		doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 6); doc.setFilterProperty("color", 0, "#000080");
		var fs = el.filters;
		doc.removeAllFilters(); doc.selectNone();
		try { t.layers[t.currentLayer].setFiltersAtFrame(0, fs); } catch (e) { log.push("f22 setFiltersAtFrame: " + e); }
		layer("fxColor");
		place("box", 170, 50, 0);
		try {
			var ly = t.layers[t.currentLayer];
			var ct = ly.getColorTransformAtFrame(0);
			var keys = [];
			for (var k in ct) keys.push(k + "=" + ct[k]);
			log.push("f22 colour transform: " + keys.join(","));
			ct.colorAlphaPercent = 60; ct.colorRedAmount = 100; ct.colorMode = "advanced";
			ly.setColorTransformAtFrame(0, ct);
		} catch (e) { log.push("f22 setColorTransformAtFrame: " + e); }
		layer("fxBlend");
		place("box", 280, 50, 0);
		try { t.layers[t.currentLayer].setBlendModeAtFrame(0, "multiply"); } catch (e) { log.push("f22 setBlendModeAtFrame: " + e); }
		layer("lastFrame");
		var g = place("counter", 370, 40, 0); g.loop = "loop"; g.firstFrame = 1;
		try { g.lastFrame = 3; } catch (e) { log.push("f22 lastFrame: " + e); }
		layer("text");
		doc.selectNone();
		doc.addNewText({ left: 20, top: 110, right: 200, bottom: 170 }, "Centred dynamic\rtext on two lines");
		doc.setElementProperty("textType", "dynamic");
		doc.setElementProperty("lineType", "multiline");
		doc.setElementTextAttr("alignment", "center");
		doc.setElementTextAttr("size", 16);
		doc.setElementTextAttr("fillColor", "#004400");
		layer("nineslice");
		el = place("panel2", 330, 140, 0);
		el.scaleX = 2.5; el.scaleY = 1.5;
		// shape tween between gradient-filled, stroked shapes with alpha
		layer("gradTween");
		doc.selectNone();
		doc.setCustomFill({ style: "linearGradient", colorArray: ["#FF0000", "#FFFF00"], posArray: [0, 255], matrix: { a: 0.05, b: 0, c: 0, d: 0.05, tx: 80, ty: 240 } });
		stroke("#000000", 3);
		doc.addNewRectangle({ left: 30, top: 200, right: 130, bottom: 280 }, 0, false, false);
		var lt = tl();
		var li = lt.currentLayer;
		lt.insertBlankKeyframe(23);
		lt.currentFrame = 23;
		doc.selectNone();
		doc.setCustomFill({ style: "radialGradient", colorArray: ["#0000FF", "#00FFFF"], posArray: [0, 255], alphaArray: [100, 40], matrix: { a: 0.06, b: 0, c: 0, d: 0.06, tx: 400, ty: 240 } });
		stroke("#CC00CC", 6);
		doc.addNewOval({ left: 340, top: 190, right: 460, bottom: 290 }, false, false);
		lt.setSelectedLayers(li);
		lt.setSelectedFrames(0, 1);
		lt.setFrameProperty("tweenType", "shape");
		extendAll(24);
	});

	// ---------------------------------------------------------------- f23: 9-slice panel with an animated (eased) scale
	build("f23-nineslice-tween", function () {
		newDoc("timeline", 400, 250, 24);
		symbol("panel", "movie clip", function () {
			rect(0, 0, 60, 40, "#996633", "#000000");
			rect(4, 4, 14, 14, "#FFFFFF");
			rect(46, 26, 56, 36, "#FF0000");
		});
		var panel = lib.items[lib.findItemIndex("panel")];
		panel.scalingGrid = true;
		panel.scalingGridRect = { left: 16, top: 12, right: 44, bottom: 28 };
		layer("grow");
		classicTween("panel", 60, 60, 23, function (e) { e.scaleX = 4; e.scaleY = 2.5; e.x = 200; e.y = 140; }, function (f) { f.tweenEasing = -60; });
		layer("shrink");
		classicTween("panel", 330, 200, 23, function (e) { e.scaleX = 0.5; e.scaleY = 0.6; });
		extendAll(24);
	});

	// ---------------------------------------------------------------- f21: one mask over several layers, mask inside a tweened symbol
	build("f21-masks2", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		symbol("window", "movie clip", function () {
			var t = tl();
			rect(-50, -50, 50, 50, "#33AA33");
			rect(-50, -10, 50, 10, "#FFFFFF");
			var maskIdx = t.addNewLayer("m", "mask", true);
			t.setSelectedLayers(maskIdx);
			t.currentLayer = maskIdx;
			oval(-35, -35, 35, 35, "#000000");
			t.layers[maskIdx + 1].layerType = "masked";
			t.layers[maskIdx + 1].parentLayer = t.layers[maskIdx];
		});
		layer("bg");
		rect(0, 0, 400, 300, "#DDDDDD");
		layer("stripes");
		for (var i = 0; i < 8; i++) rect(i * 50, 0, i * 50 + 25, 300, "#3366CC");
		layer("mover");
		classicTween("box", 40, 100, 23, function (e) { e.x = 360; e.rotation = 90; });
		layer("maskLayer");
		oval(100, 40, 300, 200, "#000000");
		var t = tl();
		var idx = {};
		for (var j = 0; j < t.layers.length; j++) idx[t.layers[j].name] = j;
		t.layers[idx.maskLayer].layerType = "mask";
		var masked = ["stripes", "mover"];
		for (j = 0; j < masked.length; j++) {
			t.layers[idx[masked[j]]].layerType = "masked";
			t.layers[idx[masked[j]]].parentLayer = t.layers[idx.maskLayer];
		}
		layer("windowTween");
		classicTween("window", 80, 240, 23, function (e) { e.x = 320; e.scaleX = e.scaleY = 0.6; e.rotation = 45; });
		extendAll(24);
	});

	// ---------------------------------------------------------------- f24: deep nesting, colour through levels, symbol swap, flips, gaps
	build("f24-deep", function () {
		newDoc("timeline", 500, 300, 24);
		boxSymbol();
		symbol("bar", "movie clip", function () {
			rect(-20, -5, 20, 5, "#CC3300");
			var t = tl();
			t.insertKeyframe(7);
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
			t.layers[0].frames[0].motionTweenRotate = "clockwise";
			t.layers[0].frames[0].motionTweenRotateTimes = 1;
		});
		symbol("counter", "graphic", function () {
			for (var i = 0; i < 6; i++) {
				var t = tl();
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(0, 0, 10 + i * 8, 8, "#0066FF");
			}
		});
		// level 2: a graphic with its own classic tween of a tinted nested graphic
		symbol("middle", "graphic", function () {
			var e = place("counter", -30, -20, 0);
			doc.selectNone(); e.selected = true; doc.setInstanceTint("#00AA00", 50); doc.selectNone();
			e.loop = "loop";
			var t = tl();
			t.insertKeyframe(9);
			var e2 = t.layers[0].frames[9].elements[0];
			e2.x += 20; e2.rotation = 30;
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
			t.layers[0].frames[0].tweenEasing = 50;
			var li = t.addNewLayer("bar", "normal", true);
			t.setSelectedLayers(li); t.currentLayer = li;
			var b = place("bar", 0, 10, 0);
			b.colorAlphaPercent = 60; b.colorMode = "alpha";
			t.setSelectedLayers(li);
			t.insertFrames(9, false, 1);
		});
		// level 1: the middle graphic placed twice with different offsets, alpha on top
		symbol("outer", "graphic", function () {
			var e = place("middle", 0, 0, 0);
			e.loop = "loop"; e.firstFrame = 3;
			var e2 = place("middle", 40, 30, 0);
			e2.loop = "single frame"; e2.firstFrame = 6; e2.scaleX = -1;
			tl().insertFrames(15, false, 1);
		});
		layer("deep");
		classicTween("outer", 90, 90, 23, function (e) {
			e.x = 200; e.scaleX = 1.4; e.scaleY = 0.8;
			doc.selectNone(); e.selected = true; doc.setInstanceAlpha(40); doc.selectNone();
		}, function (f) {
			var e = f.elements[0];
			e.loop = "loop"; e.firstFrame = 2;
			doc.selectNone(); e.selected = true; doc.setInstanceBrightness(30); doc.selectNone();
		});
		// classic tween into a keyframe that holds a different symbol
		layer("swap");
		var t = tl();
		var li = t.currentLayer;
		classicTween("box", 320, 60, 15, function (e) {
			e.x = 450; e.rotation = 45;
			doc.selectNone(); e.selected = true; doc.swapElement("bar"); doc.selectNone();
		});
		// flip through zero scale, with skew
		layer("flip");
		classicTween("box", 320, 160, 23, function (e) { e.scaleX = -1; e.skewY = 15; });
		// gaps: blank keyframes inside the span, late start, early end
		layer("gaps");
		t = tl();
		li = t.currentLayer;
		t.insertBlankKeyframe(4);
		t.currentFrame = 4;
		place("box", 80, 240, 4);
		t.insertKeyframe(10);
		t.layers[li].frames[10].elements[0].x = 200;
		t.setSelectedFrames(4, 5);
		t.createMotionTween();
		t.insertBlankKeyframe(12);
		t.insertKeyframe(16);
		t.currentFrame = 16;
		place("bar", 300, 250, 16);
		t.insertBlankKeyframe(20);
		// a tween whose end keyframe changes the graphic's first frame
		layer("gframe");
		classicTween("counter", 380, 230, 12, function (e) { e.loop = "loop"; e.firstFrame = 0; e.x = 420; }, function (f) {
			f.elements[0].loop = "loop"; f.elements[0].firstFrame = 4;
		});
		extendAll(24);
	});

	// ---------------------------------------------------------------- f25: paint: radial focus, spread modes, gradient strokes, bitmap fills, stroke styles
	build("f25-paint", function () {
		newDoc("timeline", 500, 320, 24);
		doc.importFile(root + "/assets/checker.png", true);
		var bmp = null;
		for (var i = 0; i < lib.items.length; i++) if (lib.items[i].itemType == "bitmap") bmp = lib.items[i];
		function grad(style, l, t0, r, b, extra) {
			doc.selectNone();
			var f = { style: style, colorArray: ["#FF0000", "#FFFF00", "#0000FF"], posArray: [0, 128, 255], matrix: { a: 0.02, b: 0, c: 0, d: 0.02, tx: (l + r) / 2, ty: (t0 + b) / 2 } };
			for (var k in extra) f[k] = extra[k];
			doc.setCustomFill(f);
			noStroke();
			doc.addNewRectangle({ left: l, top: t0, right: r, bottom: b }, 0, false, true);
		}
		layer("radialFocal");
		grad("radialGradient", 10, 10, 110, 110, { focalPoint: 180 });
		layer("radialReflect");
		grad("radialGradient", 130, 10, 230, 110, { overflow: "Reflect" });
		layer("linearRepeat");
		grad("linearGradient", 250, 10, 350, 110, { overflow: "Repeat" });
		layer("linearRotated");
		grad("linearGradient", 370, 10, 490, 110, { matrix: { a: 0.03, b: 0.03, c: -0.03, d: 0.03, tx: 430, ty: 60 } });
		layer("gradStroke");
		doc.selectNone();
		doc.setCustomFill({ style: "noFill" });
		doc.setCustomStroke({ style: "solid", thickness: 10, capType: "round", joinType: "round", color: "#000000" });
		doc.addNewRectangle({ left: 20, top: 140, right: 120, bottom: 220 }, 0, true, false);
		try {
			doc.selectAll();
			var s = doc.getCustomStroke("selection");
			s.shapeFill = { style: "linearGradient", colorArray: ["#00AA00", "#FF00FF"], posArray: [0, 255], matrix: { a: 0.06, b: 0, c: 0, d: 0.06, tx: 70, ty: 180 } };
			doc.setCustomStroke(s);
			doc.selectNone();
		} catch (e) { log.push("f25 gradient stroke: " + e); }
		if (bmp) {
			layer("bitmapFill");
			doc.selectNone();
			try {
				doc.setCustomFill({ style: "bitmap", bitmapPath: bmp.name, matrix: { a: 0.8, b: 0.3, c: -0.3, d: 0.8, tx: 150, ty: 140 } });
				noStroke();
				doc.addNewRectangle({ left: 150, top: 140, right: 260, bottom: 220 }, 0, false, true);
			} catch (e) { log.push("f25 bitmap fill: " + e); }
		}
		layer("strokes");
		var styles = [
			{ style: "solid", thickness: 6, capType: "none", joinType: "miter", miterLimit: 3 },
			{ style: "solid", thickness: 6, capType: "square", joinType: "bevel" },
			{ style: "dotted", thickness: 3, dotSpace: 4 },
			{ style: "solid", thickness: 0.1 }
		];
		for (var j = 0; j < styles.length; j++) {
			doc.selectNone();
			styles[j].color = "#2244AA";
			doc.setCustomStroke(styles[j]);
			doc.addNewLine({ x: 290 + j * 50, y: 150 }, { x: 310 + j * 50, y: 210 });
			doc.addNewLine({ x: 310 + j * 50, y: 210 }, { x: 330 + j * 50, y: 150 });
		}
		layer("roundRect");
		doc.selectNone();
		fill("#AA66CC"); stroke("#330033", 3);
		doc.addNewRectangle({ left: 20, top: 240, right: 160, bottom: 310 }, 18, false, false);
		layer("primitive");
		doc.selectNone();
		fill("#66CCAA"); noStroke();
		try { doc.addNewPrimitiveOval({ left: 190, top: 240, right: 290, bottom: 310 }, false, true); } catch (e) { log.push("f25 primitive: " + e); }
		layer("alphaOverlap");
		doc.selectNone();
		doc.setCustomFill({ style: "solid", color: "#FF000080" });
		doc.addNewOval({ left: 320, top: 235, right: 400, bottom: 315 }, false, true);
		layer("alphaOverlap2");
		doc.selectNone();
		doc.setCustomFill({ style: "solid", color: "#0000FF80" });
		doc.addNewOval({ left: 360, top: 235, right: 440, bottom: 315 }, false, true);
		extendAll(1);
	});

	// ---------------------------------------------------------------- f26: animated masks, a mask inside masked content, a movie clip as mask
	build("f26-masks3", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		symbol("spinMask", "movie clip", function () {
			rect(-60, -15, 60, 15, "#000000");
			var t = tl();
			t.insertKeyframe(11);
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
			t.layers[0].frames[0].motionTweenRotate = "clockwise";
			t.layers[0].frames[0].motionTweenRotateTimes = 1;
		});
		symbol("window", "movie clip", function () {
			var t = tl();
			rect(-50, -50, 50, 50, "#33AA33");
			rect(-50, -10, 50, 10, "#FFFFFF");
			var maskIdx = t.addNewLayer("m", "mask", true);
			t.setSelectedLayers(maskIdx);
			t.currentLayer = maskIdx;
			oval(-35, -35, 35, 35, "#000000");
			t.layers[maskIdx + 1].layerType = "masked";
			t.layers[maskIdx + 1].parentLayer = t.layers[maskIdx];
		});
		layer("bg");
		rect(0, 0, 400, 300, "#EEEEEE");
		// left: a shape-tweened mask over a rectangle and a tweened clip that has its own mask
		layer("content");
		rect(10, 10, 190, 290, "#FF9933");
		layer("contentWindow");
		classicTween("window", 100, 150, 23, function (e) { e.rotation = 90; });
		layer("maskShape");
		var t = tl();
		var li = t.currentLayer;
		oval(30, 30, 90, 90, "#000000");
		t.insertBlankKeyframe(23);
		t.currentFrame = 23;
		rect(20, 60, 180, 260, "#000000");
		t.setSelectedLayers(li);
		t.setSelectedFrames(0, 1);
		t.setFrameProperty("tweenType", "shape");
		// right: a spinning movie clip as the mask, with text in the masked layer
		layer("content2");
		rect(210, 10, 390, 290, "#3366CC");
		doc.selectNone();
		doc.addNewText({ left: 220, top: 130, right: 390, bottom: 170 }, "MASKED");
		doc.setElementTextAttr("size", 30);
		doc.setElementTextAttr("fillColor", "#FFFFFF");
		layer("maskClip");
		var mc = place("spinMask", 300, 150, 0);
		mc.scaleX = mc.scaleY = 1.3;
		t = tl();
		var idx = {};
		for (var j = 0; j < t.layers.length; j++) idx[t.layers[j].name] = j;
		t.layers[idx.maskShape].layerType = "mask";
		t.layers[idx.content].layerType = "masked"; t.layers[idx.content].parentLayer = t.layers[idx.maskShape];
		t.layers[idx.contentWindow].layerType = "masked"; t.layers[idx.contentWindow].parentLayer = t.layers[idx.maskShape];
		t.layers[idx.maskClip].layerType = "mask";
		t.layers[idx.content2].layerType = "masked"; t.layers[idx.content2].parentLayer = t.layers[idx.maskClip];
		extendAll(24);
	});

	// Movie clips used by f27/f28: a looping spinner, an intro that stops itself, a clip with a
	// nested loop of a different length, a colour pulse.
	function runningClips() {
		boxSymbol();
		symbol("spin8", "movie clip", function () {
			rect(-25, -6, 25, 6, "#CC3300");
			var t = tl();
			t.insertKeyframe(7);
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
			t.layers[0].frames[0].motionTweenRotate = "clockwise";
			t.layers[0].frames[0].motionTweenRotateTimes = 1;
		});
		symbol("intro", "movie clip", function () {
			var t = tl();
			place("box", 0, 0, 0);
			t.insertKeyframe(9);
			t.layers[0].frames[9].elements[0].x = 80;
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
			t.layers[0].frames[0].tweenEasing = -80;
			var a = t.addNewLayer("actions", "normal", true);
			t.setSelectedLayers(a); t.currentLayer = a;
			t.insertKeyframe(9);
			t.layers[a].frames[9].actionScript = "stop();";
		});
		symbol("pulse6", "movie clip", function () {
			var t = tl();
			var e = place("box", 0, 0, 0);
			t.insertKeyframe(5);
			var e2 = t.layers[0].frames[5].elements[0];
			doc.selectNone(); e2.selected = true; doc.setInstanceTint("#00CC00", 70); doc.selectNone();
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
			var l2 = t.addNewLayer("inner", "normal", true);
			t.setSelectedLayers(l2); t.currentLayer = l2;
			place("spin8", 0, 40, 0);
			t.setSelectedLayers(l2);
			t.insertFrames(5, false, 1);
		});
	}

	// ---------------------------------------------------------------- f27: stop() at the end, movie clips keep running
	build("f27-stop", function () {
		newDoc("timeline", 400, 300, 24);
		runningClips();
		layer("spin");
		place("spin8", 70, 60, 0);
		layer("intro");
		var t = tl();
		t.insertBlankKeyframe(7);
		place("intro", 140, 140, 7);
		layer("pulse");
		place("pulse6", 300, 70, 0);
		layer("mover");
		classicTween("box", 60, 240, 11, function (e) { e.x = 320; });
		extendAll(12);
		layer("actions");
		t = tl();
		t.insertKeyframe(11);
		t.layers[t.currentLayer].frames[11].actionScript = "stop();";
	});

	// ---------------------------------------------------------------- f28: one frame with stop(), all animation inside movie clips
	build("f28-onestop", function () {
		newDoc("timeline", 400, 300, 24);
		runningClips();
		layer("spin");
		place("spin8", 80, 80, 0);
		layer("pulse");
		place("pulse6", 260, 100, 0);
		layer("intro");
		place("intro", 100, 220, 0);
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = "stop();";
	});

	// ---------------------------------------------------------------- f29: motion tweens with property keyframes; more blend modes
	build("f29-motion", function () {
		newDoc("timeline", 500, 300, 24);
		runningClips();
		symbol("counter", "graphic", function () {
			for (var i = 0; i < 6; i++) {
				var t = tl();
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(0, 0, 10 + i * 8, 8, "#0066FF");
			}
		});
		// a group with a "layer" blend: alpha and erase cut into the clip's own content
		symbol("cutout", "movie clip", function () {
			var t = tl();
			rect(-40, -30, 40, 30, "#FF9900");
			var l1 = t.addNewLayer("alpha", "normal", true);
			t.setSelectedLayers(l1); t.currentLayer = l1;
			var e = place("box", -15, 0, 0);
			e.blendMode = "erase";
		});
		function motion(name, x, y, mid, end) {
			var t = tl();
			var li = t.currentLayer;
			var el = place(name, x, y, 0);
			t.createMotionObject(0, 23);
			if (mid) {
				t.currentFrame = 11;
				doc.selectNone();
				doc.selection = [t.layers[li].frames[11].elements[0]];
				mid();
			}
			t.currentFrame = 23;
			doc.selectNone();
			doc.selection = [t.layers[li].frames[23].elements[0]];
			end();
			doc.selectNone();
		}
		layer("path");
		motion("box", 50, 50, function () { doc.moveSelectionBy({ x: 120, y: 80 }); }, function () { doc.moveSelectionBy({ x: 260, y: 0 }); doc.rotateSelection(120); doc.scaleSelection(1.5, 0.7); });
		layer("fx");
		motion("box", 60, 240, null, function () {
			doc.moveSelectionBy({ x: 200, y: 0 });
			doc.setInstanceAlpha(30);
			doc.addFilter("blurFilter"); doc.setFilterProperty("blurX", 0, 10); doc.setFilterProperty("blurY", 0, 2);
		});
		layer("graphic");
		motion("counter", 380, 220, null, function () { doc.moveSelectionBy({ x: 40, y: -60 }); });
		layer("blendBg");
		rect(290, 10, 500, 130, "#66AA99");
		rect(290, 70, 500, 130, "#AA3366");
		layer("blends");
		var bl = ["subtract", "darken", "lighten", "hardlight", "difference", "invert"];
		for (var i = 0; i < bl.length; i++) {
			var b = place("box", 330 + (i % 3) * 60, 40 + Math.floor(i / 3) * 50, 0);
			b.blendMode = bl[i];
		}
		layer("cutout");
		var c = place("cutout", 420, 160, 0);
		c.blendMode = "layer";
		extendAll(24);
	});

	// ---------------------------------------------------------------- f30: HTML5 Canvas banner: play 3 times, a clip looping to a label
	build("f30-banner", function () {
		newDoc("htmlcanvas", 400, 200, 24);
		runningClips();
		symbol("blink", "movie clip", function () {
			var t = tl();
			var colors = ["#FF0000", "#00AA00", "#0000FF", "#FFAA00", "#AA00AA", "#000000"];
			for (var i = 0; i < 6; i++) {
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(-15, -15, 15, 15, colors[i]);
			}
			t.layers[0].frames[1].name = "on";
			var a = t.addNewLayer("actions", "normal", true);
			t.setSelectedLayers(a); t.currentLayer = a;
			t.insertKeyframe(5);
			// frame 6 is never shown: the goto runs before it is drawn
			t.layers[a].frames[5].actionScript = "this.gotoAndPlay(\"on\");";
		});
		layer("mover");
		classicTween("box", 50, 100, 11, function (e) { e.x = 330; e.rotation = 90; }, function (f) { f.tweenEasing = 40; });
		layer("blink");
		place("blink", 200, 40, 0);
		layer("spin");
		place("spin8", 330, 160, 0);
		extendAll(12);
		layer("actions");
		var t = tl();
		t.insertKeyframe(11);
		// Animate's "stop after N loops" code snippet
		t.layers[t.currentLayer].frames[11].actionScript =
			"if (!this.alreadyExecuted) {\n\tthis.alreadyExecuted = true;\n\tthis.loopNum = 1;\n} else {\n\tthis.loopNum++;\n\tif (this.loopNum == 3) {\n\t\tthis.stop();\n\t}\n}";
	});

	// ---------------------------------------------------------------- f31: text: runs, alignment, spacing, transformed and tweened text
	build("f31-text2", function () {
		newDoc("timeline", 500, 320, 24);
		function text(rect, str, attrs, props) {
			doc.selectNone();
			doc.addNewText(rect, str);
			for (var k in props) doc.setElementProperty(k, props[k]);
			for (var a in attrs) doc.setElementTextAttr(a, attrs[a]);
			var t = tl(), els = t.layers[t.currentLayer].frames[0].elements;
			return els[els.length - 1];
		}
		layer("runs");
		var t1 = text({ left: 10, top: 10, right: 240, bottom: 60 }, "Bold red, italic blue", { size: 20, fillColor: "#000000" });
		// style parts of the text: runs
		t1.setTextAttr("bold", true, 0, 8);
		t1.setTextAttr("fillColor", "#CC0000", 0, 8);
		t1.setTextAttr("italic", true, 10, 21);
		t1.setTextAttr("fillColor", "#0000CC", 10, 21);
		t1.setTextAttr("size", 26, 17, 21);
		layer("right");
		text({ left: 260, top: 10, right: 490, bottom: 90 }, "Right aligned\rsecond line", { size: 16, alignment: "right", lineSpacing: 6 }, {});
		layer("spaced");
		text({ left: 10, top: 80, right: 240, bottom: 110 }, "L e t t e r s", { size: 16, letterSpacing: 4, fillColor: "#006600" }, {});
		layer("dynRight");
		text({ left: 260, top: 110, right: 490, bottom: 170 }, "Dynamic right\raligned text", { size: 15, alignment: "right", fillColor: "#660066" }, { textType: "dynamic", lineType: "multiline" });
		layer("input");
		text({ left: 10, top: 130, right: 200, bottom: 155 }, "Input field", { size: 14 }, { textType: "input" });
		// static text inside a symbol, rotated and tweened with alpha
		symbol("label", "movie clip", function () {
			doc.selectNone();
			doc.addNewText({ left: -60, top: -12, right: 60, bottom: 12 }, "Tween me");
			doc.setElementTextAttr("size", 18);
			doc.setElementTextAttr("fillColor", "#003399");
		});
		layer("tween");
		classicTween("label", 120, 230, 23, function (e) {
			e.x = 380; e.rotation = 30; e.scaleX = 1.3;
			doc.selectNone(); e.selected = true; doc.setInstanceAlpha(40); doc.selectNone();
		});
		layer("shadowed");
		var s = place("label", 380, 290, 0);
		doc.selectNone(); s.selected = true;
		doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 3); doc.setFilterProperty("blurX", 0, 2); doc.setFilterProperty("blurY", 0, 2);
		doc.selectNone();
		extendAll(24);
	});

	// ---------------------------------------------------------------- f32: filters on rotated/scaled instances, cut-outs in shared layers
	build("f32-blend2", function () {
		newDoc("timeline", 500, 360, 24);
		boxSymbol();
		symbol("fade", "movie clip", function () {
			doc.selectNone();
			doc.setCustomFill({ style: "linearGradient", colorArray: ["#000000", "#000000"], alphaArray: [100, 0], posArray: [0, 255], matrix: { a: 0.05, b: 0, c: 0, d: 0.05, tx: 0, ty: 0 } });
			noStroke();
			doc.addNewRectangle({ left: -40, top: -25, right: 40, bottom: 25 }, 0, false, true);
		});
		// a clip whose single layer holds: background, erase element, stripes above it; and an alpha element
		symbol("shared", "movie clip", function () {
			rect(-70, -45, 70, 45, "#3366CC");
			var er = place("box", -30, 0, 0); er.blendMode = "erase";
			rect(-70, 20, 70, 30, "#FFCC00");
		});
		symbol("faded", "movie clip", function () {
			rect(-70, -45, 70, 45, "#CC3366");
			rect(-50, -10, 50, 10, "#FFFFFF");
			var t = tl();
			var l2 = t.addNewLayer("alpha", "normal", true);
			t.setSelectedLayers(l2); t.currentLayer = l2;
			var a = place("fade", 20, 0, 0); a.blendMode = "alpha";
		});
		layer("bg");
		rect(0, 0, 500, 360, "#99CC99");
		rect(0, 180, 500, 360, "#336666");
		layer("filters");
		var specs = [
			[60, 60, 45, 1, function () { doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 20); doc.setFilterProperty("angle", 0, 0); }],
			[170, 60, 90, 0.7, function () { doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 15); doc.setFilterProperty("blurX", 0, 0); doc.setFilterProperty("blurY", 0, 0); }],
			[280, 60, 30, 1.5, function () { doc.addFilter("blurFilter"); doc.setFilterProperty("blurX", 0, 20); doc.setFilterProperty("blurY", 0, 0); }],
			[400, 60, -60, 1.2, function () { doc.addFilter("glowFilter"); doc.setFilterProperty("color", 0, "#FF00FF"); doc.setFilterProperty("blurX", 0, 16); doc.setFilterProperty("blurY", 0, 4); }]
		];
		for (var i = 0; i < specs.length; i++) {
			var e = place("box", specs[i][0], specs[i][1], 0);
			e.rotation = specs[i][2]; e.scaleX = e.scaleY = specs[i][3];
			doc.selectNone(); e.selected = true; specs[i][4](); doc.selectNone();
		}
		layer("cutouts");
		var s1 = place("shared", 110, 200, 0); s1.blendMode = "layer";
		var s2 = place("faded", 290, 200, 0); s2.blendMode = "layer";
		// erase without a "layer" parent: Animate leaves the element out
		var s3 = place("shared", 420, 300, 0); s3.scaleX = s3.scaleY = 0.5;
		layer("subtract");
		var sb = place("fade", 400, 200, 0); sb.blendMode = "subtract"; sb.scaleX = 1.2;
		var sb2 = place("box", 120, 320, 0); sb2.blendMode = "subtract";
		doc.selectNone(); sb2.selected = true; doc.setInstanceAlpha(60); doc.selectNone();
		extendAll(1);
	});

	// ---------------------------------------------------------------- f33: groups holding symbol instances (they keep animating)
	build("f33-groups", function () {
		newDoc("timeline", 500, 300, 24);
		runningClips();
		doc.importFile(root + "/assets/checker.png", true);
		var bmp = null;
		for (var i = 0; i < lib.items.length; i++) if (lib.items[i].itemType == "bitmap") bmp = lib.items[i];
		function groupAll() {
			doc.selectAll();
			doc.group();
			doc.selectNone();
		}
		// group: background shape, a running clip, a tinted box
		layer("g1");
		rect(20, 20, 200, 140, "#DDEEFF", "#335577");
		place("spin8", 80, 80, 0);
		var b = place("box", 150, 100, 0);
		doc.selectNone(); b.selected = true; doc.setInstanceTint("#00AA00", 60); doc.selectNone();
		groupAll();
		// nested: an outer group with a shape and an inner group holding a clip
		layer("g2");
		rect(260, 20, 480, 140, "#FFEEDD");
		place("pulse6", 330, 70, 0);
		doc.selectAll();
		var t = tl();
		var els = t.layers[t.currentLayer].frames[0].elements;
		doc.selection = [els[els.length - 1]];
		doc.group();
		doc.selectNone();
		rect(400, 100, 470, 130, "#CC6600");
		groupAll();
		// text and an instance in one group, scaled
		layer("g3");
		doc.selectNone();
		doc.addNewText({ left: 30, top: 180, right: 200, bottom: 210 }, "Grouped text");
		doc.setElementTextAttr("size", 18);
		place("spin8", 120, 250, 0);
		groupAll();
		t = tl();
		var g3 = t.layers[t.currentLayer].frames[0].elements[0];
		doc.selection = [g3];
		doc.scaleSelection(1.2, 0.9);
		doc.selectNone();
		// a bitmap inside a group
		if (bmp) {
			layer("g4");
			rect(280, 170, 460, 280, "#EEEEEE");
			lib.addItemToDocument({ x: 330, y: 200 }, bmp.name);
			groupAll();
		}
		extendAll(24);
	});

	// ---------------------------------------------------------------- f34: layer folders (nested, hidden), a mask pair and a guide inside folders
	build("f34-folders", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		function idx(name) { var ls = tl().layers; for (var i = 0; i < ls.length; i++) if (ls[i].name == name) return i; log.push("f34: no layer " + name); return -1; }
		// a new layer inside folder `folder` (above the folder's other layers), made current
		function child(folder, name, type) {
			var t = tl();
			t.setSelectedLayers(idx(folder));
			t.currentLayer = idx(folder);
			t.addNewLayer(name, type || "normal", false);
			var i = idx(name);
			// right below the folder: an empty folder only takes it by assignment
			if (t.layers[i].parentLayer != t.layers[idx(folder)]) t.layers[i].parentLayer = t.layers[idx(folder)];
			t.setSelectedLayers(i);
			t.currentLayer = i;
		}
		var t = tl();
		t.addNewLayer("hiddenFolder", "folder", true);
		child("hiddenFolder", "hiddenChild");
		rect(250, 200, 380, 280, "#FF00FF");
		t = tl();
		t.setSelectedLayers(idx("hiddenFolder")); t.currentLayer = idx("hiddenFolder");
		t.addNewLayer("outer", "folder", true);
		// outer: inner folder (a1, a2), a mask pair, a guide layer
		child("outer", "inner", "folder");
		child("inner", "a1");
		rect(20, 20, 120, 120, "#CC3333");
		child("inner", "a2");
		classicTween("box", 60, 180, 23, function (e) { e.x = 330; e.rotation = 90; });
		t = tl();
		t.setSelectedLayers(idx("inner")); t.currentLayer = idx("inner");
		t.addNewLayer("m_content", "normal", true);
		t.setSelectedLayers(idx("m_content")); t.currentLayer = idx("m_content");
		rect(160, 20, 380, 140, "#3366CC");
		t.addNewLayer("m_mask", "normal", true);
		t.setSelectedLayers(idx("m_mask")); t.currentLayer = idx("m_mask");
		oval(200, 30, 340, 130, "#000000");
		t.addNewLayer("guideL", "normal", true);
		t.setSelectedLayers(idx("guideL")); t.currentLayer = idx("guideL");
		rect(20, 250, 100, 290, "#00FF00");
		t = tl();
		var ls = ["m_content", "m_mask", "guideL"];
		for (var q = 0; q < ls.length; q++) if (!t.layers[idx(ls[q])].parentLayer) t.layers[idx(ls[q])].parentLayer = t.layers[idx("outer")];
		t.layers[idx("m_mask")].layerType = "mask";
		t.layers[idx("m_content")].layerType = "masked";
		t.layers[idx("m_content")].parentLayer = t.layers[idx("m_mask")];
		t.layers[idx("guideL")].layerType = "guide";
		t.layers[idx("hiddenFolder")].visible = false;
		var info = [];
		for (var i = 0; i < t.layers.length; i++) info.push(t.layers[i].name + ":" + t.layers[i].layerType + (t.layers[i].parentLayer ? "<" + t.layers[i].parentLayer.name : "") + (t.layers[i].visible ? "" : "(hidden)"));
		log.push("f34 layers: " + info.join(", "));
		extendAll(24);
	});

	// ---------------------------------------------------------------- f35: edge cases: late content, flips and collapses through zero, special characters, odd frame rate, goto into the timeline
	build("f35-edge", function () {
		newDoc("timeline", 480, 320, 23.976);
		boxSymbol();
		symbol("Grafik ä & <b>", "graphic", function () {
			rect(-20, -20, 20, 20, "#00AA88");
			var t = tl();
			t.insertBlankKeyframe(3);
			t.currentFrame = 3;
			oval(-20, -20, 20, 20, "#AA0088");
			t.insertFrames(2, false, 4);
		});
		layer("late");
		var t = tl();
		t.insertBlankKeyframe(6);
		place("box", 60, 60, 6);
		t.insertBlankKeyframe(18);
		layer("flip");
		classicTween("box", 170, 60, 23, function (e) { e.scaleX = -1; });
		layer("collapse");
		classicTween("box", 280, 60, 23, function (e) {
			doc.selectNone(); e.selected = true;
			doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 6);
			doc.selectNone();
		}, function (f) { f.elements[0].scaleX = 0; f.elements[0].scaleY = 0; });
		layer("fade");
		classicTween("box", 400, 60, 23, function (e) {
			doc.selectNone(); e.selected = true; doc.setInstanceAlpha(100); doc.selectNone();
		}, function (f) { doc.selectNone(); f.elements[0].selected = true; doc.setInstanceAlpha(0); doc.selectNone(); });
		layer("Ebene <&> 日本");
		var g = place("Grafik ä & <b>", 60, 160, 0);
		g.loop = "loop";
		t = tl();
		t.insertKeyframe(4);
		t.layers[t.currentLayer].frames[4].name = "start ä&<x>";
		layer("text");
		doc.selectNone();
		doc.addNewText({ left: 120, top: 140, right: 460, bottom: 180 }, "Größe <&> „quotes“ €");
		doc.setElementTextAttr("size", 22);
		layer("cache");
		var el = place("box", 160, 240, 0);
		el.cacheAsBitmap = true; el.rotation = 15;
		layer("tiny");
		el = place("box", 250, 240, 0);
		el.scaleX = 0.05; el.scaleY = 0.05;
		layer("huge");
		el = place("box", 470, 310, 0);
		el.scaleX = 8; el.scaleY = 8;
		layer("oneframe");
		classicTween("box", 360, 250, 1, function (e) { e.rotation = 45; e.y = 230; });
		layer("mirrored");
		el = place("box", 60, 270, 0);
		el.scaleY = -1; el.name = "inst_ü";
		doc.selectNone(); el.selected = true;
		doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 5); doc.setFilterProperty("angle", 0, 45);
		doc.selectNone();
		extendAll(24);
		layer("actions");
		t = tl();
		t.insertKeyframe(23);
		t.layers[t.currentLayer].frames[23].actionScript = "gotoAndPlay(\"start ä&<x>\"); // back to the label";
	});

	// ---------------------------------------------------------------- f36: two scenes, a script jumps into the second one
	build("f36-scenes", function () {
		newDoc("timeline", 300, 200, 24);
		boxSymbol();
		layer("mover");
		classicTween("box", 50, 100, 11, function (e) { e.x = 250; e.rotation = 90; });
		layer("actions");
		var t = tl();
		t.insertKeyframe(11);
		t.layers[t.currentLayer].frames[11].actionScript = "gotoAndPlay(1, \"Zweite Szene\");";
		doc.addNewScene("Zweite Szene");
		rect(20, 20, 280, 180, "#CC0000");
		doc.editScene(0);
	});

	// ---------------------------------------------------------------- f37: an empty document
	build("f37-empty", function () {
		newDoc("timeline", 200, 100, 24);
	});

	// ---------------------------------------------------------------- f38: a file name with spaces, umlauts and an ampersand
	build("f38 Ümlaut & Co", function () {
		newDoc("timeline", 300, 200, 24);
		boxSymbol();
		layer("mover");
		classicTween("box", 50, 100, 11, function (e) { e.x = 250; });
	});

	// ---------------------------------------------------------------- f39: large stage, high frame rate, dark background, long timeline
	build("f39-big", function () {
		newDoc("timeline", 1920, 1080, 60);
		doc.backgroundColor = "#202030";
		runningClips();
		layer("mover");
		classicTween("box", 100, 540, 239, function (e) { e.x = 1820; e.rotation = 170; e.scaleX = 4; e.scaleY = 4; }, function (f) { f.tweenEasing = -60; });
		layer("spin");
		var el = place("spin8", 960, 200, 0);
		el.scaleX = 6; el.scaleY = 6;
		layer("shape");
		var t = tl();
		oval(200, 800, 400, 1000, "#FFCC00");
		t.insertBlankKeyframe(119);
		t.currentFrame = 119;
		rect(1500, 800, 1800, 1000, "#00CCFF");
		t.setSelectedFrames(0, 1);
		t.setFrameProperty("tweenType", "shape");
		extendAll(240);
	});

	// ---------------------------------------------------------------- f41: alpha on symbols: per shape (overlaps show), masks, nesting, bitmaps, filters, cache
	build("f41-alpha", function () {
		newDoc("timeline", 500, 320, 24);
		doc.importFile(root + "/assets/checker.png", true);
		var bmp = null;
		for (var i = 0; i < lib.items.length; i++) if (lib.items[i].itemType == "bitmap") bmp = lib.items[i];
		if (!bmp) throw new Error("bitmap import failed");
		// stroked shape with an overlapping drawing on a second layer
		symbol("card", "movie clip", function () {
			doc.setCustomFill({ style: "solid", color: "#3366CC" });
			doc.setCustomStroke({ style: "solid", color: "#001133", thickness: 6, capType: "round", joinType: "round" });
			doc.addNewRectangle({ left: -40, top: -25, right: 40, bottom: 25 }, 0);
			var t = tl();
			var l = t.addNewLayer("over", "normal", true);
			t.setSelectedLayers(l); t.currentLayer = l;
			oval(-10, -35, 50, 15, "#FF9900");
		});
		symbol("maskedCard", "movie clip", function () {
			var t = tl();
			rect(-45, -30, 45, 30, "#00AA66", "#003322");
			var m = t.addNewLayer("mask", "normal", true);
			t.setSelectedLayers(m); t.currentLayer = m;
			oval(-30, -30, 30, 30, "#000000");
			var mi = -1, ci = -1;
			for (var k = 0; k < t.layers.length; k++) { if (t.layers[k].name == "mask") mi = k; else ci = k; }
			t.layers[mi].layerType = "mask";
			t.layers[ci].layerType = "masked";
			t.layers[ci].parentLayer = t.layers[mi];
		});
		symbol("outer", "movie clip", function () {
			var e = place("card", 0, 0, 0);
			doc.selectNone(); e.selected = true; doc.setInstanceAlpha(50); doc.selectNone();
			rect(30, 10, 70, 40, "#CC0000");
		});
		symbol("photo", "movie clip", function () {
			lib.addItemToDocument({ x: 0, y: 0 }, bmp.name);
			rect(10, 10, 50, 40, "#FFFFFF", "#000000");
		});
		function alpha(e, a) { doc.selectNone(); e.selected = true; doc.setInstanceAlpha(a); doc.selectNone(); return e; }
		layer("plain");
		alpha(place("card", 70, 60, 0), 50);
		layer("fade");
		classicTween("card", 190, 60, 23, function (e) { alpha(e, 100); }, function (f) { alpha(f.elements[0], 10); });
		layer("masked");
		classicTween("maskedCard", 320, 60, 23, function (e) { alpha(e, 90); }, function (f) { alpha(f.elements[0], 20); });
		layer("nested");
		alpha(place("outer", 430, 60, 0), 60);
		layer("bitmap");
		alpha(place("photo", 40, 150, 0), 50);
		layer("filtered");
		var e = alpha(place("card", 220, 190, 0), 50);
		doc.selectNone(); e.selected = true; doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 4); doc.selectNone();
		layer("cached");
		e = alpha(place("card", 360, 190, 0), 50);
		e.cacheAsBitmap = true;
		layer("blended");
		e = alpha(place("card", 90, 270, 0), 50);
		e.blendMode = "multiply";
		layer("text");
		doc.selectNone();
		doc.addNewText({ left: 200, top: 255, right: 480, bottom: 300 }, "Alpha 50 %");
		doc.setElementTextAttr("size", 26);
		symbol("label", "movie clip", function () {
			doc.addNewText({ left: 0, top: 0, right: 200, bottom: 40 }, "Label");
			doc.setElementTextAttr("size", 30);
			doc.setElementTextAttr("fillColor", "#AA0000");
		});
		layer("labelAlpha");
		alpha(place("label", 300, 270, 0), 40);
		extendAll(24);
	});

	// ---------------------------------------------------------------- f40: stroke scale modes, hairlines, styles, caps and joins in scaled instances
	build("f40-strokes", function () {
		newDoc("timeline", 500, 360, 24);
		var modes = ["normal", "none", "horizontal", "vertical"];
		for (var i = 0; i < modes.length; i++) {
			(function (mode) {
				symbol("frame_" + mode, "movie clip", function () {
					doc.setCustomFill({ style: "solid", color: "#99CCFF" });
					doc.setCustomStroke({ style: "solid", color: "#003366", thickness: 3, capType: "round", joinType: "round", scaleType: mode });
					doc.addNewRectangle({ left: -20, top: -15, right: 20, bottom: 15 }, 0);
				});
			})(modes[i]);
		}
		for (i = 0; i < modes.length; i++) {
			layer("mode_" + modes[i]);
			var el = place("frame_" + modes[i], 70 + i * 120, 70, 0);
			el.scaleX = 2.5; el.scaleY = 1.5;
		}
		symbol("hair", "movie clip", function () {
			// the thinnest stroke (0.1) draws as a hairline at any scale
			doc.setCustomStroke({ style: "solid", color: "#CC0000", thickness: 0.1, capType: "round", joinType: "round" });
			doc.addNewLine({ x: -20, y: -20 }, { x: 20, y: 20 });
			doc.addNewLine({ x: -20, y: 20 }, { x: 20, y: -20 });
		});
		layer("hairline");
		el = place("hair", 70, 170, 0);
		el.scaleX = 3; el.scaleY = 2;
		symbol("styles", "graphic", function () {
			var y = -30;
			var st = [
				{ style: "dotted", color: "#006600", thickness: 3, dotSpace: 3 },
				{ style: "dashed", color: "#660066", thickness: 4, dash1: 10, dash2: 5, capType: "square" },
				{ style: "ragged", color: "#666600", thickness: 2 },
				{ style: "solid", color: "#000000", thickness: 8, capType: "none", joinType: "miter", miterLimit: 2 }
			];
			for (var k = 0; k < st.length; k++) {
				doc.setCustomStroke(st[k]);
				doc.addNewLine({ x: -60, y: y + k * 18 }, { x: 60, y: y + k * 18 });
			}
		});
		layer("styles");
		el = place("styles", 330, 190, 0);
		el.scaleX = 1.5; el.scaleY = 1.5;
		symbol("zigzag", "graphic", function () {
			doc.setCustomStroke({ style: "solid", color: "#AA5500", thickness: 6, capType: "square", joinType: "miter", miterLimit: 4 });
			doc.addNewLine({ x: -50, y: 10 }, { x: -25, y: -10 });
			doc.addNewLine({ x: -25, y: -10 }, { x: 0, y: 10 });
			doc.addNewLine({ x: 0, y: 10 }, { x: 25, y: -10 });
			doc.addNewLine({ x: 25, y: -10 }, { x: 50, y: 10 });
		});
		layer("zigzag");
		el = place("zigzag", 130, 290, 0);
		layer("thin-tween");
		classicTween("frame_normal", 380, 300, 23, function (e) { e.scaleX = 0.1; e.scaleY = 0.1; }, function (f) { f.elements[0].scaleX = 2; f.elements[0].scaleY = 1; });
		extendAll(24);
	});

	// ---------------------------------------------------------------- f42: bitmaps with Animate's compression settings: photo (JPEG) and lossless, alpha, a pixel pattern
	build("f42-images", function () {
		newDoc("timeline", 500, 340, 24);
		var files = ["photo.jpg", "photo-as-png.png", "icon.png", "pattern.png", "glow.png"];
		var items = {};
		for (var i = 0; i < files.length; i++) {
			doc.importFile(root + "/assets/" + files[i], true);
			var it = lib.items[lib.findItemIndex(files[i])];
			if (!it) throw new Error("import failed: " + files[i]);
			items[files[i]] = it;
		}
		// a PNG Animate is told to compress as a photo, and a transparent one
		items["photo-as-png.png"].compressionType = "photo";
		items["photo-as-png.png"].quality = 50;
		items["glow.png"].compressionType = "photo";
		items["glow.png"].quality = 70;
		items["pattern.png"].allowSmoothing = false;
		var info = [];
		for (var k in items) info.push(k + ":" + items[k].compressionType + "/" + items[k].quality + "/" + items[k].originalCompressionType);
		log.push("f42 bitmaps: " + info.join(", "));
		layer("photo");
		lib.addItemToDocument({ x: 130, y: 90 }, "photo.jpg");
		layer("photoPng");
		lib.addItemToDocument({ x: 370, y: 90 }, "photo-as-png.png");
		layer("pattern");
		doc.selectNone();
		// the fill matrix is in twips: 60 = scale 3; one repeated, one clipped (edges stretched)
		doc.setCustomFill({ style: "bitmap", bitmapPath: "pattern.png", bitmapIsClipped: false, matrix: { a: 60, b: 0, c: 0, d: 60, tx: 20, ty: 200 } });
		noStroke();
		doc.addNewRectangle({ left: 20, top: 200, right: 110, bottom: 320 }, 0, false, true);
		layer("patternClip");
		doc.selectNone();
		doc.setCustomFill({ style: "bitmap", bitmapPath: "pattern.png", bitmapIsClipped: true, matrix: { a: 60, b: 0, c: 0, d: 60, tx: 130, ty: 220 } });
		noStroke();
		doc.addNewRectangle({ left: 120, top: 200, right: 200, bottom: 320 }, 0, false, true);
		layer("glow");
		lib.addItemToDocument({ x: 330, y: 260 }, "glow.png");
		symbol("iconClip", "movie clip", function () { lib.addItemToDocument({ x: 0, y: 0 }, "icon.png"); });
		layer("icon");
		classicTween("iconClip", 260, 250, 23, function (e) { e.x = 440; e.rotation = 90; e.scaleX = e.scaleY = 1.5; });
		extendAll(24);
	});

	// ---------------------------------------------------------------- f44: bitmaps shown smaller than their pixels (downscaling)
	build("f44-bitmap-sizes", function () {
		newDoc("timeline", 500, 400, 24);
		var files = ["large.png", "nested.png", "fill.png", "tile.png", "pixels.png", "wide.png"];
		var items = {};
		for (var i = 0; i < files.length; i++) {
			doc.importFile(root + "/assets/" + files[i], true);
			var it = lib.items[lib.findItemIndex(files[i])];
			if (!it) throw new Error("import failed: " + files[i]);
			items[files[i]] = it;
		}
		items["large.png"].compressionType = "photo";
		items["large.png"].quality = 80;
		items["pixels.png"].allowSmoothing = false;
		var put = function (name, m) {
			var e = place(name, 0, 0, 0);
			e.matrix = m;
			return e;
		};
		// 640 x 480 at a quarter
		layer("large");
		put("large.png", { a: 0.25, b: 0, c: 0, d: 0.25, tx: 10, ty: 10 });
		// 400 x 300 at half size in a clip tweened from 0.2 to 0.5: at most 0.25 on stage
		symbol("nestedClip", "movie clip", function () { put("nested.png", { a: 0.5, b: 0, c: 0, d: 0.5, tx: -100, ty: -75 }); });
		var li = layer("nested");
		classicTween("nestedClip", 330, 90, 23, function (e) { e.scaleX = e.scaleY = 0.5; });
		var first = tl().layers[li].frames[0].elements[0];
		first.scaleX = first.scaleY = 0.2;
		// bitmap fills (matrix in twips: 5 = scale 0.25): 320 x 320 clipped, a 64 x 64 tile repeated
		layer("fill");
		doc.selectNone();
		doc.setCustomFill({ style: "bitmap", bitmapPath: "fill.png", bitmapIsClipped: true, matrix: { a: 5, b: 0, c: 0, d: 5, tx: 20, ty: 200 } });
		noStroke();
		doc.addNewRectangle({ left: 20, top: 200, right: 110, bottom: 290 }, 0, false, true);
		layer("tile");
		doc.selectNone();
		doc.setCustomFill({ style: "bitmap", bitmapPath: "tile.png", bitmapIsClipped: false, matrix: { a: 5, b: 0, c: 0, d: 5, tx: 130, ty: 200 } });
		noStroke();
		doc.addNewRectangle({ left: 130, top: 200, right: 230, bottom: 300 }, 0, false, true);
		// pixel art without smoothing at a quarter
		layer("pixels");
		put("pixels.png", { a: 0.25, b: 0, c: 0, d: 0.25, tx: 250, ty: 200 });
		// 400 x 200 rotated by 20 degrees, x at 0.2 and y at 0.8
		layer("wide");
		var r = (20 * Math.PI) / 180;
		put("wide.png", { a: 0.2 * Math.cos(r), b: 0.2 * Math.sin(r), c: -0.8 * Math.sin(r), d: 0.8 * Math.cos(r), tx: 360, ty: 200 });
		extendAll(24);
		var info = [];
		for (var k in items) info.push(k + ":" + items[k].compressionType + "/" + items[k].allowSmoothing);
		log.push("f44 bitmaps: " + info.join(", "));
	});

	// ---------------------------------------------------------------- f43: sounds
	// An event sound with an effect and loops, in and out points, a custom (panning) envelope, a
	// stream sound, an imported MP3, compression settings (Raw at 11 kHz, MP3 32 kbps mono), a sound
	// inside a movie clip and a stop sound.
	build("f43-sounds", function () {
		newDoc("timeline", 300, 200, 24);
		var files = ["chord.wav", "melody.mp3", "beep.wav", "chord mono.wav"];
		var items = {};
		for (var i = 0; i < files.length; i++) {
			doc.importFile(root + "/assets/" + files[i], true);
			var it = lib.items[lib.findItemIndex(files[i])];
			if (!it) throw new Error("import failed: " + files[i]);
			items[files[i]] = it;
		}
		var copy = items["chord mono.wav"];
		copy.compressionType = "MP3";
		copy.bitRate = "32 kbps";
		copy.convertStereoToMono = true;
		items["beep.wav"].compressionType = "Raw";
		items["beep.wav"].sampleRate = "11 kHz";
		var t = tl();
		var sound = function (li, f, item, sync, setup) {
			if (f > 0) t.insertBlankKeyframe(f);
			var fr = t.layers[li].frames[f];
			fr.soundLibraryItem = item;
			fr.soundSync = sync;
			if (setup) setup(fr);
		};
		// something to look at: a box moving across
		symbol("snd box", "graphic", function () { rect(-20, -20, 20, 20, "#3366cc"); });
		layer("box");
		classicTween("snd box", 40, 100, 47, function (e) { e.x = 260; });
		var li = layer("event");
		sound(li, 0, items["chord.wav"], "event", function (fr) { fr.soundEffect = "fade in"; fr.soundLoopMode = "repeat"; fr.soundLoop = 2; });
		li = layer("trim");
		sound(li, 6, items["beep.wav"], "event", function (fr) { fr.setSoundEnvelopeLimits({ start: 2205, end: 13230 }); });
		sound(li, 30, items["beep.wav"], "event");
		li = layer("stream");
		sound(li, 0, items["melody.mp3"], "stream");
		t.insertBlankKeyframe(24);
		li = layer("pan");
		sound(li, 12, copy, "event", function (fr) {
			fr.setSoundEnvelope([{ mark: 0, leftChannel: 32768, rightChannel: 0 }, { mark: 44100, leftChannel: 0, rightChannel: 32768 }]);
		});
		li = layer("stop");
		sound(li, 40, items["chord.wav"], "stop");
		symbol("snd clip", "movie clip", function () {
			rect(-10, -10, 10, 10, "#cc3366");
			tl().layers[0].frames[0].soundLibraryItem = items["beep.wav"];
			tl().layers[0].frames[0].soundSync = "start";
		});
		layer("clip");
		tl().insertBlankKeyframe(36);
		place("snd clip", 150, 40, 36);
		// a button with a sound on its Down frame (plays when pressed)
		symbol("snd button", "button", function () {
			var bt = tl();
			var colors = ["#999999", "#66aa66", "#aa6666", "#000000"];
			for (var j = 0; j < 4; j++) {
				if (j > 0) bt.insertBlankKeyframe(j);
				bt.currentFrame = j;
				rect(-30, -15, 30, 15, colors[j]);
			}
			bt.layers[0].frames[2].soundLibraryItem = items["chord mono.wav"];
			bt.layers[0].frames[2].soundSync = "event";
		});
		layer("button");
		place("snd button", 240, 170, 0);
		extendAll(48);
		var info = [];
		for (var k in items) info.push(k + ":" + items[k].compressionType + "/" + items[k].originalCompressionType);
		info.push(copy.name + ": " + copy.bitRate + "/" + copy.convertStereoToMono);
		log.push("f43 sounds: " + info.join(", "));
	});

	// ---------------------------------------------------------------- f45: shape tweens as path morphs
	build("f45-morph", function () {
		newDoc("timeline", 640, 400, 24);
		doc.importFile(root + "/assets/pattern.png", true);
		function star(cx, cy, r1, r2, n) {
			var p = fl.drawingLayer.newPath();
			for (var i = 0; i < n * 2; i++) {
				var a = (i * Math.PI) / n - Math.PI / 2, r = i % 2 ? r2 : r1;
				p.addPoint(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
			}
			p.close();
			p.makeShape(false, false);
		}
		// a shape tween on its own layer from frame `a` to `b`; draw(0) and draw(1) make the two ends
		function shapeTween(name, a, b, draw, frameFn) {
			var li = layer(name);
			var t = tl();
			if (a > 0) t.insertBlankKeyframe(a);
			t.currentFrame = a;
			draw(0);
			t.insertBlankKeyframe(b);
			t.currentFrame = b;
			draw(1);
			t.setSelectedFrames(a, a + 1);
			t.setFrameProperty("tweenType", "shape");
			if (frameFn) frameFn(t.layers[li].frames[a]);
		}
		shapeTween("easeIn", 0, 20, function (e) {
			if (!e) rect(20, 20, 100, 80, "#FF6600");
			else oval(130, 10, 210, 90, "#0066FF");
		}, function (f) { f.tweenEasing = -100; });
		shapeTween("easeOut", 0, 20, function (e) {
			doc.selectNone();
			if (!e) { fill("#99CC00"); stroke("#000000", 2); doc.addNewRectangle({ left: 240, top: 20, right: 320, bottom: 80 }, 12, false, false); }
			else { fill("#CC3399"); stroke("#CC0000", 8); star(370, 50, 40, 18, 5); }
		}, function (f) { f.tweenEasing = 70; });
		shapeTween("custom", 0, 24, function (e) {
			if (!e) oval(440, 20, 500, 80, "#336699");
			else rect(540, 30, 620, 70, "#993366");
		}, function (f) {
			f.hasCustomEase = true;
			f.setCustomEase("all", [
				{ x: 0, y: 0 }, { x: 0.2, y: 0.9 }, { x: 0.35, y: 1.25 }, { x: 0.5, y: 1.1 },
				{ x: 0.65, y: 0.95 }, { x: 0.8, y: 1 }, { x: 1, y: 1 }
			]);
		});
		shapeTween("alpha", 4, 28, function (e) {
			doc.selectNone();
			noStroke();
			if (!e) { doc.setCustomFill({ style: "solid", color: "#FF000080" }); doc.addNewRectangle({ left: 20, top: 120, right: 100, bottom: 200 }, 0, false, true); }
			else { doc.setCustomFill({ style: "solid", color: "#00AA00" }); doc.addNewOval({ left: 60, top: 110, right: 180, bottom: 190 }, false, true); }
		});
		shapeTween("holes", 0, 24, function (e) {
			// a ring: the inner shape is cut out of the outer one
			if (!e) { oval(220, 110, 320, 210, "#FFAA00"); oval(250, 140, 290, 180, "#000000"); doc.mouseClick({ x: 270, y: 160 }, false, false); }
			else { rect(220, 120, 340, 200, "#AA00FF"); rect(260, 140, 300, 180, "#000000"); doc.mouseClick({ x: 280, y: 160 }, false, false); }
			doc.deleteSelection();
			doc.selectNone();
		});
		shapeTween("multi", 0, 24, function (e) {
			if (!e) { oval(380, 120, 420, 160, "#00CCCC"); oval(440, 160, 480, 200, "#00CCCC"); }
			else { rect(380, 160, 430, 210, "#0066CC"); rect(450, 110, 500, 160, "#0066CC"); }
		});
		shapeTween("split", 0, 24, function (e) {
			if (!e) oval(530, 120, 610, 200, "#666666");
			else { oval(520, 120, 560, 160, "#CC6600"); oval(580, 160, 620, 200, "#CC6600"); }
		});
		shapeTween("radial", 0, 24, function (e) {
			doc.selectNone();
			noStroke();
			if (!e) { doc.setCustomFill({ style: "radialGradient", colorArray: ["#FFFFFF", "#0033CC"], posArray: [0, 255], matrix: { a: 0.05, b: 0, c: 0, d: 0.05, tx: 70, ty: 290 } }); doc.addNewOval({ left: 20, top: 240, right: 120, bottom: 340 }, false, true); }
			else { doc.setCustomFill({ style: "radialGradient", colorArray: ["#FFFF00", "#CC0000"], posArray: [30, 255], matrix: { a: 0.08, b: 0, c: 0, d: 0.04, tx: 160, ty: 300 } }); doc.addNewOval({ left: 100, top: 260, right: 220, bottom: 340 }, false, true); }
		});
		shapeTween("bitmapFill", 0, 24, function (e) {
			doc.selectNone();
			noStroke();
			if (!e) doc.setCustomFill({ style: "bitmap", bitmapPath: "pattern.png", bitmapIsClipped: false, matrix: { a: 60, b: 0, c: 0, d: 60, tx: 250, ty: 250 } });
			else doc.setCustomFill({ style: "bitmap", bitmapPath: "pattern.png", bitmapIsClipped: false, matrix: { a: 40, b: 20, c: -20, d: 40, tx: 280, ty: 260 } });
			doc.addNewRectangle(e ? { left: 270, top: 250, right: 350, bottom: 340 } : { left: 240, top: 240, right: 320, bottom: 330 }, 0, false, true);
		});
		// a looping movie clip morphing a gradient circle into a square and back, placed twice
		symbol("blob", "movie clip", function () {
			var t = tl();
			function gradient(c) { doc.selectNone(); noStroke(); doc.setCustomFill({ style: "linearGradient", colorArray: c, posArray: [0, 255], matrix: { a: 0.03, b: 0.01, c: -0.01, d: 0.03, tx: 0, ty: 0 } }); }
			gradient(["#FF0066", "#FFCC00"]);
			doc.addNewOval({ left: -30, top: -30, right: 30, bottom: 30 }, false, true);
			t.insertBlankKeyframe(12);
			t.currentFrame = 12;
			gradient(["#00CC66", "#0033FF"]);
			doc.addNewRectangle({ left: -25, top: -25, right: 25, bottom: 25 }, 0, false, true);
			t.insertBlankKeyframe(24);
			t.currentFrame = 24;
			gradient(["#FF0066", "#FFCC00"]);
			doc.addNewOval({ left: -30, top: -30, right: 30, bottom: 30 }, false, true);
			t.setSelectedFrames(0, 1);
			t.setFrameProperty("tweenType", "shape");
			t.setSelectedFrames(12, 13);
			t.setFrameProperty("tweenType", "shape");
			t.layers[0].frames[12].tweenEasing = 50;
		});
		layer("blobs");
		place("blob", 450, 290, 0);
		var b2 = place("blob", 560, 300, 0);
		b2.scaleX = b2.scaleY = 0.6;
		b2.rotation = 30;
		extendAll(36);
	});

	// ---------------------------------------------------------------- f17: stress (performance)
	build("f17-stress", function () {
		newDoc("timeline", 640, 480, 30);
		// 40 symbols, each with a small tweened inner animation
		for (var s = 0; s < 40; s++) {
			(function (s) {
				symbol("sym" + s, "movie clip", function () {
					rect(-10, -10, 10, 10, "#" + (0x100000 + ((s * 99991) % 0xEFFFFF)).toString(16));
					var t = tl();
					t.insertKeyframe(9);
					t.setSelectedFrames(0, 1);
					t.createMotionTween();
				});
			})(s);
		}
		layer("fbf");
		var t = tl();
		var li = t.currentLayer;
		for (var f = 0; f < 150; f++) {
			if (f > 0) t.insertBlankKeyframe(f);
			t.currentFrame = f;
			oval(20 + f * 4, 300 + Math.sin(f / 8) * 60, 40 + f * 4, 320 + Math.sin(f / 8) * 60, "#" + (0x200000 + f * 4321).toString(16).substr(0, 6));
		}
		layer("symbols");
		for (s = 0; s < 40; s++) place("sym" + s, 20 + (s % 10) * 60, 40 + Math.floor(s / 10) * 60, 0);
		extendAll(150);
	});

	// ---------------------------------------------------------------- f46: filters built from mattes in Lottie
	build("f46-filters3", function () {
		newDoc("timeline", 500, 400, 24);
		boxSymbol();
		layer("bg");
		rect(0, 0, 500, 400, "#88CC88");
		function sel(el) { doc.selectNone(); el.selected = true; }
		function prop(i, k, v) { doc.setFilterProperty(k, i, v); }
		function filtered(name, x, y, fn, mod) {
			layer(name);
			var el = place("box", x, y, 0);
			if (mod) mod(el);
			sel(el);
			fn();
			doc.selectNone();
			return el;
		}
		function gradient(colors, ratios) {
			var fs = doc.getFilters();
			fs[fs.length - 1].colorArray = colors;
			fs[fs.length - 1].posArray = ratios;
			doc.setFilters(fs);
		}
		// row 1: inner / knockout / hidden object, an outline glow, uneven blur
		filtered("innerKnock", 60, 70, function () { doc.addFilter("dropShadowFilter"); prop(0, "inner", true); prop(0, "knockout", true); prop(0, "distance", 6); });
		filtered("outerKnock", 155, 70, function () { doc.addFilter("dropShadowFilter"); prop(0, "knockout", true); prop(0, "distance", 6); prop(0, "blurX", 8); prop(0, "blurY", 8); prop(0, "color", "#CC0000"); });
		filtered("outline", 250, 70, function () { doc.addFilter("glowFilter"); prop(0, "color", "#000000"); prop(0, "strength", 1000); prop(0, "blurX", 3); prop(0, "blurY", 3); prop(0, "quality", "high"); });
		filtered("uneven", 345, 70, function () { doc.addFilter("dropShadowFilter"); prop(0, "blurX", 16); prop(0, "blurY", 2); prop(0, "distance", 5); prop(0, "quality", "high"); });
		filtered("innerHide", 440, 70, function () { doc.addFilter("dropShadowFilter"); prop(0, "inner", true); prop(0, "hideObject", true); prop(0, "color", "#0000FF"); prop(0, "distance", 5); });
		// row 2: chains, a faded / tinted / turned instance
		filtered("chain1", 60, 170, function () { doc.addFilter("blurFilter"); prop(0, "blurX", 4); prop(0, "blurY", 4); doc.addFilter("glowFilter"); prop(1, "inner", true); prop(1, "color", "#FFFF00"); prop(1, "blurX", 8); prop(1, "blurY", 8); });
		filtered("chain2", 155, 170, function () {
			doc.addFilter("dropShadowFilter"); prop(0, "inner", true); prop(0, "distance", 5); prop(0, "color", "#FF0000");
			doc.addFilter("dropShadowFilter"); prop(1, "distance", 6);
			doc.addFilter("adjustColorFilter"); prop(2, "hue", 120);
		});
		filtered("fadedBevel", 250, 170, function () { doc.addFilter("bevelFilter"); prop(0, "distance", 5); prop(0, "highlightColor", "#FFFF00"); prop(0, "shadowColor", "#0000FF"); }, function (el) { el.colorMode = "alpha"; el.colorAlphaPercent = 50; });
		filtered("tintBevel", 345, 170, function () { doc.addFilter("bevelFilter"); prop(0, "type", "outer"); prop(0, "distance", 4); prop(0, "blurX", 6); prop(0, "blurY", 6); }, function (el) { el.colorMode = "tint"; el.tintColor = "#FF6600"; el.tintPercent = 60; });
		filtered("turnedInner", 440, 170, function () { doc.addFilter("glowFilter"); prop(0, "inner", true); prop(0, "color", "#FFFFFF"); prop(0, "blurX", 10); prop(0, "blurY", 10); }, function (el) { el.rotation = 30; el.scaleX = 1.4; el.scaleY = 0.8; });
		// row 3: gradient filters with other stops, a filtered instance under a mask
		filtered("gradGlow4", 60, 270, function () {
			doc.addFilter("gradientGlowFilter"); prop(0, "distance", 3); prop(0, "blurX", 12); prop(0, "blurY", 12);
			gradient(["#FF000000", "#FFFF00", "#00FF00", "#0000FF"], [0, 80, 170, 255]);
		});
		filtered("gradBevelOut", 155, 270, function () {
			doc.addFilter("gradientBevelFilter"); prop(0, "type", "outer"); prop(0, "knockout", true); prop(0, "distance", 5);
		});
		filtered("gradGlowInner", 250, 270, function () {
			doc.addFilter("gradientGlowFilter"); prop(0, "type", "inner"); prop(0, "distance", 0); prop(0, "strength", 200);
			gradient(["#FFFFFF00", "#FF00FF"], [0, 255]);
		});
		filtered("maskedContent", 345, 270, function () { doc.addFilter("dropShadowFilter"); prop(0, "inner", true); prop(0, "distance", 5); });
		layer("maskShape");
		oval(305, 245, 385, 300, "#000000");
		var t = tl();
		var mi = -1, ci = -1;
		for (var i = 0; i < t.layers.length; i++) {
			if (t.layers[i].name == "maskShape") mi = i;
			if (t.layers[i].name == "maskedContent") ci = i;
		}
		t.layers[mi].layerType = "mask";
		t.layers[ci].layerType = "masked";
		t.layers[ci].parentLayer = t.layers[mi];
		// row 4: filter tweens (values change every frame, the kinds stay)
		function tweened(name, x, y, start, end) {
			layer(name);
			var t = tl();
			var li = t.currentLayer;
			var el = place("box", x, y, 0);
			sel(el);
			start();
			doc.selectNone();
			t.insertKeyframe(23);
			t.currentFrame = 23;
			var e2 = t.layers[li].frames[23].elements[0];
			e2.x = x + 60;
			sel(e2);
			end();
			doc.selectNone();
			t.setSelectedFrames(0, 1);
			t.createMotionTween();
		}
		tweened("innerTween", 60, 360, function () { doc.addFilter("dropShadowFilter"); prop(0, "inner", true); prop(0, "distance", 2); }, function () { prop(0, "distance", 12); prop(0, "color", "#FF0000"); prop(0, "blurX", 10); prop(0, "blurY", 10); });
		tweened("bevelTween", 300, 360, function () { doc.addFilter("bevelFilter"); prop(0, "distance", 2); }, function () { prop(0, "distance", 8); prop(0, "strength", 300); prop(0, "angle", 135); });
		extendAll(24);
	});

	// ---------------------------------------------------------------- f47: Animate's code snippets (mouse handlers)
	build("f47-snippets", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		symbol("btn", "button", function () {
			var t = tl();
			var colors = ["#CC3333", "#33CC33", "#3333CC", "#33CCCC"];
			for (var i = 0; i < 4; i++) {
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(-35, -15, 35, 15, colors[i]);
			}
		});
		// a spinner that stands still until the mouse is over it
		symbol("spinner", "movie clip", function () {
			classicTween("box", 0, 0, 11, function (e) { e.rotation = 330; });
			layer("actions");
			tl().layers[tl().currentLayer].frames[0].actionScript = "stop();";
		});
		layer("bg");
		rect(0, 0, 400, 300, "#EEEEEE");
		layer("mover");
		classicTween("box", 60, 70, 23, function (e) { e.x = 340; e.rotation = 90; });
		layer("panel");
		place("box", 200, 160, 0).name = "mc_box";
		layer("spin");
		place("spinner", 320, 160, 0).name = "mc_spin";
		layer("buttons");
		var names = ["btn_next", "btn_end", "btn_web", "btn_hide"];
		for (var b = 0; b < names.length; b++) place("btn", 60 + b * 93, 260, 0).name = names[b];
		extendAll(24);
		layer("labels");
		var t = tl();
		t.layers[t.currentLayer].frames[0].name = "start";
		t.insertKeyframe(18);
		t.layers[t.currentLayer].frames[18].name = "end";
		layer("actions");
		t = tl();
		var li = t.currentLayer;
		// as the Code Snippets panel writes them (comments included)
		t.layers[li].frames[0].actionScript = [
			"/* Click to Go to Frame and Play",
			"Clicking on the specified symbol instance moves the playhead to the specified frame in the timeline and continues playback from that frame.",
			"*/",
			"stop();",
			"",
			"btn_next.addEventListener(MouseEvent.CLICK, fl_ClickToGoToAndPlayFromFrame);",
			"",
			"function fl_ClickToGoToAndPlayFromFrame(event:MouseEvent):void",
			"{",
			"	gotoAndPlay(2);",
			"}",
			"",
			"/* Click to Go to Frame and Stop */",
			"btn_end.addEventListener(MouseEvent.CLICK, fl_ClickToGoToAndStopAtFrame);",
			"",
			"function fl_ClickToGoToAndStopAtFrame(event:MouseEvent):void",
			"{",
			"	gotoAndStop(\"end\");",
			"}",
			"",
			"/* Click to Go to Web Page */",
			"btn_web.addEventListener(MouseEvent.CLICK, fl_ClickToGoToWebPage);",
			"",
			"function fl_ClickToGoToWebPage(event:MouseEvent):void",
			"{",
			"	navigateToURL(new URLRequest(\"https://example.com/\"), \"_blank\");",
			"}",
			"",
			"/* Click to Hide an Object */",
			"btn_hide.addEventListener(MouseEvent.CLICK, fl_ClickToHide);",
			"",
			"function fl_ClickToHide(event:MouseEvent):void",
			"{",
			"	mc_box.visible = false;",
			"}",
			"",
			"/* Mouse Over Event */",
			"mc_spin.addEventListener(MouseEvent.MOUSE_OVER, fl_MouseOverHandler);",
			"",
			"function fl_MouseOverHandler(event:MouseEvent):void",
			"{",
			"	mc_spin.play();",
			"}",
			"",
			"/* Mouse Out Event */",
			"mc_spin.addEventListener(MouseEvent.MOUSE_OUT, fl_MouseOutHandler);",
			"",
			"function fl_MouseOutHandler(event:MouseEvent):void",
			"{",
			"	mc_spin.stop();",
			"}"
		].join("\n");
		t.insertKeyframe(23);
		t.layers[li].frames[23].actionScript = "stop();";
	});

	// ---------------------------------------------------------------- f48: Accessibility panel settings
	build("f48-accessibility", function () {
		newDoc("timeline", 300, 200, 24);
		boxSymbol();
		symbol("btn", "button", function () {
			var t = tl();
			for (var i = 0; i < 4; i++) {
				if (i > 0) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(-30, -12, 30, 12, ["#CC3333", "#33CC33", "#3333CC", "#33CCCC"][i]);
			}
		});
		symbol("deco", "movie clip", function () { oval(-10, -10, 10, 10, "#999999"); });
		doc.accName = "Moving box demo";
		doc.description = "A blue box moves to the right; the Play button starts it again.";
		layer("mover");
		classicTween("box", 60, 70, 23, function (e) { e.x = 240; });
		var t = tl();
		var box = t.layers[t.currentLayer].frames[0].elements[0];
		box.name = "mc_box";
		box.accName = "Blue box";
		box.description = "It moves from left to right";
		layer("ui");
		var b = place("btn", 150, 160, 0);
		b.name = "btn_play";
		b.accName = "Play";
		b.shortcut = "P";
		b.tabIndex = 1;
		var dec = place("deco", 270, 30, 0);
		dec.silent = true;
		var grp = place("box", 40, 160, 0);
		grp.accName = "Group";
		grp.forceSimple = true;
		log.push("f48 defaults: tabIndex " + place("deco", 20, 20, 0).tabIndex + ", silent " + dec.silent);
		extendAll(24);
	});

	// ---------------------------------------------------------------- f49: dynamic and input text (embedded fonts)
	build("f49-fonts", function () {
		newDoc("timeline", 500, 360, 24);
		function text(l, t, r, b, s, type, face, size, color, bold, italic, multiline) {
			doc.selectNone();
			doc.addNewText({ left: l, top: t, right: r, bottom: b }, s);
			doc.selectNone();
			// nothing is selected after addNewText: the Text object itself (the frame's newest element)
			var tt = tl(), els = tt.layers[tt.currentLayer].frames[tt.currentFrame].elements;
			var el = els[els.length - 1];
			el.textType = type;
			if (type != "static") el.lineType = multiline ? "multiline" : "single line";
			el.setTextAttr("face", face);
			el.setTextAttr("size", size);
			el.setTextAttr("fillColor", color);
			el.setTextAttr("bold", !!bold);
			el.setTextAttr("italic", !!italic);
			return el;
		}
		layer("texts");
		text(20, 20, 480, 50, "Dynamic Arial: Hello Ünïcödé € 123", "dynamic", "Arial", 22, "#003399");
		text(20, 70, 480, 100, "Bold italic Times New Roman", "dynamic", "Times New Roman", 24, "#990000", true, true);
		text(20, 120, 300, 200, "Georgia, two lines of dynamic text that wrap in the field.", "dynamic", "Georgia", 16, "#222222", false, false, true).name = "para";
		text(320, 120, 480, 150, "Type here", "input", "Verdana", 14, "#000000");
		// dynamic text inside a moving movie clip
		symbol("label", "movie clip", function () { text(-60, -12, 60, 12, "Moving label", "dynamic", "Arial", 16, "#006600", true); });
		layer("mover");
		classicTween("label", 100, 290, 23, function (e) { e.x = 380; });
		extendAll(24);
	});

	// ---------------------------------------------------------------- f50: colour effects on bitmaps (Lottie: Fill effect)
	build("f50-bitmap-tint", function () {
		newDoc("timeline", 480, 240, 24);
		doc.importFile(root + "/assets/checker.png", true);
		var item = null;
		for (var i = 0; i < lib.items.length; i++) if (lib.items[i].itemType == "bitmap") item = lib.items[i];
		if (!item) throw new Error("bitmap import failed");
		symbol("pic", "movie clip", function () { lib.addItemToDocument({ x: 0, y: 0 }, item.name); });
		function colour(e, mode, fn) { e.colorMode = mode; fn(e); }
		layer("tint");
		colour(place("pic", 60, 60, 0), "tint", function (e) { e.tintColor = "#FF0000"; e.tintPercent = 60; });
		layer("brighter");
		colour(place("pic", 180, 60, 0), "brightness", function (e) { e.brightness = 50; });
		layer("darker");
		colour(place("pic", 300, 60, 0), "brightness", function (e) { e.brightness = -60; });
		layer("advanced");
		colour(place("pic", 420, 60, 0), "advanced", function (e) { e.colorRedPercent = 30; e.colorGreenPercent = 100; e.colorBlueAmount = 80; });
		layer("tween");
		classicTween("pic", 60, 170, 23, function (e) { e.x = 300; e.colorMode = "tint"; e.tintColor = "#0033FF"; e.tintPercent = 100; });
		extendAll(24);
	});

	// ---------------------------------------------------------------- f51/f52: video components (linked video files)
	function videoComponent(names, x, y, params) {
		var el = null;
		for (var n = 0; n < names.length && !el; n++) {
			try {
				doc.selectNone();
				fl.componentsPanel.addItemToDocument({ x: x, y: y }, "Video", names[n]);
				el = doc.selection[0] || null;
				if (el) log.push("component " + names[n] + " added");
			} catch (e) {
				log.push("component " + names[n] + ": " + e);
			}
		}
		if (!el) throw new Error("no video component");
		var ps = el.parameters || [];
		var seen = [];
		for (var i = 0; i < ps.length; i++) {
			seen.push(ps[i].name + "=" + ps[i].value);
			for (var k in params) if (ps[i].name.toLowerCase() == k.toLowerCase()) ps[i].value = params[k];
		}
		log.push("parameters: " + seen.join(", "));
		return el;
	}
	build("f51-video", function () {
		newDoc("timeline", 400, 300, 24);
		FLfile.copy(root + "/assets/clip.webm", outDir + "/clip.webm");
		layer("bg");
		rect(0, 0, 400, 300, "#DDDDDD");
		layer("video");
		var v = videoComponent(["FLVPlayback 2.5", "FLVPlayback"], 40, 40, { source: "clip.webm", autoPlay: true });
		v.width = 240;
		v.height = 180;
		v.x = 40;
		v.y = 40;
		extendAll(24);
	});
	build("f52-video-canvas", function () {
		newDoc("htmlcanvas", 400, 300, 24);
		FLfile.copy(root + "/assets/clip.webm", outDir + "/clip.webm");
		layer("bg");
		rect(0, 0, 400, 300, "#DDDDDD");
		layer("video");
		var v = videoComponent(["Video"], 40, 40, { src: "clip.webm", autoplay: true, loop: true, muted: true, controls: false });
		v.width = 240;
		v.height = 180;
		v.x = 40;
		v.y = 40;
		extendAll(24);
	});

	// ---------------------------------------------------------------- f53: a shape tween whose gradient turns
	build("f53-gradient-turn", function () {
		newDoc("timeline", 300, 300, 24);
		layer("tween");
		var t = tl();
		var li = t.currentLayer;
		function gradientRect(angle) {
			var r = angle * Math.PI / 180, k = 0.08;
			var fill = doc.getCustomFill("toolbar");
			fill.style = "radialGradient";
			fill.colorArray = ["#FF3300", "#FFFF00", "#0033CC"];
			fill.posArray = [0, 128, 255];
			// an ellipse (twice as wide as high) that turns
			fill.matrix = { a: k * Math.cos(r), b: k * Math.sin(r), c: -k * 0.5 * Math.sin(r), d: k * 0.5 * Math.cos(r), tx: 150, ty: 150 };
			doc.setCustomFill(fill);
			noStroke();
			doc.addNewRectangle({ left: 50, top: 50, right: 250, bottom: 250 }, 0, false, true);
		}
		gradientRect(0);
		t.insertBlankKeyframe(23);
		t.currentFrame = 23;
		gradientRect(90);
		t.setSelectedFrames(0, 1);
		t.setFrameProperty("tweenType", "shape");
		var tt = t.layers[li].frames[0].tweenType;
		log.push("f53 tween: " + tt);
	});

	// ---------------------------------------------------------------- f54: library and timeline structure
	build("f54-structure", function () {
		newDoc("timeline", 400, 300, 30);
		// two symbols with the same name in different library folders
		lib.newFolder("a");
		lib.newFolder("b");
		symbol("item", "movie clip", function () { rect(-20, -20, 20, 20, "#CC3333"); });
		lib.moveToFolder("a", "item");
		symbol("item", "movie clip", function () { oval(-20, -20, 20, 20, "#3333CC"); });
		lib.moveToFolder("b", "item");
		// a movie clip of six frames (a bar that moves right), placed as a movie clip and as a graphic
		symbol("dual", "movie clip", function () {
			var t = tl();
			for (var i = 0; i < 6; i++) {
				if (i) t.insertBlankKeyframe(i);
				t.currentFrame = i;
				rect(-30 + i * 8, -6, -14 + i * 8, 6, "#228844");
			}
		});
		// nothing at all, and only a guide layer
		symbol("nothing", "movie clip", function () {});
		symbol("guideonly", "movie clip", function () {
			rect(-20, -20, 20, 20, "#FF00FF");
			tl().layers[0].layerType = "guide";
		});
		layer("folders");
		place("a/item", 50, 50, 0);
		place("b/item", 110, 50, 0);
		layer("dual");
		place("dual", 220, 50, 0);
		var g1 = place("dual", 220, 110, 0);
		g1.symbolType = "graphic"; g1.loop = "single frame"; g1.firstFrame = 3;
		var g2 = place("dual", 220, 170, 0);
		g2.symbolType = "graphic"; g2.loop = "play once"; g2.firstFrame = 2;
		layer("empties");
		classicTween("nothing", 50, 150, 9, function (e) { e.x = 150; });
		layer("guideonly");
		place("guideonly", 50, 220, 0);
		// a layer that ends early, and a tween one frame long
		layer("short");
		var t = tl();
		place("a/item", 330, 50, 0);
		t.insertKeyframe(1);
		t.currentFrame = 1;
		t.layers[t.currentLayer].frames[1].elements[0].x = 350;
		t.setSelectedFrames(0, 1);
		t.createMotionTween();
		t.insertBlankKeyframe(4);
		layer("long");
		classicTween("b/item", 330, 150, 29, function (e) { e.y = 250; e.rotation = 120; });
		var info = [];
		for (var i = 0; i < lib.items.length; i++) info.push(lib.items[i].name);
		log.push("f54 library: " + info.join(", ") + "; dual instances: " + g1.symbolType + "/" + g1.loop + "/" + g1.firstFrame + ", " + g2.symbolType + "/" + g2.loop);
	});

	// ---------------------------------------------------------------- f55: stroke styles
	build("f55-strokes2", function () {
		newDoc("timeline", 500, 320, 24);
		var styles = [
			{ style: "dashed", dash1: 8, dash2: 4 },
			{ style: "dotted", dotSpace: 4 },
			{ style: "ragged", pattern: "random", waveHeight: "wild", waveLength: "short" },
			{ style: "stipple", dotSize: "small", variation: "varied sizes", density: "dense" },
			{ style: "hatched", hatchThickness: "thin", space: "close", jiggle: "wild", rotate: "free", curve: "slight curve", length: "slight" },
			{ style: "solid", capType: "none", joinType: "miter" },
		];
		var made = [];
		for (var i = 0; i < styles.length; i++) {
			layer("s" + i);
			var x = 20 + (i % 3) * 160, y = 20 + Math.floor(i / 3) * 150;
			var st = styles[i];
			st.color = "#1144AA";
			st.thickness = i == 5 ? 14 : 4;
			try {
				doc.selectNone();
				doc.setCustomFill({ style: "noFill" });
				doc.setCustomStroke(st);
				doc.addNewRectangle({ left: x, top: y, right: x + 130, bottom: y + 110 }, 0, true, false);
				// a curve too
				doc.addNewOval({ left: x + 30, top: y + 30, right: x + 100, bottom: y + 80 }, true, false);
				var drawn = tl().layers[tl().currentLayer].frames[0].elements[0];
				made.push(st.style + ":" + (drawn && drawn.edges && drawn.edges.length ? drawn.edges[0].stroke.style : "nothing drawn"));
			} catch (e) {
				made.push(st.style + ": ERROR " + e);
			}
		}
		// a stroke filled with a gradient
		layer("gradientStroke");
		doc.selectNone();
		doc.setCustomFill({ style: "noFill" });
		doc.setCustomStroke({ style: "solid", thickness: 10, color: "#000000", capType: "round", joinType: "round" });
		doc.addNewLine({ x: 40, y: 300 }, { x: 460, y: 290 });
		// only the line (selectAll would take every layer's shapes)
		var lt = tl();
		doc.selectNone();
		doc.selection = [lt.layers[lt.currentLayer].frames[0].elements[0]];
		var gs = doc.getCustomStroke("selection");
		gs.shapeFill = { style: "linearGradient", colorArray: ["#FF0000", "#00AA00", "#0000FF"], posArray: [0, 128, 255], matrix: { a: 0.25, b: 0, c: 0, d: 0.25, tx: 250, ty: 295 } };
		doc.setCustomStroke(gs);
		doc.selectNone();
		log.push("f55 strokes: " + made.join(", "));
	});

	// ---------------------------------------------------------------- f56: unusual text
	build("f56-text3", function () {
		newDoc("timeline", 500, 360, 24);
		function text(l, t, r, b, s, type, size, color) {
			doc.selectNone();
			doc.addNewText({ left: l, top: t, right: r, bottom: b }, s);
			doc.selectNone();
			var tt = tl(), els = tt.layers[tt.currentLayer].frames[tt.currentFrame].elements;
			var el = els[els.length - 1];
			el.textType = type;
			el.setTextAttr("face", "Arial");
			el.setTextAttr("size", size);
			el.setTextAttr("fillColor", color);
			return el;
		}
		var notes = [];
		layer("vertical");
		var v = text(20, 20, 50, 200, "Vertical", "static", 20, "#003366");
		try { v.orientation = "vertical left to right"; notes.push("vertical " + v.orientation); } catch (e) { notes.push("vertical: ERROR " + e); }
		layer("rotated");
		var r = text(80, 40, 260, 70, "Rotated text", "static", 18, "#660000");
		r.rotation = -30;
		layer("link");
		var l = text(80, 120, 300, 150, "A linked word", "static", 18, "#000099");
		try { l.setTextAttr("url", "https://example.com/?a=1&b=2", 2, 8); l.setTextAttr("target", "_blank", 2, 8); notes.push("url ok"); } catch (e) { notes.push("url: ERROR " + e); }
		layer("positions");
		var p = text(80, 170, 300, 200, "E=mc2 and H2O", "static", 18, "#000000");
		try { p.setTextAttr("characterPosition", "superscript", 4, 5); p.setTextAttr("characterPosition", "subscript", 11, 12); notes.push("sub/sup ok"); } catch (e) { notes.push("sub/sup: ERROR " + e); }
		layer("scripts");
		text(320, 20, 490, 50, "日本語 עברית 😀", "static", 18, "#333333");
		text(320, 60, 490, 90, "Dynamic 日本語 Ωmega", "dynamic", 18, "#006633");
		layer("empty");
		var e0 = text(320, 110, 490, 140, " ", "dynamic", 18, "#000000");
		e0.name = "emptyField";
		layer("border");
		var b = text(320, 150, 490, 180, "Bordered dynamic", "dynamic", 14, "#000000");
		try { b.border = true; notes.push("border " + b.border); } catch (e) { notes.push("border: ERROR " + e); }
		layer("password");
		var pw = text(320, 190, 490, 220, "secret", "input", 14, "#000000");
		try { pw.lineType = "password"; notes.push("password " + pw.lineType); } catch (e) { notes.push("password: ERROR " + e); }
		layer("shadowed");
		var sh = text(80, 230, 300, 270, "Text with a shadow", "static", 22, "#CC6600");
		doc.selectNone(); sh.selected = true;
		try { doc.addFilter("dropShadowFilter"); doc.setFilterProperty("distance", 0, 4); notes.push("filter ok"); } catch (e) { notes.push("filter: ERROR " + e); }
		doc.selectNone();
		layer("multiline");
		var ml = text(80, 280, 480, 350, "A multiline dynamic field with BIG and small words that wraps at its width.", "dynamic", 14, "#222222");
		ml.lineType = "multiline";
		ml.setTextAttr("size", 26, 38, 41);
		log.push("f56 text: " + notes.join(", "));
	});

	// ---------------------------------------------------------------- f57: instance properties
	build("f57-instances", function () {
		newDoc("timeline", 500, 300, 24);
		boxSymbol();
		var notes = [];
		function put(name, x, y, fn) {
			layer(name);
			var e = place("box", x, y, 0);
			doc.selectNone(); e.selected = true;
			try { fn(e); notes.push(name + " ok"); } catch (err) { notes.push(name + ": ERROR " + err); }
			doc.selectNone();
			return e;
		}
		put("rotY", 60, 60, function (e) { e.rotationY = 50; });
		put("rotX", 160, 60, function (e) { e.rotationX = 40; e.rotationZ = 20; });
		put("exportBitmap", 260, 60, function (e) { e.bitmapRenderMode = "export"; });
		put("cacheOpaque", 360, 60, function (e) { e.bitmapRenderMode = "cache"; e.useBackgroundColor = true; e.backgroundColor = "#FFCC00"; });
		put("invisible", 440, 60, function (e) { e.visible = false; });
		put("dark", 60, 160, function (e) { doc.setInstanceBrightness(-100); });
		put("tinted", 160, 160, function (e) { doc.setInstanceTint("#FF0000", 100); });
		put("advanced", 260, 160, function (e) { e.colorMode = "advanced"; e.colorRedPercent = -100; e.colorGreenPercent = 100; e.colorBlueAmount = 255; e.colorAlphaPercent = 70; });
		put("transparent", 360, 160, function (e) { doc.setInstanceAlpha(0); });
		// alpha 0 to 100 over the timeline, and a 3D rotation that turns
		layer("fadeIn");
		classicTween("box", 100, 240, 23, function (e) { doc.selectNone(); e.selected = true; doc.setInstanceAlpha(100); doc.selectNone(); }, null);
		var t = tl();
		doc.selectNone(); t.layers[t.currentLayer].frames[0].elements[0].selected = true; doc.setInstanceAlpha(0); doc.selectNone();
		layer("turn3d");
		classicTween("box", 300, 240, 23, function (e) { e.rotationY = 80; });
		extendAll(24);
		log.push("f57 instances: " + notes.join(", "));
	});

	// ---------------------------------------------------------------- f58: awkward scenes
	build("f58-scenes2", function () {
		newDoc("timeline", 300, 200, 12);
		boxSymbol();
		layer("mover");
		classicTween("box", 50, 100, 5, function (e) { e.x = 250; });
		layer("actions");
		var t = tl();
		t.insertKeyframe(5);
		t.layers[t.currentLayer].frames[5].actionScript = "gotoAndPlay(\"ende\", \"Szene <3> & co\");";
		doc.addNewScene("Leer");
		doc.addNewScene("Szene <3> & co");
		rect(20, 20, 280, 180, "#0066CC");
		t = tl();
		t.insertFrames(5, false, 1);
		t.insertKeyframe(3);
		t.layers[0].frames[3].name = "ende";
		t.layers[0].frames[3].actionScript = "stop();";
		doc.editScene(0);
		var names = [];
		for (var i = 0; i < doc.timelines.length; i++) names.push(doc.timelines[i].name + ":" + doc.timelines[i].frameCount);
		log.push("f58 scenes: " + names.join(", "));
	});

	// ---------------------------------------------------------------- f59: long, fast, loops of coprime lengths
	build("f59-long", function () {
		newDoc("timeline", 400, 240, 60);
		function spinner(name, frames, color) {
			symbol(name, "movie clip", function () {
				rect(-18, -4, 18, 4, color);
				var t = tl();
				t.insertKeyframe(frames - 1);
				t.setSelectedFrames(0, 1);
				t.createMotionTween();
				t.layers[0].frames[0].motionTweenRotate = "clockwise";
				t.layers[0].frames[0].motionTweenRotateTimes = 1;
			});
		}
		spinner("s7", 7, "#CC3300");
		spinner("s11", 11, "#33AA00");
		spinner("s13", 13, "#0033CC");
		layer("spinners");
		place("s7", 60, 60, 0);
		place("s11", 140, 60, 0);
		place("s13", 220, 60, 0);
		boxSymbol();
		layer("slow");
		classicTween("box", 40, 170, 599, function (e) { e.x = 360; e.rotation = 359; }, function (f) { f.tweenEasing = 40; });
		extendAll(600);
	});

	// ---------------------------------------------------------------- f60: motion guides as paths
	build("f60-guides", function () {
		newDoc("timeline", 640, 480, 24);
		boxSymbol();
		symbol("dot", "graphic", function () { oval(-8, -8, 8, 8, "#CC3366"); });
		/** A stroke through the midpoints of control points C (quadratic pieces), on the current frame. */
		function curve(C, closed) {
			doc.selectNone();
			stroke("#999999", 1);
			var p = fl.drawingLayer.newPath();
			var P = [C[0]];
			for (var i = 1; i < C.length - 2; i++) P.push([(C[i][0] + C[i + 1][0]) / 2, (C[i][1] + C[i + 1][1]) / 2]);
			P.push(C[C.length - 1]);
			for (var j = 0; j < P.length - 1; j++) p.addCurve(P[j][0], P[j][1], C[j + 1][0], C[j + 1][1], P[j + 1][0], P[j + 1][1]);
			if (closed) p.addCurve(P[P.length - 1][0], P[P.length - 1][1], (P[P.length - 1][0] + P[0][0]) / 2, (P[P.length - 1][1] + P[0][1]) / 2 + 60, P[0][0], P[0][1]);
			p.makeShape(true, false);
			doc.selectNone();
			return P;
		}
		/** A guided classic tween of `name` on a new layer from C's start to its end, its guide drawn from C. */
		function guided(lname, name, C, end, frameFn, mod, closed) {
			var t = tl();
			layer(lname);
			var P0 = C[0], Pn = C[C.length - 1];
			var f = classicTween(name, P0[0], P0[1], end, function (e) { e.x = Pn[0]; e.y = Pn[1]; if (mod) mod(e); }, function (fr) { fr.motionTweenSnap = true; if (frameFn) frameFn(fr); });
			t.addMotionGuide();
			t.currentFrame = 0;
			curve(C, closed);
			return f;
		}
		// eased (ease out), not oriented
		guided("eased", "box", [[40, 60], [120, 0], [200, 120], [280, 20], [360, 80]], 40, function (f) { f.tweenEasing = 100; });
		// orient to path, ending turned 45 degrees
		guided("orient", "box", [[40, 160], [140, 100], [240, 220], [340, 120]], 40, function (f) { f.motionTweenOrientToPath = true; }, function (e) { e.rotation = 45; });
		// backwards along its guide (drawn from the other end), eased in, scaling down
		guided("back", "box", [[600, 240], [520, 160], [440, 300], [380, 220]], 50, function (f) { f.tweenEasing = -60; }, function (e) { e.scaleX = e.scaleY = 0.5; });
		// a closed guide: keeps Animate's frames
		guided("closed", "dot", [[460, 60], [520, 0], [600, 80], [560, 140]], 30, null, null, true);
		// two legs along one guide with a hold between (keyframes at 20 and 30 on the curve)
		var t = tl();
		guided("legs", "dot", [[40, 300], [100, 240], [200, 360], [300, 280], [360, 320]], 50, null, null);
		var li = -1;
		for (var i = 0; i < t.layers.length; i++) if (t.layers[i].name == "legs") li = i;
		t.currentLayer = li;
		t.setSelectedLayers(li);
		t.insertKeyframe(20);
		t.insertKeyframe(30);
		t.setSelectedFrames(20, 21);
		t.setFrameProperty("tweenType", "none");
		t.setSelectedFrames(30, 31);
		t.createMotionTween();
		t.layers[li].frames[30].motionTweenSnap = true;
		// a looping movie clip with a guided tween inside, placed twice (once turned and smaller)
		symbol("mover", "movie clip", function () {
			var tt = tl();
			tt.layers[0].name = "ball";
			tt.currentLayer = 0;
			classicTween("dot", 0, 0, 29, function (e) { e.x = 120; e.y = 0; }, function (fr) { fr.motionTweenSnap = true; fr.tweenEasing = 40; });
			tt.addMotionGuide();
			tt.currentFrame = 0;
			curve([[0, 0], [40, -60], [80, 60], [120, 0]]);
			for (var k = 0; k < tt.layers.length; k++) if (tt.layers[k].frameCount < 30) { tt.setSelectedLayers(k); tt.insertFrames(30 - tt.layers[k].frameCount, false, tt.layers[k].frameCount); }
		});
		// (on top: a layer added above "legs" would sit between it and its guide)
		t.currentLayer = 0;
		t.setSelectedLayers(0);
		layer("clips");
		place("mover", 420, 380, 0);
		var m2 = place("mover", 480, 440, 0);
		m2.rotation = 30;
		m2.scaleX = m2.scaleY = 0.8;
		extendAll(60);
	});

	// ---------------------------------------------------------------- f61: layer depth and the camera
	build("f61-depth", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		layer("sky");
		rect(-200, -150, 600, 450, "#DDEEFF");
		layer("far");
		place("box", 80, 90, 0);
		place("box", 320, 90, 0);
		layer("mid");
		rect(150, 130, 250, 190, "#33AA33");
		layer("near");
		place("box", 200, 240, 0);
		layer("hud");
		rect(10, 10, 110, 30, "#222222");
		// a masked layer at a depth of its own, its mask at another
		layer("seen");
		rect(280, 180, 390, 290, "#CC4488");
		layer("window");
		oval(290, 190, 380, 280, "#000000");
		extendAll(48);
		var t = tl();
		t.camera.cameraEnabled = true;
		var idx = {};
		for (var i = 0; i < t.layers.length; i++) idx[t.layers[i].name] = i;
		t.layers[idx.window].layerType = "mask";
		t.layers[idx.seen].layerType = "masked";
		t.layers[idx.seen].parentLayer = t.layers[idx.window];
		t.layers[idx.window].setZDepthAtFrame(0, -60);
		t.layers[idx.seen].setZDepthAtFrame(0, 120);
		t.layers[idx.far].setZDepthAtFrame(0, 300);
		t.layers[idx.sky].setZDepthAtFrame(0, 900);
		t.layers[idx.near].setZDepthAtFrame(0, -150);
		t.layers[idx.hud].lockForCamera = true;
		var ci = -1;
		for (i = 0; i < t.layers.length; i++) if (t.layers[i].layerType == "camera") ci = i;
		t.setSelectedLayers(ci);
		t.insertKeyframe(47);
		t.currentFrame = 47;
		var ce = t.layers[ci].frames[47].elements[0];
		ce.x = ce.x + 80;
		ce.y = ce.y - 30;
		t.setSelectedLayers(ci);
		t.setSelectedFrames(0, 1);
		t.createMotionTween();
		var z = [];
		for (i = 0; i < t.layers.length; i++) z.push(t.layers[i].name + "=" + t.layers[i].getZDepthAtFrame(0));
		log.push("f61 depths: " + z.join(", "));
	});

	// ---------------------------------------------------------------- f62: layer depth changing over time, camera depth
	build("f62-depth2", function () {
		newDoc("timeline", 400, 300, 24);
		boxSymbol();
		layer("a");
		place("box", 120, 150, 0);
		layer("b");
		place("box", 280, 150, 0);
		// top of the timeline but farther away than b, and than a until a passes it
		layer("c");
		rect(60, 110, 340, 190, "#EEDD55");
		extendAll(24);
		var t = tl();
		t.camera.cameraEnabled = true;
		var idx = {};
		for (var i = 0; i < t.layers.length; i++) idx[t.layers[i].name] = i;
		// keyframes at 0 and 23 with different depths, a classic tween between
		t.setSelectedLayers(idx.a);
		t.insertKeyframe(23);
		t.layers[idx.a].setZDepthAtFrame(23, 400);
		t.setSelectedLayers(idx.a);
		t.setSelectedFrames(0, 1);
		t.createMotionTween();
		t.layers[idx.c].setZDepthAtFrame(0, 200);
		// held change
		t.setSelectedLayers(idx.b);
		t.insertKeyframe(12);
		t.layers[idx.b].setZDepthAtFrame(12, -200);
		var r = [];
		for (var f = 0; f < 24; f += 6) r.push(f + ":" + t.layers[idx.a].getZDepthAtFrame(f) + "/" + t.layers[idx.b].getZDepthAtFrame(f));
		log.push("f62 depth a/b: " + r.join(" "));
		try { t.camera.setZDepth(0, -100); log.push("f62 camera z " + t.camera.getZDepth(0)); } catch (e) { log.push("f62 setZDepth: " + e); }
	});

	// ---------------------------------------------------------------- f63: 3D rotation and translation
	build("f63-3d", function () {
		newDoc("timeline", 400, 300, 24);
		symbol("card", "movie clip", function () {
			rect(-50, -35, 50, 35, "#CC6633", "#552200");
			oval(-20, -20, 20, 20, "#FFEE88");
		});
		var turned = function (lname, name, x, y, rot, move) {
			layer(lname);
			var e = place(name, x, y, 0);
			doc.selectNone();
			doc.selection = [e];
			if (rot) doc.rotate3DSelection(rot, true);
			if (move) doc.translate3DSelection(move, true);
			doc.selectNone();
		};
		turned("y", "card", 90, 80, { x: 0, y: 50, z: 0 });
		turned("x", "card", 220, 80, { x: 50, y: 0, z: 0 });
		turned("xyz", "card", 330, 90, { x: 30, y: 40, z: 20 });
		turned("near", "card", 100, 210, null, { x: 0, y: 0, z: -200 });
		turned("far", "card", 220, 210, null, { x: 0, y: 0, z: 300 });
		turned("both", "card", 330, 210, { x: 0, y: -60, z: 0 }, { x: 0, y: 0, z: 150 });
		extendAll(12);
		var t = tl(), r = [];
		for (var i = 0; i < t.layers.length; i++) {
			var els = t.layers[i].frames[0].elements;
			if (!els.length || els[0].elementType != "instance") continue;
			var m = els[0].matrix, q = els[0].matrix3D;
			r.push(t.layers[i].name + " is3D " + els[0].is3D + " m " + [m.a, m.b, m.c, m.d, m.tx, m.ty].join(",") + " m3 " + [q.m00, q.m01, q.m02, q.m10, q.m11, q.m12, q.m20, q.m21, q.m22, q.m30, q.m31, q.m32].join(","));
		}
		log.push("f63: " + r.join(" | "));
	});

	// ---------------------------------------------------------------- f64: 3D tween, view angle and vanishing point
	build("f64-3d2", function () {
		newDoc("timeline", 400, 300, 24);
		symbol("card", "movie clip", function () {
			rect(-60, -40, 60, 40, "#3366CC", "#112244");
			rect(-40, -10, 0, 10, "#FFCC00");
		});
		doc.setStageViewAngle(80);
		layer("spin");
		place("card", 130, 150, 0);
		var t = tl();
		var li = t.currentLayer;
		t.insertFrames(23, false, 1);
		try {
			t.setSelectedLayers(li);
			t.createMotionObject(0, 23);
			t.currentFrame = 23;
			var e2 = t.layers[li].frames[23].elements[0];
			doc.selectNone();
			doc.selection = [e2];
			// (at the end of a motion tween the angle comes out in degrees where it went in as radians)
			doc.rotate3DSelection({ x: 0, y: 70 * 180 / Math.PI, z: 0 }, true);
			log.push("f64 tween: " + t.layers[li].frames[0].tweenType);
		} catch (ex2) { log.push("f64 motion tween: " + ex2); }
		layer("still");
		var s = place("card", 300, 150, 0);
		doc.selectNone();
		doc.selection = [s];
		doc.rotate3DSelection({ x: 40, y: 0, z: 0 }, true);
		extendAll(24);
	});

	// ---------------------------------------------------------------- f65: layer parenting with scale, skew and flip
	build("f65-rig2", function () {
		newDoc("timeline", 500, 300, 24);
		boxSymbol();
		symbol("dot", "movie clip", function () { oval(-10, -10, 10, 10, "#CC0000"); });
		layer("scaled");
		classicTween("box", 110, 150, 23, function (el) { el.scaleX = 2; el.scaleY = 0.6; });
		layer("skewed");
		classicTween("box", 250, 150, 23, function (el) { el.skewX = 30; el.skewY = -20; });
		layer("flipped");
		classicTween("box", 390, 150, 23, function (el) { el.scaleX = -1; });
		var kids = ["scaled", "skewed", "flipped"];
		for (var k = 0; k < 3; k++) {
			layer(kids[k] + "Child");
			var x = [110, 250, 390][k];
			classicTween("dot", x + 50, 100, 23, function (el) { el.y = 200; });
		}
		extendAll(24);
		var t = tl(), idx = {};
		for (var j = 0; j < t.layers.length; j++) idx[t.layers[j].name] = j;
		for (k = 0; k < 3; k++) {
			var child = t.layers[idx[kids[k] + "Child"]];
			child.setRigParentAtFrame(t.layers[idx[kids[k]]], 0);
			child.setRigParentAtFrame(t.layers[idx[kids[k]]], 23);
		}
		var rm = t.layers[idx.flippedChild].getRigMatrixAtFrame(12);
		log.push("f65 rig matrix@12: " + [rm.a, rm.b, rm.c, rm.d, rm.tx, rm.ty].join(","));
	});

	// ---------------------------------------------------------------- f66: button hit areas
	build("f66-hit", function () {
		newDoc("timeline", 400, 200, 24);
		// the hit area is much larger than the button
		symbol("wide hit", "button", function () {
			var t = tl();
			for (var i = 1; i < 4; i++) t.insertBlankKeyframe(i);
			var c = ["#CC3333", "#33CC33", "#3333CC"];
			for (i = 0; i < 3; i++) { t.currentFrame = i; rect(-20, -20, 20, 20, c[i]); }
			t.currentFrame = 3;
			rect(-70, -60, 70, 60, "#000000");
		});
		// invisible: only a Hit frame
		symbol("invisible", "button", function () {
			var t = tl();
			for (var i = 1; i < 4; i++) t.insertBlankKeyframe(i);
			t.currentFrame = 3;
			rect(-40, -40, 40, 40, "#000000");
		});
		// no Hit frame: the Up art's shape is the hit area
		symbol("own hit", "button", function () {
			var t = tl();
			t.currentFrame = 0;
			oval(-30, -30, 30, 30, "#996600");
			t.insertKeyframe(1);
			t.insertKeyframe(2);
		});
		layer("ui");
		var a = place("wide hit", 90, 100, 0);
		var b = place("invisible", 210, 100, 0);
		var c = place("own hit", 320, 100, 0);
		a.name = "a"; b.name = "b"; c.name = "c";
	});

	/** A document written as XFL by scripts/build-fixtures.mjs (what JSFL can't make), saved as FLA. */
	function buildXfl(name, fn) {
		if (only && only.indexOf("," + name + ",") == -1) return;
		try {
			doc = fl.openDocument(root + "/xfl/" + name + "/" + name + ".xfl");
			lib = doc.library;
			if (fn) fn();
			var uri = outDir + "/" + name + ".fla";
			if (FLfile.exists(uri)) FLfile.remove(uri);
			var ok = fl.saveDocument(doc, uri);
			fl.closeDocument(doc, false);
			log.push(name + ": " + (ok ? "saved" : "SAVE FAILED"));
		} catch (e) {
			log.push(name + ": ERROR " + e + (e.lineNumber ? " line " + e.lineNumber : ""));
			try { fl.closeDocument(doc, false); } catch (e2) {}
		}
	}
	buildXfl("f67-ik");
	buildXfl("f68-ikshape");
	buildXfl("f69-iknested");
	buildXfl("f70-width");

	/**
	 * Documents made with Animate's own Asset Warp tool (no script can: scripts/animate-session.mjs
	 * and real mouse drags), kept as FLA in assets/.
	 */
	function fromAsset(name, asset, fn) {
		if (only && only.indexOf("," + name + ",") == -1) return;
		var uri = outDir + "/" + name + ".fla";
		if (FLfile.exists(uri)) FLfile.remove(uri);
		FLfile.copy(root + "/assets/" + asset + ".fla", uri);
		if (fn) {
			try {
				doc = fl.openDocument(uri);
				fn();
				fl.saveDocument(doc, uri);
				fl.closeDocument(doc, false);
			} catch (e) {
				log.push(name + ": ERROR " + e);
			}
		}
		log.push(name + ": saved");
	}
	fromAsset("f71-warp", "f71-warp");
	fromAsset("f72-warp2", "f72-warp2");
	// the warp in a clip as a graphic, which Animate's own frames step through
	fromAsset("f73-warp3", "f72-warp2", function () {
		var t = doc.getTimeline();
		for (var i = 0; i < t.layers.length; i++) {
			if (t.layers[i].name != "clips") continue;
			t.setSelectedLayers(i);
			t.setSelectedFrames(0, 1);
			try { t.setFrameProperty("tweenType", "none"); } catch (e) {}
			var els = t.layers[i].frames[0].elements;
			for (var k = 0; k < els.length; k++) {
				els[k].symbolType = "graphic";
				els[k].loop = "loop";
			}
		}
	});

	// ---------------------------------------------------------------- scripts: compared with Flash Player (scripts/e2e-as3.ts)
	/** The script of a document ends by quitting the player: the traces are then complete. */
	var QUIT = 'import flash.system.fscommand;\ntrace("END");\nfscommand("quit");\n';

	build("f74-as3lang", function () {
		newDoc("timeline", 300, 200, 24);
		// (what strict mode refuses is part of what is tested)
		doc.as3StrictMode = false;
		rect(10, 10, 100, 60, "#3366CC");
		var t = tl();
		t.layers[0].frames[0].actionScript = [
			'import flash.utils.getQualifiedClassName;',
			'trace(1 + 2 * 3, 7 / 2, 7 % 3, 2 << 3, -7 >> 1, -7 >>> 28, 5 & 3, 5 | 3, 5 ^ 3, ~5);',
			'var i:int = 7 / 2; trace(i);',
			'var u:uint = -1; trace(u);',
			'var n:Number; trace(n);',
			'var b:Boolean; trace(b);',
			'var s:String; trace(s);',
			'var o:Object; trace(o);',
			'var a:*; trace(a);',
			'var v:int; trace(v);',
			'i = 2.9; trace(i);',
			'i += 1.5; trace(i);',
			'i = 2147483647; i++; trace(i);',
			'u = 0; u--; trace(u);',
			'trace(int(3.9), int(-3.9), uint(3.9), int("12"), int("x"), Number("1.5"), Number("x"), String(12), Boolean(0), Boolean("a"));',
			'trace(1 / 0, -1 / 0, 0 / 0, isNaN(0 / 0), isFinite(1 / 0));',
			'trace(0.1 + 0.2, 1e21, 1.5e-7, 100000000000000000000, 255 .toString(16), (3.14159).toFixed(2));',
			'trace("a" + 1, 1 + "a", "a" + null, "a" + undefined, "5" * 2, "5" - 2, true + 1, null + 1);',
			'trace("hello".charAt(1), "hello".charCodeAt(1), "hello".indexOf("l"), "hello".lastIndexOf("l"), "hello".substr(1, 3), "hello".substring(1, 3), "hello".slice(-2));',
			'trace("a,b".split(","), "AbC".toLowerCase(), "AbC".toUpperCase(), "x".concat("y", 1), "hello".replace("l", "L"), "hello".replace(/l/g, "L"), "hello".length);',
			'trace(String.fromCharCode(65, 66), "abc".search(/c/), "a1b2".match(/[0-9]/g));',
			'var list:Array = [3, 1, 2];',
			'trace(list, list.length, list.join("-"), list.indexOf(2), list.concat([9]), list.slice(1), list.reverse());',
			'list.push(4); list.unshift(0); trace(list.pop(), list.shift(), list);',
			'list.splice(1, 1, 7, 8); trace(list);',
			'list = [10, 9, 1]; list.sort(); trace(list);',
			'list.sort(Array.NUMERIC); trace(list);',
			'list.sort(Array.NUMERIC | Array.DESCENDING); trace(list);',
			'list.sort(function (x:int, y:int):int { return y - x; }); trace(list);',
			'var recs:Array = [{k: 2, n: "b"}, {k: 1, n: "a"}]; recs.sortOn("k"); trace(recs[0].n);',
			'recs.sortOn("k", Array.NUMERIC | Array.DESCENDING); trace(recs[0].n);',
			'trace([1, 2, 3].map(function (x:*, i:int, l:Array):* { return x * 2; }), [1, 2, 3].filter(function (x:*, i:int, l:Array):Boolean { return x > 1; }), [1, 2].every(function (x:*, i:int, l:Array):Boolean { return x > 0; }), [1, 2].some(function (x:*, i:int, l:Array):Boolean { return x > 1; }));',
			'var obj:Object = {a: 1, b: "x"}; obj.c = 3; delete obj.a; trace(obj.b, obj["c"], obj.a, "b" in obj, obj.hasOwnProperty("c"));',
			'var keys:Array = []; for (var k:String in obj) keys.push(k); keys.sort(); trace(keys);',
			'var vals:Array = []; for each (var val:* in {x: 1}) vals.push(val); trace(vals);',
			'for (var j:int = 0, m:int = 3; j < m; j++) { if (j == 1) continue; trace(j); }',
			'var w:int = 0; do { w++; } while (w < 3); trace(w);',
			'outer: for (var p:int = 0; p < 3; p++) { for (var q:int = 0; q < 3; q++) { if (q == 1) continue outer; if (p == 2) break outer; trace(p, q); } }',
			'switch ("b") { case "a": trace("A"); case "b": trace("B"); case "c": trace("C"); break; default: trace("D"); }',
			'try { throw new Error("boom"); } catch (e:Error) { trace(e.message, e.name); } finally { trace("fin"); }',
			'try { var nul:Object = null; nul.x = 1; } catch (e2:Error) { trace("caught"); }',
			'function add(x:int, y:int = 2, ...rest):int { return x + y + rest.length; }',
			'trace(add(1), add(1, 1), add(1, 1, 5, 6));',
			'function half(x:int):int { return x / 2; } trace(half(5));',
			'function str(x:String = "d"):String { return x + "!"; } trace(str(), str("e"));',
			'var count:Function = function ():Function { var c:int = 0; return function ():int { return ++c; }; }(); count(); trace(count());',
			'function hoisted():int { return later(); function later():int { return 9; } } trace(hoisted());',
			'trace(typeof 1, typeof "a", typeof true, typeof null, typeof undefined, typeof {}, typeof [], typeof add);',
			'trace(1 is int, 1.5 is int, 1.5 is Number, "a" is String, [] is Array, {} is Object, null is Object, this is MovieClip, this is Sprite);',
			'trace(("a" as String), (1 as String), (this as Sprite) == this);',
			'trace(Math.floor(1.5), Math.ceil(1.2), Math.round(2.5), Math.round(-2.5), Math.abs(-1), Math.max(1, 2, 3), Math.min(1, 2), Math.pow(2, 8), Math.sqrt(16), Math.PI);',
			'trace(parseInt("12px"), parseInt("ff", 16), parseFloat("1.5x"), encodeURIComponent("a b"), decodeURIComponent("a%20b"), escape("a b"));',
			'var d:Date = new Date(2020, 0, 15, 12, 30, 0); trace(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getDay());',
			'var vec:Vector.<int> = new Vector.<int>(); vec.push(1); vec.push(2); trace(vec, vec.length);',
			'var vv:Vector.<String> = new <String>["a", "b"]; trace(vv.join("+"));',
			'var t1:Boolean = true && false || !false; trace(t1, 1 && 2, 0 || 3, null || "x", 1 == "1", 1 === 1, null == undefined, 0 == false);',
			'var c2:int = 3; c2 <<= 2; c2 |= 1; c2 ^= 2; c2 %= 7; trace(c2);',
			'var tern:String = c2 > 1 ? "big" : "small"; trace(tern);',
			'var r1:RegExp = /(\\d+)-(\\d+)/; var m1:Array = "10-20".match(r1); trace(m1[1], m1[2]);',
			'trace(new Array(3).length, new Array(1, 2).length, new Object() is Object);',
			'trace(this.currentFrame, totalFrames, stage.stageWidth, stage.stageHeight, stage.frameRate);',
			QUIT
		].join("\n");
	});

	build("f75-as3timeline", function () {
		newDoc("timeline", 400, 300, 24);
		symbol("kid", "movie clip", function () {
			var k = tl();
			rect(-10, -10, 10, 10, "#CC6633");
			k.insertFrames(9, false, 1);
			k.insertKeyframe(4);
			k.layers[0].frames[0].actionScript = 'trace("kid frame", currentFrame, name, parent.name == "", parent is MovieClip);';
			k.layers[0].frames[4].actionScript = 'trace("kid frame 5", currentFrame);';
		});
		symbol("holder", "movie clip", function () {
			var h = tl();
			h.layers[0].name = "inner";
			h.currentLayer = 0;
			var e = place("kid", 30, 0, 0);
			e.name = "inner";
			h.insertFrames(5, false, 1);
			h.layers[0].frames[0].actionScript = 'trace("holder frame", currentFrame, numChildren, inner == null ? "none" : inner.name);';
		});
		lib.setItemProperty && 0;
		lib.selectItem("kid");
		lib.setItemProperty("linkageExportForAS", true);
		lib.setItemProperty("linkageClassName", "Kid");
		layer("hold");
		var e = place("holder", 100, 100, 0);
		e.name = "box";
		layer("mover");
		classicTween("kid", 200, 50, 11, function (el) { el.x = 310; el.alpha = 0; });
		var t = tl();
		t.layers[t.currentLayer].frames[0].elements[0].name = "mover";
		t.layers[t.currentLayer].frames[11].elements[0].name = "mover";
		layer("actions");
		var ai = t.currentLayer;
		var kf = function (f, code, label) {
			t.currentLayer = ai;
			t.setSelectedLayers(ai);
			if (f > 0) t.insertKeyframe(f);
			var fr = t.layers[ai].frames[f];
			fr.actionScript = code;
			if (label) fr.name = label;
		};
		kf(0, [
			'trace("root 1", currentFrame, totalFrames, currentLabel, currentFrameLabel, numChildren);',
			'var log:int = 0;',
			'trace(box.name, box.x, box.y, box.parent == this, box.root == root, box.stage == stage, root == this);',
			'trace(box.inner, box.getChildAt(0) == box.inner, box.numChildren, box.getChildByName("inner") == box.inner);',
			'for (var i:int = 0; i < numChildren; i++) trace(i, getChildAt(i).name);',
			'addEventListener(Event.ENTER_FRAME, tick);',
			'function tick(e:Event):void { log++; if (log < 5) trace("enter", currentFrame, e.target == this, e.currentTarget == this, e.type); }',
			'box.custom = 5; trace(box.custom);',
			'var mine:Kid = new Kid();',
			'trace("made", mine.name != null, mine.parent, mine.stage, mine.currentFrame);',
			'mine.addEventListener(Event.ADDED_TO_STAGE, function (e:Event):void { trace("added", e.target == mine, mine.stage == stage); });',
			'addChild(mine); mine.x = 50; mine.name = "dyn";',
			'trace(numChildren, getChildIndex(mine), getChildByName("dyn") == mine);',
			'stop();',
			'gotoAndPlay("two");',
			'trace("after goto", currentFrame);'
		].join("\n"));
		kf(3, ['trace("root 4 label", currentFrame, currentLabel, currentFrameLabel);', 'trace("mover", Math.round(mover.x), Math.round(mover.alpha * 100));'].join("\n"), "two");
		kf(6, [
			'trace("root 7", Math.round(mover.x), box.alpha);',
			'mover.x = 5; trace(mover.x);',
			'box.rotation = 90; trace(box.rotation); box.scaleX = 2; trace(box.scaleX); box.alpha = 0.5; trace(box.alpha); box.visible = false; trace(box.visible); box.visible = true;',
			'gotoAndStop(9);',
			'trace("after gotoAndStop", currentFrame);'
		].join("\n"));
		kf(8, ['trace("root 9", currentFrame, mover.x);', 'gotoAndPlay(11);'].join("\n"));
		kf(10, ['trace("root 11", currentFrame, mover.x);', 'removeChild(mine); trace(numChildren, mine.parent, mine.stage);', 'removeEventListener(Event.ENTER_FRAME, tick);'].join("\n"));
		kf(13, ['trace("root 14", currentFrame);', 'prevFrame();', 'trace(currentFrame);', 'nextFrame();', 'trace(currentFrame);', 'stop();', 'var again:Timer = new Timer(10, 2);', 'var ticks:int = 0;', 'again.addEventListener(TimerEvent.TIMER, function (e:TimerEvent):void { ticks++; trace("timer", ticks, again.currentCount, again.running); });', 'again.addEventListener(TimerEvent.TIMER_COMPLETE, function (e:TimerEvent):void { trace("timer done", again.running); finish(); });', 'again.start();', 'function finish():void {', QUIT, '}'].join("\n"));
		extendAll(20);
	});

	build("f76-as3order", function () {
		newDoc("timeline", 400, 300, 24);
		symbol("leaf", "movie clip", function () {
			var k = tl();
			rect(-10, -10, 10, 10, "#33AA33");
			k.insertFrames(5, false, 1);
			k.layers[0].frames[0].actionScript = 'trace(name, "leaf 1", currentFrame);';
			k.insertKeyframe(2);
			k.layers[0].frames[2].actionScript = 'trace(name, "leaf 3", currentFrame);';
			k.insertKeyframe(3);
			k.layers[0].frames[3].actionScript = 'trace(name, "leaf 4 stop", currentFrame); stop();';
		});
		layer("low");
		var a = place("leaf", 50, 50, 0);
		a.name = "low";
		layer("high");
		var b = place("leaf", 100, 50, 0);
		b.name = "high";
		var t = tl();
		var hi = t.currentLayer;
		layer("late");
		var li = t.currentLayer;
		t.insertBlankKeyframe(2);
		t.currentFrame = 2;
		var c = place("leaf", 150, 50, 2);
		c.name = "late";
		t.insertBlankKeyframe(5);
		layer("scriptB");
		var bi = t.currentLayer;
		t.layers[bi].frames[0].actionScript = 'trace("script layer B");';
		layer("scriptA");
		var ai = t.currentLayer;
		var kf = function (f, code) {
			t.currentLayer = ai;
			t.setSelectedLayers(ai);
			if (f > 0) t.insertKeyframe(f);
			t.layers[ai].frames[f].actionScript = code;
		};
		extendAll(1);
		kf(0, [
			'trace("script layer A", late);',
			'import flash.events.EventDispatcher;',
			'addEventListener(Event.ENTER_FRAME, function (e:Event):void { trace("enter root", currentFrame); });',
			'low.addEventListener(Event.ENTER_FRAME, function (e:Event):void { trace("enter low", low.currentFrame); });',
			'stage.addEventListener(Event.ENTER_FRAME, function (e:Event):void { trace("enter stage"); });',
			'addEventListener(Event.EXIT_FRAME, function (e:Event):void { trace("exit root", currentFrame); });',
			'addEventListener(Event.FRAME_CONSTRUCTED, function (e:Event):void { trace("constructed", currentFrame); });',
			'var d:Sprite = new Sprite();',
			'var outer:Sprite = new Sprite(); outer.addChild(d); addChild(outer);',
			'addEventListener("bubble", function (e:Event):void { trace("bubble root", e.target == d, e.currentTarget == root, e.eventPhase); });',
			'outer.addEventListener("bubble", function (e:Event):void { trace("bubble outer", e.eventPhase); });',
			'outer.addEventListener("bubble", function (e:Event):void { trace("capture outer", e.eventPhase); }, true);',
			'd.addEventListener("bubble", function (e:Event):void { trace("bubble d", e.eventPhase); });',
			'd.dispatchEvent(new Event("bubble", true));',
			'd.dispatchEvent(new Event("nobubble", false));',
			'outer.addEventListener("stop", function (e:Event):void { trace("stopped outer 1"); e.stopPropagation(); });',
			'outer.addEventListener("stop", function (e:Event):void { trace("stopped outer 2"); });',
			'addEventListener("stop", function (e:Event):void { trace("never"); });',
			'd.dispatchEvent(new Event("stop", true));',
			'outer.addEventListener("imm", function (e:Event):void { trace("imm 1"); e.stopImmediatePropagation(); });',
			'outer.addEventListener("imm", function (e:Event):void { trace("never 2"); });',
			'd.dispatchEvent(new Event("imm", true));',
			'var once:Function = function (e:Event):void { trace("once"); e.currentTarget.removeEventListener("o", once); };',
			'outer.addEventListener("o", once); outer.dispatchEvent(new Event("o")); outer.dispatchEvent(new Event("o"));',
			'outer.addEventListener("p", function (e:Event):void { trace("low prio"); }, false, 0); outer.addEventListener("p", function (e:Event):void { trace("high prio"); }, false, 5); outer.dispatchEvent(new Event("p"));',
			'trace(outer.hasEventListener("p"), outer.hasEventListener("zz"), d.willTrigger("p"));',
			'd.addEventListener(Event.REMOVED_FROM_STAGE, function (e:Event):void { trace("removed", e.target == d, d.stage == stage); });',
			'd.addEventListener(Event.REMOVED, function (e:Event):void { trace("removed ev", d.parent == outer); });',
			'outer.removeChild(d); trace(d.parent, d.stage);',
			'outer.addEventListener(Event.ADDED, function (e:Event):void { trace("added ev", e.target == d, d.parent == outer); });',
			'outer.addChild(d);',
			'trace(getChildIndex(outer), numChildren);',
			'var s2:Sprite = new Sprite(); addChildAt(s2, 0); trace(getChildIndex(s2), getChildAt(0) == s2, getChildIndex(low));',
			'swapChildren(s2, outer); trace(getChildIndex(s2), getChildIndex(outer));',
			'setChildIndex(outer, numChildren - 1); trace(getChildIndex(outer), getChildIndex(s2));',
			'low.gotoAndStop(2); trace("goto other", low.currentFrame);',
			'gotoAndStop(2);',
			'trace("own goto", currentFrame);',
			'stop(); play(); trace("frame 1 end");'
		].join("\n"));
		kf(1, ['trace("frame 2", late, low.currentFrame, high.currentFrame);', 'gotoAndStop(2); trace("same frame", currentFrame);', 'gotoAndPlay(3); trace("last goto counts", currentFrame);', 'stop();'].join("\n"));
		kf(2, ['trace("frame 3", late != null, late.currentFrame, numChildren);', 'late.gotoAndPlay(3); trace(late.currentFrame);'].join("\n"));
		kf(4, ['trace("frame 5");', 'high.gotoAndStop(5); trace(high.currentFrame); high.play();', 'var n5:int = 0;', 'addEventListener(Event.ENTER_FRAME, five);', 'function five(e:Event):void { if (++n5 == 2) { removeEventListener(Event.ENTER_FRAME, five); gotoAndStop(7); trace("first handler goto", currentFrame); trace("after", currentFrame); } }', 'stop();'].join("\n"));
		kf(6, ['trace("frame 7", currentFrame, late);', 'var s3:Sprite = new Sprite();', 'addEventListener(Event.ENTER_FRAME, tock);', 'var left:int = 3;', 'function tock(e:Event):void { trace("tock", currentFrame, left); if (--left == 0) { removeEventListener(Event.ENTER_FRAME, tock); gotoAndStop(9); trace("handler goto", currentFrame); } }'].join("\n"));
		kf(8, ['trace("frame 9");', QUIT].join("\n"));
		extendAll(10);
	});

	// ---------------------------------------------------------------- f77: a small game, played by scripts/e2e-scripts.ts with a real mouse and keyboard
	build("f77-game", function () {
		newDoc("timeline", 400, 300, 24);
		symbol("disc", "movie clip", function () { oval(-20, -20, 20, 20, "#CC3366"); });
		symbol("crate", "movie clip", function () { rect(-20, -20, 20, 20, "#3366CC"); });
		symbol("star", "movie clip", function () {
			oval(-8, -8, 8, 8, "#FFCC00");
			var s = tl();
			s.layers[0].frames[0].actionScript = 'trace("star made");';
		});
		lib.selectItem("star");
		lib.setItemProperty("linkageExportForAS", true);
		lib.setItemProperty("linkageClassName", "Star");
		symbol("btn", "button", function () {
			var b = tl();
			var c = ["#33AA33", "#55CC55", "#118811"];
			for (var i = 0; i < 4; i++) {
				if (i > 0) b.insertBlankKeyframe(i);
				b.currentFrame = i;
				rect(-40, -15, 40, 15, c[Math.min(i, 2)]);
			}
		});
		layer("things");
		var d = place("disc", 80, 80, 0);
		d.name = "ball";
		var c = place("crate", 200, 80, 0);
		c.name = "box";
		var b = place("btn", 320, 80, 0);
		b.name = "go";
		layer("text");
		doc.addNewText({ left: 20, top: 250, right: 220, bottom: 280 });
		doc.setElementProperty("textType", "dynamic");
		doc.setTextString("Score 0");
		var tf = doc.selection[0] || tl().layers[tl().currentLayer].frames[0].elements[0];
		tf.name = "label";
		doc.selectNone();
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = [
			'var score:int = 0;',
			'ball.addEventListener(MouseEvent.MOUSE_DOWN, function (e:MouseEvent):void { trace("down", e.target == ball, Math.round(e.stageX), Math.round(e.stageY)); ball.startDrag(); });',
			'stage.addEventListener(MouseEvent.MOUSE_UP, function (e:MouseEvent):void { ball.stopDrag(); trace("dropped", Math.round(ball.x), Math.round(ball.y), ball.hitTestObject(box)); });',
			'go.addEventListener(MouseEvent.CLICK, function (e:MouseEvent):void { score += 10; label.text = "Score " + score; trace("score", score, label.text); });',
			'stage.addEventListener(KeyboardEvent.KEY_DOWN, function (e:KeyboardEvent):void { if (e.keyCode == Keyboard.RIGHT) box.x += 10; if (e.keyCode == Keyboard.LEFT) box.x -= 10; if (e.keyCode == Keyboard.SPACE) spawn(); trace("key", e.keyCode, box.x); });',
			'box.addEventListener(MouseEvent.ROLL_OVER, function (e:MouseEvent):void { box.alpha = 0.5; trace("over", box.alpha); });',
			'box.addEventListener(MouseEvent.ROLL_OUT, function (e:MouseEvent):void { box.alpha = 1; trace("out", box.alpha); });',
			'var turning:Boolean = false;',
			'box.addEventListener(MouseEvent.CLICK, function (e:MouseEvent):void { turning = !turning; trace("turning", turning); });',
			'addEventListener(Event.ENTER_FRAME, function (e:Event):void { if (turning) box.rotation += 15; });',
			'function spawn():void { var s:Star = new Star(); s.x = 40 + numChildren * 30; s.y = 200; addChild(s); trace("spawned", numChildren); s.addEventListener(MouseEvent.CLICK, function (e:MouseEvent):void { removeChild(s); trace("popped", numChildren); }); }',
			'var clock:Timer = new Timer(100);',
			'var seconds:int = 0;',
			'clock.addEventListener(TimerEvent.TIMER, function (e:TimerEvent):void { seconds++; if (seconds == 3) { clock.stop(); trace("clock", seconds); } });',
			'clock.start();',
			'trace("ready");',
			'stop();'
		].join("\n");
	});

	// ---------------------------------------------------------------- f78: the display API, line by line (the script is a file of its own: it has every kind of quote)
	build("f78-as3display", function () {
		newDoc("timeline", 400, 300, 24);
		doc.as3StrictMode = false;
		symbol("dot", "movie clip", function () { rect(-5, -5, 5, 5, "#FFCC00"); });
		symbol("box", "movie clip", function () {
			rect(-20, -20, 20, 20, "#3366CC");
			var d = place("dot", 10, 0, 0);
			d.name = "kid";
			var s = tl();
			s.insertFrames(2);
			s.setSelectedFrames(0, 0);
			s.layers[0].frames[0].name = "a";
			s.convertToKeyframes(2);
			s.layers[0].frames[2].name = "b";
		});
		symbol("disc", "movie clip", function () { oval(-20, -20, 20, 20, "#CC3366"); });
		symbol("twoframes", "movie clip", function () { rect(0, 0, 4, 4, "#333333"); tl().insertFrames(1); });
		lib.selectItem("twoframes");
		lib.setItemProperty("linkageExportForAS", true);
		lib.setItemProperty("linkageClassName", "Ball");
		doc.importFile(root + "/assets/glow.png", true);
		lib.selectItem("glow.png");
		lib.setItemProperty("linkageExportForAS", true);
		lib.setItemProperty("linkageClassName", "MyImage");
		lib.setItemProperty("linkageBaseClass", "flash.display.BitmapData");
		lib.items[lib.findItemIndex("glow.png")].compressionType = "lossless";
		doc.importFile(root + "/assets/beep.wav", true);
		lib.selectItem("beep.wav");
		lib.setItemProperty("linkageExportForAS", true);
		lib.setItemProperty("linkageClassName", "Beep");
		lib.setItemProperty("linkageBaseClass", "flash.media.Sound");
		layer("things");
		var o = place("box", 100, 80, 0);
		o.name = "one";
		o.rotation = 30;
		o.scaleX = 2;
		var w = place("box", 300, 200, 0);
		w.name = "two";
		var c = place("disc", 300, 100, 0);
		c.name = "ball";
		var mirrored = place("box", 60, 220, 0);
		mirrored.name = "flip";
		mirrored.scaleX = -1;
		var skewed = place("box", 150, 220, 0);
		skewed.name = "slant";
		skewed.skewX = 20;
		doc.addNewText({ left: 20, top: 250, right: 220, bottom: 280 });
		doc.setElementProperty("textType", "dynamic");
		doc.setTextString("Label");
		doc.setElementTextAttr("bold", false);
		doc.setElementTextAttr("alignment", "left");
		doc.setElementProperty("width", 120);
		var tf = doc.selection[0] || tl().layers[tl().currentLayer].frames[0].elements[5];
		tf.name = "label";
		doc.selectNone();
		var t = tl();
		t.insertFrames(4);
		t.currentFrame = 0;
		layer("labels");
		t = tl();
		t.layers[t.currentLayer].frames[0].name = "intro";
		t.convertToKeyframes(2);
		t.layers[t.currentLayer].frames[2].name = "mid";
		layer("actions");
		t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f78-display.as");
	});

	// ---------------------------------------------------------------- f79: HTML5 Canvas scripts, compared with CreateJS (scripts/e2e-canvas.ts)
	build("f79-canvas", function () {
		newDoc("htmlcanvas", 400, 300, 24);
		symbol("dot", "movie clip", function () { rect(-5, -5, 5, 5, "#FFCC00"); });
		symbol("box", "movie clip", function () {
			rect(-20, -20, 20, 20, "#3366CC");
			var d = place("dot", 10, 0, 0);
			d.name = "kid";
			var s = tl();
			s.insertFrames(2);
			s.setSelectedFrames(0, 0);
			s.layers[0].frames[0].name = "a";
			s.convertToKeyframes(2);
			s.layers[0].frames[2].name = "b";
		});
		symbol("disc", "movie clip", function () { oval(-20, -20, 20, 20, "#CC3366"); });
		symbol("star", "movie clip", function () { oval(-8, -8, 8, 8, "#FFCC00"); tl().insertFrames(1); });
		lib.selectItem("star");
		lib.setItemProperty("linkageExportForAS", true);
		lib.setItemProperty("linkageClassName", "Star");
		layer("things");
		var o = place("box", 100, 80, 0);
		o.name = "one";
		o.rotation = 30;
		o.scaleX = 2;
		var w = place("box", 300, 200, 0);
		w.name = "two";
		var c = place("disc", 300, 100, 0);
		c.name = "ball";
		var mirrored = place("box", 60, 220, 0);
		mirrored.name = "flip";
		mirrored.scaleX = -1;
		var skewed = place("box", 150, 220, 0);
		skewed.name = "slant";
		skewed.skewX = 20;
		doc.addNewText({ left: 20, top: 250, right: 220, bottom: 280 });
		doc.setElementProperty("textType", "dynamic");
		doc.setTextString("Label");
		doc.setElementTextAttr("bold", false);
		doc.setElementTextAttr("alignment", "left");
		var tf = doc.selection[0] || tl().layers[tl().currentLayer].frames[0].elements[5];
		tf.name = "label";
		doc.selectNone();
		var t = tl();
		t.insertFrames(4);
		t.currentFrame = 0;
		layer("labels");
		t = tl();
		t.layers[t.currentLayer].frames[0].name = "intro";
		t.convertToKeyframes(2);
		t.layers[t.currentLayer].frames[2].name = "mid";
		layer("actions");
		t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f79-canvas.js") + "\n" + FLfile.read(root + "/as3/f79-mouse.js");
	});

	// ---------------------------------------------------------------- f80: three scenes with scripts, exported as one
	build("f80-as3scenes", function () {
		newDoc("timeline", 300, 200, 24);
		doc.as3StrictMode = false;
		function frames(n, labels, scripts) {
			rect(10, 10, 60, 60, "#3366CC");
			var t = tl();
			t.insertFrames(n - 1);
			layer("labels");
			t = tl();
			var ll = t.layers[t.currentLayer];
			for (var f in labels) {
				var at = +f;
				if (at > 0) t.convertToKeyframes(at);
				ll.frames[at].name = labels[f];
			}
			layer("actions");
			t = tl();
			var al = t.layers[t.currentLayer];
			for (var g in scripts) {
				var to = +g;
				if (to > 0) t.convertToKeyframes(to);
				al.frames[to].actionScript = scripts[g];
			}
		}
		frames(4, { 1: "here", 3: "shared" }, {
			0: FLfile.read(root + "/as3/f80-scene1.as"),
			1: 'say("one 2"); nextFrame();',
			2: 'say("one 3"); nextScene();',
			3: 'say("one 4"); gotoAndPlay(1, "Last");'
		});
		doc.addNewScene("Middle");
		frames(3, { 0: "shared" }, {
			0: 'say("two 1"); gotoAndPlay(2);',
			1: 'say("two 2"); this.again = true; prevScene();'
		});
		doc.addNewScene("Last");
		frames(3, { 0: "begin", 1: "end" }, {
			0: 'say("three 1"); gotoAndStop("end");',
			1: 'say("three 2"); ' + QUIT
		});
		doc.editScene(0);
	});

	// ---------------------------------------------------------------- f81: the language, compared with Flash Player
	build("f81-as3language", function () {
		newDoc("timeline", 300, 200, 24);
		doc.as3StrictMode = false;
		rect(10, 10, 100, 60, "#3366CC");
		var t = tl();
		t.layers[0].frames[0].actionScript = FLfile.read(root + "/as3/f81-language.as");
	});

	// ---------------------------------------------------------------- f82: the camera's colour effects
	build("f82-camcolor", function () {
		newDoc("timeline", 400, 300, 24);
		layer("art");
		rect(40, 40, 180, 200, "#3366CC");
		oval(200, 80, 340, 220, "#CC3366");
		rect(120, 200, 300, 260, "#44AA55");
		extendAll(24);
		var t = tl();
		t.camera.cameraEnabled = true;
		var c = t.camera;
		log.push("camera members: " + typeof c.setTint + " " + typeof c.setColorFilter + " " + typeof c.getTint + " " + typeof c.getColorFilter + " " + typeof c.setTintColor + " " + typeof c.setTintPercent);
		var ci = -1;
		for (var i = 0; i < t.layers.length; i++) if (t.layers[i].layerType == "camera") ci = i;
		t.setSelectedLayers(ci);
		t.currentLayer = ci;
		t.insertKeyframe(8);
		t.insertKeyframe(16);
		c.tintEnabled = true;
		c.colorFilterEnabled = true;
		c.setTint(0, 0, 255, 128, 0);
		c.setColorFilter(0, 0, 0, 0, 0);
		c.setTint(8, 60, 255, 128, 0);
		c.setColorFilter(8, 0, 0, 0, 0);
		c.setTint(16, 30, 255, 128, 0);
		c.setColorFilter(16, 20, 30, -40, 60);
		t.setSelectedFrames(0, 7);
		t.createMotionTween();
		for (var f = 0; f < 24; f += 6) { var ti = c.getTint(f), cf = c.getColorFilter(f), dump = "cam " + f; for (var k in ti) dump += " " + k + "=" + ti[k]; for (var q in cf) dump += " " + q + "=" + cf[q]; log.push(dump); }
	});

	// ---------------------------------------------------------------- f83: how strokes scale, under an uneven scale
	build("f83-strokescale", function () {
		newDoc("timeline", 500, 300, 24);
		var kinds = ["normal", "horizontal", "vertical", "none"];
		for (var i = 0; i < kinds.length; i++) {
			(function (kind, n) {
				symbol("s " + kind, "graphic", function () {
					doc.setStrokeSize(4);
					doc.setStrokeColor("#222222");
					doc.setFillColor("#FFCC00");
					doc.addNewRectangle({ left: -20, top: -20, right: 20, bottom: 20 }, 0, false, false);
					var els = tl().layers[0].frames[0].elements;
					doc.selectAll();
					var st = doc.getCustomStroke("selection");
					st.scaleType = kind;
					st.thickness = 4;
					doc.setCustomStroke(st);
					doc.selectNone();
				});
				layer("l " + kind);
				var a = place("s " + kind, 70 + n * 115, 80, 0);
				a.scaleX = 2.5;
				a.scaleY = 0.75;
				var b = place("s " + kind, 70 + n * 115, 210, 0);
				b.scaleX = 0.6;
				b.scaleY = 2;
			})(kinds[i], i);
		}
	});

	// ---------------------------------------------------------------- f84: Export as Bitmap and Cache as Bitmap
	build("f84-render", function () {
		newDoc("timeline", 500, 300, 24);
		symbol("art", "movie clip", function () {
			oval(-40, -40, 40, 40, "#3366CC");
			rect(-10, -30, 10, 30, "#FFCC00");
		});
		layer("as vector");
		place("art", 80, 80, 0);
		layer("export");
		var e = place("art", 220, 80, 0);
		e.bitmapRenderMode = "export";
		log.push("render mode " + e.bitmapRenderMode + " cacheAsBitmap " + e.cacheAsBitmap);
		layer("export scaled");
		var s = place("art", 380, 80, 0);
		s.bitmapRenderMode = "export";
		s.scaleX = 1.5;
		s.scaleY = 1.5;
		s.rotation = 20;
		layer("cache");
		var c = place("art", 80, 220, 0);
		c.cacheAsBitmap = true;
		layer("cache scaled");
		var d = place("art", 220, 220, 0);
		d.cacheAsBitmap = true;
		d.scaleX = 1.5;
		d.rotation = 20;
		layer("export filtered");
		var f = place("art", 380, 220, 0);
		f.bitmapRenderMode = "export";
		doc.selectNone();
		doc.selection = [f];
		doc.addFilter("blurFilter");
		doc.setFilterProperty("blurX", 0, 6);
		doc.setFilterProperty("blurY", 0, 6);
		doc.selectNone();
	});

	// ---------------------------------------------------------------- f85: UI components, their API compared with Flash Player
	build("f85-controls", function () {
		newDoc("timeline", 560, 400, 24);
		doc.as3StrictMode = false;
		layer("controls");
		var add = function (kind, name, x, y) {
			fl.componentsPanel.addItemToDocument({ x: x, y: y }, "User Interface", kind);
			var e = doc.selection[0];
			e.name = name;
			doc.selectNone();
			return e;
		};
		add("Button", "ok", 20, 20);
		add("CheckBox", "tick", 20, 60);
		add("RadioButton", "one", 20, 100);
		add("RadioButton", "two", 20, 130);
		add("ComboBox", "pick", 20, 170);
		add("List", "many", 20, 210);
		add("TextInput", "line", 160, 20);
		add("TextArea", "lines", 160, 60);
		add("Label", "title", 160, 120);
		add("NumericStepper", "num", 160, 160);
		add("Slider", "slide", 160, 200);
		add("ColorPicker", "shade", 160, 230);
		add("ProgressBar", "bar", 160, 270);
		add("DataGrid", "grid", 420, 60);
		add("UILoader", "loads", 420, 200);
		var t = tl();
		layer("actions");
		t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f85-controls.as");
	});

	// ---------------------------------------------------------------- f86: input text fields
	build("f86-input", function () {
		newDoc("timeline", 400, 340, 24);
		doc.as3StrictMode = false;
		layer("fields");
		var field = function (name, rect, str, props) {
			doc.selectNone();
			doc.addNewText(rect, str || " ");
			var els = tl().layers[tl().currentLayer].frames[0].elements;
			var e = els[els.length - 1];
			e.textType = props.type || "input";
			e.setTextAttr("face", "Arial");
			e.setTextAttr("size", 14);
			e.setTextAttr("fillColor", props.color || "#003399");
			e.setTextAttr("bold", false);
			e.setTextAttr("italic", false);
			e.setTextAttr("alignment", "left");
			e.name = name;
			e.lineType = props.lineType || "single line";
			e.maxCharacters = props.max || 0;
			if (!str) e.setTextString("");
			if (props.border) e.border = true;
			e.autoExpand = false;
			doc.selectNone();
			e.selected = true;
			doc.setTextRectangle(rect);
			doc.selectNone();
		};
		field("one", { left: 20, top: 20, right: 220, bottom: 44 }, "Hello", { border: true });
		field("many", { left: 20, top: 60, right: 220, bottom: 130 }, "Line one\rLine two", { lineType: "multiline", border: true, color: "#660000" });
		field("pass", { left: 20, top: 140, right: 220, bottom: 164 }, "", { lineType: "password", border: true });
		field("most", { left: 20, top: 180, right: 220, bottom: 204 }, "12", { max: 5, border: true });
		field("nowrap", { left: 20, top: 220, right: 220, bottom: 270 }, "No wrap here", { lineType: "multiline no wrap", border: true });
		field("wide", { left: 240, top: 20, right: 380, bottom: 90 }, "A paragraph long enough to wrap in its field\rand one more", { lineType: "multiline", border: true });
		field("shown", { left: 240, top: 110, right: 380, bottom: 180 }, "A dynamic paragraph long enough to wrap in its field\rand one more", { lineType: "multiline", type: "dynamic" });
		field("blank", { left: 240, top: 200, right: 380, bottom: 224 }, "", { type: "dynamic", color: "#117733" });
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f86-input.as");
	});

	// ---------------------------------------------------------------- f87: typing, keys come from outside
	build("f87-typing", function () {
		newDoc("timeline", 400, 340, 24);
		doc.as3StrictMode = false;
		layer("fields");
		var field = function (name, rect, str, props) {
			doc.selectNone();
			doc.addNewText(rect, str || " ");
			var els = tl().layers[tl().currentLayer].frames[0].elements;
			var e = els[els.length - 1];
			e.textType = "input";
			e.setTextAttr("face", "Arial");
			e.setTextAttr("size", 14);
			e.setTextAttr("fillColor", "#003399");
			e.setTextAttr("bold", false);
			e.setTextAttr("italic", false);
			e.setTextAttr("alignment", "left");
			e.name = name;
			e.lineType = props.lineType || "single line";
			e.maxCharacters = props.max || 0;
			if (!str) e.setTextString("");
			e.border = true;
			// (with embedded fonts Flash takes only the characters that came along)
			e.fontRenderingMode = "device";
			e.autoExpand = false;
			doc.selectNone();
			e.selected = true;
			doc.setTextRectangle(rect);
			doc.selectNone();
		};
		field("one", { left: 20, top: 10, right: 220, bottom: 34 }, "Hi", {});
		field("many", { left: 20, top: 40, right: 220, bottom: 100 }, "", { lineType: "multiline" });
		field("most", { left: 20, top: 110, right: 220, bottom: 134 }, "12", { max: 5 });
		field("upper", { left: 20, top: 140, right: 220, bottom: 164 }, "", {});
		field("digits", { left: 20, top: 170, right: 220, bottom: 194 }, "", {});
		field("block", { left: 20, top: 200, right: 220, bottom: 224 }, "", {});
		field("pass", { left: 20, top: 230, right: 220, bottom: 254 }, "", { lineType: "password" });
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f87-typing.as");
	});

	// ---------------------------------------------------------------- f88: UI components under the mouse and the keyboard
	build("f88-clicks", function () {
		newDoc("timeline", 400, 400, 24);
		doc.as3StrictMode = false;
		layer("controls");
		var add = function (kind, name, x, y, params, w, h) {
			// (made away from everything: a UIScrollBar dropped on a text field snaps to it)
			fl.componentsPanel.addItemToDocument({ x: 380, y: 380 }, "User Interface", kind);
			var e = doc.selection[0];
			e.name = name;
			if (w) e.width = w;
			if (h) e.height = h;
			e.x = x;
			e.y = y;
			for (var i = 0; params && i < e.parameters.length; i++) {
				var q = e.parameters[i];
				if (params[q.name] !== undefined) q.value = params[q.name];
			}
			doc.selectNone();
		};
		var fruit = [{ label: "Apple", data: "1" }, { label: "Pear", data: "2" }, { label: "Plum", data: "3" }];
		add("Button", "ok", 20, 20);
		add("Button", "tog", 130, 20, { toggle: true, label: "Toggle" });
		add("CheckBox", "tick", 20, 50);
		add("RadioButton", "one", 20, 80, { value: "first" });
		add("RadioButton", "two", 130, 80, { value: "second" });
		add("ComboBox", "pick", 20, 110, { dataProvider: fruit });
		add("List", "many", 140, 110, { dataProvider: fruit });
		add("TextInput", "line", 20, 220, { text: "Hi" });
		add("TextArea", "lines", 140, 220, { text: "Top" }, 100, 50);
		add("NumericStepper", "num", 20, 250, { value: 3 });
		add("Slider", "slide", 20, 300, { maximum: 100, value: 20 }, 120);
		add("Slider", "live", 200, 300, { maximum: 100, value: 50, liveDragging: true }, 120);
		add("ColorPicker", "shade", 20, 330, { selectedColor: "#FF0000" });
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f88-clicks.as");
	});

	// ---------------------------------------------------------------- f89: UI components of an HTML5 Canvas document
	build("f89-canvasui", function () {
		newDoc("htmlcanvas", 400, 300, 24);
		layer("controls");
		var add = function (kind, name, x, y, params) {
			fl.componentsPanel.addItemToDocument({ x: x, y: y }, "User Interface", kind);
			var e = doc.selection[0];
			e.name = name;
			e.x = x;
			e.y = y;
			for (var i = 0; params && i < e.parameters.length; i++) {
				var q = e.parameters[i];
				if (params[q.name] !== undefined) q.value = params[q.name];
			}
			doc.selectNone();
		};
		var fruit = [{ label: "Apple", data: "1" }, { label: "Pear", data: "2" }, { label: "Plum", data: "3" }];
		add("Button", "btn", 20, 20, { label: "Go" });
		add("CheckBox", "chk", 140, 20, { label: "Tick", value: "yes" });
		add("RadioButton", "rad1", 20, 50, { label: "One", value: "first", name: "group" });
		add("RadioButton", "rad2", 140, 50, { label: "Two", value: "second", name: "group" });
		add("ComboBox", "cmb", 20, 80, { items: fruit });
		add("List", "lst", 140, 80, { items: [{ "": "One" }, { "": "Two" }] });
		add("TextInput", "txt", 20, 110, { value: "Hello" });
		add("NumericStepper", "num", 20, 140, { value: 3, min: 0, max: 9 });
		add("Label", "lab", 20, 170, { label: "A label" });
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f89-ui.js");
	});

	// ---------------------------------------------------------------- f90: the video component in scripts
	build("f90-video", function () {
		newDoc("timeline", 400, 300, 24);
		doc.as3StrictMode = false;
		FLfile.copy(root + "/assets/clip.mp4", outDir + "/clip.mp4");
		layer("video");
		var v = videoComponent(["FLVPlayback 2.5", "FLVPlayback"], 40, 40, { source: "clip.mp4", autoPlay: false, skin: "" });
		v.name = "vid";
		v.width = 240;
		v.height = 180;
		v.x = 40;
		v.y = 40;
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f90-video.as");
	});

	// ---------------------------------------------------------------- f91: a document class and classes in .as files
	build("f91-classes", function () {
		newDoc("timeline", 400, 300, 24);
		// (the classes lie in tests/fixtures/as3/f91, found through the document's class path)
		doc.docClass = "Main";
		doc.sourcePath = "../as3/f91";
		boxSymbol();
		layer("art");
		var b = place("box", 100, 100, 0);
		b.name = "box";
		var t = tl();
		t.insertFrames(1);
		layer("labels");
		t = tl();
		t.convertToKeyframes(1);
		t.layers[t.currentLayer].frames[1].name = "end";
		layer("actions");
		t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = 'trace("frame 1", currentFrame, describeMe(), count, TITLE, box.name);\nstop();';
		t.convertToKeyframes(1);
		t.layers[t.currentLayer].frames[1].actionScript = 'import flash.system.fscommand;\ntrace("frame 2", currentFrame, currentLabel, frames);\ntrace("END");\nfscommand("quit");';
	});

	// ---------------------------------------------------------------- f92: classes of library symbols
	build("f92-symbols", function () {
		newDoc("timeline", 400, 300, 24);
		doc.docClass = "Game";
		doc.sourcePath = "../as3/f92";
		var linkTo = function (item, cls, base) {
			lib.selectItem(item);
			lib.setItemProperty("linkageExportForAS", true);
			lib.setItemProperty("linkageClassName", cls);
			if (base) lib.setItemProperty("linkageBaseClass", base);
		};
		symbol("Eye", "movie clip", function () { oval(-4, -4, 4, 4, "#FFFFFF"); });
		linkTo("Eye", "game.Eye");
		symbol("Ball", "movie clip", function () {
			oval(-20, -20, 20, 20, "#CC3333");
			layer("eye");
			var e = place("Eye", 6, -6, 0);
			e.name = "eye";
			var s = tl();
			s.insertFrames(2, true, 0);
			layer("actions");
			s = tl();
			s.layers[s.currentLayer].frames[0].actionScript = 'trace("Ball frame 1", nameOf(), color, made);';
			s.convertToKeyframes(2);
			s.layers[s.currentLayer].frames[2].actionScript = 'trace("Ball frame 3", bounce(3));\nstop();';
		});
		linkTo("Ball", "game.Ball");
		symbol("Star", "movie clip", function () {
			rect(-10, -10, 10, 10, "#FFCC00");
			tl().insertFrames(1, true, 0);
		});
		linkTo("Star", "Star", "game.Spinner");
		boxSymbol();
		layer("low");
		var b1 = place("Ball", 80, 100, 0);
		b1.name = "ball1";
		var t = tl();
		t.insertFrames(3, true, 0);
		t.convertToBlankKeyframes(2);
		layer("plain");
		var p = place("box", 200, 100, 0);
		p.name = "plain";
		layer("high");
		var b2 = place("Ball", 300, 100, 0);
		b2.name = "ball2";
		layer("actions");
		t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = 'trace("root frame 1", ball1.nameOf(), ticks);';
		t.convertToKeyframes(2);
		t.layers[t.currentLayer].frames[2].actionScript = 'trace("root frame 3", ball1);';
		t.convertToKeyframes(3);
		t.layers[t.currentLayer].frames[3].actionScript = 'import flash.system.fscommand;\ntrace("root frame 4", numChildren);\ntrace("END");\nfscommand("quit");\nstop();';
	});

	// ---------------------------------------------------------------- f93: a document class that extends Sprite, and what code-only projects use
	build("f93-sprite", function () {
		newDoc("timeline", 400, 300, 24);
		doc.docClass = "App";
		doc.sourcePath = "../as3/f93";
		boxSymbol();
		layer("art");
		var l = place("box", 120, 80, 0);
		l.name = "logo";
	});

	// ---------------------------------------------------------------- f94: XML and E4X in a frame script
	build("f94-xml", function () {
		newDoc("timeline", 400, 300, 24);
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f94-xml.as");
	});

	// ---------------------------------------------------------------- f95: XML namespaces (Atom, Media RSS, Dublin Core)
	build("f95-xmlns", function () {
		newDoc("timeline", 400, 300, 24);
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f95-xmlns.as");
	});

	// ---------------------------------------------------------------- f96: TileList, ScrollPane, UIScrollBar
	build("f96-panes", function () {
		newDoc("timeline", 400, 400, 24);
		doc.as3StrictMode = false;
		symbol("BigArt", "movie clip", function () {
			rect(0, 0, 400, 300, "#88AACC");
			rect(20, 20, 60, 60, "#CC3333");
			rect(340, 240, 380, 280, "#33CC33");
		});
		lib.selectItem("BigArt");
		lib.setItemProperty("linkageExportForAS", true);
		lib.setItemProperty("linkageClassName", "BigArt");
		lib.setItemProperty("linkageExportInFirstFrame", true);
		layer("story");
		var lines = [];
		for (var n = 1; n <= 12; n++) lines.push("Line " + n);
		var storyBox = { left: 220, top: 20, right: 360, bottom: 80 };
		doc.selectNone();
		doc.addNewText(storyBox, " ");
		var els = tl().layers[tl().currentLayer].frames[0].elements;
		var st = els[els.length - 1];
		st.textType = "dynamic";
		st.setTextAttr("face", "Arial");
		st.setTextAttr("size", 12);
		st.setTextAttr("fillColor", "#000000");
		st.setTextAttr("bold", false);
		st.setTextAttr("italic", false);
		st.setTextAttr("alignment", "left");
		st.lineType = "multiline";
		st.name = "story";
		st.autoExpand = false;
		st.setTextString(lines.join("\r"));
		// (Scrollable: else the box grows to the text)
		st.scrollable = true;
		doc.selectNone();
		st.selected = true;
		doc.setTextRectangle(storyBox);
		doc.selectNone();
		layer("controls");
		var add = function (kind, name, x, y, params, w, h) {
			fl.componentsPanel.addItemToDocument({ x: x, y: y }, "User Interface", kind);
			var e = doc.selection[0];
			e.name = name;
			if (w) e.width = w;
			if (h) e.height = h;
			e.x = x;
			e.y = y;
			for (var i = 0; params && i < e.parameters.length; i++) {
				var q = e.parameters[i];
				if (params[q.name] === undefined) continue;
				if (q.valueType == "List") {
					for (var j = 0; j < q.value.length; j++) if (q.value[j].value == params[q.name]) q.listIndex = j;
				} else q.value = params[q.name];
			}
			doc.selectNone();
		};
		var pics = [];
		for (var k = 1; k <= 7; k++) pics.push({ label: "Tile " + k, source: "pic.png" });
		add("TileList", "tiles", 20, 20, { dataProvider: pics }, 180, 120);
		add("TileList", "vtiles", 20, 150, { dataProvider: pics, direction: "vertical" }, 120, 90);
		add("ScrollPane", "pane", 220, 150, { source: "BigArt" }, 150, 100);
		add("UIScrollBar", "bar", 360, 20, { scrollTargetName: "story", direction: "vertical" }, 15, 60);
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f96-panes.as");
	});

	// ---------------------------------------------------------------- f97: jQuery UI components of an HTML5 Canvas document
	build("f97-jqueryui", function () {
		newDoc("htmlcanvas", 400, 300, 24);
		layer("controls");
		var add = function (kind, name, x, y, params) {
			fl.componentsPanel.addItemToDocument({ x: x, y: y }, "jQuery UI", kind);
			var e = doc.selection[0];
			e.name = name;
			e.x = x;
			e.y = y;
			for (var i = 0; params && i < e.parameters.length; i++) {
				var q = e.parameters[i];
				if (params[q.name] !== undefined) q.value = params[q.name];
			}
			doc.selectNone();
		};
		add("RadioSet", "rs", 20, 20, { label: "Size", items: [{ "": "Small" }, { "": "Medium" }, { "": "Large" }] });
		add("DatePicker", "dp", 20, 120, { label: "Day" });
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f97-jqueryui.js");
	});

	// ---------------------------------------------------------------- f98: BitmapData.draw() of display objects
	build("f98-draw", function () {
		newDoc("timeline", 400, 300, 24);
		symbol("dot", "movie clip", function () { rect(0, 0, 20, 20, "#00FF00"); });
		symbol("art", "movie clip", function () {
			rect(0, 0, 40, 40, "#FF0000");
			oval(50, 0, 90, 40, "#0000FF");
			var d = place("dot", 110, 70, 0);
			d.name = "inner";
			d.x = 100;
			d.y = 60;
		});
		doc.importFile(root + "/assets/checker.png", true);
		lib.selectItem("checker.png");
		lib.setItemProperty("linkageExportForAS", true);
		lib.setItemProperty("linkageClassName", "Pic");
		lib.setItemProperty("linkageBaseClass", "flash.display.BitmapData");
		lib.items[lib.findItemIndex("checker.png")].compressionType = "lossless";
		layer("art");
		var a = place("art", 200, 150, 0);
		a.name = "art";
		a.rotation = 30;
		layer("actions");
		var t = tl();
		t.layers[t.currentLayer].frames[0].actionScript = FLfile.read(root + "/as3/f98-draw.as");
	});

	// ---------------------------------------------------------------- f99: motion tweens on curves (roadmap package 21)
	build("f99-curves", function () {
		newDoc("timeline", 640, 560, 24);
		boxSymbol();
		// A motion tween whose property curves get handles, written into its XML: that is how the
		// Motion Editor and a path bent on stage keep them (a bent path is curved X and Y over time).
		// Frames 0..23 (a new motion tween lasts a second), then held.
		function curved(name, x, y, mid, end, edit) {
			layer(name);
			var t = tl(),
				li = t.currentLayer;
			place("box", x, y, 0);
			t.createMotionObject(0, 23);
			if (mid) {
				t.currentFrame = 11;
				doc.selectNone();
				doc.selection = [t.layers[li].frames[11].elements[0]];
				doc.moveSelectionBy(mid);
			}
			t.currentFrame = 23;
			doc.selectNone();
			doc.selection = [t.layers[li].frames[23].elements[0]];
			doc.moveSelectionBy(end);
			doc.selectNone();
			var f = t.layers[li].frames[0];
			var xml = f.getMotionObjectXML();
			var changed = edit(xml);
			if (changed == xml) log.push("f99 " + name + ": XML unchanged");
			f.setMotionObjectXML(changed);
		}
		// Motion_Y still (one keyframe) gets handles out of its start and into an end keyframe
		function yHandles(xml, out, into) {
			return xml.replace(
				/(<Property[^>]*id="Motion_Y"[^>]*>)<Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"\/>/,
				'$1<Keyframe anchor="0,0" next="' + out + '" previous="0,0" roving="0" timevalue="0"/><Keyframe anchor="0,0" next="0,0" previous="' + into + '" roving="0" timevalue="23000"/>'
			);
		}
		// an arc: x straight, y up and back down
		curved("arc", 60, 190, null, { x: 380, y: 0 }, function (xml) {
			return yHandles(xml, "8000,-200", "-8000,-200");
		});
		// an S: y down, then up past its start, then back
		curved("scurve", 60, 330, null, { x: 380, y: 0 }, function (xml) {
			return yHandles(xml, "8000,140", "-8000,-140");
		});
		// along an arc, turned with it (orient to path)
		curved("orient", 80, 500, null, { x: 460, y: 0 }, function (xml) {
			return yHandles(xml, "9000,-160", "-9000,-160").replace(/orientToPath="0"/, 'orientToPath="1"');
		});
		// straight pieces through a position keyframe, eased in (the tween's own ease)
		curved("eased", 520, 60, { x: -150, y: 60 }, { x: -80, y: -60 }, function (xml) {
			return xml.replace(/<TimeMap strength="0" type="Quadratic"\/>/, '<TimeMap strength="-100" type="Quadratic"/>');
		});
		extendAll(40);
	});

	FLfile.write(outDir + "/build-log.txt", log.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
