#!/usr/bin/env node
/**
 * Closes the Flash2SVG panel and quits Animate through CEP remote debugging (port 8099), for when
 * screenshots.mjs stopped half-way: the panel must close before Animate quits and before the
 * extension is removed (see the README's note on removing the extension).
 */
const PORT = 8099;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => /panel\/index\.html/.test(t.url));
if (!target) throw new Error("no panel to close");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `window.__adobe_cep__.evalScript("fl.closeAll(false); fl.quit(false)", () => {}); window.__adobe_cep__.closeExtension(); true` } }));
await new Promise((r) => setTimeout(r, 1000));
ws.close();
console.log("asked the panel to close and Animate to quit");
