import { describe, expect, it } from "vitest";
import { parseActions } from "../../src/core/program.ts";
import { blankComments, splitScript, targetPath } from "../../src/core/snippets.ts";

// as Animate's Code Snippets panel inserts them (comment block included)
const AS3 = `/* Click to Go to Frame and Play
Clicking on the specified symbol instance moves the playhead to the specified frame.
*/
stop();

button_1.addEventListener(MouseEvent.CLICK, fl_ClickToGoToAndPlayFromFrame);

function fl_ClickToGoToAndPlayFromFrame(event:MouseEvent):void
{
	gotoAndPlay(5);
}

/* Click to Go to Web Page */
button_2.addEventListener(MouseEvent.CLICK, fl_ClickToGoToWebPage);

function fl_ClickToGoToWebPage(event:MouseEvent):void
{
	navigateToURL(new URLRequest("http://www.adobe.com"), "_blank");
}

movieClip_1.addEventListener(MouseEvent.MOUSE_OVER, fl_MouseOverHandler);

function fl_MouseOverHandler(event:MouseEvent):void
{
	// Start your custom code
	trace("Moused over");
	movieClip_1.play();
	// End your custom code
}
button_3.addEventListener(MouseEvent.CLICK, fl_ClickToHide);
function fl_ClickToHide(event:MouseEvent):void
{
	event.currentTarget.visible = false;
	movieClip_2.visible = false;
	MovieClip(this.root).gotoAndStop("end");
}`;

const CANVAS = `/* Click to Go to Frame and Play */
this.stop();
this.button_1.addEventListener("click", fl_ClickToGoToAndPlayFromFrame.bind(this));

function fl_ClickToGoToAndPlayFromFrame()
{
	this.gotoAndPlay(5);
}
var frequency = 3;
stage.enableMouseOver(frequency);
this.movieClip_1.addEventListener("mouseout", fl_MouseOutHandler);
function fl_MouseOutHandler()
{
	this.movieClip_1.stop();
}
this.button_2.on("click", function () { window.open("https://example.com/a//b", "_self"); });
this.button_3.addEventListener("dblclick", () => exportRoot.gotoAndPlay("intro"));`;

