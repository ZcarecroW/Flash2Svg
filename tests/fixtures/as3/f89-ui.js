// Frame 1 of f89-canvasui: components of an HTML5 Canvas document, as Animate's snippets use them.
// scripts/e2e-canvas.ts does the same to the document published by Animate.
function log() {
	console.log(Array.prototype.join.call(arguments, " "));
}
var box = $("#dom_overlay_container");
box.on("click", "#btn", function (evt) {
	log("click", evt.target.id, $("#txt").val(), $("#cmb").val(), $("#num").val(), $("#lst").val(), $("#chk").prop("checked"));
});
box.on("change", "#chk", function (evt) {
	log("change", evt.target.id, evt.target.checked, evt.target.value);
});
box.on("change", "#cmb", function (evt) {
	log("change", evt.target.id, evt.target.value);
});
box.on("change", "#lst", function (evt) {
	log("change", evt.target.id, evt.target.value);
});
box.on("change", "#num", function (evt) {
	log("change", evt.target.id, evt.target.value);
});
box.on("change", "#rad1", function (evt) {
	log("change", evt.target.id, evt.target.checked, evt.target.value, evt.target.name);
});
box.on("change", "#rad2", function (evt) {
	log("change", evt.target.id, evt.target.checked, evt.target.value, evt.target.name);
});
box.on("change", "#txt", function (evt) {
	log("change", evt.target.id, evt.target.value);
});
var self = this;
log("object", typeof this.btn, this.btn.x, this.btn.y, this.btn.visible, this.btn.name);
this.btn.on("added", function () {
	log("added", $("#btn").length);
}, this, true);
setTimeout(function () {
	log("found", $("#btn").length, $("#nothing").length, $("#btn")[0].tagName.toLowerCase(), $("#btn").text(), $("#lab").text(), $("#txt").attr("type"), $("#chk").attr("type"), $("#lst li").length, $("#lst li").eq(1).text(), $("#lst")[0].tagName.toLowerCase());
	log("values", $("#txt").val(), $("#cmb").val(), $("#num").val(), $("#num").attr("min"), $("#num").attr("max"), $("#rad1").prop("name"));
	$("#txt").val("set");
	$("#lab").text("Changed");
	$("#btn").text("Press");
	$("#chk").prop("checked", true);
	$("#btn").addClass("extra");
	log($("#btn").hasClass("extra"), $("#txt").val(), $("#lab").text(), $("#chk").prop("checked"), $("#btn").attr("class"));
	$("#lab").css("color", "#ff0000");
	log($("#lab").css("color"));
	$("#btn").hide();
	log($("#btn").css("display"));
	$("#btn").show();
	log($("#btn").css("display"));
	$("#lab").html("<b>Bold</b>");
	log($("#lab").html(), $("#lab").text());
	log("READY");
}, 300);
