/*
 * Runs the exporter's extractor on the guide's demo documents (docs/guide/demos/fla/*.fla) and
 * writes their scene data to docs/guide/demos/models/<name>/ — what the panel's Export does
 * before it compiles. Reads the names from docs/guide/demos/fla/extract.txt.
 */
(function () {
	var here = fl.scriptURI.replace(/\/[^\/]*$/, "");
	var repo = here.replace(/\/docs\/guide\/demos$/, "");
	var names = FLfile.read(here + "/fla/extract.txt").replace(/\s+/g, "").split(",");
	var log = [];
	fl.runScript(repo + "/src/jsfl/flash2svg.jsfl");
	for (var i = 0; i < names.length; i++) {
		var name = names[i];
		if (!name) continue;
		var t0 = new Date().getTime();
		try {
			var out = here + "/models/" + name;
			if (FLfile.exists(out)) FLfile.remove(out);
			var doc = fl.openDocument(here + "/fla/" + name + ".fla");
			var res = Flash2Svg.run({ outDir: out });
			log.push(name + ": " + res + " (" + (new Date().getTime() - t0) + " ms)");
			fl.closeDocument(doc, false);
		} catch (e) {
			log.push(name + ": ERROR " + e + (e.lineNumber ? " line " + e.lineNumber : ""));
		}
	}
	FLfile.write(here + "/fla/extract-log.txt", log.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
