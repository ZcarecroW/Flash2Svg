/*
 * E2E step 1 (inside Animate): for every fixture FLA, run the extractor and export
 * Animate's own PNG renderings of all frames as reference images.
 * Reads tests/out/e2e-config.txt: line 1 = repo root URI, line 2 = comma separated fixture names.
 * Writes tests/out/<name>/model/scene.json, tests/out/<name>/ref/f*.png, tests/out/extract-log.txt
 */
(function () {
	var here = fl.scriptURI.replace(/\/[^\/]*$/, "");
	var repo = here.replace(/\/tests\/e2e$/, "");
	var outRoot = repo + "/tests/out";
	var cfg = FLfile.read(outRoot + "/e2e-config.txt").split(/\r?\n/);
	var names = cfg[0].split(",");
	var refs = cfg[1] != "noref";
	var log = [];
	fl.runScript(repo + "/src/jsfl/flash2svg.jsfl");

	for (var i = 0; i < names.length; i++) {
		var name = names[i];
		if (!name) continue;
		var fla = repo + "/tests/fixtures/fla/" + name + ".fla";
		var t0 = new Date().getTime();
		try {
			var doc = fl.openDocument(fla);
			var res = Flash2Svg.run({ outDir: outRoot + "/" + name + "/model" });
			log.push(name + " extract: " + res + " (" + (new Date().getTime() - t0) + "ms)");
			if (refs) {
				FLfile.createFolder(outRoot + "/" + name + "/ref");
				fl.setActiveWindow(doc);
				if (doc.timelines.length > 1) doc.editScene(0);
				var ok = doc.exportPNG(outRoot + "/" + name + "/ref/f.png", true, false);
				log.push(name + " png: " + ok);
			}
			fl.closeDocument(doc, false);
		} catch (e) {
			log.push(name + " ERROR " + e + (e.lineNumber ? " line " + e.lineNumber : ""));
		}
	}
	FLfile.write(outRoot + "/extract-log.txt", log.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
