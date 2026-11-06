/**
 * Part of the Flash API for fields the user types in: input text and the text components. What
 * happens in which order was measured with real keys posted to Flash Player (scripts/e2e-typing.ts).
 */

/** Whether a character may be typed under TextField.restrict: scanned left to right, ^ flips. */
function allowedBy(rule: string, c: string): boolean {
	let ok = rule[0] === "^",
		add = true;
	for (let i = 0; i < rule.length; i++) {
		let a = rule[i]!;
		if (a === "^") {
			add = !add;
			continue;
		}
		if (a === "\\") a = rule[++i] ?? a;
		let b = a;
		if (rule[i + 1] === "-" && i + 2 < rule.length) {
			i += 2;
			b = rule[i]!;
			if (b === "\\") b = rule[++i] ?? b;
		}
		if (c >= a && c <= b) ok = add;
	}
	return ok;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function input(L: any): Record<string, unknown> {
	const { TextField, FEvent, FTextEvent, htmlEl, svgEl, colorOf, scripts: s } = L;

	/** Typing in a control under a box: what a field or a text component does with it. */
	function typing(box: Element, o: any) {
		box.addEventListener("beforeinput", (e) =>
			s.safely(() => {
				const b = e as InputEvent;
				const c = o._in;
				// (Enter is text where it starts a line)
				const typed = b.data ?? b.dataTransfer?.getData("text/plain") ?? (/^insert(LineBreak|Paragraph)$/.test(b.inputType) && o._multi ? "\n" : null);
				if (typed === null || typed === undefined || b.isComposing) return;
				// what was typed, whatever comes of it
				const ev = new FTextEvent(FTextEvent.TEXT_INPUT, true, !o._kind, typed);
				o.dispatchEvent(ev);
				if (ev.isDefaultPrevented()) return b.preventDefault();
				const rule = o.restrict;
				let text = typed;
				if (rule !== null) {
					text = "";
					for (const ch of typed) {
						// (a letter that isn't allowed goes in as its other case, if that is)
						const other = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
						text += allowedBy(rule, ch) ? ch : allowedBy(rule, other) ? other : "";
					}
				}
				const room = o._most ? o._most - c.value.length + (c.selectionEnd - c.selectionStart) : Infinity;
				if (text.length > room) text = text.slice(0, Math.max(0, room));
				if (text === typed) return;
				b.preventDefault();
				if (!text) return;
				c.setRangeText(text, c.selectionStart, c.selectionEnd, "end");
				o._typed();
			}),
		);
		box.addEventListener("input", () => s.safely(() => o._typed()));
	}

	/** What the user does in the control (asked of the box around it: the control itself can change). */
	function hear(o: any, box: Element) {
		typing(box, o);
		box.addEventListener("focusin", () => s.safely(() => void (s.stage._focus !== o && s.focused(o))));
		box.addEventListener("focusout", (e) => s.safely(() => void (s.stage._focus === o && s.blurred(o, (e as FocusEvent).relatedTarget as Node | null))));
		box.addEventListener("scroll", () => s.safely(() => o.dispatchEvent(new FEvent(FEvent.SCROLL, true))), true);
	}

	Object.assign(TextField.prototype, {
		/** The field's look and state from the control it came with. */
		_look(this: any, box: HTMLInputElement, f: any) {
			const c = box.style;
			const family = c.fontFamily;
			f.font = family.split(",")[/^["']?f2s-/.test(family) ? 1 : 0]!.trim().replace(/['"]/g, "");
			this._face = [f.font, family];
			f.size = parseFloat(c.fontSize);
			const [r, g, b] = (c.color.match(/\d+/g) ?? []).map(Number);
			f.color = ((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0);
			f.bold = c.fontWeight === "bold";
			f.italic = c.fontStyle === "italic";
			// (kept here: a control that is full says nothing of what was typed, in WebKit)
			this._most = box.maxLength > 0 ? box.maxLength : 0;
			box.removeAttribute("maxlength");
			this._pass = box.type === "password";
			this._text = box.value.replace(/\n/g, "\r");
		},
		_take(this: any, box: HTMLInputElement) {
			this._in = box;
			box.value = this._text.replace(/\r/g, "\n");
			box.setSelectionRange(this._text.length, this._text.length);
			hear(this, box.parentNode as Element);
		},
		/** The right control for what the field is now. */
		_box(this: any) {
			if (this._type !== "input") return;
			const had = this._in;
			const area = this._multi && !this._pass;
			const same = had && (had.localName === "textarea") === area;
			const b = (same ? had : htmlEl(area ? "textarea" : "input")) as HTMLInputElement & HTMLTextAreaElement;
			if (!same) {
				b.style.cssText = "box-sizing:border-box;display:block;width:100%;height:100%;margin:0;padding:2px;border:0;outline:0;border-radius:0;background:none;resize:none;overflow:hidden";
				b.setAttribute("spellcheck", "false");
				b.setAttribute("autocomplete", "off");
				if (had) had.replaceWith(b);
				else {
					const fo = svgEl("foreignObject", { width: String(this._w), height: String(this._h), tabindex: "-1" });
					this._node.appendChild(fo);
					fo.appendChild(b);
					hear(this, fo);
					this._field()?.remove();
				}
				this._in = b;
			}
			if (area) b.wrap = this._wrap ? "soft" : "off";
			else b.type = this._pass ? "password" : "text";
		},
		_typed(this: any) {
			this._text = this._in.value.replace(/\r\n|\n/g, "\r");
			this._html = null;
			const f = this._def;
			this._chars = Array.from({ length: this._text.length }, () => f);
			this._lay();
			this.dispatchEvent(new FEvent(FEvent.CHANGE, true));
		},
		/** The text and its look in the control (one look: an HTML control has no runs). */
		_showIn(this: any, b: HTMLInputElement) {
			const v = this._text.replace(/\r/g, "\n");
			if (b.value !== v) {
				// (writing the value puts the caret at its end)
				const from = b.selectionStart ?? 0,
					to = b.selectionEnd ?? 0;
				b.value = v;
				b.setSelectionRange(from, to);
			}
			const f = this._chars[0] ?? this._def;
			const c = b.style;
			c.fontFamily = this._face?.[0] === f.font ? this._face[1] : `'${f.font}', sans-serif`;
			c.fontSize = `${f.size}px`;
			c.fontWeight = f.bold ? "bold" : "normal";
			c.fontStyle = f.italic ? "italic" : "normal";
			c.textDecoration = f.underline ? "underline" : "none";
			c.color = colorOf(f.color ?? 0);
			c.textAlign = f.align === "center" || f.align === "right" ? f.align : "left";
			c.letterSpacing = f.letterSpacing ? `${f.letterSpacing}px` : "normal";
		},
	});
	return { typing: (box: Element, o: unknown) => typing(box, o) };
}
