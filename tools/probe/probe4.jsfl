// Probe: can we copy layers from library timelines / paste into another document without
// switching windows or entering edit mode?
(function () {
	var out = [];
	function log(k, v) { out.push(k + " = " + v); }
	function t(name, fn) { try { log(name, fn()); } catch (e) { log(name, "ERROR " + e); } }
	var dir = fl.scriptURI.replace(/\/[^\/]*$/, "");
	var src = fl.createDocument("timeline");
	src.library.addNewItem("graphic", "g1");
	src.library.editItem("g1");
	src.addNewRectangle({ left: 0, top: 0, right: 30, bottom: 30 }, 0);
	var gt = src.getTimeline();
	gt.addNewLayer("L2");
	src.addNewOval({ left: 40, top: 0, right: 70, bottom: 30 }, false, false);
	gt.insertKeyframe(5);
	src.exitEditMode();
	var atlas = fl.createDocument("timeline");
	// atlas is active now
	t("active is atlas", function () { return fl.getDocumentDOM() == atlas; });
	t("copyLayers from library timeline w/o edit (src inactive)", function () {
		var item = src.library.items[src.library.findItemIndex("g1")];
		var tl = item.timeline;
		tl.copyLayers(0, tl.layers.length - 1);
		return "ok layers=" + tl.layers.length;
	});
	t("pasteLayers into active atlas", function () {
		var at = atlas.getTimeline();
		var before = at.layers.length;
		at.pasteLayers(0);
		return before + " -> " + at.layers.length + " frames=" + at.layers[0].frameCount + "," + at.layers[1].frameCount + " el0=" + at.layers[0].frames[0].elements.length + " left=" + (at.layers[0].frames[0].elements[0] ? at.layers[0].frames[0].elements[0].left : "-");
	});
	t("insertFrames on one layer", function () {
		var at = atlas.getTimeline();
		at.setSelectedLayers(1);
		at.insertFrames(10, false, 0);
		return "L1 count=" + at.layers[1].frameCount + " startOfContent=" + at.layers[1].frames[10].startFrame + " el@10=" + at.layers[1].frames[10].elements.length + " el@0=" + at.layers[1].frames[0].elements.length;
	});
	t("copyFrames on inactive doc timeline", function () {
		var item = src.library.items[src.library.findItemIndex("g1")];
		item.timeline.setSelectedLayers(0);
		item.timeline.copyFrames(0, 1);
		var at = atlas.getTimeline();
		at.setSelectedLayers(0);
		at.insertBlankKeyframe(20);
		at.pasteFrames(20);
		return "el@20=" + at.layers[0].frames[20].elements.length;
	});
	t("paste into inactive doc", function () {
		fl.setActiveWindow(src);
		var at = atlas.getTimeline();
		try { at.pasteLayers(0); return "ok " + at.layers.length; } catch (e) { return "fails: " + e; }
	});
	t("timing 20 setActiveWindow", function () {
		var t0 = new Date().getTime();
		for (var i = 0; i < 10; i++) { fl.setActiveWindow(atlas); fl.setActiveWindow(src); }
		return (new Date().getTime() - t0) + "ms";
	});
	t("timing 10 editItem", function () {
		fl.setActiveWindow(src);
		var t0 = new Date().getTime();
		for (var i = 0; i < 10; i++) { src.library.editItem("g1"); src.exitEditMode(); }
		return (new Date().getTime() - t0) + "ms";
	});
	FLfile.write(dir + "/probe4-result.txt", out.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
