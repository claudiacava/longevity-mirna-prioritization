// "Analyse your data": source review, selection and robustness for any table of
// gene association records. Everything runs in the browser; files are not uploaded.
import { DEFAULTS, GRID, selectGenes, isSelected, stability, range } from "./core.js";
import {
  FIELDS, readTable, tableFromArrays, guessMapping, readCorrections, review, geneEvidence, criteriaLong, interpretAssociation,
  squish, toCSV, CORRECTION_ACTIONS, CORRECTION_COLUMNS, VARIANTS, BASE_DEF,
} from "./review.js";

const VARIANT_LABEL = {
  primary: "All population labels, multi-gene records excluded",
  significant_populations_only: "Populations from significant units only",
  country_level_labels: "Country-level population labels",
  significant_and_country_level: "Significant units, country level",
  composite_records_included: "Multi-gene records credited to every gene",
};
const PROPS = [0.5, 0.6, 0.7, 0.8, 0.9];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toFixed(d));

const S = {
  fileName: "", sha: "", headers: [], rows: [], mapping: {}, alpha: 0.05,
  corrName: "", corrections: [], corrWarnings: [], dedup: true,
  def: { ...BASE_DEF, evidenceTypes: null }, t: { minSig: DEFAULTS.minSig, minPop: DEFAULTS.minPop, minProp: DEFAULTS.minProp },
  reference: "", auditFilter: "decisions", auditQuery: "", geneQuery: "", rev: null, ev: null, long: null,
};
let root;

export function renderAnalyse(app) {
  root = app;
  app.innerHTML = `
  <h1>Analyse your own evidence table</h1>
  <p class="lead">Apply the same source review, gene-study units, selection rule and robustness checks to any table of
  gene association records: another database, a GWAS Catalog export or your own curation.</p>
  <div class="okbox"><b>Your data stay on your computer.</b> Files are read by this page in your browser and are not sent anywhere.</div>

  <section class="panel step"><h2><span class="n">1</span>Load a table</h2>
    <p>Excel workbook (first sheet) or CSV / tab-separated text, with comma or semicolon separators. One row per reported association;
    several genes in one cell are allowed (separated by <code>,</code> <code>;</code> <code>|</code> or <code> / </code>).</p>
    <div class="btns">
      <label class="filebtn">Choose a file…<input type="file" id="f-data" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,text/csv,text/tab-separated-values" hidden></label>
      <button id="b-example">Use the LongevityMap example (article)</button>
      <a class="btnlink" href="examples/template_records.xlsx" download>Template (Excel)</a>
      <a class="btnlink" href="examples/template_records.csv" download>Template (CSV)</a>
      <label class="filebtn ghost">Load saved settings…<input type="file" id="f-settings" accept=".json,application/json" hidden></label>
    </div>
    <div id="load-info"></div>
  </section>
  <div id="after-load"></div>`;
  app.querySelector("#f-data").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const { table, sha } = await readFile(f); await loadTable(f.name, table, sha, true); }
    catch (err) { app.querySelector("#load-info").innerHTML = `<div class="note">Could not read ${esc(f.name)}: ${esc(err.message)}</div>`; }
  };
  app.querySelector("#b-example").onclick = loadExample;
  app.querySelector("#f-settings").onchange = async (e) => { const f = e.target.files[0]; if (f) applySettings(JSON.parse(await f.text())); };
  if (S.rows.length) { showLoadInfo(); renderAfterLoad(); }
}

