// The mouse in f79-canvas: scripts/e2e-canvas.ts moves and clicks the same way on both.
stage.enableMouseOver(20);
function where(e) {
	return e.type + " " + Math.round(e.stageX) + " " + Math.round(e.stageY) + " " + (e.target === e.currentTarget);
}
this.two.addEventListener("click", function (e) { log(where(e), Math.round(e.localX), Math.round(e.localY), e.primary, e.pointerID, e.nativeEvent != null, e.relatedTarget); });
this.two.addEventListener("mouseover", function (e) { log(where(e)); });
this.two.addEventListener("mouseout", function (e) { log(where(e)); });
this.two.addEventListener("rollover", function (e) { log(where(e)); });
this.two.addEventListener("rollout", function (e) { log(where(e)); });
this.two.addEventListener("mousedown", function (e) { log(where(e)); });
this.two.addEventListener("pressup", function (e) { log(where(e)); });
this.ball.addEventListener("mousedown", function (e) { log(where(e)); });
this.ball.addEventListener("pressmove", function (e) { log("move", where(e)); });
this.ball.addEventListener("pressup", function (e) { log(where(e)); });
stage.addEventListener("stagemousedown", function (e) { log("stage", e.type, Math.round(e.stageX), Math.round(e.stageY), Math.round(stage.mouseX), Math.round(stage.mouseY)); });
stage.addEventListener("stagemouseup", function (e) { log("stage", e.type); });
