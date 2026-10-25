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
		only = "," + FLfile.read(outDir + "/fixtures-only.txt").replace(/\s+/g, "") + ",";
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
		var armIdx = t.currentLayer;
		layer("hand");
		place("dot", 200, 150, 0);
		extendAll(24);
		var handIdx = t.currentLayer;
		try {
			t.layers[handIdx].setRigParentAtFrame(0, armIdx);
			var rp = t.layers[handIdx].getRigParentAtFrame(0);
			var rm = t.layers[handIdx].getRigMatrixAtFrame(12);
			log.push("f14 rig parent: " + rp + " (" + typeof rp + "), rig matrix@12: " + [rm.a, rm.b, rm.c, rm.d, rm.tx, rm.ty].join(","));
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

	FLfile.write(outDir + "/build-log.txt", log.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
