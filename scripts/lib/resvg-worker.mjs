// Renders SVGs with resvg in a child process: resvg panics on some inputs (and a Rust panic ends
// the whole process), so the comparison runs it here and restarts it when it dies.
import { Resvg } from "@resvg/resvg-js";

process.on("message", ({ id, svg, width }) => {
	try {
		const png = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "white" }).render().asPng();
		process.send({ id, png: Buffer.from(png).toString("base64") });
	} catch (e) {
		process.send({ id, error: e.message });
	}
});
