import { describe, expect, it } from "vitest";
import { sizeParts } from "../../src/core/compile.ts";
import { controlNode } from "../../src/core/emit/controls.ts";
import { inputNode } from "../../src/core/emit/text.ts";
import type { ControlElement, TextElement } from "../../src/core/model.ts";
import { serialize } from "../../src/core/xml.ts";
import { controlBox, controlSpec } from "../../src/player/control-markup.ts";

const control = (kind: string, params: Record<string, unknown>, name = "x"): ControlElement => ({ kind: "control", control: kind, name, params, matrix: [1, 0, 0, 1, 20, 30], width: 100, height: 22, bounds: { left: 20, top: 30, width: 100, height: 22 } });
const field = (over: Partial<TextElement>): TextElement => ({ kind: "text", textType: "input", atlas: "", matrix: [1, 0, 0, 1, 12, 12], name: "f", width: 200, height: 24, text: "Hi", runs: [{ text: "Hi", face: "Arial", size: 14, fillColor: "#112233", bold: true, italic: false, alignment: "center", letterSpacing: 0, lineSpacing: 2 }], multiline: false, selectable: true, bounds: { left: 10, top: 10, width: 200, height: 24 }, ...over });

describe("UI components as HTML", () => {
	it("makes a control for each of them", () => {
		const tags: Record<string, string> = { Button: "button", CheckBox: "label", RadioButton: "label", ComboBox: "select", List: "select", TextInput: "input", TextArea: "textarea", Label: "span", NumericStepper: "input", Slider: "input", ColorPicker: "input", ProgressBar: "progress", UILoader: "img", DataGrid: "div" };
		for (const k in tags) expect(controlSpec(k, {}, false)![0]).toBe(tags[k]);
		expect(controlSpec("Whatever", {}, false)).toBeNull();
	});
	it("takes the parameters", () => {
		const s = serialize(controlNode(control("Button", { label: "Go <now>", enabled: false, toggle: true, selected: true }), 2, false));
		expect(s).toContain('transform="translate(20 30)"');
		expect(s).toContain("disabled");
		expect(s).toContain('aria-pressed="true"');
		expect(s).toContain("Go &lt;now&gt;");
		const c = serialize(controlNode(control("ComboBox", { dataProvider: [{ label: "A", data: "1" }, { label: "B", data: "2" }], prompt: "Pick" }), 2, false));
		expect(c).toContain('<option value="1"');
		expect(c).toContain('hidden="hidden"');
		const e = serialize(controlNode(control("ComboBox", { dataProvider: [{ label: "A" }], editable: true }), 2, false));
		expect(e).toContain("<datalist");
		expect(e).toContain('list="x-list"');
	});
	it("hides what isn't visible and has ids in Canvas documents", () => {
		expect(serialize(controlNode(control("Button", { visible: false }), 2, false))).toContain('display="none"');
		expect(serialize(controlNode(control("Button", {}), 2, true))).toContain('id="x"');
		expect(serialize(controlNode(control("Button", {}), 2, false))).not.toContain('id="x"');
		const box = serialize(controlNode(control("CheckBox", {}), 2, true));
		expect(box).toMatch(/<input id="x"/);
	});
	it("gives a Canvas list items to read, and a thin slider room", () => {
		expect(controlSpec("List", { type: "Ordered", items: [{ "": "One" }, { "": "Two" }] }, true)![0]).toBe("ol");
		expect(controlBox("Slider", 80, 4)).toEqual({ x: 0, y: -8, w: 80, h: 20 });
	});
	it("closes what an HTML page would leave open", () => {
		expect(serialize(controlNode(control("TextArea", {}), 2, false))).toContain("</textarea>");
		expect(serialize(controlNode(control("Label", {}), 2, false))).toContain("</span>");
	});
});

describe("Input text as HTML", () => {
	it("is an input on the field's box", () => {
		const s = serialize(inputNode(field({}), 2));
		expect(s).toContain('<input xmlns="http://www.w3.org/1999/xhtml"');
		expect(s).toContain('value="Hi"');
		expect(s).toContain('x="-2"');
		expect(s).toContain("color:#112233");
		expect(s).toContain("text-align:center");
		expect(s).toContain("bold 14px");
	});
	it("has several lines in a textarea, a password in an input", () => {
		expect(serialize(inputNode(field({ multiline: true, text: "a\rb" }), 2))).toMatch(/<textarea[^>]*>a\nb<\/textarea>/);
		expect(serialize(inputNode(field({ noWrap: true }), 2))).toContain('wrap="off"');
		expect(serialize(inputNode(field({ multiline: true, password: true }), 2))).toContain('type="password"');
		expect(serialize(inputNode(field({ maxChars: 5 }), 2))).toContain('maxlength="5"');
	});
	it("takes a stretched field's box inside its matrix", () => {
		const s = serialize(inputNode(field({ matrix: [2, 0, 0, 2, 0, 0], width: 200, height: 40 }), 2));
		expect(s).toContain('width="100"');
		expect(s).toContain('height="20"');
	});
});

describe("The size overview", () => {
	it("counts a sound once, also in a script of its own", () => {
		const sound = "data:audio/mpeg;base64,AAAA";
		const svg = `<svg><script>var a="${sound}";</script></svg>`;
		const p = sizeParts(svg);
		expect(p.sounds).toBe(sound.length);
		expect(p.drawing + p.animation + p.images + p.sounds + p.runtime + p.fonts).toBe(svg.length);
	});
});
