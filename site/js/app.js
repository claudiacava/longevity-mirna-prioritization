import {
  CRITERIA, DEFAULTS, GRID, parseCSV, splitList, selectGenes, isSelected, setKey,
  indexDownstream, stability, openGenesTest,
} from "./core.js";

const RESULTS = "../results/";
const FILES = {
  long: "10_longevitymap/criteria_sensitivity_long.csv",
  evidence: "10_longevitymap/gene_evidence_genetic.csv",
  records: "10_longevitymap/gene_level_records_all_modalities.csv",
  audit: "10_longevitymap/record_level_audit.csv",
  decisions: "10_longevitymap/source_review_decisions.csv",
  lmna: "10_longevitymap/lmna_cohort_overlap.csv",
  summary: "10_longevitymap/summary.csv",
  downstream: "16_downstream_sensitivity/downstream_sensitivity_summary.csv",
  downGO: "16_downstream_sensitivity/downstream_GO_significant_terms.csv",
  presence: "13_open_genes/gene_by_category_presence.csv",
  ogOver: "13_open_genes/open_genes_overrepresentation.csv",
  additional: "13_open_genes/additional_candidates.csv",
  regions: "12_go/gene_coordinates_regions.csv",
  goPrimary: "12_go/GO_BP_propagated_primary.csv",
  goLRO: "12_go/GO_BP_leave_region_out_summary.csv",
  mirPrimary: "15_mirna/ranking_primary.csv",
  mirNullPrimary: "15_mirna/null_comparison_primary.csv",
  mirIntegrated: "15_mirna/ranking_integrated.csv",
  mirNullIntegrated: "15_mirna/null_comparison_integrated.csv",
};
const SUPP = [
  ["Supplementary_1_LongevityMap_source_review.xlsx", "S1 · Source review"], ["Supplementary_2_gene_level_evidence.xlsx", "S2 · Gene-level evidence"],
  ["Supplementary_3_threshold_sensitivity.xlsx", "S3 · Threshold sensitivity"], ["Supplementary_4_GO_enrichment.xlsx", "S4 · GO enrichment"],
  ["Supplementary_5_Open_Genes.xlsx", "S5 · Open Genes"], ["Supplementary_6_miRNA.xlsx", "S6 · miRNA"], ["Supplementary_7.png", "S7 · Figure"]];
const INTERACTIONS = "15_mirna/interactions_deduplicated_all_queried_genes.csv.gz";

const D = {};
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toFixed(d));
const fmtP = (p) => (p === null || p === undefined ? "–" : p < 0.001 ? Number(p).toExponential(1) : Number(p).toFixed(3));
const pmid = (id) => (id ? `<a href="https://pubmed.ncbi.nlm.nih.gov/${esc(id)}/" target="_blank" rel="noopener">${esc(id)}</a>` : "–");
const geneLink = (g) => `<a class="g" href="#gene/${encodeURIComponent(g)}">${esc(g)}</a>`;
const bar = (v) => `<span class="bar"><i style="width:${Math.round((v ?? 0) * 100)}%"></i></span>${fmt(v)}`;

async function load() {
  const entries = await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
    const r = await fetch(RESULTS + f);
    if (!r.ok) throw new Error(`Cannot read ${f} (${r.status})`);
    return [k, parseCSV(await r.text())];
  }));
  Object.assign(D, Object.fromEntries(entries));
  D.downIdx = indexDownstream(D.downstream);
  D.region = new Map(D.regions.map((r) => [r.SYMBOL, r.region]));
  D.primary = selectGenes(D.long, DEFAULTS);
  D.stab = {};
  D.stableCore = new Set(D.primary.filter((g) =>
    Object.keys(CRITERIA).every((c) => D.long.some((x) => x.analysis === c && x.gene === g && isSelected(x, DEFAULTS)))));
  D.metric = Object.fromEntries(D.summary.map((r) => [r.metric, r.value]));
}
const stab = (c) => (D.stab[c] ??= stability(D.long, c));

let interactions = null;
async function loadInteractions() {
  if (interactions) return interactions;
  const r = await fetch(RESULTS + INTERACTIONS);
  const text = await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text();
  interactions = parseCSV(text);
  return interactions;
}

// ---------------- routing ----------------
function route() {
  const [path, query] = (location.hash.slice(1) || "overview").split("?");
  const [page, arg] = path.split("/");
  document.querySelectorAll("nav a").forEach((a) =>
    a.classList.toggle("on", a.getAttribute("href") === "#" + (page === "gene" ? "genes" : page)));
  const params = new URLSearchParams(query || "");
  if (page === "analyse") { import("./analyse.js").then((m) => m.renderAnalyse(app)); window.scrollTo(0, 0); return; }
  ({ overview, explore, genes, gene, review, data }[page] || overview)(arg && decodeURIComponent(arg), params);
  if (page !== "explore") window.scrollTo(0, 0);
}

