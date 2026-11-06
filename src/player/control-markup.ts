/**
 * What a UI component shows, as real HTML controls: one description for the export (XML) and for
 * the player, which makes the same controls for components that scripts create.
 */

/** Tag, attributes, children. */
export type Spec = [string, Record<string, string | undefined>, ...(Spec | string)[]];

/** A component's parameters, as the Properties panel has them. */
export type Params = Record<string, any>;

const FONT = "font:11px/1.2 Arial,Helvetica,sans-serif;color:#000";
const BOX = "box-sizing:border-box;display:block;width:100%;height:100%;margin:0";
const SKIN = `${BOX};${FONT}`;
const FIELD = `${SKIN};padding:2px 3px;border:1px solid #919999;border-radius:0;background:#fff;outline:0`;
const BUTTON = `${SKIN};padding:0 3px;border:1px solid #919999;border-radius:2px;background:linear-gradient(#fff,#d9dcde);overflow:hidden;white-space:nowrap`;
export const ROW = "height:14px;padding:3px 5px";
const LABEL = `${BOX};display:flex;align-items:center;gap:7px;white-space:nowrap;overflow:hidden`;

/** Where the label goes around a box or a button's icon. */
const PLACE: Record<string, string> = { left: ";flex-direction:row-reverse;justify-content:flex-end", top: ";flex-direction:column", bottom: ";flex-direction:column-reverse" };

/** The text of a list's item: `label`, or what a Canvas list's item has. */
export const itemLabel = (it: any): string => String(it?.label ?? it?.[""] ?? it ?? "");
export const itemData = (it: any): string => String(it?.data ?? it?.value ?? it?.label ?? it ?? "");

/** The box a control needs: a Slider's track is thinner than its thumb. */
export function controlBox(kind: string, w: number, h: number): { x: number; y: number; w: number; h: number } {
	if (kind === "Slider") return w >= h ? { x: 0, y: (h - 20) / 2, w, h: 20 } : { x: (w - 20) / 2, y: 0, w: 20, h };
	if (kind === "ProgressBar") return { x: 0, y: 0, w, h: Math.max(h, 4) };
	return { x: 0, y: 0, w, h };
}

const options = (items: any[], selected: number, style?: string): Spec[] => items.map((it, i) => ["option", { value: itemData(it), selected: i === selected ? "selected" : undefined, style }, itemLabel(it)]);

