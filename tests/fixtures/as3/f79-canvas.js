// Frame 1 of f79-canvas: what the frame scripts of an HTML5 Canvas document see. Traces go to the
// console; scripts/e2e-canvas.ts compares them with the same document published by Animate on the
// real CreateJS.
var self = this;
function log() {
	console.log(Array.prototype.join.call(arguments, " "));
}
function r(n) {
	return Math.round(n * 100) / 100;
}

// ---- the timeline
log("timeline", this.currentFrame, this.totalFrames, this.timeline.duration, this.timeline.position, this.paused, this.loop, this.mode, this.startPosition, this.currentLabel, this.labels.length);
log(this.labels[0].label, this.labels[0].position, this.labels[1].label, this.labels[1].position);
log(this.one.currentFrame, this.one.totalFrames, this.one.paused, this.one.currentLabel, this.one.labels.length);
log(this.name, this.one.name, this.parent === stage, this.one.parent === this, stage.getChildAt(0) === this, exportRoot === this, this.stage === stage, this.one.stage === stage);

// ---- properties
log("props", r(this.one.x), r(this.one.y), r(this.one.rotation), r(this.one.scaleX), r(this.one.scaleY), this.one.alpha, this.one.visible, this.one.regX, this.one.regY, this.one.skewX, this.one.skewY, this.one.mouseEnabled, this.one.tickEnabled, this.one.cursor, this.one.compositeOperation, this.one.mouseChildren);
log(r(this.flip.scaleX), r(this.flip.scaleY), r(this.flip.rotation), r(this.flip.skewX), r(this.flip.skewY));
log(r(this.slant.scaleX), r(this.slant.scaleY), r(this.slant.rotation), r(this.slant.skewX), r(this.slant.skewY));
var w = this.two;
w.x = 10.123; log(w.x); w.x = 300;
w.alpha = 0.3; log(w.alpha); w.alpha = 1.5; log(w.alpha); w.alpha = 1;
w.rotation = 725; log(w.rotation); w.rotation = 0;
w.visible = false; log(w.visible); w.visible = true;

// ---- children
log("children", this.numChildren, this.children.length, this.getChildIndex(this.one) >= 0, this.contains(this.one), this.getChildByName("one") === this.one, this.one.children.length);
var s = new createjs.Shape();
s.name = "drawn";
s.graphics.beginFill("#ff0000").drawRect(0, 0, 20, 10);
this.addChild(s);
log(s.parent === this, this.contains(s), this.getChildByName("drawn") === s, s.getBounds(), s.x, s.alpha);
s.setBounds(1, 2, 3, 4);
log(s.getBounds().x, s.getBounds().width, s.getTransformedBounds().y);
var n = this.numChildren;
this.removeChild(s);
log(this.numChildren === n - 1, s.parent, this.removeChild(s));
var c = new createjs.Container();
c.x = 5;
this.addChild(c);
c.addChild(s);
log(c.numChildren, s.parent === c, c.getChildAt(0) === s, c.getChildIndex(s));
c.removeAllChildren();
log(c.numChildren);
this.removeChild(c);

// ---- points
log("points", r(this.two.localToGlobal(10, 5).x), r(this.two.localToGlobal(10, 5).y), r(this.two.globalToLocal(310, 205).x), r(this.two.globalToLocal(310, 205).y), r(this.two.localToLocal(0, 0, this).x));
log(this.two.hitTest(0, 0), this.two.hitTest(100, 100));

// ---- text
var t = new createjs.Text("Hello", "20px Arial", "#ff0000");
log("text", t.text, t.font, t.color, t.textAlign, t.textBaseline, t.lineHeight, t.lineWidth, t.x);
t.text = "Changed";
t.color = "#00ff00";
t.font = "bold 12px Arial";
t.textAlign = "center";
this.addChild(t);
log(t.text, t.color, t.font, t.textAlign, typeof t.getMeasuredWidth(), typeof t.getMeasuredHeight(), typeof t.getMeasuredLineHeight());
this.removeChild(t);
log(this.label.text, this.label.color, this.label.font, this.label.textAlign, this.label.lineHeight);
this.label.text = "New text";
log(this.label.text);

// ---- graphics chain
var g = new createjs.Graphics();
log("graphics", g.beginFill("red") === g, g.drawCircle(0, 0, 5) === g, g.endFill() === g, g.isEmpty());
g.clear();
log(g.isEmpty());
log(createjs.Graphics.getRGB(255, 0, 0), createjs.Graphics.getRGB(0xff0000, 0.5), createjs.Graphics.getHSL(120, 100, 50));

// ---- library
var star = new lib.Star();
log("library", star.currentFrame, star.totalFrames, star.parent, star.name, star.paused);
this.addChild(star);
log(star.parent === this);
log(lib.properties.fps, lib.properties.width, lib.properties.height, lib.properties.color);

// ---- events
var order = [];
function say(name) {
	return function (e) {
		order.push(name + ":" + e.type + ":" + e.eventPhase + ":" + (e.target === self.one) + ":" + (e.currentTarget === self.one));
	};
}
this.one.addEventListener("hello", say("a"));
var second = this.one.on("hello", say("b"));
this.addEventListener("hello", say("up"));
this.addEventListener("hello", say("down"), true);
this.one.dispatchEvent("hello");
log("event", order.join(" "));
order.length = 0;
this.one.dispatchEvent(new createjs.Event("hello", true));
log(order.join(" "));
order.length = 0;
this.one.off("hello", second);
this.one.dispatchEvent("hello");
log(order.join(" "), this.one.hasEventListener("hello"), this.one.hasEventListener("nope"), this.willTrigger("hello"), this.one.willTrigger("hello"));
this.one.removeAllEventListeners("hello");
log(this.one.hasEventListener("hello"));
var once = 0;
this.one.on("hello", function () { once++; }, null, true);
this.one.dispatchEvent("hello");
this.one.dispatchEvent("hello");
log(once);
var data = null;
this.one.on("hello", function (e, d) { data = d; }, null, false, "extra");
this.one.dispatchEvent("hello");
log(data);
this.one.removeAllEventListeners();

// ---- easing and tweens
log("ease", r(createjs.Ease.linear(0.5)), r(createjs.Ease.quadIn(0.5)), r(createjs.Ease.quadOut(0.5)), r(createjs.Ease.quadInOut(0.25)), r(createjs.Ease.cubicIn(0.5)), r(createjs.Ease.bounceOut(0.5)), r(createjs.Ease.backOut(0.5)), r(createjs.Ease.sineIn(0.5)), r(createjs.Ease.elasticOut(0.5)), r(createjs.Ease.circIn(0.5)), r(createjs.Ease.getPowIn(3)(0.5)));
log(createjs.Ticker.framerate, typeof createjs.Ticker.getTicks(), createjs.Ticker.paused, createjs.Ticker.timingMode);

// ---- the steps below happen on later frames
var seen = 0;
var target = { x: 0, y: 5 };
createjs.Tween.get(target)
	.to({ x: 10 }, 100)
	.wait(50)
	.call(function () {
		log("tween", target.x, target.y);
		self.gotoAndStop("mid");
		log(self.currentFrame, self.currentLabel);
		self.addEventListener("tick", function tick(e) {
			if (seen++ === 2) {
				self.removeEventListener("tick", tick);
				log("tick", e.type, typeof e.delta, typeof e.time, e.paused, typeof e.runTime);
				log("READY");
			}
		});
	});
this.stop();
