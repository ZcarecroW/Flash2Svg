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

	FLfile.write(outDir + "/build-log.txt", log.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