/** The element for a component; null if there is none to make. */
export function controlSpec(kind: string, p: Params, canvas: boolean): Spec | null {
	const disabled = p.enabled === false || p.disabled === true ? "disabled" : undefined;
	const skin = canvas ? BOX : SKIN;
	const field = canvas ? BOX : FIELD;
	const cls = canvas && p.class ? String(p.class) : undefined;
	const items: any[] = p.dataProvider ?? p["items"] ?? [];
	const dim = disabled && !canvas ? ";color:#999" : "";
	switch (kind) {
		case "Button":
			return ["button", { type: "button", disabled, class: cls, "aria-pressed": p.toggle ? String(!!p.selected) : undefined, style: canvas ? BOX : `${BUTTON}${dim}${p.emphasized ? ";border-width:2px" : ""}` }, String(p.label ?? "")];
		case "CheckBox":
		case "RadioButton": {
			const type = kind === "CheckBox" ? "checkbox" : "radio";
			const box: Spec = ["input", { id: canvas ? p.$id : undefined, type, disabled, name: type === "radio" ? String(p.groupName ?? p.name ?? "radio") : undefined, value: p.value === undefined || p.value === "" ? undefined : String(p.value), checked: p.selected ? "checked" : undefined, style: "margin:0;flex:none" }];
			return ["label", { class: cls, style: `${canvas ? `${BOX};display:flex;align-items:center;gap:4px` : `${LABEL};${FONT};padding-left:5px`}${dim}${PLACE[p.labelPlacement] ?? ""}` }, box, String(p.label ?? "")];
		}
		case "ComboBox": {
			// (HTML5 Canvas: the value says what is selected, or nothing is)
			const none = canvas && !p.label && !items.some((it) => itemData(it) === String(p.value));
			const prompt: Spec[] = p.prompt || none ? [["option", { value: "", hidden: "hidden", selected: "selected" }, String(p.prompt ?? "")]] : canvas && p.label ? [["option", { value: "" }, String(p.label)]] : [];
			if (p.editable) {
				const list = `${String(p.$id ?? "f2s")}-list`;
				return ["span", { style: BOX }, ["input", { type: "text", list, disabled, spellcheck: "false", autocomplete: "off", placeholder: p.prompt ? String(p.prompt) : undefined, style: field }], ["datalist", { id: list }, ...options(items, -1)]];
			}
			return ["select", { disabled, class: cls, style: `${canvas ? BOX : `${BUTTON};padding:0`}${dim}` }, ...prompt, ...options(items, canvas ? items.findIndex((it) => itemData(it) === String(p.value)) : prompt.length ? -1 : Number(p.selectedIndex ?? 0))];
		}
		case "List":
			// (HTML5 Canvas: a list to read)
			if (canvas) return [p.type === "Ordered" ? "ol" : "ul", { class: cls, style: "box-sizing:border-box;width:100%;height:100%;margin:0;overflow:hidden" }, ...items.map((it, i): Spec => ["li", {}, (i ? " " : "") + itemLabel(it)])];
			return ["select", { size: String(Math.max(2, items.length || 5)), multiple: p.allowMultipleSelection || p.type === "multiple" ? "multiple" : undefined, disabled, class: cls, style: `${field};padding:0;overflow:auto` }, ...options(items, -1, ROW)];
		case "TextInput":
			return ["input", { type: p.displayAsPassword ? "password" : "text", value: String(p.text ?? p.value ?? ""), maxlength: p.maxChars ? String(p.maxChars) : undefined, readonly: p.editable === false ? "readonly" : undefined, disabled, class: cls, spellcheck: "false", autocomplete: "off", style: `${field}${dim}` }];
		case "TextArea":
			return ["textarea", { maxlength: p.maxChars ? String(p.maxChars) : undefined, readonly: p.editable === false ? "readonly" : undefined, wrap: p.wordWrap === false ? "off" : undefined, disabled, class: cls, spellcheck: "false", autocomplete: "off", style: `${field};resize:none;overflow:auto${dim}` }, String(p.text ?? p.value ?? "")];
		case "Label":
			return ["span", { class: cls, style: `${skin}${dim};white-space:${p.wordWrap ? "normal" : "nowrap"};overflow:hidden;user-select:${p.selectable ? "text" : "none"}` }, String(p.text ?? p.label ?? "")];
		case "NumericStepper":
			return ["input", { type: "number", value: String(p.value ?? 0), min: String(p.minimum ?? p.min ?? 0), max: String(p.maximum ?? p.max ?? 10), step: p.stepSize !== undefined ? String(p.stepSize) : undefined, disabled, class: cls, style: `${field}${dim}` }];
		case "Slider": {
			const up = p.direction === "vertical";
			return ["input", { type: "range", value: String(p.value ?? 0), min: String(p.minimum ?? 0), max: String(p.maximum ?? 10), step: Number(p.snapInterval) > 0 ? String(p.snapInterval) : "any", disabled, style: `${BOX};accent-color:#7f8b90${up ? ";writing-mode:vertical-lr;direction:rtl" : ""}` }];
		}
		case "ColorPicker":
			return ["input", { type: "color", value: String(p.selectedColor ?? "#000000"), disabled, style: `${BOX};padding:0;border:1px solid #919999;background:none` }];
		case "ProgressBar":
			return ["progress", { value: p.mode === "manual" ? "0" : undefined, max: "1", dir: p.direction === "left" ? "rtl" : undefined, style: BOX }];
		case "UILoader":
		case "Image":
			return ["img", { src: String(p.file ?? p.source ?? p.src ?? ""), alt: String(p.alt ?? ""), class: cls, style: `${BOX};object-fit:${p.scaleContent === false ? "none" : p.maintainAspectRatio === false ? "fill" : "contain"};object-position:0 0` }];
		case "DataGrid": {
			const rows: any[] = items;
			const cols: string[] = rows.length ? Object.keys(rows[0]) : [];
			const cell = "padding:2px 4px;border:1px solid #d9dcde;text-align:left";
			return [
				"div",
				{ style: `${field};padding:0;overflow:auto` },
				[
					"table",
					{ style: "border-collapse:collapse;width:100%;font:inherit" },
					["thead", {}, ["tr", {}, ...cols.map((c): Spec => ["th", { style: `${cell};background:#eee` }, c])]],
					["tbody", {}, ...rows.map((r): Spec => ["tr", {}, ...cols.map((c): Spec => ["td", { style: cell }, String(r[c] ?? "")])])],
				],
			];
		}
	}
	return null;
}
