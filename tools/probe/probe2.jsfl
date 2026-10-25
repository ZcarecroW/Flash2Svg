// Second probe: tween interpolation access, ease types, motion objects, publish profile.
(function () {
	var out = [];
	function log(k, v) { out.push(k + " = " + v); }
	function t(name, fn) {
		try { log(name, fn()); } catch (e) { log(name, "ERROR " + e); }
	}
	var dir = fl.scriptURI.replace(/\/[^\/]*$/, "");
	FLfile.createFolder(dir + "/out2");

	var doc = fl.createDocument("timeline");
	var tl = doc.getTimeline();
	doc.addNewRectangle({ left: 0, top: 0, right: 100, bottom: 50 }, 0);
	doc.selectAll();
	doc.convertToSymbol("movie clip", "box", "top left");
	tl.insertKeyframe(20);
	tl.currentFrame = 20;
	doc.selectAll();
	t("sel at 20", function () { return doc.selection.length; });
	doc.moveSelectionBy({ x: 200, y: 100 });
	t("tx at kf20", function () { return tl.layers[0].frames[20].elements[0].matrix.tx; });
	tl.setSelectedFrames(0, 1);
	tl.createMotionTween();
	var f0 = tl.layers[0].frames[0];
	t("easeType default", function () { return f0.easeType; });
	f0.tweenEasing = 50;
	t("easeType after tweenEasing=50", function () { return f0.easeType; });
	t("ease curve after 50", function () {
		var e = f0.getCustomEase(), s = [];
		for (var i = 0; i < e.length; i++) s.push(e[i].x + ":" + e[i].y);
		return s.join(" ");
	});
	t("tweenObj tx after refresh", function () {
		tl.currentFrame = 10;
		var tw = tl.layers[0].frames[0].tweenObj, r = [];
		for (var i = 0; i <= 20; i += 5) r.push(Math.round(tw.getGeometricTransform(i).tx * 100) / 100);
		return r.join(",");
	});
	t("elements at frame 10", function () {
		var e = tl.layers[0].frames[10].elements[0];
		return "tx=" + e.matrix.tx + " left=" + e.left;
	});
	t("set easeType values", function () {
		var vals = ["Classic Ease", "Quad Ease-In", "quadIn", "Bounce", "bounceOut", "Custom", "None", "Elastic Ease-In-Out"];
		var r = [];
		for (var i = 0; i < vals.length; i++) {
			try { f0.easeType = vals[i]; r.push(vals[i] + "->" + f0.easeType); } catch (e) { r.push(vals[i] + "->ERR " + e); }
		}
		return r.join(" | ");
	});

	// save & reopen
	var fla = dir + "/out2/tween.fla";
	t("saveDocument", function () { return fl.saveDocument(doc, fla); });
	fl.closeDocument(doc, false);
	doc = fl.openDocument(fla);
	tl = doc.getTimeline();
	t("reopened easeType", function () { return tl.layers[0].frames[0].easeType + " tweenEasing=" + tl.layers[0].frames[0].tweenEasing; });
	t("reopened tweenObj tx", function () {
		var tw = tl.layers[0].frames[0].tweenObj, r = [];
		for (var i = 0; i <= 20; i += 5) r.push(Math.round(tw.getGeometricTransform(i).tx * 100) / 100);
		return r.join(",");
	});
	t("exportSVG frame 10 reopened", function () {
		doc.exportSVG(dir + "/out2/re", true, false);
		var s = FLfile.read(dir + "/out2/re11.svg");
		var m = s.match(/matrix\([^)]*\)/);
		return m ? m[0] : s.substr(0, 200);
	});

	// motion object (new-style tween)
	t("motion object", function () {
		var d = fl.createDocument("timeline");
		var t2 = d.getTimeline();
		d.addNewOval({ left: 0, top: 0, right: 40, bottom: 40 }, 0);
		d.selectAll();
		d.convertToSymbol("graphic", "dot", "center");
		t2.createMotionObject(0, 30);
		var fr = t2.layers[0].frames[0];
		var r = "tweenType=" + fr.tweenType + " isMotionObject=" + fr.isMotionObject() + " dur=" + fr.duration;
		try { r += " xml=" + String(fr.getMotionObjectXML()).substr(0, 300).replace(/\s+/g, " "); } catch (e) { r += " xmlERR " + e; }
		fl.closeDocument(d, false);
		return r;
	});

	t("publish profile svg section", function () {
		var p = fl.getDocumentDOM().exportPublishProfileString();
		var i = p.indexOf("SVG");
		return p.length + " :: " + p.substr(Math.max(0, i - 300), 1500).replace(/\s+/g, " ");
	});
	t("saveAsCopy", function () {
		var r = fl.getDocumentDOM().saveAsCopy(dir + "/out2/copy.fla");
		return r + " exists=" + FLfile.exists(dir + "/out2/copy.fla");
	});

	FLfile.write(dir + "/probe2-result.txt", out.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
