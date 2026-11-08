// Probe (package 25): Animate 2024 hangs when it quits after a document with a motion tween
// (object-based) was saved and then closed on its own. tests/out/quit-doc.txt names a fixture
// (f06-motionobject), tests/out/quit-mode.txt holds letters, done in order:
//   i: idle message off/on around it; S: change and save the document itself; f: a fresh folder for
//   the copy; c: save a copy (saveAsCopy, as the extractor's working copy); X: as XFL; 2: twice;
//   w: wait until written; n: don't open the copy, else open it; l: read its library; t: read the
//   motion tween (tweenObj); k: close the copy; r: delete its file; s: activate the original;
//   p: exportPNG of the original; D: closeDocument(original); E: original.close()
// Then closeAll and quit. Found: S+D, c+D, c+E hang (90 s, the watchdog ends Animate); without D/E
// (closeAll closing it) nothing hangs; a document without a motion tween never hangs.
var base = "file:///C|/GitHubz/Flash2Svg/";
var name = FLfile.read(base + "tests/out/quit-doc.txt").replace(/\s+$/, "");
var mode = FLfile.read(base + "tests/out/quit-mode.txt").replace(/\s+$/, "");
var log = function (s) { FLfile.write(base + "tests/out/quit-log.txt", s + "\n", "append"); };
if (mode.indexOf("i") >= 0) fl.showIdleMessage(false);
var d = fl.openDocument(base + "tests/fixtures/fla/" + name + ".fla");
var w = d;
log("opened " + name + " mode " + mode);
if (mode.indexOf("S") >= 0) { d.backgroundColor = "#FFFFFE"; log("saved itself " + fl.saveDocument(d)); }
if (mode.indexOf("c") >= 0) {
	FLfile.createFolder(base + "tests/out/quit-probe");
	var copy = base + "tests/out/quit-probe/copy.fla";
	if (mode.indexOf("f") >= 0) {
		var folder = base + "tests/out/quit-probe/model";
		if (FLfile.exists(folder)) FLfile.remove(folder);
		FLfile.createFolder(folder);
		FLfile.createFolder(folder + "/atlas");
		copy = folder + "/_source_copy_test.fla";
	}
	if (FLfile.exists(copy)) FLfile.remove(copy);
	if (mode.indexOf("X") >= 0) { copy = base + "tests/out/quit-probe/xflcopy/copy.xfl"; FLfile.createFolder(base + "tests/out/quit-probe/xflcopy"); }
	log("saved " + d.saveAsCopy(copy));
	if (mode.indexOf("2") >= 0) { d.saveAsCopy(copy + ".2.fla"); log("second copy"); }
	if (mode.indexOf("w") >= 0) {
		// as the extractor's whenWritten: until the size stays the same for a quarter second
		var t0 = new Date().getTime(), last = -1, since = t0, polls = 0;
		for (;;) {
			var now = new Date().getTime(), size = FLfile.getSize(copy);
			polls++;
			if (size != last || size <= 0) { last = size; since = now; } else if (now - since >= 250) break;
			if (now - t0 > 30000) break;
		}
		log("waited " + (new Date().getTime() - t0) + " ms, " + polls + " polls, size " + last);
	}
	if (mode.indexOf("n") < 0) {
		w = fl.openDocument(copy);
		log("copy open");
	} else log("copy saved, not opened");
	if (mode.indexOf("l") >= 0) log("library items " + w.library.items.length);
}
if (mode.indexOf("t") >= 0) {
	var tl = w.getTimeline();
	for (var li = 0; li < tl.layers.length; li++) {
		var fr = tl.layers[li].frames[0];
		if (fr.tweenType != "motion object") continue;
		tl.currentFrame = 1;
		var t = fr.tweenObj;
		var n = 0;
		for (var s = 0; s < fr.duration; s++) { t.getGeometricTransform(s); t.getColorTransform(s); n++; }
		log("tween read on layer " + li + ": " + n + " samples");
	}
}
if (mode.indexOf("k") >= 0 && w != d) {
	fl.closeDocument(w, false);
	log("copy closed");
}
if (mode.indexOf("r") >= 0) log("copy removed " + FLfile.remove(mode.indexOf("f") >= 0 ? base + "tests/out/quit-probe/model/_source_copy_test.fla" : base + "tests/out/quit-probe/copy.fla"));
if (mode.indexOf("s") >= 0) { fl.setActiveWindow(d); log("original active"); }
if (mode.indexOf("i") >= 0) fl.showIdleMessage(true);
if (mode.indexOf("p") >= 0) {
	FLfile.createFolder(base + "tests/out/quit-probe/ref");
	fl.setActiveWindow(d);
	log("png " + d.exportPNG(base + "tests/out/quit-probe/ref/f.png", true, false));
}
if (mode.indexOf("D") >= 0) { fl.closeDocument(d, false); log("original closed"); }
if (mode.indexOf("E") >= 0) { d.close(false); log("original closed by document.close"); }
fl.closeAll(false);
log("closed all");
fl.quit(false);
