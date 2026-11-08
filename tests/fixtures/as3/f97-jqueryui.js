// Frame 1 of f97-jqueryui: the jQuery UI components of an HTML5 Canvas document (RadioSet,
// DatePicker), as scripts use them. scripts/e2e-canvas.ts does the same to the published document.
function log() {
	console.log(Array.prototype.join.call(arguments, " "));
}
var box = $("#dom_overlay_container");
box.on("change", "#rs input", function (evt) {
	log("radio", evt.target.checked, $(evt.target).next("label").text().trim(), $("#rs input:checked").length, evt.target.name === $("#rs input").eq(0).attr("name"));
});
box.on("change", "#dp", function (evt) {
	var d = $("#dp").datepicker("getDate");
	log("date", $("#dp").val(), d ? d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() : null);
});
setTimeout(function () {
	log("found", $("#rs").length, $("#rs").prop("tagName").toLowerCase(), $("#rs legend").text(), $("#rs input").length, $("#rs label").length, $("#rs label").eq(1).text().trim(), $("#rs input").eq(0).attr("type"));
	log("picker", $("#dp").length, $("#dp").attr("type"), $("#dp").parent().attr("id"), $("#dp").parent().text().trim(), $("#dp").val() === "", $("#dp").hasClass("jqueryui-datepicker"));
	$("#dp").datepicker("setDate", new Date(2026, 10, 8));
	log("set", $("#dp").val(), $("#dp").datepicker("getDate").getMonth(), $("#dp").datepicker("option", "dateFormat"));
	$("#dp").datepicker("option", "dateFormat", "yy-mm-dd");
	$("#dp").datepicker("setDate", new Date(2025, 0, 2));
	log("format", $("#dp").val(), $("#dp").datepicker("getDate").getDate());
	$("#dp").datepicker("option", "dateFormat", "mm/dd/yy");
	$("#dp").val("");
}, 300);