describe("code snippets", () => {
	it("takes AS3 mouse handlers out of the frame script", () => {
		const warn: string[] = [];
		const parts = splitScript(AS3, { frame: 0, warn: (m) => warn.push(m) });
		// only the stop() runs on the frame: the gotoAndPlay(5) belongs to the click
		expect(parseActions(parts.frameCode)).toEqual([{ type: "stop" }]);
		expect(parts.interactions).toEqual([
			{ on: "button_1", event: "click", frame: 0, actions: [{ type: "goto", target: "", frame: 5, play: true }] },
			{ on: "button_2", event: "click", frame: 0, actions: [{ type: "url", url: "http://www.adobe.com", window: "_blank" }] },
			{ on: "movieClip_1", event: "over", frame: 0, actions: [{ type: "play", target: "movieClip_1" }] },
			{
				on: "button_3",
				event: "click",
				frame: 0,
				actions: [
					{ type: "visible", target: "@", value: false },
					{ type: "visible", target: "movieClip_2", value: false },
					{ type: "goto", target: "/", frame: "end", play: false },
				],
			},
		]);
		expect(warn).toEqual([]);
	});

	it("reads HTML5 Canvas snippets (frames from 0, bind, on(), function literals, arrows)", () => {
		const warn: string[] = [];
		const parts = splitScript(CANVAS, { frame: 3, zeroBased: true, warn: (m) => warn.push(m) });
		expect(parseActions(parts.frameCode, { zeroBased: true })).toEqual([{ type: "stop" }]);
		expect(parts.interactions).toEqual([
			{ on: "button_1", event: "click", frame: 3, actions: [{ type: "goto", target: "", frame: 6, play: true }] },
			{ on: "movieClip_1", event: "out", frame: 3, actions: [{ type: "stop", target: "movieClip_1" }] },
			{ on: "button_2", event: "click", frame: 3, actions: [{ type: "url", url: "https://example.com/a//b", window: "_self" }] },
			{ on: "button_3", event: "dblclick", frame: 3, actions: [{ type: "goto", target: "/", frame: "intro", play: true }] },
		]);
		expect(warn).toEqual([]);
	});

	it("warns about what isn't exported", () => {
		const warn: string[] = [];
		splitScript(
			`btn.addEventListener(MouseEvent.CLICK, f);
			function f(e:MouseEvent):void { score += 1; gotoAndPlay(frameFor(score)); MovieClip(root).gotoAndPlay(1, "Scene 2"); nextScene(); }
			addEventListener(Event.ENTER_FRAME, tick);
			function tick(e:Event):void { mc.x += 1; }
			stage.addEventListener(MouseEvent.CLICK, f);`,
			{ frame: 0, scene: "Scene 1", warn: (m) => warn.push(m) },
		);
		expect(warn.some((w) => /computed frame/.test(w))).toBe(true);
		expect(warn.some((w) => /scene "Scene 2"/.test(w))).toBe(true);
		expect(warn.some((w) => /nextScene/.test(w))).toBe(true);
		expect(warn.some((w) => /other code isn't run \(score\+=1/.test(w))).toBe(true);
		expect(warn.some((w) => /ENTER_FRAME listener isn't run/.test(w))).toBe(true);
		expect(warn.some((w) => /on stage is left out/.test(w))).toBe(true);
	});

	it("keeps strings when removing comments", () => {
		expect(blankComments(`a("x//y"); // c\n/* d\n */b('/*')`)).toBe(`a("x//y");     \n    \n   b('/*')`);
	});

	it("resolves targets", () => {
		expect(targetPath("")).toBe("");
		expect(targetPath("this")).toBe("");
		expect(targetPath("MovieClip(this.root)")).toBe("/");
		expect(targetPath("exportRoot.mc")).toBe("/mc");
		expect(targetPath("MovieClip(this.parent).other")).toBe("../other");
		expect(targetPath("this.mc.inner")).toBe("mc/inner");
		expect(targetPath("evt.currentTarget")).toBe("@");
		expect(targetPath("getChildByName('x')")).toBeNull();
	});
});

describe("labels as dotLottie states", () => {
	it("states from frame 1, jumps and button targets; clicks on the buttons' layers fire them", async () => {
		const { readFileSync } = await import("node:fs");
		const { unzipSync, strFromU8 } = await import("fflate");
		const { compileScene } = await import("../../src/core/compile.ts");
		const model = JSON.parse(readFileSync(new URL("../fixtures/models/f47-snippets.json", import.meta.url), "utf8"));
		const files = { readText: () => `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`, readBinary: () => new Uint8Array() };
		const out = compileScene(model, files, { format: "dotlottie" });
		const zip = unzipSync(out.files[0]!.bytes!);
		const sm = JSON.parse(strFromU8(zip["s/playback.json"]!));
		expect(sm.initial).toBe("f1");
		expect(sm.states.map((s: { name: string; autoplay: boolean }) => [s.name, s.autoplay])).toEqual([
			["f1", false],
			["f2", true],
			["still19", false],
		]);
		expect(sm.interactions).toContainEqual({ type: "Click", layerName: "btn_next", actions: [{ type: "Fire", inputName: "go_f2" }] });
		expect(sm.interactions).toContainEqual({ type: "Click", layerName: "btn_web", actions: [{ type: "OpenUrl", url: "https://example.com/", target: "_blank" }] });
		// the whole root timeline (24 frames, held once more), a marker per state
		const anim = JSON.parse(strFromU8(zip[Object.keys(zip).find((k) => k.startsWith("a/"))!]!));
		expect(anim.op).toBe(25);
		expect(anim.markers).toContainEqual({ cm: "state f2", tm: 1, dr: 22 });
		expect(out.warnings.some((w) => /over handler on mc_spin/.test(w))).toBe(true);
	});
});
