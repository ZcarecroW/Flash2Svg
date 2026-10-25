/*
 * Flash2SVG extractor (runs inside Adobe Animate).
 *
 * Reads a document and writes a "scene model" (scene.json, see src/core/model.ts) plus the
 * artwork Animate's own SVG exporter produces for every shape/text item ("atlas"). All the
 * SVG generation happens afterwards in the compiler (panel or CLI).
 *
 * The user's document is never modified: we work on a temporary copy made with saveAsCopy().
 * The clipboard IS used (frames are copied into the atlas document).
 *
 * JSFL is ES3 + E4X. Keep to that: no JSON, no let/const, no arrow functions, no Object.keys.
 *
 * API:
 *   Flash2Svg.start(optionsJson)   -> starts a job, returns status JSON
 *   Flash2Svg.step(milliseconds)   -> works for about that long, returns status JSON
 *   Flash2Svg.run(optionsJson)     -> runs a whole job synchronously, returns status JSON
 *   Flash2Svg.cancel()             -> aborts and cleans up
 *   Flash2Svg.info()               -> describes the active document (for the panel)
 * Status JSON: {"state":"running"|"done"|"error"|"idle","phase":..,"progress":0..1,"message":..,"scene":uri}
 */
(function (global) {
	var VERSION = "4.0.0";

	// ------------------------------------------------------------------ JSON

	function quote(s) {
		var out = '"';
		for (var i = 0; i < s.length; i++) {
			var c = s.charAt(i);
			var code = s.charCodeAt(i);
			if (c == '"') out += '\\"';
			else if (c == "\\") out += "\\\\";
			else if (c == "\n") out += "\\n";
			else if (c == "\r") out += "\\r";
			else if (c == "\t") out += "\\t";
			else if (code < 32 || code > 126) {
				var h = code.toString(16);
				while (h.length < 4) h = "0" + h;
				out += "\\u" + h;
			} else out += c;
		}
		return out + '"';
	}
	function num(n) {
		if (isNaN(n) || !isFinite(n)) return "null";
		var r = Math.round(n * 1000000) / 1000000;
		if (r == 0) return "0";
		return String(r);
	}
	function stringify(v) {
		if (v === null || v === undefined) return "null";
		var t = typeof v;
		if (t == "number") return num(v);
		if (t == "boolean") return v ? "true" : "false";
		if (t == "string") return quote(v);
		if (t == "function") return "null";
		if (v instanceof Array) {
			var parts = [];
			for (var i = 0; i < v.length; i++) parts.push(stringify(v[i]));
			return "[" + parts.join(",") + "]";
		}
		var props = [];
		for (var k in v) {
			if (!v.hasOwnProperty(k)) continue;
			var val = v[k];
			if (val === undefined || typeof val == "function") continue;
			props.push(quote(k) + ":" + stringify(val));
		}
		return "{" + props.join(",") + "}";
	}
	function parse(text) {
		// Options come from our own panel/CLI, never from documents.
		return eval("(" + text + ")");
	}

	// ------------------------------------------------------------------ helpers

	function round(n) { return Math.round(n * 1000000) / 1000000; }
	/** Reads a property that may throw (HTML5 Canvas documents reject many AS3-only properties). */
	function get(o, k, def) {
		try {
			var v = o[k];
			return v === undefined || v === null ? def : v;
		} catch (e) {
			return def;
		}
	}
	/** Matrix that applies `first`, then `then` (points map as x' = a*x + c*y + tx). */
	function concat(first, then) {
		return {
			a: then.a * first.a + then.c * first.b,
			b: then.b * first.a + then.d * first.b,
			c: then.a * first.c + then.c * first.d,
			d: then.b * first.c + then.d * first.d,
			tx: then.a * first.tx + then.c * first.ty + then.tx,
			ty: then.b * first.tx + then.d * first.ty + then.ty
		};
	}
	function mat(m) { return [round(m.a), round(m.b), round(m.c), round(m.d), round(m.tx), round(m.ty)]; }
	function indexOf(list, item) {
		for (var i = 0; i < list.length; i++) if (list[i] === item || list[i] == item) return i;
		return -1;
	}
	function colorOf(src) {
		if (!src) return null;
		var c = {
			mode: src.colorMode || src.mode || "none",
			rP: src.colorRedPercent, gP: src.colorGreenPercent, bP: src.colorBluePercent, aP: src.colorAlphaPercent,
			rA: src.colorRedAmount, gA: src.colorGreenAmount, bA: src.colorBlueAmount, aA: src.colorAlphaAmount
		};
		var keys = ["rP", "gP", "bP", "aP"];
		for (var i = 0; i < 4; i++) if (c[keys[i]] === undefined || isNaN(c[keys[i]])) c[keys[i]] = 100;
		keys = ["rA", "gA", "bA", "aA"];
		for (i = 0; i < 4; i++) if (c[keys[i]] === undefined || isNaN(c[keys[i]])) c[keys[i]] = 0;
		if (c.rP == 100 && c.gP == 100 && c.bP == 100 && c.aP == 100 && c.rA == 0 && c.gA == 0 && c.bA == 0 && c.aA == 0) return null;
		return c;
	}
	function filtersOf(list) {
		var out = [];
		if (!list) return out;
		for (var i = 0; i < list.length; i++) {
			var f = list[i];
			var o = {};
			for (var k in f) {
				var v;
				try { v = f[k]; } catch (e) { continue; }
				if (typeof v == "function") continue;
				if (v && typeof v == "object" && v.length !== undefined) {
					var arr = [];
					for (var j = 0; j < v.length; j++) arr.push(v[j]);
					v = arr;
				}
				o[k] = v;
			}
			out.push(o);
		}
		return out;
	}
	function safeName(s) {
		return String(s).replace(/[^A-Za-z0-9_\-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
	}
	function setPublishSvgOptions(doc) {
		try {
			var p = doc.exportPublishProfileString();
			var start = p.indexOf('name="SVG Image"');
			if (start < 0) return;
			var end = p.indexOf("</PublishProperties>", start);
			var section = p.substring(start, end);
			var fixed = section
				.replace('<Property name="embed">false</Property>', '<Property name="embed">true</Property>')
				.replace('<Property name="includeHiddenLayers">false</Property>', '<Property name="includeHiddenLayers">true</Property>');
			if (fixed != section) doc.importPublishProfileString(p.substring(0, start) + fixed + p.substring(end));
		} catch (e) {}
	}

	// ------------------------------------------------------------------ job

	var job = null;

	function status() {
		if (!job) return stringify({ state: "idle" });
		return stringify({
			state: job.state,
			phase: job.phase,
			progress: job.total ? Math.min(1, job.doneCount / job.total) : 0,
			message: job.message,
			scene: job.state == "done" ? job.outDir + "/scene.json" : undefined,
			warnings: job.model ? job.model.warnings.length : 0
		});
	}

	function warn(msg) {
		if (job && job.model) {
			for (var i = 0; i < job.model.warnings.length; i++) if (job.model.warnings[i] == msg) return;
			job.model.warnings.push(msg);
		}
	}

	function start(options) {
		if (job && job.state == "running") cleanup();
		var opts = typeof options == "string" ? parse(options) : (options || {});
		var src = fl.getDocumentDOM();
		if (!src) throw new Error("No document is open.");
		job = {
			state: "running",
			phase: "prepare",
			message: "Preparing",
			opts: opts,
			queue: [],
			doneCount: 0,
			total: 1,
			srcDoc: src,
			outDir: opts.outDir,
			model: null
		};
		if (!job.outDir) throw new Error("options.outDir is required");
		if (FLfile.exists(job.outDir)) FLfile.remove(job.outDir);
		FLfile.createFolder(job.outDir);
		FLfile.createFolder(job.outDir + "/atlas");
		job.queue.push(prepare);
		return status();
	}

	function step(ms) {
		if (!job || job.state != "running") return status();
		var until = new Date().getTime() + (ms || 200);
		try {
			do {
				var fn = job.queue.shift();
				if (!fn) {
					job.state = "done";
					job.phase = "done";
					job.message = "Done";
					break;
				}
				fn();
				job.doneCount++;
			} while (new Date().getTime() < until);
		} catch (e) {
			job.state = "error";
			job.message = String(e) + (e.lineNumber ? " (line " + e.lineNumber + ")" : "");
			try { cleanup(); } catch (e2) {}
		}
		return status();
	}

	function run(options) {
		start(options);
		var s;
		do { s = step(2000); } while (job.state == "running");
		return s;
	}

	function cancel() {
		if (job) {
			cleanup();
			job.state = "idle";
		}
		return status();
	}

	// ------------------------------------------------------------------ phases

	function prepare() {
		var src = job.srcDoc;
		var tl = src.getTimeline();
		var roots = [];
		if (job.opts.items && job.opts.items.length) {
			for (var i = 0; i < job.opts.items.length; i++) roots.push({ item: job.opts.items[i] });
		} else if (tl.libraryItem) {
			roots.push({ item: tl.libraryItem.name });
		} else {
			roots.push({ scene: src.currentTimeline });
		}
		job.rootRefs = roots;

		// Work on a copy so the user's document can never be damaged.
		job.copyUri = job.outDir + "/_source_copy.fla";
		if (!src.saveAsCopy(job.copyUri)) throw new Error("Could not save a temporary copy of the document.");
		job.doc = fl.openDocument(job.copyUri);
		if (!job.doc) throw new Error("Could not open the temporary copy.");
		job.lib = job.doc.library;

		var platform = fl.version.indexOf("MAC") == 0 ? "mac" : "win";
		job.model = {
			version: 1,
			generator: "flash2svg " + VERSION,
			app: { version: fl.version, platform: platform },
			doc: {
				name: src.name,
				path: src.pathURI || null,
				type: src.type || "Flash",
				width: src.width,
				height: src.height,
				frameRate: src.frameRate,
				backgroundColor: src.backgroundColor
			},
			roots: [],
			timelines: {},
			atlas: {},
			bitmaps: {},
			sounds: {},
			warnings: []
		};
		job.atlasJobs = [];
		job.pendingTimelines = [];
		job.seen = {};
		for (i = 0; i < roots.length; i++) {
			var id = roots[i].item ? "sym:" + roots[i].item : "scene:" + roots[i].scene;
			job.model.roots.push(id);
			queueTimeline(id);
		}
		job.phase = "timelines";
		job.message = "Reading timelines";
		job.queue.push(nextTimeline);
	}

	function queueTimeline(id) {
		if (job.seen[id]) return;
		job.seen[id] = true;
		job.pendingTimelines.push(id);
		job.total++;
	}

	function nextTimeline() {
		var id = job.pendingTimelines.shift();
		if (id) {
			readTimeline(id);
			job.queue.unshift(nextTimeline);
			return;
		}
		// All timelines read: build the atlas
		job.phase = "atlas";
		job.message = "Collecting artwork";
		job.total += job.atlasJobs.length + 4;
		job.atlasDoc = fl.createDocument(job.doc.type == "htmlcanvas" ? "htmlcanvas" : "timeline");
		job.atlasDoc.width = job.doc.width;
		job.atlasDoc.height = job.doc.height;
		setPublishSvgOptions(job.atlasDoc);
		job.atlasFrame = 0;
		job.atlasIndex = 0;
		job.queue.push(nextAtlasJob);
	}

	/** Makes `id` the timeline being edited in the copy document and returns it. */
	function editTimeline(id) {
		// setActiveWindow is slow (~0.25 s): only switch when needed
		if (fl.getDocumentDOM() != job.doc) fl.setActiveWindow(job.doc);
		if (id.indexOf("scene:") == 0) {
			var idx = parseInt(id.substr(6), 10);
			if (job.doc.timelines.length > 1) {
				job.doc.editScene(idx);
			} else {
				// HTML5 Canvas documents have a single scene and no editScene().
				var guard = 0;
				while (job.doc.getTimeline().libraryItem && guard++ < 50) job.doc.exitEditMode();
			}
		} else {
			var name = id.substr(4);
			job.lib.editItem(name);
		}
		return job.doc.getTimeline();
	}

	function readTimeline(id) {
		var tl = editTimeline(id);
		var item = tl.libraryItem;
		var kind = item ? get(item, "symbolType", "movie clip") : "scene";
		var data = {
			id: id,
			name: item ? item.name : tl.name,
			kind: kind,
			frameCount: tl.frameCount,
			layers: []
		};
		if (item && get(item, "scalingGrid", false)) {
			var r = item.scalingGridRect;
			data.scalingGrid = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
		}
		var layers = tl.layers;
		for (var li = 0; li < layers.length; li++) {
			data.layers.push(readLayer(id, tl, layers, li));
		}
		if (!item) readCamera(tl, data);
		job.model.timelines[id] = data;
		job.message = "Reading " + data.name;
		job.doneCount++;
	}

	function readLayer(tlId, tl, layers, li) {
		var layer = layers[li];
		var type = layer.layerType;
		var parent = layer.parentLayer ? indexOf(layers, layer.parentLayer) : -1;
		var out = {
			name: layer.name,
			type: type,
			visible: layer.visible,
			parent: parent,
			frameCount: layer.frameCount,
			keyframes: []
		};
		if (type == "folder") return out;
		var guided = type == "guided";
		var hasRig = false;
		var f = 0;
		while (f < layer.frameCount) {
			var frame = layer.frames[f];
			if (!frame) break;
			var kf = readKeyframe(tlId, tl, layer, li, frame, f, guided);
			out.keyframes.push(kf);
			if (layer.getRigParentAtFrame) {
				try { if (isRigParent(layer.getRigParentAtFrame(f))) hasRig = true; } catch (e) {}
			}
			f += Math.max(1, frame.duration);
		}
		if (hasRig) {
			out.rig = [];
			for (f = 0; f < layer.frameCount; f++) {
				var m = null;
				try { if (isRigParent(layer.getRigParentAtFrame(f))) m = mat(layer.getRigMatrixAtFrame(f)); } catch (e) {}
				out.rig.push(m);
			}
		}
		readLayerEffects(layer, out);
		return out;
	}

	/** getRigParentAtFrame() returns a layer (index or object) or nothing. */
	function isRigParent(p) {
		if (p === undefined || p === null || p === false) return false;
		if (typeof p == "number") return p >= 0;
		return true;
	}

	function readLayerEffects(layer, out) {
		if (!layer.getColorTransformAtFrame) return;
		var effects = [];
		for (var i = 0; i < out.keyframes.length; i++) {
			var f = out.keyframes[i].index;
			var e = { frame: f };
			var any = false;
			try {
				var c = colorOf(layer.getColorTransformAtFrame(f));
				if (c) { e.color = c; any = true; }
			} catch (x) {}
			try {
				var fl2 = filtersOf(layer.getFiltersAtFrame(f));
				if (fl2.length) { e.filters = fl2; any = true; }
			} catch (x) {}
			try {
				var b = layer.getBlendModeAtFrame(f);
				if (b && b != "normal") { e.blendMode = b; any = true; }
			} catch (x) {}
			if (any) effects.push(e);
		}
		if (effects.length) out.effects = effects;
	}

	function readKeyframe(tlId, tl, layer, li, frame, f, guided) {
		var kf = { index: f, duration: frame.duration, elements: [] };
		var label = get(frame, "name", "");
		if (label && get(frame, "labelType", "none") != "none") {
			kf.label = { name: label, type: get(frame, "labelType", "name") };
		}
		var script = get(frame, "actionScript", "");
		if (script) kf.script = String(script).substr(0, 4000);
		var soundItem = get(frame, "soundLibraryItem", null);
		if (soundItem) {
			var sid = readSound(soundItem);
			if (sid) {
				kf.sound = {
					sound: sid,
					sync: get(frame, "soundSync", "event"),
					loopMode: get(frame, "soundLoopMode", "repeat"),
					loops: get(frame, "soundLoop", 1),
					effect: get(frame, "soundEffect", "none")
				};
			}
		}
		var elements = frame.elements;
		// Group consecutive shape elements into one atlas item: z-order is preserved inside the export.
		var run = null;
		for (var i = 0; i < elements.length; i++) {
			var el = elements[i];
			var data = readElement(tlId, el);
			if (data.kind == "shape") {
				if (run && !data.containsInstances && !run.containsInstances) {
					run.endElement = i;
					mergeBounds(run.data.bounds, data.bounds);
					if (data.linearRGB) {
						if (!run.data.linearRGB) run.data.linearRGB = [];
						for (var g = 0; g < data.linearRGB.length; g++) run.data.linearRGB.push(data.linearRGB[g]);
					}
					continue;
				}
				run = addAtlasJob(tlId, li, f, i, i, 1, "shape");
				run.containsInstances = data.containsInstances;
				run.data = data;
				data.atlas = run.id;
				kf.elements.push(data);
				continue;
			}
			run = null;
			if (data.kind == "text") {
				data.atlas = addAtlasJob(tlId, li, f, i, i, 1, "text").id;
			}
			kf.elements.push(data);
		}

		var tt = frame.tweenType;
		if (tt == "motion" || tt == "motion object" || tt == "shape") {
			kf.tween = readTween(tlId, tl, layer, li, frame, f, tt, guided);
		}
		return kf;
	}

	function mergeBounds(a, b) {
		var r = Math.max(a.left + a.width, b.left + b.width);
		var btm = Math.max(a.top + a.height, b.top + b.height);
		a.left = Math.min(a.left, b.left);
		a.top = Math.min(a.top, b.top);
		a.width = r - a.left;
		a.height = btm - a.top;
	}

	function addAtlasJob(tlId, li, f, e0, e1, count, what) {
		var id = "a" + (job.atlasJobs.length + 1);
		var j = { id: id, tl: tlId, layer: li, frame: f, startElement: e0, endElement: e1, count: count, what: what };
		job.atlasJobs.push(j);
		return j;
	}

	function boundsOf(el) {
		return { left: round(el.left), top: round(el.top), width: round(el.width), height: round(el.height) };
	}

	function readElement(tlId, el) {
		var type = el.elementType;
		if (type == "instance") {
			var it = el.instanceType;
			if (it == "symbol" && el.libraryItem) {
				var symId = "sym:" + el.libraryItem.name;
				// the camera's own frame graphic is never drawn
				if (el.libraryItem.name != "___Camera___") queueTimeline(symId);
				var tp = get(el, "transformationPoint", { x: 0, y: 0 });
				var d = {
					kind: "instance",
					symbol: symId,
					symbolType: el.symbolType,
					name: get(el, "name", ""),
					matrix: mat(el.matrix),
					transformPoint: { x: round(tp.x), y: round(tp.y) },
					color: colorOf(el),
					filters: filtersOf(get(el, "filters", [])),
					blendMode: get(el, "blendMode", "normal"),
					visible: get(el, "visible", true) !== false,
					cacheAsBitmap: !!get(el, "cacheAsBitmap", false),
					bounds: boundsOf(el)
				};
				if (el.symbolType == "graphic") {
					d.loop = get(el, "loop", "loop");
					d.firstFrame = get(el, "firstFrame", 0);
					var lf = get(el, "lastFrame", -1);
					if (lf >= 0) d.lastFrame = lf;
				}
				if (get(el, "is3D", false)) {
					d.is3D = true;
					warn("3D transforms are exported as 2D (" + el.libraryItem.name + ")");
				}
				return d;
			}
			if (it == "bitmap" && el.libraryItem) {
				return { kind: "bitmap", bitmap: readBitmap(el.libraryItem), matrix: mat(el.matrix), bounds: boundsOf(el) };
			}
			warn("Unsupported element: " + it);
			return { kind: "unsupported", what: String(it), bounds: boundsOf(el) };
		}
		if (type == "shape") {
			var hasInst = false;
			if (el.isGroup && el.members) {
				for (var i = 0; i < el.members.length; i++) {
					if (el.members[i].elementType != "shape") { hasInst = true; break; }
				}
			}
			if (hasInst) warn("A group contains symbols or text; its content is exported as static artwork");
			var s = { kind: "shape", atlas: "", bounds: boundsOf(el) };
			if (hasInst) s.containsInstances = true;
			// Animate's SVG export drops the "Linear RGB" gradient option: record it here.
			var lin = [];
			linearGradients(el, lin, 0);
			if (lin.length) s.linearRGB = lin;
			return s;
		}
		if (type == "text" || type == "tlfText") {
			var runs = [];
			try {
				for (var r = 0; r < el.textRuns.length; r++) {
					var run = el.textRuns[r];
					var a = run.textAttrs;
					runs.push({
						text: run.characters,
						face: a.face, size: a.size, fillColor: a.fillColor,
						bold: !!a.bold, italic: !!a.italic,
						alignment: a.alignment, letterSpacing: a.letterSpacing || 0, lineSpacing: a.lineSpacing || 0
					});
				}
			} catch (e) {}
			var textType = el.textType || "static";
			var multiline = true, selectable = false, name = "";
			if (textType != "static") {
				try { multiline = el.lineType != "single line"; } catch (e) {}
				try { name = el.name || ""; } catch (e) {}
			}
			try { selectable = !!el.selectable; } catch (e) {}
			return {
				kind: "text",
				textType: textType,
				atlas: "",
				matrix: mat(el.matrix),
				name: name,
				width: round(el.width),
				height: round(el.height),
				text: el.getTextString ? el.getTextString() : "",
				runs: runs,
				multiline: multiline,
				selectable: selectable,
				bounds: boundsOf(el)
			};
		}
		warn("Unsupported element type: " + type);
		return { kind: "unsupported", what: String(type), bounds: boundsOf(el) };
	}

	/** Signatures ("#rrggbb,#rrggbb|0,255") of gradient fills that use linear RGB interpolation. */
	function linearGradients(el, out, depth) {
		if (depth > 8) return;
		var contours = get(el, "contours", null);
		if (contours) {
			for (var i = 0; i < contours.length; i++) {
				var f = get(contours[i], "fill", null);
				if (!f || !get(f, "linearRGB", false)) continue;
				if (f.style != "linearGradient" && f.style != "radialGradient") continue;
				var cols = [], pos = [];
				for (var c = 0; c < f.colorArray.length; c++) {
					cols.push(String(f.colorArray[c]).substr(0, 7).toLowerCase());
					pos.push(f.posArray[c]);
				}
				var sig = cols.join(",") + "|" + pos.join(",");
				if (indexOf(out, sig) < 0) out.push(sig);
			}
		}
		var members = get(el, "members", null);
		if (members) for (var m = 0; m < members.length; m++) linearGradients(members[m], out, depth + 1);
	}

	function readTween(tlId, tl, layer, li, frame, f, tt, guided) {
		var tw = {
			type: tt == "motion" ? "classic" : (tt == "motion object" ? "motionObject" : "shape"),
			easing: get(frame, "tweenEasing", 0),
			rotate: get(frame, "motionTweenRotate", "none"),
			rotateTimes: get(frame, "motionTweenRotateTimes", 0),
			orientToPath: !!get(frame, "motionTweenOrientToPath", false),
			scale: get(frame, "motionTweenScale", true) !== false,
			snap: !!get(frame, "motionTweenSnap", false),
			sync: !!get(frame, "motionTweenSync", false),
			guided: guided
		};
		if (get(frame, "hasCustomEase", false)) {
			tw.customEase = {};
			var props = get(frame, "useSingleEaseCurve", true) ? ["all"] : ["position", "rotation", "scale", "color", "filters"];
			for (var i = 0; i < props.length; i++) {
				try {
					var pts = frame.getCustomEase(props[i]);
					var arr = [];
					for (var p = 0; p < pts.length; p++) arr.push({ x: round(pts[p].x), y: round(pts[p].y) });
					tw.customEase[props[i]] = arr;
				} catch (e) {}
			}
		}
		if (tw.type == "shape") {
			// Re-export every in-between frame of the span through the atlas.
			var next = layer.frames[f + frame.duration];
			var count = frame.duration + (next && next.startFrame == f + frame.duration ? 1 : 0);
			var j = addAtlasJob(tlId, li, f, -1, -1, count, "shapeTween");
			tw.shapeFrames = [];
			j.frameIds = tw.shapeFrames;
			for (var k = 0; k < frame.duration; k++) tw.shapeFrames.push(j.id + "_" + k);
			// The keyframe's own elements are covered by frame 0 of the span.
			return tw;
		}
		var els = frame.elements;
		if (els.length == 1 && els[0].elementType == "instance") {
			tw.samples = [];
			try {
				tl.currentFrame = Math.min(f + 1, tl.frameCount - 1); // forces Animate to (re)compute the tween
				var t = frame.tweenObj;
				var base = els[0].matrix;
				for (var s = 0; s < frame.duration; s++) {
					// getGeometricTransform() is the change since the keyframe, applied in parent space.
					var sample = { matrix: mat(concat(base, t.getGeometricTransform(s))), color: colorOf(t.getColorTransform(s)) };
					if (get(els[0], "filters", []).length) {
						try { sample.filters = filtersOf(t.getFilters(s)); } catch (e) {}
					}
					tw.samples.push(sample);
				}
			} catch (e) {
				delete tw.samples;
				warn("Could not sample a tween (layer " + layer.name + ", frame " + (f + 1) + "): " + e);
			}
		} else if (els.length > 1) {
			warn("Tween with several elements on layer " + layer.name + " (frame " + (f + 1) + ") is ignored");
		}
		return tw;
	}

	function currentTimelineId() {
		var tl = job.doc.getTimeline();
		return tl.libraryItem ? "sym:" + tl.libraryItem.name : "scene:" + job.doc.currentTimeline;
	}

	function readCamera(tl, data) {
		var cam = get(tl, "camera", null);
		if (!cam || !get(cam, "cameraEnabled", false)) return;
		data.camera = [];
		for (var f = 0; f < tl.frameCount; f++) {
			var c = {};
			try {
				var p = cam.getPosition(f);
				c.x = round(p.x); c.y = round(p.y);
				c.zoom = round(cam.getZoom(f));
				c.rotation = round(cam.getRotation(f));
				if (cam.tintEnabled) c.tint = cam.getTint(f);
				if (cam.colorFilterEnabled) c.colorFilter = cam.getColorFilter(f);
			} catch (e) {
				warn("Camera: " + e);
			}
			data.camera.push(c);
		}
	}

	function readBitmap(item) {
		var id = "bmp" + safeName(item.name);
		if (job.model.bitmaps[id]) return id;
		var ext = get(item, "originalCompressionType", "lossless") == "photo" ? "jpg" : "png";
		var rel = "bitmaps/" + id + "." + ext;
		FLfile.createFolder(job.outDir + "/bitmaps");
		var ok = false;
		try { ok = item.exportToFile(job.outDir + "/" + rel, 100); } catch (e) {}
		if (!ok) warn("Could not export bitmap " + item.name);
		job.model.bitmaps[id] = {
			name: item.name,
			file: rel,
			width: get(item, "hPixels", 0),
			height: get(item, "vPixels", 0),
			smoothing: get(item, "allowSmoothing", true) !== false
		};
		return id;
	}

	function readSound(item) {
		var id = "snd" + safeName(item.name);
		if (job.model.sounds[id]) return id;
		FLfile.createFolder(job.outDir + "/sounds");
		var exts = get(item, "originalCompressionType", "") == "RAW" ? ["wav", "mp3"] : ["mp3"];
		var rel = null;
		for (var i = 0; i < exts.length && !rel; i++) {
			var r = "sounds/" + id + "." + exts[i];
			try { if (item.exportToFile(job.outDir + "/" + r)) rel = r; } catch (e) {}
		}
		if (!rel) {
			warn("Could not export sound " + item.name);
			return null;
		}
		job.model.sounds[id] = { name: item.name, file: rel };
		return id;
	}

	// ------------------------------------------------------------------ atlas

	/** Timeline object of the copy document, without entering edit mode. */
	function sourceTimeline(id) {
		if (!job.tlCache) job.tlCache = {};
		if (job.tlCache[id]) return job.tlCache[id];
		var tl;
		if (id.indexOf("scene:") == 0) tl = job.doc.timelines[parseInt(id.substr(6), 10)];
		else {
			var item = job.lib.items[job.lib.findItemIndex(id.substr(4))];
			// hidden system symbols (e.g. the camera) are not listed: fall back to edit mode
			tl = item ? item.timeline : editTimeline(id);
		}
		job.tlCache[id] = tl;
		return tl;
	}

	/**
	 * Takes the next atlas job plus following jobs that can be copied in the same go: same
	 * timeline and layer, contiguous frames, whole-frame shape runs (no isolation needed).
	 */
	function nextBatch() {
		var first = job.atlasJobs[job.atlasIndex];
		if (!first) return null;
		var batch = [first];
		job.atlasIndex++;
		if (!wholeFrame(first)) return batch;
		var last = first;
		while (job.atlasIndex < job.atlasJobs.length && batch.length < 500) {
			var j = job.atlasJobs[job.atlasIndex];
			if (j.tl != first.tl || j.layer != first.layer || j.frame != last.frame + last.count || !wholeFrame(j)) break;
			batch.push(j);
			last = j;
			job.atlasIndex++;
		}
		return batch;
	}

	function wholeFrame(j) {
		if (j.what == "text") return false;
		if (j.startElement < 0) return true; // shape tween span
		var els = sourceTimeline(j.tl).layers[j.layer].frames[j.frame].elements;
		return j.startElement == 0 && j.endElement == els.length - 1;
	}

	function nextAtlasJob() {
		var T = job.timing || (job.timing = {});
		var t0 = new Date().getTime();
		function lap(name) { var n = new Date().getTime(); T[name] = (T[name] || 0) + (n - t0); t0 = n; }
		var batch = nextBatch();
		if (!batch) {
			job.queue.push(exportAtlas);
			return;
		}
		var first = batch[0];
		var lastJob = batch[batch.length - 1];
		var count = lastJob.frame + lastJob.count - first.frame;
		job.message = "Collecting artwork " + job.atlasIndex + "/" + job.atlasJobs.length;

		if (fl.getDocumentDOM() != job.atlasDoc) fl.setActiveWindow(job.atlasDoc);
		var tl = sourceTimeline(first.tl);
		tl.setSelectedLayers(first.layer);
		// Remember where the first copied element sits: pasting symbol frames into a scene moves
		// them (Animate re-centres symbol content), so we measure and record the shift.
		var srcEls = tl.layers[first.layer].frames[first.frame].elements;
		var ref = srcEls[first.startElement >= 0 ? first.startElement : 0];
		var refPos = ref ? { x: ref.left, y: ref.top } : null;
		tl.copyFrames(first.frame, first.frame + count);
		lap("copy");

		var at = job.atlasDoc.getTimeline();
		var k = job.atlasFrame;
		if (k > 0) {
			if (at.layers[0].frameCount <= k) at.insertFrames(k - at.layers[0].frameCount + 1, false, at.layers[0].frameCount);
			at.insertBlankKeyframe(k);
		}
		lap("insert");
		at.pasteFrames(k);
		lap("paste");
		if (at.layers.length > 1) {
			// pasteFrames may create layers if the clipboard holds several; keep the first only.
			for (var x = at.layers.length - 1; x > 0; x--) at.deleteLayer(x);
		}
		// Pasting frames from a guide/mask layer converts the target layer: guides are never
		// exported, so force a plain visible layer every time.
		var al = at.layers[0];
		if (al.layerType != "normal") al.layerType = "normal";
		if (!al.visible) al.visible = true;
		if (al.locked) al.locked = false;
		if (al.outline) al.outline = false;
		var offset = { x: 0, y: 0 };
		var pasted = at.layers[0].frames[k].elements[first.startElement >= 0 ? first.startElement : 0];
		if (refPos && pasted) offset = { x: round(pasted.left - refPos.x), y: round(pasted.top - refPos.y) };

		for (var b = 0; b < batch.length; b++) {
			var j = batch[b];
			var kk = k + (j.frame - first.frame);
			if (j.startElement >= 0) {
				if (batch.length == 1) isolate(at, kk, j);
				job.model.atlas[j.id] = { file: "atlas/a" + (kk + 1) + ".svg", source: j.tl + " layer " + j.layer + " frame " + j.frame, offset: offset };
			} else {
				// shape tween span: one item per frame
				for (var s = 0; s < j.frameIds.length; s++) {
					job.model.atlas[j.frameIds[s]] = { file: "atlas/a" + (kk + s + 1) + ".svg", source: j.tl + " layer " + j.layer + " frame " + (j.frame + s), offset: offset };
				}
			}
			job.doneCount++;
		}
		lap("isolate");
		job.atlasFrame = k + count;
		job.queue.unshift(nextAtlasJob);
	}

	/** Keeps only the job's elements in atlas frame k (and outlines text). */
	function isolate(at, k, j) {
		at.currentFrame = k;
		var els = at.layers[0].frames[k].elements;
		var del = [];
		for (var i = 0; i < els.length; i++) if (i < j.startElement || i > j.endElement) del.push(els[i]);
		if (del.length) {
			job.atlasDoc.selectNone();
			job.atlasDoc.selection = del;
			job.atlasDoc.deleteSelection();
		}
		if (j.what == "text") {
			// Animate writes text as SVG fonts, which browsers ignore: convert to outlines.
			for (var pass = 0; pass < 2; pass++) {
				var left = at.layers[0].frames[k].elements;
				if (!left.length) break;
				job.atlasDoc.selectNone();
				job.atlasDoc.selection = left;
				try { job.atlasDoc.breakApart(); } catch (e) { warn("Could not convert text to outlines: " + e); break; }
			}
		}
	}

	function exportAtlas() {
		job.phase = "export";
		job.message = "Exporting artwork through Animate";
		if (job.atlasFrame > 0) {
			fl.setActiveWindow(job.atlasDoc);
			var te = new Date().getTime();
			job.atlasDoc.exportSVG(job.outDir + "/atlas/a", true, false);
			(job.timing || (job.timing = {})).exportSVG = new Date().getTime() - te;
			// A one-frame document is written without the frame number.
			var single = job.outDir + "/atlas/a.svg";
			if (FLfile.exists(single) && !FLfile.exists(job.outDir + "/atlas/a1.svg")) {
				FLfile.copy(single, job.outDir + "/atlas/a1.svg");
				FLfile.remove(single);
			}
		}
		job.queue.push(writeModel);
	}

	function writeModel() {
		job.phase = "write";
		job.message = "Writing scene";
		if (job.timing) job.model.timing = job.timing;
		if (!FLfile.write(job.outDir + "/scene.json", stringify(job.model))) {
			throw new Error("Could not write scene.json");
		}
		job.queue.push(cleanup);
	}

	function cleanup() {
		if (!job) return;
		try { if (job.atlasDoc) fl.closeDocument(job.atlasDoc, false); } catch (e) {}
		job.atlasDoc = null;
		try { if (job.doc) fl.closeDocument(job.doc, false); } catch (e) {}
		job.doc = null;
		try { if (job.copyUri && FLfile.exists(job.copyUri)) FLfile.remove(job.copyUri); } catch (e) {}
		try { if (job.srcDoc) fl.setActiveWindow(job.srcDoc); } catch (e) {}
	}

	function info() {
		var d = fl.getDocumentDOM();
		if (!d) return stringify({ open: false });
		var tl = d.getTimeline();
		var sel = [];
		try {
			var items = d.library.getSelectedItems();
			for (var i = 0; i < items.length; i++) if (items[i].timeline) sel.push(items[i].name);
		} catch (e) {}
		return stringify({
			open: true,
			name: d.name,
			path: d.pathURI || null,
			type: d.type,
			width: d.width,
			height: d.height,
			frameRate: d.frameRate,
			timeline: tl.libraryItem ? tl.libraryItem.name : tl.name,
			isSymbol: !!tl.libraryItem,
			frameCount: tl.frameCount,
			currentFrame: tl.currentFrame,
			selectedSymbols: sel
		});
	}

	global.Flash2Svg = {
		version: VERSION,
		start: function (o) { return start(o); },
		step: function (ms) { return step(ms); },
		run: function (o) { return run(o); },
		cancel: cancel,
		info: info,
		status: status,
		stringify: stringify
	};
})(this);
