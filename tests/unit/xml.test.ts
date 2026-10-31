import { describe, expect, it } from "vitest";
import { cdata, el, escapeAttr, escapeText, serialize } from "../../src/core/xml.ts";

describe("XML writer", () => {
	it("escapes markup in text and attributes", () => {
		expect(escapeText('a<b&c>"d')).toBe('a&lt;b&amp;c&gt;"d');
		expect(escapeAttr('a<b&c"d\ne')).toBe("a&lt;b&amp;c&quot;d&#10;e");
		expect(escapeText("M0 0L10 10Z")).toBe("M0 0L10 10Z");
	});

	it("leaves out characters XML can't hold, keeps the rest of the text", () => {
		// control characters, unpaired surrogates, U+FFFE / U+FFFF: from labels, names, text fields
		const odd = "a" + String.fromCharCode(3) + "b" + String.fromCharCode(0xd800) + "c" + String.fromCharCode(0xffff) + "d" + String.fromCharCode(0xdc00);
		expect(escapeText(odd)).toBe("abcd");
		expect(escapeAttr(odd)).toBe("abcd");
		// tabs, line breaks and characters outside the BMP stay
		expect(escapeText("tab\tline\r\nemoji 😀")).toBe("tab\tline\r\nemoji 😀");
		expect(serialize(el("text", { "aria-label": odd }, [odd]))).toBe('<text aria-label="abcd">abcd</text>');
	});

	it("keeps CDATA sections closed", () => {
		expect(serialize(cdata("x]]>y" + String.fromCharCode(0)))).toBe("<![CDATA[x]]]]><![CDATA[>y]]>");
	});
});
