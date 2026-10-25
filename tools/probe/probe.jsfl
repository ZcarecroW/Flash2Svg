// Probe of the JSFL engine & APIs available in the installed Animate.
// Run: Animate.exe probe.jsfl  (writes probe-result.txt next to this file, then quits)
(function () {
	var out = [];
	function log(k, v) { out.push(k + " = " + v); }
	function t(name, fn) {
		try { log(name, fn()); } catch (e) { log(name, "ERROR " + e); }
	}
	var dir = fl.scriptURI.replace(/\/[^\/]*$/, "");

	t("fl.version", function () { return fl.version; });
	t("typeof JSON", function () { return typeof JSON; });
	t("JSON.stringify", function () { return JSON.stringify({ a: [1, "x"], b: null }); });
	t("typeof XML", function () { return typeof XML; });
	t("Array.forEach", function () { return typeof [].forEach; });
	t("Array.map", function () { return typeof [].map; });
	t("Array.isArray", function () { return typeof Array.isArray; });
	t("Object.keys", function () { return typeof Object.keys; });
	t("Object.create", function () { return typeof Object.create; });
	t("Object.defineProperty", function () { return typeof Object.defineProperty; });
	t("Function.bind", function () { return typeof (function () {}).bind; });
	t("String.trim", function () { return typeof "".trim; });
	t("Date.now", function () { return typeof Date.now; });
	t("let", function () { return eval("(function(){ let a = 1; return a; })()"); });
	t("const", function () { return eval("(function(){ const a = 2; return a; })()"); });
	t("arrow", function () { return eval("((a) => a + 1)(1)"); });
	t("template", function () { return eval("`x${1}`"); });
	t("forOf", function () { return eval("(function(){ var s=0; for (var v of [1,2]) s+=v; return s; })()"); });
	t("Map", function () { return typeof Map; });
	t("getter literal", function () { var o = { get x() { return 5; } }; return o.x; });
	t("fl.configURI", function () { return fl.configURI; });
	t("FLfile.platformPathToURI", function () { return FLfile.platformPathToURI("C:\\a b\\c.txt"); });

	// Build a test document with a classic tween
	t("createDocument", function () {
		var d = fl.createDocument("timeline");
		return d ? d.type : "null";
	});
	var doc = fl.getDocumentDOM();
	t("doc.type", function () { return doc.type; });
	t("typeof doc.exportSVG", function () { return typeof doc.exportSVG; });
	t("typeof doc.saveAsCopy", function () { return typeof doc.saveAsCopy; });
	t("typeof doc.exportPNG", function () { return typeof doc.exportPNG; });
	t("typeof timeline.camera", function () { return typeof doc.getTimeline().camera; });
	t("frameRate", function () { return doc.frameRate; });

	t("draw+symbol", function () {
		doc.addNewRectangle({ left: 0, top: 0, right: 100, bottom: 50 }, 0);
		doc.selectAll();
		var sym = doc.convertToSymbol("movie clip", "box", "top left");
		return sym ? sym.name : "null";
	});
	var tl = doc.getTimeline();
	t("classic tween", function () {
		tl.insertKeyframe(20);
		tl.currentFrame = 20;
		doc.selectAll();
		doc.moveSelectionBy({ x: 200, y: 100 });
		var f = tl.layers[0].frames[0];
		tl.setSelectedFrames(0, 1);
		tl.createMotionTween();
		f = tl.layers[0].frames[0];
		f.tweenEasing = -100;
		return f.tweenType + " ease=" + f.tweenEasing + " dur=" + f.duration;
	});
	t("tweenObj", function () {
		var f = tl.layers[0].frames[0];
		var tw = f.tweenObj;
		if (!tw) return "undefined";
		var m = tw.getGeometricTransform(10);
		var c = tw.getColorTransform(10);
		return "type=" + tw.tweenType + " dur=" + tw.duration + " start=" + tw.startFrame + " m10.tx=" + m.tx + " ty=" + m.ty + " alpha=" + c.colorAlphaPercent;
	});
	t("tweenObj all tx", function () {
		var tw = tl.layers[0].frames[0].tweenObj, r = [];
		for (var i = 0; i <= 20; i++) { try { r.push(Math.round(tw.getGeometricTransform(i).tx * 100) / 100); } catch (e) { r.push("E"); } }
		return r.join(",");
	});
	t("customEase default", function () {
		var f = tl.layers[0].frames[0];
		var e = f.getCustomEase();
		var s = [];
		for (var i = 0; i < e.length; i++) s.push(e[i].x + ":" + e[i].y);
		return f.hasCustomEase + " single=" + f.useSingleEaseCurve + " [" + s.join(" ") + "]";
	});
	t("frame props", function () {
		var f = tl.layers[0].frames[0], r = [];
		for (var k in f) { try { r.push(k); } catch (e) {} }
		return r.join(",");
	});
	t("element props", function () {
		var e = tl.layers[0].frames[0].elements[0], r = [];
		for (var k in e) { r.push(k); }
		return r.join(",");
	});
	t("layer props", function () {
		var l = tl.layers[0], r = [];
		for (var k in l) { r.push(k); }
		return r.join(",");
	});
	t("exportSVG all frames", function () {
		var base = dir + "/out/probe";
		FLfile.createFolder(dir + "/out");
		doc.exportSVG(base, true, false);
		return FLfile.listFolder(dir + "/out", "files").join(",");
	});
	t("exportSVG current frame", function () {
		tl.currentFrame = 0;
		doc.exportSVG(dir + "/out/cur", true, true);
		return FLfile.listFolder(dir + "/out", "files").join(",");
	});
	t("exportPNG", function () {
		var ok = doc.exportPNG(dir + "/out/png.png", true, true);
		return ok + " " + FLfile.listFolder(dir + "/out", "files").join(",");
	});
	t("canvas doc", function () {
		var d2 = fl.createDocument("htmlcanvas");
		var ty = d2.type;
		var has = typeof d2.exportSVG;
		fl.closeDocument(d2, false);
		return ty + " exportSVG:" + has;
	});

	FLfile.write(dir + "/probe-result.txt", out.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
