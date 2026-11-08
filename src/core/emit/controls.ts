import { fmt, fmtMatrix } from "../geom.ts";
import type { ControlElement } from "../model.ts";
import { el, type XmlNode } from "../xml.ts";
import { controlBox, controlSpec, type Spec } from "../../player/control-markup.ts";

const XHTML = "http://www.w3.org/1999/xhtml";

function node(s: Spec, root: boolean, inner?: XmlNode): XmlNode {
	const [tag, attrs, ...kids] = s;
	// (a ScrollPane's content, rendered by the export)
	if (inner && "data-f2s-content" in attrs) return inner;
	// (an end tag, not "/>": inlined in an HTML page the parser would leave most of these open)
	const children = kids.map((k) => (typeof k === "string" ? k : node(k, false, inner)));
	const VOID = tag === "input" || tag === "img";
	return el(tag, root ? { xmlns: XHTML, ...attrs } : attrs, VOID ? [] : children.length ? children : [""]);
}

/** A UI component: a real HTML control on its box. `inner`: what a ScrollPane shows. */
export function controlNode(c: ControlElement, digits: number, canvas: boolean, inner?: XmlNode): XmlNode {
	if (c.control === "CSS") return el("style", {}, [c.params.css ?? ""]);
	const b = controlBox(c.control, c.width, c.height);
	const params = c.name ? { ...c.params, $id: c.name } : c.params;
	const spec = controlSpec(c.control, params, canvas, c.width, c.height);
	// (scripts find an HTML5 Canvas document's components by their instance names; radio buttons and check boxes have it on the box)
	// (a DatePicker's field has the name, its box _datepicker_ and the name, as Animate publishes it)
	if (spec && canvas && c.name && c.control !== "CheckBox" && c.control !== "RadioButton") spec[1].id = c.control === "DatePicker" ? `_datepicker_${c.name}` : c.name;
	return el("g", { transform: fmtMatrix(c.matrix, digits) || undefined, "data-name": c.name || undefined, display: c.params.visible === false ? "none" : undefined }, [
		// (tabindex: Chromium stops at a foreignObject on the way through with the Tab key)
		el("foreignObject", { x: b.x ? fmt(b.x, 2) : undefined, y: b.y ? fmt(b.y, 2) : undefined, width: fmt(b.w, 2), height: fmt(b.h, 2), tabindex: "-1", style: c.control === "DatePicker" ? "overflow:visible" : undefined }, spec ? [node(spec, true, inner)] : []),
	]);
}