// ---------- loading ----------
// Reads a CSV/TSV text file or a spreadsheet (SheetJS, loaded only when needed)
const isSheet = (name) => /\.(xlsx|xls|ods)$/i.test(name);
async function readFile(file) {
  const buf = await file.arrayBuffer();
  const sha = await sha256(buf);
  if (!isSheet(file.name)) return { table: readTable(new TextDecoder().decode(buf)), sha };
  const XLSX = await loadSheetJS();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return { table: tableFromArrays(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })), sha, sheet: wb.SheetNames[0] };
}
let sheetjs;
function loadSheetJS() {
  return (sheetjs ??= new Promise((ok, ko) => {
    const s = Object.assign(document.createElement("script"), { src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" });
    s.onload = () => ok(window.XLSX); s.onerror = () => { sheetjs = null; ko(new Error("the Excel reader could not be loaded; save the sheet as CSV instead")); };
    document.head.appendChild(s);
  }));
}

async function loadData(name, text, resetMapping) { return loadTable(name, readTable(text), await sha256(new TextEncoder().encode(text)), resetMapping); }
async function loadTable(name, table, sha, resetMapping) {
  const { headers, rows } = table;
  if (!rows.length) { root.querySelector("#load-info").innerHTML = `<div class="note">No rows found in ${esc(name)}.</div>`; return; }
  Object.assign(S, { fileName: name, headers, rows, sha, delimiter: table.delimiter });
  if (resetMapping) {
    S.mapping = guessMapping(headers);
    S.corrections = []; S.corrWarnings = []; S.corrName = "";
    S.def = { ...BASE_DEF, evidenceTypes: null }; S.reference = "";
  }
  showLoadInfo(); renderAfterLoad();
}

async function loadExample() {
  const [data, corr, ref] = await Promise.all(["../data/raw/longevity.csv", "examples/longevitymap_corrections.csv", "../results/10_longevitymap/primary_genes.txt"]
    .map((u) => fetch(u).then((r) => (r.ok ? r.text() : Promise.reject(new Error(u))))));
  await loadData("longevity.csv (LongevityMap Build 3)", data, true);
  setCorrections("longevitymap_corrections.csv", corr);
  S.def.evidenceTypes = ["genetic association"];
  S.reference = ref.trim().split(/\s+/).join(", ");
  renderAfterLoad();
}

function showLoadInfo() {
  const sep = { ",": "comma-separated", ";": "semicolon-separated", "\t": "tab-separated", xlsx: "spreadsheet, first sheet" }[S.delimiter] || "";
  root.querySelector("#load-info").innerHTML = `<p class="small"><b>${esc(S.fileName)}</b> · ${sep} · ${S.rows.length} rows · ${S.headers.length} columns ·
    <span class="muted">SHA-256 ${S.sha.slice(0, 16)}…</span></p>`;
}

async function sha256(bytes) {
  try {
    const h = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return "unavailable"; }
}

function setCorrections(name, text) {
  const { corrections, warnings } = readCorrections(text);
  Object.assign(S, { corrName: name, corrections, corrWarnings: warnings });
}

// ---------- page after loading ----------
function renderAfterLoad() {
  const box = root.querySelector("#after-load");
  box.innerHTML = `
  <section class="panel step"><h2><span class="n">2</span>Map the columns</h2>
    <div class="mapgrid">${FIELDS.map((f) => `<label><span>${f.label}${f.required ? ' <b class="req">required</b>' : ""}</span>
      <select data-field="${f.key}"><option value="">—</option>${S.headers.map((h) => `<option ${S.mapping[f.key] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}</select>
      <small class="muted">${f.hint}</small></label>`).join("")}</div>
    <div id="alpha-box"></div>
    <div id="assoc-preview"></div>
    <details><summary class="small">Preview of the first rows</summary><div class="tablewrap" id="preview"></div></details>
  </section>

  <section class="panel step"><h2><span class="n">3</span>Source review</h2>
    <p>Manual decisions taken after reading the original publications are given as a corrections table, so that every change is explicit and reproducible.
    Actions: ${Object.entries(CORRECTION_ACTIONS).map(([k, v]) => `<code>${k}</code> (${v.toLowerCase()})`).join("; ")}.</p>
    <div class="btns">
      <label class="filebtn">Load corrections…<input type="file" id="f-corr" accept=".csv,.tsv,.txt,.xlsx,.xls,.ods" hidden></label>
      <a class="btnlink" href="examples/template_corrections.xlsx" download>Corrections template (Excel)</a>
      <a class="btnlink" href="examples/template_corrections.csv" download>(CSV)</a>
      <button id="b-nocorr">Remove corrections</button>
      <label class="small check"><input type="checkbox" id="c-dedup" ${S.dedup ? "checked" : ""}> Remove exact duplicates (study, gene, population, result, variant)</label>
    </div>
    <div id="corr-info"></div>
    <div id="review-out"></div>
  </section>

  <section class="panel step"><h2><span class="n">4</span>Selection</h2>
    <div class="grid2"><aside id="sel-controls"></aside><div id="sel-out"></div></div>
  </section>

  <section class="panel step"><h2><span class="n">5</span>Robustness</h2><div id="rob-out"></div></section>

  <section class="panel step"><h2><span class="n">6</span>Compare with a reference list</h2>
    <textarea id="ref" rows="3" placeholder="Paste gene symbols, e.g. a published list (comma, space or newline separated)">${esc(S.reference)}</textarea>
    <div id="ref-out"></div>
  </section>

  <section class="panel step"><h2><span class="n">7</span>Export</h2>
    <p class="small">Every table behind this page, plus a settings file that reloads the same analysis (column mapping, corrections, options, thresholds and the SHA-256 of the input file).</p>
    <div class="btns" id="exports"></div>
  </section>`;

  box.querySelectorAll("select[data-field]").forEach((s) => (s.onchange = () => { S.mapping[s.dataset.field] = s.value || undefined; runReview(); }));
  box.querySelector("#f-corr").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const { table } = await readFile(f); setCorrections(f.name, table); }
    catch (err) { S.corrWarnings = [`Could not read ${f.name}: ${err.message}`]; S.corrections = []; S.corrName = f.name; }
    runReview();
  };
  box.querySelector("#b-nocorr").onclick = () => { Object.assign(S, { corrections: [], corrWarnings: [], corrName: "" }); runReview(); };
  box.querySelector("#c-dedup").onchange = (e) => { S.dedup = e.target.checked; runReview(); };
  box.querySelector("#ref").oninput = (e) => { S.reference = e.target.value; renderReference(); };
  box.querySelector("#preview").innerHTML = `<table><thead><tr>${S.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    S.rows.slice(0, 6).map((r) => `<tr>${S.headers.map((h) => `<td class="small">${esc(short(r[h], 60))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  runReview();
}

// ---------- step 2-3 ----------
function runReview() {
  const m = S.mapping;
  const missing = FIELDS.filter((f) => f.required && !m[f.key]).map((f) => f.label);
  if (!m.association && !m.pvalue) missing.push("Association result or P-value");
  const alphaBox = root.querySelector("#alpha-box");
  alphaBox.innerHTML = !m.association && m.pvalue ? `<p class="small">Significance threshold for the P-value:
    <input type="number" id="alpha" value="${S.alpha}" min="0" max="1" step="0.001" style="width:7em"></p>` : "";
  alphaBox.querySelector("#alpha")?.addEventListener("change", (e) => { S.alpha = +e.target.value || 0.05; runReview(); });
  renderAssocPreview();
  root.querySelector("#corr-info").innerHTML = S.corrections.length || S.corrWarnings.length
    ? `<p class="small"><b>${esc(S.corrName)}</b>: ${S.corrections.length} corrections (${countBy(S.corrections, (c) => c.action)})</p>
       ${S.corrWarnings.length ? `<div class="note small">${S.corrWarnings.map(esc).join("<br>")}</div>` : ""}`
    : `<p class="small muted">No corrections loaded: records are used as they are.</p>`;
  if (missing.length) {
    root.querySelector("#review-out").innerHTML = `<div class="note">Map these columns to continue: ${missing.map(esc).join(", ")}.</div>`;
    ["#sel-controls", "#sel-out", "#rob-out", "#ref-out", "#exports"].forEach((s) => (root.querySelector(s).innerHTML = ""));
    S.rev = null; return;
  }
  S.rev = review(S.rows, m, S.corrections, { alpha: S.alpha, dedup: S.dedup });
  const types = S.rev.summary.evidence_types;
  if (!S.def.evidenceTypes || !S.def.evidenceTypes.some((t) => types.includes(t))) S.def.evidenceTypes = [...types];
  else S.def.evidenceTypes = S.def.evidenceTypes.filter((t) => types.includes(t));
  renderReviewReport();
  renderSelectionControls();
  runSelection();
}

function renderAssocPreview() {
  const col = S.mapping.association;
  const box = root.querySelector("#assoc-preview");
  if (!col) { box.innerHTML = ""; return; }
  const counts = new Map();
  for (const r of S.rows) { const v = squish(r[col]); counts.set(v, (counts.get(v) || 0) + 1); }
  const vals = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 15);
  box.innerHTML = `<p class="small" style="margin-bottom:4px"><b>How the values of “${esc(col)}” are read</b></p><div class="chips">${vals.map(([v, n]) => {
    const k = interpretAssociation(v, null, S.alpha);
    return `<span class="badge ${k === "significant" ? "ok" : k ? "" : "warn"}">${esc(v || "(empty)")} × ${n} → ${k || "not recognised, excluded"}</span>`;
  }).join("")}</div>`;
}

function renderReviewReport() {
  const s = S.rev.summary, st = (k) => S.rev.audit.filter((a) => a.status === k).length;
  const statuses = [["decisions", "All decisions except plain single-gene records"], ["", "All records"], ["counted", "Counted"], ["multi-gene", "Multi-gene, not counted"], ["replaced", "Replaced by correction"],
    ["excluded", "Excluded by correction"], ["duplicate", "Exact duplicates"], ["excluded-qc", "Excluded at quality control"]];
  root.querySelector("#review-out").innerHTML = `
  <div class="stats">
    <div class="stat"><b>${s.valid}</b><span>valid records of ${s.rows}</span></div>
    <div class="stat"><b>${s.studies}</b><span>studies</span></div>
    <div class="stat"><b>${s.populations}</b><span>population labels</span></div>
    <div class="stat"><b>${s.gene_records}</b><span>counted gene-level records</span></div>
  </div>
  ${S.rev.warnings.length ? `<div class="note small">${S.rev.warnings.map(esc).join("<br>")}</div>` : ""}
  <div class="chips" style="margin-bottom:10px">${statuses.map(([k, l]) => `<button class="chipbtn ${S.auditFilter === k ? "on" : ""}" data-st="${k}">${l}: ${k === "decisions" ? S.rev.audit.filter(isDecision).length : k === "" ? S.rev.audit.length : st(k)}</button>`).join("")}
    ${s.reassigned ? `<span class="badge">of which reassigned: ${s.reassigned}</span>` : ""}</div>
  <input type="search" id="aq" placeholder="Search record, gene, study or population…" value="${esc(S.auditQuery)}" style="max-width:340px;margin-bottom:8px">
  <div class="tablewrap scroll" id="audit"></div>`;
  root.querySelectorAll(".chipbtn[data-st]").forEach((b) => (b.onclick = () => { S.auditFilter = b.dataset.st; renderReviewReport(); }));
  root.querySelector("#aq").oninput = (e) => { S.auditQuery = e.target.value; drawAudit(); };
  drawAudit();
}

function drawAudit() {
  const q = S.auditQuery.trim().toLowerCase();
  const f = S.auditFilter;
  const r = S.rev.audit.filter((a) => (!f || (f === "decisions" ? isDecision(a) : a.status === f)) &&
    (!q || `${a.record_id} ${a.gene_original} ${a.genes} ${a.study} ${a.population}`.toLowerCase().includes(q)));
  root.querySelector("#audit").innerHTML = `<table><thead><tr><th>Record</th><th>Study</th><th>Result</th><th>Population</th><th>Genes</th><th>Decision</th></tr></thead><tbody>${
    r.slice(0, 250).map((a) => `<tr><td>${esc(a.record_id)}</td><td>${esc(a.study)}</td><td class="nw">${esc(a.association || a.association_original)}</td><td>${esc(a.population)}</td>
    <td class="small">${esc(short(a.genes || a.gene_original, 60))}${a.genes && a.genes !== a.gene_original.replace(/\s/g, "") ? `<br><span class="muted">was ${esc(short(a.gene_original, 40))}</span>` : ""}</td>
    <td class="small">${esc(a.action)}${a.note ? `<br><span class="muted">${esc(a.note)}</span>` : ""}</td></tr>`).join("")}</tbody></table>
    ${r.length > 250 ? `<p class="help" style="padding:8px">First 250 of ${r.length} shown; the full audit is in Export.</p>` : ""}`;
}

// ---------- step 4 ----------
function renderSelectionControls() {
  const types = S.rev.summary.evidence_types;
  const c = root.querySelector("#sel-controls");
  c.innerHTML = `
    ${types.length > 1 ? `<label class="ctl">Evidence types counted</label>${types.map((t) => `<label class="check small"><input type="checkbox" data-type="${esc(t)}" ${S.def.evidenceTypes.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("")}` : ""}
    <label class="ctl" for="mg">Multi-gene records</label>
    <select id="mg"><option value="exclude">Not counted (source review)</option><option value="split">Credited to every listed gene</option></select>
    <label class="ctl" for="pl">Population labels</label>
    <select id="pl"><option value="label">As written</option><option value="country">Country level (text in brackets removed)</option></select>
    <label class="ctl" for="pf">Count populations from</label>
    <select id="pf"><option value="all">All gene-study units</option><option value="significant">Significant units only</option></select>
    ${slider("s", "Minimum significant gene-study units", ...GRID.minSig, 1, S.t.minSig)}
    ${slider("p", "Minimum population labels", ...GRID.minPop, 1, S.t.minPop)}
    ${slider("q", "Minimum proportion of significant units", ...GRID.minProp, 0.1, S.t.minProp)}
    <div class="btns"><button id="b-reset">Reset to article defaults</button></div>`;
  c.querySelector("#mg").value = S.def.multiGene; c.querySelector("#pl").value = S.def.populationLevel; c.querySelector("#pf").value = S.def.populationsFrom;
  c.querySelectorAll("input[data-type]").forEach((x) => (x.onchange = () => {
    S.def.evidenceTypes = [...c.querySelectorAll("input[data-type]:checked")].map((y) => y.dataset.type); runSelection();
  }));
  c.querySelector("#mg").onchange = (e) => { S.def.multiGene = e.target.value; runSelection(); };
  c.querySelector("#pl").onchange = (e) => { S.def.populationLevel = e.target.value; runSelection(); };
  c.querySelector("#pf").onchange = (e) => { S.def.populationsFrom = e.target.value; runSelection(); };
  for (const [id, k] of [["s", "minSig"], ["p", "minPop"], ["q", "minProp"]])
    c.querySelector("#" + id).oninput = (e) => { S.t[k] = +e.target.value; outputs(); updateSelection(); };
  c.querySelector("#b-reset").onclick = () => {
    Object.assign(S.def, { multiGene: "exclude", populationLevel: "label", populationsFrom: "all" });
    S.t = { minSig: DEFAULTS.minSig, minPop: DEFAULTS.minPop, minProp: DEFAULTS.minProp };
    renderSelectionControls(); runSelection();
  };
  outputs();
}
function slider(id, label, min, max, step, v) {
  return `<label class="ctl" for="${id}">${label}</label><div class="ctl-row"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output id="${id}-out"></output></div>`;
}
function outputs() {
  root.querySelector("#s-out").textContent = S.t.minSig;
  root.querySelector("#p-out").textContent = S.t.minPop;
  root.querySelector("#q-out").textContent = S.t.minProp.toFixed(2);
}

function runSelection() {
  if (!S.def.evidenceTypes.length) {
    root.querySelector("#sel-out").innerHTML = `<div class="note">Select at least one evidence type.</div>`;
    root.querySelector("#rob-out").innerHTML = ""; return;
  }
  S.ev = geneEvidence(S.rev, S.def).map((g) => ({ ...g, analysis: "current" }));
  S.long = criteriaLong(S.rev, { evidenceTypes: S.def.evidenceTypes });
  S.stab = stability(S.ev, "current");
  updateSelection();
}

const current = () => selectGenes(S.ev, { ...S.t, criterion: "current" });

function updateSelection() {
  const genes = current(), sel = new Set(genes);
  const ref = refSet();
  const out = root.querySelector("#sel-out");
  out.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${genes.length}</b><span>genes selected of ${S.ev.length}</span></div>
      <div class="stat"><b>${S.ev.filter((g) => g.n_sig_studies >= 1).length}</b><span>genes with ≥ 1 significant unit</span></div>
      <div class="stat"><b>${stableCore().length}</b><span>stable core: selected under all five definitions</span></div>
    </div>
    <div class="chips">${genes.map((g) => `<span class="chip ${ref.size && !ref.has(g) ? "gain" : ""}" title="stability ${fmt(S.stab.get(g))}">${esc(g)}</span>`).join("") || '<span class="muted">No gene meets these thresholds.</span>'}</div>
    ${ref.size ? `<p class="help">Green: not in the reference list (step 6).</p>` : ""}
    <h3>Gene-level evidence</h3>
    <input type="search" id="gq2" placeholder="Filter genes…" value="${esc(S.geneQuery)}" style="max-width:260px;margin-bottom:8px">
    <div class="tablewrap scroll" id="gt2"></div>`;
  out.querySelector("#gq2").oninput = (e) => { S.geneQuery = e.target.value; drawGenes(); };
  drawGenes();
  renderRobustness(genes);
  renderReference();
  renderExports();

  function drawGenes() {
    const f = S.geneQuery.trim().toUpperCase();
    const r = S.ev.filter((g) => !f || g.gene.toUpperCase().includes(f))
      .sort((a, b) => sel.has(b.gene) - sel.has(a.gene) || b.n_sig_studies - a.n_sig_studies || a.gene.localeCompare(b.gene));
    out.querySelector("#gt2").innerHTML = `<table><thead><tr><th>Gene</th><th class="num">Units</th><th class="num">Significant</th><th class="num">Mixed</th>
      <th class="num">Populations</th><th class="num">Proportion</th><th class="num">Replication score</th><th class="num">Grid stability</th><th>Selected</th></tr></thead><tbody>${
      r.slice(0, 300).map((g) => `<tr class="${sel.has(g.gene) ? "sel" : ""}"><td><code>${esc(g.gene)}</code></td><td class="num">${g.n_studies}</td><td class="num">${g.n_sig_studies}</td>
      <td class="num">${g.n_mixed_studies}</td><td class="num">${g.n_pop_criterion}</td><td class="num">${fmt(g.proportion_sig)}</td><td class="num">${fmt(g.replication_score)}</td>
      <td class="num"><span class="bar"><i style="width:${Math.round((S.stab.get(g.gene) ?? 0) * 100)}%"></i></span>${fmt(S.stab.get(g.gene))}</td>
      <td>${sel.has(g.gene) ? '<span class="badge ok">yes</span>' : ""}</td></tr>`).join("")}</tbody></table>
      ${r.length > 300 ? `<p class="help" style="padding:8px">First 300 of ${r.length}; full table in Export.</p>` : ""}`;
  }
}

// ---------- step 5 ----------
function gridCounts() {
  const cells = [];
  for (const s of range(...GRID.minSig)) for (const p of range(...GRID.minPop)) for (const q of PROPS)
    cells.push({ min_sig: s, min_pop: p, min_prop: q, genes: selectGenes(S.ev, { criterion: "current", minSig: s, minPop: p, minProp: q }) });
  return cells;
}
const isDecision = (a) => a.status !== "counted" || a.action.startsWith("reassigned") || !!a.note;
function stableCore() { const vr = variantResults(); return vr.reduce((acc, x) => acc.filter((g) => x.genes.includes(g)), vr[0].genes); }
function variantResults() {
  return Object.keys(VARIANTS).map((v) => ({ v, genes: selectGenes(S.long, { ...S.t, criterion: v }) }));
}

function renderRobustness(genes) {
  const cells = gridCounts(), vr = variantResults(), sel = new Set(genes);
  const max = Math.max(1, ...cells.map((c) => c.genes.length));
  const core = vr.reduce((acc, x) => acc.filter((g) => x.genes.includes(g)), vr[0].genes);
  const box = root.querySelector("#rob-out");
  box.innerHTML = `
  <h3 style="margin-top:0">Threshold grid (${cells.length} combinations, current definition)</h3>
  <p class="help">Number of genes selected; click a cell to apply its thresholds.</p>
  <div class="tablewrap"><table class="matrix"><thead><tr><th>Significant ≥</th><th>Populations ≥</th>${PROPS.map((q) => `<th class="num">prop ≥ ${q.toFixed(1)}</th>`).join("")}</tr></thead><tbody>${
    range(...GRID.minSig).flatMap((s) => range(...GRID.minPop).map((p) => `<tr><td>${s}</td><td>${p}</td>${PROPS.map((q) => {
      const c = cells.find((x) => x.min_sig === s && x.min_pop === p && x.min_prop === q), n = c.genes.length;
      const on = s === S.t.minSig && p === S.t.minPop && Math.abs(q - S.t.minProp) < 1e-9;
      return `<td class="num cell ${on ? "on" : ""}" data-c="${s},${p},${q}" style="--a:${(n / max).toFixed(3)}">${n}</td>`;
    }).join("")}</tr>`)).join("")}</tbody></table></div>
  <h3>Alternative selection definitions (current thresholds)</h3>
  ${table(["Definition", "Genes", "Lost vs current selection", "Gained"], vr.map((x) => [VARIANT_LABEL[x.v] + (sameDef(x.v) ? ' <span class="badge ok">current</span>' : ""), x.genes.length,
    chips(genes.filter((g) => !x.genes.includes(g)), "loss"), chips(x.genes.filter((g) => !sel.has(g)), "gain")]), [1])}
  <p class="small"><b>Stable core</b> (selected under all five definitions): ${core.length ? chips(core) : "none"}</p>`;
  box.querySelectorAll("td.cell").forEach((td) => (td.onclick = () => {
    const [s, p, q] = td.dataset.c.split(",").map(Number);
    S.t = { minSig: s, minPop: p, minProp: q };
    root.querySelector("#s").value = s; root.querySelector("#p").value = p; root.querySelector("#q").value = q;
    outputs(); updateSelection();
  }));
}
const sameDef = (v) => Object.entries({ ...BASE_DEF, ...VARIANTS[v] }).every(([k, x]) => k === "evidenceTypes" || S.def[k] === x);
const chips = (gs, cls = "") => (gs.length ? `<span class="chips">${gs.map((g) => `<span class="chip ${cls}">${esc(g)}</span>`).join("")}</span>` : "–");
function table(head, rows, num = []) {
  return `<div class="tablewrap"><table><thead><tr>${head.map((h, j) => `<th class="${num.includes(j) ? "num" : ""}">${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, j) => `<td class="${num.includes(j) ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// ---------- step 6 ----------
const refSet = () => new Set(S.reference.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean));
function renderReference() {
  const box = root.querySelector("#ref-out");
  if (!box || !S.ev) return;
  const ref = refSet(), genes = current();
  if (!ref.size) { box.innerHTML = ""; return; }
  const universe = new Set(S.ev.map((g) => g.gene));
  const shared = genes.filter((g) => ref.has(g)), onlyYou = genes.filter((g) => !ref.has(g)), onlyRef = [...ref].filter((g) => !genes.includes(g));
  const union = new Set([...genes, ...ref]).size;
  box.innerHTML = `<div class="stats">
    <div class="stat"><b>${shared.length}</b><span>shared</span></div>
    <div class="stat"><b>${onlyYou.length}</b><span>only in your selection</span></div>
    <div class="stat"><b>${onlyRef.length}</b><span>only in the reference</span></div>
    <div class="stat"><b>${fmt(union ? shared.length / union : 0)}</b><span>Jaccard index</span></div></div>
  ${onlyRef.length ? `<p class="small">Reference genes not selected: ${onlyRef.map((g) => `<code>${esc(g)}</code>${universe.has(g) ? "" : ' <span class="muted">(no counted evidence in your table)</span>'}`).join(", ")}</p>` : ""}
  ${onlyYou.length ? `<p class="small">Selected genes not in the reference: ${onlyYou.map((g) => `<code>${esc(g)}</code>`).join(", ")}</p>` : ""}`;
}

// ---------- step 7 ----------
function renderExports() {
  const box = root.querySelector("#exports");
  const files = [
    ["record_audit.csv", () => toCSV(S.rev.audit, ["record_id", "row", "status", "action", "note", "study", "association", "association_original", "population", "variant", "cohort", "evidence_type", "gene_original", "genes", "n_genes"])],
    ["gene_level_records.csv", () => toCSV(S.rev.records, ["record_id", "study", "unit", "gene", "association", "population", "variant", "cohort", "evidence_type", "source"])],
    ["gene_evidence.csv", () => toCSV(S.ev.map((g) => ({ ...g, grid_stability: S.stab.get(g.gene), selected: isSelected(g, S.t) })),
      ["gene", "n_studies", "n_sig_studies", "n_nonsig_studies", "n_mixed_studies", "n_pop_criterion", "proportion_sig", "replication_score", "grid_stability", "selected", "populations"])],
    ["selected_genes.txt", () => current().join("\n") + "\n"],
    ["threshold_grid.csv", () => toCSV(gridCounts().map((c) => ({ ...c, n_genes: c.genes.length, selected_genes: c.genes.join("; ") })), ["min_sig", "min_pop", "min_prop", "n_genes", "selected_genes"])],
    ["alternative_definitions.csv", () => toCSV(variantResults().map((x) => ({ definition: x.v, description: VARIANT_LABEL[x.v], n_genes: x.genes.length, selected_genes: x.genes.join("; ") })))],
    ["analysis_settings.json", () => JSON.stringify(settings(), null, 2)],
  ];
  box.innerHTML = files.map(([n]) => `<button data-f="${n}">${n}</button>`).join("");
  box.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const [n, f] = files.find((x) => x[0] === b.dataset.f);
    download(n, f());
  }));
}
function settings() {
  return {
    tool: "Longevity Evidence Explorer – generic source review", version: 1, created: new Date().toISOString(),
    input: { file: S.fileName, sha256: S.sha, rows: S.rows.length },
    mapping: S.mapping, alpha: S.alpha, remove_exact_duplicates: S.dedup,
    corrections: { file: S.corrName, rows: S.corrections.map((c) => Object.fromEntries(CORRECTION_COLUMNS.map((k) => [k, c[k]]))) },
    definition: S.def, thresholds: S.t, reference: S.reference,
    summary: { ...S.rev.summary, selected_genes: current() },
  };
}
function applySettings(js) {
  if (!S.rows.length) { alertBox("Load the data file first, then the settings."); return; }
  if (js.input?.sha256 && js.input.sha256 !== S.sha) alertBox(`These settings were saved for a different file (${esc(js.input.file)}). They are applied anyway; check the column mapping.`);
  S.mapping = js.mapping || S.mapping; S.alpha = js.alpha ?? S.alpha; S.dedup = js.remove_exact_duplicates ?? S.dedup;
  S.corrections = js.corrections?.rows || []; S.corrName = js.corrections?.file || "from settings"; S.corrWarnings = [];
  S.def = { ...BASE_DEF, ...js.definition }; S.t = { ...S.t, ...js.thresholds }; S.reference = js.reference || "";
  renderAfterLoad();
}
function alertBox(html) { root.querySelector("#load-info").insertAdjacentHTML("beforeend", `<div class="note small">${html}</div>`); }
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: name.endsWith(".json") ? "application/json" : "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const short = (s, n) => (String(s ?? "").length > n ? String(s).slice(0, n) + "…" : String(s ?? ""));
const countBy = (xs, f) => Object.entries(xs.reduce((o, x) => ((o[f(x)] = (o[f(x)] || 0) + 1), o), {})).map(([k, v]) => `${v} ${k}`).join(", ");