// ---------------- overview ----------------
function overview() {
  const m = D.metric;
  app.innerHTML = `
  <h1>Which human longevity genes survive a source review, and how robust is the list?</h1>
  <p class="lead">This site exposes every step behind the prioritisation of human longevity genes from LongevityMap:
  how each record was reviewed, how genes were selected, how the list changes when the selection rules change, and what the
  downstream GO, Open Genes and miRNA analyses show for each alternative list.</p>
  <div class="stats">
    <div class="stat"><b>${m.records_valid}</b><span>LongevityMap records analysed (of ${m.records_downloaded})</span></div>
    <div class="stat"><b>${m.distinct_pmids}</b><span>publications (PMIDs)</span></div>
    <div class="stat"><b>${m.gene_universe_genetic}</b><span>genes with single-gene evidence</span></div>
    <div class="stat"><b>${D.primary.length}</b><span>genes selected (primary definition)</span></div>
    <div class="stat"><b>${D.stableCore.size}</b><span>selected under all five criteria</span></div>
  </div>
  <h2>The pipeline</h2>
  <div class="flow">
    <div><b>Source review</b><span>Multi-gene records audited; alias errors corrected; overlapping cohorts handled.</span></div>
    <div><b>Gene-study units</b><span>One unit per gene and publication; mixed units count as non-significant.</span></div>
    <div><b>Selection</b><span>≥ ${DEFAULTS.minSig} significant units, ≥ ${DEFAULTS.minPop} population labels, proportion ≥ ${DEFAULTS.minProp.toFixed(2)}.</span></div>
    <div><b>Robustness</b><span>100 threshold combinations × 5 alternative criteria.</span></div>
    <div><b>Downstream</b><span>GO enrichment, Open Genes over-representation, validated miRNA regulators with a coverage-matched null.</span></div>
  </div>
  <h2>Primary gene list</h2>
  <div class="panel"><div class="chips">${D.primary.map((g) =>
    `<a class="chip ${D.stableCore.has(g) ? "gain" : ""}" href="#gene/${g}" title="${D.stableCore.has(g) ? "Selected under all criteria" : ""}">${g}</a>`).join("")}</div>
    <p class="help">Highlighted genes are selected under all five selection criteria.</p>
    <div class="btns"><a href="#explore"><button>Change the selection rules →</button></a><a href="#analyse"><button>Apply the method to your own table →</button></a></div>
  </div>
  <h2>Main findings</h2>
  <div class="cols3">
    <div class="panel"><h3>GO enrichment</h3><p>No Biological Process term is significant after correction for the primary list. The strongest nominal signal (cholesterol transport and efflux) depends on APOB, APOC1, APOC3, APOE, PON1 and PPARG.</p></div>
    <div class="panel"><h3>Open Genes</h3><p>After removing records duplicated from LongevityMap and adjusting for coverage, only human longevity associations are over-represented among the selected genes.</p></div>
    <div class="panel"><h3>miRNA regulators</h3><p>hsa-miR-34a-5p targets the most selected genes, but no miRNA exceeds what random genes of matched coverage would give.</p></div>
  </div>
  <div class="note"><b>Limits of the evidence.</b> LongevityMap Build 3 was last updated in 2017. Cohorts may overlap across publications beyond the case handled here, and sex is not recorded.</div>`;
}

