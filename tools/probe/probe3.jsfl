// Probe: camera keyframes/tweens and layer parenting API shapes.
(function () {
	var out = [];
	function log(k, v) { out.push(k + " = " + v); }
	function t(name, fn) { try { log(name, fn()); } catch (e) { log(name, "ERROR " + e); } }
	var dir = fl.scriptURI.replace(/\/[^\/]*$/, "");
	var doc = fl.createDocument("timeline");
	var tl = doc.getTimeline();
	doc.addNewRectangle({ left: 0, top: 0, right: 50, bottom: 50 }, 0);
	tl.insertFrames(23, true, 1);
	var cam = tl.camera;
	cam.cameraEnabled = true;
	t("layers", function () { var r = []; for (var i = 0; i < tl.layers.length; i++) r.push(tl.layers[i].name + "/" + tl.layers[i].layerType + "/" + tl.layers[i].frameCount); return r.join(" "); });
	t("cam methods", function () { var r = []; for (var k in cam) r.push(k); return r.join(","); });
	t("zoom at 0 then set", function () { cam.setZoom(0, 120); return cam.getZoom(0); });
	t("current frame 23 then set", function () {
		tl.setSelectedLayers(0);
		tl.insertKeyframe(23);
		tl.currentFrame = 23;
		cam.setZoom(23, 200);
		cam.setRotation(23, 30);
		return "z23=" + cam.getZoom(23) + " r23=" + cam.getRotation(23) + " kf23=" + (tl.layers[0].frames[23].startFrame == 23);
	});
	t("camera layer element", function () {
		var f = tl.layers[0].frames[0];
		var e = f.elements[0];
		if (!e) return "no elements, type=" + tl.layers[0].layerType;
		var r = [];
		for (var k in e) { try { r.push(k + ":" + e[k]); } catch (x) {} }
		return r.join(", ").substr(0, 900);
	});
	t("tween camera", function () {
		tl.setSelectedLayers(0);
		tl.setSelectedFrames(0, 1);
		tl.createMotionTween();
		tl.currentFrame = 12;
		return "type=" + tl.layers[0].frames[0].tweenType + " z12=" + cam.getZoom(12) + " r12=" + cam.getRotation(12) + " pos12=" + cam.getPosition(12).x;
	});
	t("camera frame tweenObj", function () {
		var tw = tl.layers[0].frames[0].tweenObj;
		var m = tw.getGeometricTransform(12);
		return m.a + " " + m.b + " " + m.c + " " + m.d + " " + m.tx + " " + m.ty;
	});
	// parenting
	t("rig", function () {
		var idx = tl.addNewLayer("child");
		doc.addNewOval({ left: 100, top: 100, right: 120, bottom: 120 }, false, false);
		var r = [];
		var child = tl.layers[idx];
		var parentIdx = idx + 1; // layer below
		try { child.setRigParentAtFrame(0, tl.layers[parentIdx]); r.push("obj ok"); } catch (e) { r.push("obj: " + e); }
		try { child.setRigParentAtFrame(0, parentIdx); r.push("idx ok"); } catch (e) { r.push("idx: " + e); }
		try { tl.layers[idx].setRigParentAtFrame(0, doc.getTimeline().layers[parentIdx]); r.push("fresh obj ok"); } catch (e) { r.push("fresh: " + e); }
		var p = null;
		try { p = tl.layers[idx].getRigParentAtFrame(0); } catch (e) {}
		r.push("parent=" + (p ? p.name : p));
		try { var m = tl.layers[idx].getRigMatrixAtFrame(0); r.push("rig m=" + m.a + "," + m.tx); } catch (e) { r.push("rigm: " + e); }
		return r.join(" | ");
	});
	FLfile.write(dir + "/probe3-result.txt", out.join("\n"));
	fl.closeAll(false);
	fl.quit(false);
})();
