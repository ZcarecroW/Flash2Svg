// Probe (package 21): can a motion tween's path be bent through its XML? Writes the XML before and
// after, and the frames' positions, to tests/out/bentpath.txt.
var out = [];
var base = "file:///C|/GitHubz/Flash2Svg/tests/out/";
var doc = fl.createDocument("timeline");
doc.width = 400;
doc.height = 300;
doc.frameRate = 24;
var lib = doc.library;
doc.addNewRectangle({ left: -20, top: -20, right: 20, bottom: 20 }, 0, false, true);
doc.selectAll();
doc.convertToSymbol("graphic", "box", "center");
doc.selectNone();
lib.selectNone();
var tl = doc.getTimeline();
tl.layers[0].frames[0].elements[0].x = 60;
tl.layers[0].frames[0].elements[0].y = 150;

function positions(li, n) {
	var fr = tl.layers[li].frames[0];
	tl.currentFrame = 1;
	var t = fr.tweenObj;
	var m0 = fr.elements[0].matrix;
	var r = [];
	for (var s = 0; s < n; s++) {
		var g = t.getGeometricTransform(s);
		// (the change since the keyframe, in parent space)
		var x = g.a * m0.tx + g.c * m0.ty + g.tx,
			y = g.b * m0.tx + g.d * m0.ty + g.ty;
		r.push(Math.round(x * 1000) / 1000 + "," + Math.round(y * 1000) / 1000);
	}
	return r.join(" ");
}

function motion(li, mid) {
	tl.setSelectedLayers(li);
	tl.currentLayer = li;
	tl.createMotionObject(0, 24);
	if (mid) {
		tl.currentFrame = 11;
		doc.selectNone();
		doc.selection = [tl.layers[li].frames[11].elements[0]];
		doc.moveSelectionBy({ x: 130, y: -90 });
	}
	tl.currentFrame = 23;
	doc.selectNone();
	doc.selection = [tl.layers[li].frames[23].elements[0]];
	doc.moveSelectionBy({ x: 260, y: 0 });
	doc.selectNone();
}

// layer 0: straight
motion(0, false);
var xml0 = tl.layers[0].frames[0].getMotionObjectXML();
out.push("== straight XML\n" + xml0);
out.push("straight: " + positions(0, 24));
out.push("hasMotionPath " + tl.layers[0].frames[0].hasMotionPath());

// layer 1: the same with handles on Motion_Y written into its XML
tl.setSelectedLayers(0);
tl.copyLayers();
tl.pasteLayers();
var li = 0;
for (var i = 0; i < tl.layers.length; i++) if (i != 1) li = i;
out.push("layers " + tl.layers.length);
var f1 = tl.layers[0].frames[0];
var x1 = f1.getMotionObjectXML();
// the end keyframe of Motion_X: its handles; Motion_Y gets an end keyframe with a bump
var y1 = x1.replace(/(<Property[^>]*id="Motion_Y"[^>]*>)<Keyframe anchor="0,0" next="0,0" previous="0,0" roving="0" timevalue="0"\/>/, '$1<Keyframe anchor="0,0" next="8000,-120" previous="0,0" roving="0" timevalue="0"/><Keyframe anchor="0,0" next="0,0" previous="-8000,-120" roving="0" timevalue="23000"/>');
out.push("replaced Y: " + (y1 != x1));
try {
	f1.setMotionObjectXML(y1);
	out.push("set ok");
} catch (e) {
	out.push("set failed: " + e);
}
out.push("== after XML\n" + tl.layers[0].frames[0].getMotionObjectXML());
out.push("bumped: " + positions(0, 24));

// layer 2: a position keyframe in the middle (a corner), then handles on it
var l2 = tl.addNewLayer("mid", "normal", true);
tl.setSelectedLayers(l2);
tl.currentLayer = l2;
tl.currentFrame = 0;
lib.addItemToDocument({ x: 60, y: 250 }, "box");
motion(l2, true);
var xm = tl.layers[l2].frames[0].getMotionObjectXML();
out.push("== mid XML\n" + xm);
out.push("mid: " + positions(l2, 24));
// smooth the corner: handles on the middle keyframes of X and Y
var xs = xm.replace(/(id="Motion_X"[\s\S]*?<Keyframe anchor="(\d+),(-?[\d.]+)" )next="[^"]*" previous="[^"]*"( roving="0" timevalue="11000"\/>)/, function (all, head, t, v, tail) {
	return head + 'next="' + (+t + 4000) + "," + (+v + 60) + '" previous="' + (+t - 4000) + "," + (+v - 60) + '"' + tail;
});
out.push("replaced mid X: " + (xs != xm));
try {
	tl.layers[l2].frames[0].setMotionObjectXML(xs);
	out.push("set mid ok");
} catch (e) {
	out.push("set mid failed: " + e);
}
out.push("mid smoothed: " + positions(l2, 24));
out.push("== mid after XML\n" + tl.layers[l2].frames[0].getMotionObjectXML());

FLfile.write(base + "bentpath.txt", out.join("\n"));
doc.close(false);
fl.quit(false);