// ---------------- explore ----------------
function readState(params) {
  const c = params.get("c");
  return {
    criterion: CRITERIA[c] ? c : DEFAULTS.criterion,
    minSig: clamp(+params.get("s") || DEFAULTS.minSig, ...GRID.minSig),
    minPop: clamp(+params.get("p") || DEFAULTS.minPop, ...GRID.minPop),
    minProp: clamp(+params.get("q") || DEFAULTS.minProp, ...GRID.minProp),
  };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
let exploreSort = { key: "selected", dir: -1 }, exploreAll = false;

function explore(_, params) {
  const t = readState(params);
  if (!app.querySelector("#controls")) {
    app.innerHTML = `
    <h1>Explore the selection</h1>
    <p class="lead">Move the thresholds or switch criterion: the gene list, its comparison with the primary list and the downstream results update immediately.</p>
    <div class="grid2">
      <aside class="panel" id="controls">
        <label class="ctl" for="crit">Selection criterion</label>
        <select id="crit">${Object.entries(CRITERIA).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
        <p class="help" id="crit-help"></p>
        ${slider("s", "Minimum significant gene-study units", ...GRID.minSig, 1)}
        ${slider("p", "Minimum population labels", ...GRID.minPop, 1)}
        ${slider("q", "Minimum proportion of significant units", ...GRID.minProp, 0.1)}
        <div class="btns"><button id="reset">Reset to primary</button><button id="copy">Copy link</button></div>
        <p class="help">Ranges match the 100-combination grid of the article.</p>
      </aside>
      <section id="out"></section>
    </div>`;
    const go = () => {
      const q = new URLSearchParams({ c: crit.value, s: s.value, p: p.value, q: (+q_.value).toFixed(1) });
      history.replaceState(null, "", "#explore?" + q);
      renderExplore(readState(q));
    };
    const crit = app.querySelector("#crit"), s = app.querySelector("#s"), p = app.querySelector("#p"), q_ = app.querySelector("#q");
    [crit, s, p, q_].forEach((el) => el.addEventListener("input", go));
    app.querySelector("#reset").onclick = () => { location.hash = "#explore"; };
    app.querySelector("#copy").onclick = (e) => {
      navigator.clipboard?.writeText(location.href).then(() => (e.target.textContent = "Link copied"), () => {});
    };
  }
  app.querySelector("#crit").value = t.criterion;
  app.querySelector("#s").value = t.minSig;
  app.querySelector("#p").value = t.minPop;
  app.querySelector("#q").value = t.minProp;
  renderExplore(t);
}

function slider(id, label, min, max, step) {
  return `<label class="ctl" for="${id}">${label}</label>
  <div class="ctl-row"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><output id="${id}-out"></output></div>`;
}

function renderExplore(t) {
  ["s", "p", "q"].forEach((id) => {
    const v = app.querySelector("#" + id).value;
    app.querySelector(`#${id}-out`).textContent = id === "q" ? (+v).toFixed(2) : v;
  });
  app.querySelector("#crit-help").textContent = CRITERIA[t.criterion].help;

  const genes = selectGenes(D.long, t);
  const sel = new Set(genes), prim = new Set(D.primary);
  const gained = genes.filter((g) => !prim.has(g)), lost = D.primary.filter((g) => !sel.has(g));
  const regions = new Set(genes.map((g) => D.region.get(g) || "unplaced:" + g)); // genes without coordinates (e.g. GSTT1) count as their own region
  const universe = CRITERIA[t.criterion].universe;
  const down = D.downIdx.get(setKey(genes, universe));
  const stabC = stab(t.criterion);
  const rows = D.long.filter((x) => x.analysis === t.criterion).map((x) => ({ ...x, selected: sel.has(x.gene), stability: stabC.get(x.gene) }));
  const isPrimaryState = t.criterion === "primary" && t.minSig === 2 && t.minPop === 2 && Math.abs(t.minProp - 0.6) < 1e-9;

  const out = app.querySelector("#out");
  out.innerHTML = `
  <div class="stats">
    <div class="stat"><b>${genes.length}</b><span>genes selected of ${rows.length}</span></div>
    <div class="stat"><b>${regions.size}</b><span>genomic regions</span></div>
    <div class="stat"><b>${genes.filter((g) => prim.has(g)).length}</b><span>shared with the primary list</span></div>
    <div class="stat"><b>${genes.filter((g) => D.stableCore.has(g)).length}/${D.stableCore.size}</b><span>stable-core genes kept</span></div>
  </div>
  <div class="panel">
    <h3 style="margin-top:0">Selected genes ${isPrimaryState ? '<span class="badge ok">primary definition</span>' : ""}</h3>
    ${genes.length ? `<div class="chips">${genes.map((g) => `<a class="chip ${prim.has(g) ? "" : "gain"}" href="#gene/${g}">${g}</a>`).join("")}${lost.map((g) => `<a class="chip loss" href="#gene/${g}" title="In the primary list, not here">${g}</a>`).join("")}</div>
    <p class="help">${gained.length} gained (green) and ${lost.length} lost (struck through) compared with the primary list.</p>` : `<p class="muted">No gene meets these thresholds.</p>`}
  </div>
  <h2>Downstream analyses for this list</h2>
  ${downstreamBlock(genes, down, t, isPrimaryState)}
  <h2>Gene-level evidence under this criterion</h2>
  <div class="ctl-row" style="margin-bottom:8px"><input type="search" id="flt" placeholder="Filter genes…" aria-label="Filter genes">
    <label class="small" style="white-space:nowrap"><input type="checkbox" id="all" ${exploreAll ? "checked" : ""}> show all ${rows.length}</label></div>
  <div class="tablewrap" id="tbl"></div>`;

  const draw = () => {
    const f = out.querySelector("#flt").value.trim().toUpperCase();
    let r = rows.filter((x) => (exploreAll || x.selected || x.n_sig_studies >= 1) && (!f || x.gene.includes(f)));
    const k = exploreSort.key, d = exploreSort.dir;
    r.sort((a, b) => (a[k] === b[k] ? (b.n_sig_studies - a.n_sig_studies) || a.gene.localeCompare(b.gene) : (a[k] > b[k] ? d : -d)));
    out.querySelector("#tbl").innerHTML = table(
      [["gene", "Gene"], ["n_studies", "Units", 1], ["n_sig_studies", "Significant", 1], ["n_pop_criterion", "Populations", 1],
       ["proportion_sig", "Proportion", 1], ["stability", "Grid stability", 1], ["selected", "Selected"]],
      r.map((x) => [geneLink(x.gene), x.n_studies, x.n_sig_studies, x.n_pop_criterion, fmt(x.proportion_sig), bar(x.stability),
        x.selected ? '<span class="badge ok">yes</span>' : ""]), r.map((x) => (x.selected ? "sel" : "")));
    out.querySelectorAll("th.sort").forEach((th) => (th.onclick = () => {
      exploreSort = { key: th.dataset.k, dir: exploreSort.key === th.dataset.k ? -exploreSort.dir : -1 }; draw();
    }));
  };
  out.querySelector("#flt").oninput = draw;
  out.querySelector("#all").onchange = (e) => { exploreAll = e.target.checked; draw(); };
  draw();
}

function table(cols, rows, rowClass = []) {
  return `<table><thead><tr>${cols.map(([k, l, n]) => `<th class="sort ${n ? "num" : ""}" data-k="${k}">${l}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r, i) => `<tr class="${rowClass[i] || ""}">${r.map((c, j) => `<td class="${cols[j][2] ? "num" : ""}">${c ?? "–"}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
const simpleTable = (head, rows, numCols = []) =>
  `<div class="tablewrap"><table><thead><tr>${head.map((h, j) => `<th class="${numCols.includes(j) ? "num" : ""}">${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, j) => `<td class="${numCols.includes(j) ? "num" : ""}">${c ?? "–"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

function downstreamBlock(genes, down, t, isPrimaryState) {
  if (!genes.length) return `<p class="muted">Nothing to analyse.</p>`;
  const og = t.criterion === "composite_records_included" ? null : openGenesTest(D.presence, genes);
  const ogHtml = og ? `
    <div class="panel"><h3 style="margin-top:0">Open Genes evidence <span class="badge">computed live</span></h3>
    ${simpleTable(["Evidence type", "Selected with evidence", "Other genes with evidence", "Fisher p (one-sided)", "FDR"],
      og.map((r) => [esc(r.evidence_type), `${r.a}/${r.a + r.b}`, `${r.c}/${r.c + r.d}`, fmtP(r.p), r.fdr !== undefined ? fmtP(r.fdr) : "–"]), [1, 2, 3, 4])}
    <p class="help">Unadjusted test against the other genes of the 213-gene universe; it reproduces the Fisher column of the article for the primary list.
    ${isPrimaryState ? `The coverage-adjusted logistic model (article) leaves only human longevity associations significant (OR ${fmt(D.ogOver[0].adjusted_odds_ratio)}, 95% CI ${fmt(D.ogOver[0].adjusted_ci_low)}–${fmt(D.ogOver[0].adjusted_ci_high)}, FDR ${fmtP(D.ogOver[0].adjusted_fdr)}).` : "The coverage-adjusted model is precomputed for the primary list only."}</p></div>`
    : `<div class="panel"><h3 style="margin-top:0">Open Genes evidence</h3><p class="muted">Not available for the composite-records universe.</p></div>`;

  if (!down) return ogHtml + `<div class="note">GO and miRNA results have not been precomputed for this list (${genes.length} genes).
    The article precomputed them for the ${D.downstream.length} distinct lists produced by the threshold grid under the primary criterion and by each criterion at the default thresholds.
    Extending <code>R/16_downstream_sensitivity.R</code> to every list reachable here would close this gap.</div>`;

  const goSig = D.downGO.filter((r) => r.set_id === down.set_id);
  return `
  <div class="cols3">
    <div class="panel"><h3 style="margin-top:0">GO Biological Process <span class="badge">set ${esc(down.set_id)}</span></h3>
      <dl class="kv"><dt>Terms tested</dt><dd>${down.go_terms_tested}</dd><dt>FDR &lt; 0.05</dt><dd>${down.go_terms_fdr05}</dd>
      <dt>Nominal p &lt; 0.05</dt><dd>${down.go_terms_nominal}</dd><dt>Top term</dt><dd>${esc(down.go_top_term)}</dd>
      <dt>Top p / FDR</dt><dd>${fmtP(down.go_top_p)} / ${fmtP(down.go_top_fdr)}</dd><dt>Cholesterol efflux FDR</dt><dd>${fmtP(down.go_cholesterol_efflux_fdr)}</dd></dl>
      ${goSig.length ? `<p class="small"><b>Significant terms:</b> ${goSig.map((r) => esc(r.Description)).join("; ")}</p>` : ""}</div>
    <div class="panel"><h3 style="margin-top:0">miRNA regulators</h3>
      <dl class="kv"><dt>Genes with interactions</dt><dd>${down.mirna_genes_with_interactions}/${down.n_genes}</dd>
      <dt>Top miRNA</dt><dd>${esc(down.mirna_top)} (${down.mirna_top_targets} genes)</dd>
      <dt>miR-34a-5p rank</dt><dd>${down.mir34a_rank ?? "–"} (${down.mir34a_targets ?? 0} genes; null mean ${fmt(down.mir34a_null_mean, 1)})</dd>
      <dt>miR-34a-5p null FDR</dt><dd>${fmtP(down.mir34a_null_fdr)}</dd><dt>Lowest null FDR</dt><dd>${fmtP(down.null_min_fdr)} (${esc(down.null_top_mirna)})</dd>
      <dt>miRNAs FDR &lt; 0.05</dt><dd>${down.null_mirnas_fdr05}</dd></dl></div>
  </div>
  ${ogHtml}
  ${isPrimaryState ? primaryDetails() : ""}`;
}

function primaryDetails() {
  const go = D.goPrimary.slice(0, 15), mir = D.mirPrimary.slice(0, 15);
  const nul = new Map(D.mirNullPrimary.map((r) => [r.mirna, r]));
  return `<details class="panel"><summary><b>Full tables for the primary list</b></summary>
  <h3>Top GO terms (propagated annotations)</h3>
  ${simpleTable(["Term", "Genes", "Ratio", "p", "FDR"], go.map((r) => [`${esc(r.Description)} <span class="muted small">${esc(r.ID)}</span>`, esc(r.geneID.replaceAll("/", ", ")), esc(r.GeneRatio), fmtP(r.pvalue), fmtP(r["p.adjust"])]), [2, 3, 4])}
  <h3>Top miRNAs</h3>
  ${simpleTable(["Rank", "miRNA", "Targets", "Databases", "Null mean", "Null FDR"], mir.map((r) => [r.rank, esc(r.mirna), r.n_targets, r.n_databases, fmt(nul.get(r.mirna)?.null_mean, 1), fmtP(nul.get(r.mirna)?.empirical_fdr)]), [0, 2, 3, 4, 5])}
  <h3>GO, leave-one-region-out</h3>
  ${simpleTable(["Removed", "Genes left", "FDR &lt; 0.05", "Top term", "Top FDR"], D.goLRO.map((r) => [esc(r.removed_genes), r.n_candidates, r.n_fdr05, esc(r.top_term), fmtP(r.top_fdr)]), [1, 2, 4])}
  </details>`;
}

// ---------------- genes ----------------
function genes() {
  const ev = D.evidence, st = stab("primary");
  app.innerHTML = `<h1>Genes</h1>
  <p class="lead">${ev.length} genes with source-reviewed single-gene evidence in LongevityMap, plus ${D.additional.length} exploratory candidates added from Open Genes.</p>
  <input type="search" id="gq" placeholder="Search a gene symbol…" aria-label="Search genes" style="max-width:320px">
  <h2>LongevityMap gene universe</h2><div class="tablewrap" id="gt"></div>
  <h2>Additional candidates from Open Genes</h2>
  <p class="muted small">Exploratory; together with the primary list they form the integrated set of ${D.primary.length + D.additional.length} genes used in the integrated miRNA analysis.</p>
  <div id="at"></div>`;
  const draw = () => {
    const f = app.querySelector("#gq").value.trim().toUpperCase();
    const r = ev.filter((x) => !f || x.gene.includes(f));
    app.querySelector("#gt").innerHTML = table(
      [["gene", "Gene"], ["n", "Units", 1], ["s", "Significant", 1], ["m", "Mixed", 1], ["p", "Populations", 1], ["pr", "Proportion", 1], ["rs", "Replication score", 1], ["st", "Stability", 1], ["sel", "Primary"]],
      r.map((x) => [geneLink(x.gene), x.n_studies, x.n_sig_studies, x.n_mixed_studies, x.n_populations, fmt(x.proportion_sig), fmt(x.replication_score), bar(st.get(x.gene)), x.primary_selected ? '<span class="badge ok">selected</span>' : ""]),
      r.map((x) => (x.primary_selected ? "sel" : "")));
    const a = D.additional.filter((x) => !f || x.gene.includes(f));
    app.querySelector("#at").innerHTML = simpleTable(["Gene", "Human records", "Significant", "Complementary categories", "LongevityMap status"],
      a.map((x) => [geneLink(x.gene), x.og_human_records, x.og_human_significant, x.n_complementary_categories, esc(x.lm_status)]), [1, 2, 3]);
  };
  app.querySelector("#gq").oninput = draw;
  draw();
}

function gene(g) {
  if (!g) return genes();
  const crit = Object.keys(CRITERIA).map((c) => ({ c, r: D.long.find((x) => x.analysis === c && x.gene === g) }));
  const recs = D.records.filter((r) => r.gene === g);
  const excluded = D.audit.filter((r) => splitList(r.gene_s_corrected, /,\s*/).includes(g) && !/^retained|^reassigned/.test(r.source_review_action));
  const pres = D.presence.filter((r) => r.gene === g);
  const add = D.additional.find((r) => r.gene === g);
  const inPrimary = D.primary.includes(g);
  const st = stab("primary").get(g);
  const units = groupBy(recs, (r) => r.study_unit);
  app.innerHTML = `
  <p class="small"><a href="#genes">← All genes</a></p>
  <h1 style="font-family:var(--mono)">${esc(g)}</h1>
  <p>${inPrimary ? '<span class="badge ok">primary list</span> ' : ""}${D.stableCore.has(g) ? '<span class="badge ok">stable under all criteria</span> ' : ""}${add ? '<span class="badge warn">Open Genes candidate</span> ' : ""}
  ${D.region.get(g) ? `<span class="badge">region ${esc(D.region.get(g))}</span>` : ""}
  <a class="small" href="https://www.genecards.org/cgi-bin/carddisp.pl?gene=${encodeURIComponent(g)}" target="_blank" rel="noopener">GeneCards ↗</a></p>
  ${recs.length || excluded.length ? "" : `<p class="muted">No LongevityMap record for this gene.</p>`}
  ${crit.some((x) => x.r) ? `<h2>Selection under each criterion</h2>
  ${simpleTable(["Criterion", "Units", "Significant", "Populations", "Proportion", "Selected at default thresholds"],
    crit.filter((x) => x.r).map(({ c, r }) => [CRITERIA[c].label, r.n_studies, r.n_sig_studies, r.n_pop_criterion, fmt(r.proportion_sig), isSelected(r, DEFAULTS) ? '<span class="badge ok">yes</span>' : "no"]), [1, 2, 3, 4])}
  ${st !== undefined ? `<p class="small">Selected in ${Math.round(st * 100)} of 100 threshold combinations (primary criterion). ${bar(st)}</p>` : ""}` : ""}
  ${recs.length ? `<h2>Counted evidence: ${Object.keys(units).length} gene-study units</h2>
  ${simpleTable(["PMID", "Unit result", "Records", "Population", "Variants", "Modality"],
    Object.entries(units).map(([u, rs]) => {
      const sig = !rs.some((r) => r.association === "non-significant"), mixed = sig ? false : rs.some((r) => r.association === "significant");
      return [pmid(rs[0].pub_med), sig ? '<span class="badge ok">significant</span>' : mixed ? '<span class="badge warn">mixed → non-significant</span>' : '<span class="badge">non-significant</span>',
        rs.length, esc([...new Set(rs.map((r) => r.population))].join("; ")), `<code>${esc([...new Set(rs.map((r) => r.variant_s))].join(", "))}</code>`, esc(rs[0].evidence_modality)];
    }), [2])}` : ""}
  ${excluded.length ? `<h2>Records involving ${esc(g)} not counted</h2>
  ${simpleTable(["Record", "PMID", "Result", "Population", "Genes in record", "Decision"],
    excluded.map((r) => [esc(r.id), pmid(r.pub_med), esc(r.association), esc(r.population), `<span class="small">${esc(shorten(r.gene_s_corrected))}</span>`, esc(r.source_review_action)]))}` : ""}
  ${pres.length ? `<h2>Open Genes (after removing records duplicated from LongevityMap)</h2>
  <div class="chips">${pres.map((r) => `<span class="badge ${r.evidence_present ? "ok" : ""}">${esc(r.evidence_type)}: ${r.evidence_present ? "present" : "absent"}</span>`).join("")}</div>` : ""}
  ${add ? `<p class="small">Open Genes human records: ${add.og_human_records} (${add.og_human_significant} significant); evidence in ${add.n_complementary_categories} complementary categories. ${esc(add.lm_status)}.</p>` : ""}
  <h2>Validated miRNA interactions</h2><div id="mir"><p class="muted">Loading multiMiR interactions (about 3 MB, once per visit)…</p></div>`;
  loadInteractions().then((all) => {
    const box = document.getElementById("mir");
    if (!box) return;
    const rs = all.filter((r) => r.gene === g);
    if (!rs.length) { box.innerHTML = `<p class="muted">No validated interaction in multiMiR for ${esc(g)}.</p>`; return; }
    const by = Object.entries(groupBy(rs, (r) => r.mirna)).map(([m, x]) => ({
      m, n: x.length, db: [...new Set(x.map((r) => r.database))], assay: x.some((r) => r.assay_label),
      exp: [...new Set(x.flatMap((r) => splitList(r.experiment, /\/\//)))], pm: [...new Set(x.flatMap((r) => splitList(String(r.pubmed_id_raw ?? ""), /[,;|]\s*/)))],
    })).sort((a, b) => b.db.length - a.db.length || b.n - a.n || a.m.localeCompare(b.m));
    box.innerHTML = `<p class="small muted">${by.length} miRNAs, ${rs.length} interaction records (miRTarBase 9, TarBase v9, miRecords 4; validated only).</p>` +
      simpleTable(["miRNA", "Databases", "Records", "Low-throughput assay", "Experiments", "PMIDs"],
        by.slice(0, 200).map((x) => [esc(x.m), esc(x.db.join(", ")), x.n, x.assay ? '<span class="badge ok">yes</span>' : "", `<span class="small">${esc(shorten(x.exp.join(", "), 90))}</span>`,
          x.pm.slice(0, 4).map(pmid).join(", ") + (x.pm.length > 4 ? ` +${x.pm.length - 4}` : "")]), [2]) +
      (by.length > 200 ? `<p class="help">First 200 of ${by.length} shown; full table in Downloads.</p>` : "");
  }).catch((e) => { const box = document.getElementById("mir"); if (box) box.innerHTML = `<p class="note">Could not load interactions: ${esc(e.message)}</p>`; });
}
const groupBy = (xs, f) => xs.reduce((o, x) => ((o[f(x)] ??= []).push(x), o), {});
const shorten = (s, n = 70) => (String(s).length > n ? String(s).slice(0, n) + "…" : s);

// ---------------- source review ----------------
function review(_, params) {
  const m = D.metric;
  const actions = [...new Set(D.audit.map((r) => r.source_review_action))];
  app.innerHTML = `<h1>Source review</h1>
  <p class="lead">Every LongevityMap record, what was done with it and why. Multi-gene records were not split automatically: each was checked against the original publication.</p>
  <div class="stats">
    <div class="stat"><b>${m.records_downloaded}</b><span>records downloaded</span></div>
    <div class="stat"><b>${m.records_excluded}</b><span>invalid records removed</span></div>
    <div class="stat"><b>${m.records_multi_gene_original}</b><span>multi-gene records</span></div>
    <div class="stat"><b>${m.records_apoe_alias_corrected}</b><span>APOE alias corrections</span></div>
  </div>
  <h2>Decisions on multi-gene records</h2>
  ${simpleTable(["Unit", "Records", "Original assignment", "Genes counted (primary)", "Decision"], D.decisions.map((r) => [esc(r.decision_unit), r.n_records, esc(r.original_assignment), r.genes_counted_primary_genetic, esc(r.decision)]), [1, 3])}
  <h2>Overlapping cohorts: LMNA</h2>
  <div class="note">${esc(D.lmna[0]?.note)}</div>
  <h2>Record-level audit</h2>
  <div class="ctl-row" style="margin-bottom:8px;flex-wrap:wrap">
    <select id="act" style="max-width:420px"><option value="">All decisions (${D.audit.length})</option>${actions.map((a) => `<option>${esc(a)}</option>`).join("")}</select>
    <input type="search" id="aq" placeholder="Gene, PMID or population…" style="max-width:280px"></div>
  <div class="tablewrap" id="audit"></div>`;
  const draw = () => {
    const a = app.querySelector("#act").value, q = app.querySelector("#aq").value.trim().toLowerCase();
    const r = D.audit.filter((x) => (!a || x.source_review_action === a) &&
      (!q || `${x.gene_s_corrected} ${x.pub_med} ${x.population}`.toLowerCase().includes(q)));
    app.querySelector("#audit").innerHTML = `<table><thead><tr><th>ID</th><th>PMID</th><th>Result</th><th>Population</th><th>Genes</th><th>Type</th><th>Decision</th></tr></thead><tbody>${
      r.slice(0, 300).map((x) => `<tr><td>${esc(x.id)}</td><td>${pmid(x.pub_med)}</td><td>${esc(x.association)}</td><td>${esc(x.population)}</td>
      <td class="small">${splitList(x.gene_s_corrected, /,\s*/).length <= 6 ? splitList(x.gene_s_corrected, /,\s*/).map(geneLink).join(", ") : esc(shorten(x.gene_s_corrected))}</td>
      <td class="small">${esc(x.record_type)}</td><td class="small">${esc(x.source_review_action)}${x.alias_correction !== "none" ? `<br><span class="muted">${esc(x.alias_correction)}</span>` : ""}</td></tr>`).join("")}</tbody></table>
      ${r.length > 300 ? `<p class="help" style="padding:8px">First 300 of ${r.length}; refine the filter or download the full table.</p>` : ""}`;
  };
  app.querySelector("#act").onchange = draw;
  app.querySelector("#aq").oninput = draw;
  draw();
}

// ---------------- data & methods ----------------
function data() {
  const dl = (f, label) => `<li><a href="${RESULTS}${f}" download>${esc(label || f.split("/").pop())}</a> <span class="muted small">results/${esc(f)}</span></li>`;
  app.innerHTML = `<h1>Data &amp; methods</h1>
  <h2>Sources and versions</h2>
  ${simpleTable(["Resource", "Version", "Retrieved", "Used for"], [
    ["LongevityMap (Human Ageing Genomic Resources)", "Build 3 (2017)", "July 2026", "Human genetic association records"],
    ["Open Genes API", "6 datasets", "24 July 2026", "Complementary evidence, additional candidates"],
    ["multiMiR", "1.30.0, database 2.4.0 (miRTarBase 9, TarBase v9, miRecords 4)", "8 October 2026", "Validated miRNA–target interactions"],
    ["Europe PMC REST API", "–", "July 2026", "DOI to PMID mapping"],
    ["org.Hs.eg.db, GO.db, clusterProfiler", "see results/package_versions.csv", "–", "GO Biological Process enrichment"]])}
  <h2>How this site works</h2>
  <p>The site is static. It reads the CSV files written by the R pipeline in <code>results/</code> without any conversion and recomputes the gene selection in the browser with the same rule as <code>R/10_longevitymap.R</code>.
  Downstream GO and miRNA results are looked up from <code>results/16_downstream_sensitivity/</code>; the Open Genes Fisher test is recomputed for any list.</p>
  <p>The page <a href="#analyse">Analyse your data</a> applies the same procedure to any table: the manual source-review decisions are supplied as a corrections table, so each one is explicit, and the whole analysis can be saved and reloaded as a settings file.</p>
  <div class="okbox"><b>Validation.</b> <code>node site/tests/validate.mjs</code> checks the browser logic against the R outputs: the primary list, all 100 threshold combinations, the five selection criteria, the stability of all 213 genes and the six Open Genes Fisher tests (326 checks, all passing).
  <code>node site/tests/validate_review.mjs</code> runs the generic engine on the raw LongevityMap table with the article's corrections file and checks that it reproduces the record counts, all gene-level records, per-gene evidence, the five selection definitions and the 100-combination grid (36 checks, all passing).</div>
  <h2>Limitations</h2>
  <ul><li>LongevityMap has not been updated since 2017; newer associations (for example in the GWAS Catalog) are not included.</li>
  <li>Different publications may analyse overlapping cohorts; only the NECS overlap (LMNA) was resolved explicitly.</li>
  <li>Sex is not recorded in LongevityMap, so sex-specific associations cannot be distinguished.</li>
  <li>The replication score is descriptive and is not used for selection.</li></ul>
  <h2>Downloads</h2>
  <div class="cols3"><div class="panel"><h3 style="margin-top:0">Source review and selection</h3><ul class="small">
  ${dl("10_longevitymap/record_level_audit.csv")}${dl("10_longevitymap/gene_evidence_genetic.csv")}${dl("10_longevitymap/gene_level_records_all_modalities.csv")}
  ${dl("10_longevitymap/criteria_sensitivity_long.csv")}${dl("11_sensitivity/threshold_scenarios_genetic.csv")}${dl("11_sensitivity/gene_stability_genetic.csv")}</ul></div>
  <div class="panel"><h3 style="margin-top:0">Downstream analyses</h3><ul class="small">
  ${dl("12_go/GO_BP_propagated_primary.csv")}${dl("12_go/GO_BP_direct_primary.csv")}${dl("13_open_genes/open_genes_overrepresentation.csv")}${dl("13_open_genes/additional_candidates.csv")}
  ${dl("15_mirna/ranking_primary.csv")}${dl("15_mirna/null_comparison_primary.csv")}${dl("15_mirna/ranking_integrated.csv")}${dl(INTERACTIONS)}${dl("16_downstream_sensitivity/downstream_sensitivity_summary.csv")}</ul></div>
  <div class="panel"><h3 style="margin-top:0">Article material</h3><ul class="small">
  ${SUPP.map(([f, l]) => `<li><a href="../supplementary/${f}" download>${l}</a></li>`).join("")}
  <li><a href="https://github.com/claudiacava/longevity-mirna-prioritization" target="_blank" rel="noopener">Code repository (GitHub)</a></li></ul></div></div>
  <h2>How to cite</h2>
  <p>Cava C, Castiglioni I. Integrative prioritization of human longevity genes and their miRNA regulators. <em>Network Modeling Analysis in Health Informatics and Bioinformatics</em> 15:233 (2026). <a href="https://doi.org/10.1007/s13721-026-00908-y" target="_blank" rel="noopener">doi:10.1007/s13721-026-00908-y</a></p>`;
}

// ---------------- start ----------------
load().then(() => { window.addEventListener("hashchange", route); window.__route = route; route(); })
  .catch((e) => { app.innerHTML = `<div class="note"><b>The data could not be loaded.</b> ${esc(e.message)}.<br>
  Open the site through a web server from the repository root (for example <code>python -m http.server</code> and then <code>http://localhost:8000/site/</code>), not by double-clicking the file.</div>`; });
