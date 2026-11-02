// Core logic shared by the website and the validation tests.
// It reads the pipeline outputs in results/ unchanged and reproduces the
// gene-selection rule of R/10_longevitymap.R (select_genes) and
// R/11_threshold_sensitivity.R in the browser.

export const CRITERIA = {
  primary: {
    label: "Primary definition",
    help: "Source-reviewed genetic records; any population label counts towards the population threshold.",
    universe: "213 source-reviewed genes",
  },
  significant_populations_only: {
    label: "Only populations with significant results",
    help: "Population labels are counted only from gene-study units that were significant.",
    universe: "213 source-reviewed genes",
  },
  country_level_labels: {
    label: "Country-level population labels",
    help: "Sub-national qualifiers in brackets are removed, e.g. “Italian (Sicily)” counts as “Italian”.",
    universe: "213 source-reviewed genes",
  },
  significant_and_country_level: {
    label: "Significant populations, country level",
    help: "Both restrictions above together.",
    universe: "213 source-reviewed genes",
  },
  composite_records_included: {
    label: "Composite multi-gene records included",
    help: "The 61 composite records excluded during source review are split and every listed gene is credited.",
    universe: "composite-records universe",
  },
};

export const DEFAULTS = { criterion: "primary", minSig: 2, minPop: 2, minProp: 0.6 };
export const GRID = { minSig: [1, 5], minPop: [1, 4], minProp: [0.5, 0.9] };

// ---------- CSV parsing (RFC 4180, quoted fields) ----------
export function parseCSV(text, { raw = false, delimiter = "," } = {}) {
  const rows = [];
  let row = [], field = "", i = 0, q = false;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() || []).map((h, j) => (raw ? (h.trim() || `column_${j + 1}`) : h));
  return rows
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => Object.fromEntries(header.map((h, j) => [h, raw ? (r[j] ?? "") : convert(r[j])])));
}

function convert(v) {
  if (v === undefined || v === "NA" || v === "") return null;
  if (v === "TRUE") return true;
  if (v === "FALSE") return false;
  if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return Number(v);
  return v;
}

export const splitList = (s, sep = /;\s*/) =>
  s === null || s === undefined || s === "" ? [] : String(s).split(sep).map((x) => x.trim()).filter(Boolean);

// ---------- Selection ----------
// Same rule as R: n_sig >= minSig & n_pop >= minPop & proportion >= minProp - 1e-9
export function isSelected(g, t) {
  return g.n_sig_studies >= t.minSig && g.n_pop_criterion >= t.minPop &&
    g.proportion_sig >= t.minProp - 1e-9;
}

export function selectGenes(criteriaLong, t) {
  return criteriaLong
    .filter((g) => g.analysis === t.criterion && isSelected(g, t))
    .map((g) => g.gene)
    .sort();
}

// Key used to look up gene sets whose downstream analyses were precomputed
// (results/16_downstream_sensitivity). The GO universe differs for the
// composite-records criterion, so it is part of the key.
export function setKey(genes, universe) {
  return universe + "|" + [...genes].sort().join(";");
}

export function indexDownstream(summary) {
  const idx = new Map();
  for (const s of summary) idx.set(setKey(splitList(s.genes), normaliseUniverse(s.background)), s);
  return idx;
}

export function normaliseUniverse(bg) {
  return /composite/i.test(bg) ? "composite-records universe" : "213 source-reviewed genes";
}

// Gene stability under the 100-scenario grid, for any criterion
export function stability(criteriaLong, criterion) {
  const out = new Map();
  const sigs = range(1, 5), pops = range(1, 4), props = [0.5, 0.6, 0.7, 0.8, 0.9];
  const total = sigs.length * pops.length * props.length;
  for (const g of criteriaLong.filter((x) => x.analysis === criterion)) {
    let n = 0;
    for (const s of sigs) for (const p of pops) for (const q of props)
      if (isSelected(g, { minSig: s, minPop: p, minProp: q })) n++;
    out.set(g.gene, n / total);
  }
  return out;
}

export const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------- Fisher's exact test, one-sided (alternative = "greater", as in R/13_open_genes.R) ----------
const lf = [0];
function logFact(n) { for (let i = lf.length; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i); return lf[n]; }
function logHyper(a, r1, c1, n) { // P(X = a), r1 row total, c1 col total, n total
  return logFact(r1) + logFact(n - r1) + logFact(c1) + logFact(n - c1) -
    logFact(n) - logFact(a) - logFact(r1 - a) - logFact(c1 - a) - logFact(n - r1 - c1 + a);
}
// a: selected with evidence, b: selected without, c: others with, d: others without
export function fisherGreater(a, b, c, d) {
  const r1 = a + b, c1 = a + c, n = a + b + c + d, hi = Math.min(r1, c1);
  let p = 0;
  for (let x = a; x <= hi; x++) p += Math.exp(logHyper(x, r1, c1, n));
  return Math.min(1, p);
}

// Benjamini-Hochberg adjustment
export function bh(ps) {
  const n = ps.length, o = ps.map((p, i) => [p, i]).sort((x, y) => y[0] - x[0]);
  const out = new Array(n); let m = 1;
  o.forEach(([p, i], k) => { m = Math.min(m, (p * n) / (n - k)); out[i] = m; });
  return out;
}

// Open Genes evidence among the selected genes versus the other genes of the universe
export function openGenesTest(presence, selected) {
  const sel = new Set(selected), types = [...new Set(presence.map((r) => r.evidence_type))];
  const rows = types.map((t) => {
    const rs = presence.filter((r) => r.evidence_type === t);
    const a = rs.filter((r) => sel.has(r.gene) && r.evidence_present).length;
    const b = rs.filter((r) => sel.has(r.gene) && !r.evidence_present).length;
    const c = rs.filter((r) => !sel.has(r.gene) && r.evidence_present).length;
    const d = rs.filter((r) => !sel.has(r.gene) && !r.evidence_present).length;
    return { evidence_type: t, a, b, c, d, p: a + b ? fisherGreater(a, b, c, d) : null };
  });
  const valid = rows.filter((r) => r.p !== null), fdr = bh(valid.map((r) => r.p));
  valid.forEach((r, i) => (r.fdr = fdr[i]));
  return rows;
}
