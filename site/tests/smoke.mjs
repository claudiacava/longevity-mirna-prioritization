// Smoke test: renders every page of the site with the real data in Node,
// using a minimal DOM stand-in, and reports any runtime error.
// Run from the repository root:  node site/tests/smoke.mjs
import { readFileSync } from "node:fs";
const site = new URL("../", import.meta.url);

class El {
  constructor() { this.innerHTML = ""; this.value = ""; this.textContent = ""; this.dataset = {}; this.checked = false; this.classList = { toggle() {} }; }
  querySelector(s) { return get(s); }
  querySelectorAll() { return []; }
  addEventListener(ev, f) { this["on" + ev] = f; }
  getAttribute() { return ""; }
}
const app = new El(); let pool = new Map();
function get(s) {
  const id = s.replace(/^#/, "");
  if (pool.has(id)) return pool.get(id);
  if (![app, ...pool.values()].some((e) => e.innerHTML.includes(`id="${id}"`))) return null;
  const e = new El(); pool.set(id, e); return e;
}
globalThis.document = { getElementById: (id) => (id === "app" ? app : get(id)), querySelectorAll: () => [] };
globalThis.window = { addEventListener() {}, scrollTo() {} };
globalThis.history = { replaceState() {} };
globalThis.location = { hash: "" };

globalThis.fetch = async (u) => {
  try { return new Response(readFileSync(new URL(u, site))); } catch { return new Response("", { status: 404 }); }
};

await import("../js/app.js");
for (let i = 0; i < 50 && !window.__route; i++) await new Promise((r) => setTimeout(r, 100));
if (!window.__route) { console.log("FAIL: data did not load\n", app.innerHTML); process.exit(1); }

const pages = ["#overview", "#explore", "#explore?c=composite_records_included&s=1&p=1&q=0.5", "#explore?c=country_level_labels&s=5&p=4&q=0.9",
  "#explore?c=primary&s=3&p=2&q=0.7", "#genes", "#gene/APOE", "#gene/FOXO3", "#gene/LMNA", "#gene/HSPA1B", "#review", "#data"];
let fail = 0;
for (const h of pages) {
  pool = new Map(); app.innerHTML = ""; location.hash = h;
  try {
    window.__route();
    // controls exist after first render: set them and redraw like the browser
    if (h.startsWith("#explore")) window.__route();
    await new Promise((r) => setTimeout(r, h.startsWith("#gene/") ? 4000 : 50));
    const html = app.innerHTML + [...pool.values()].map((e) => e.innerHTML).join("");
    if (/undefined|NaN|\[object Object\]/.test(html.replace(/=\"undefined\"/g, ""))) { console.log("WARN", h, (html.match(/.{60}(undefined|NaN|\[object Object\]).{40}/) || [])[0]); }
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    console.log("OK  ", h.padEnd(58), text.length, "chars ·", text.slice(0, 110));
    if (process.env.SHOW === h) console.log(text);
  } catch (e) { fail++; console.log("FAIL", h, e.stack.split("\n").slice(0, 3).join(" | ")); }
}
process.exit(fail ? 1 : 0);
