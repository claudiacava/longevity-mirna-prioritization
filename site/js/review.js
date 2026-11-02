// Generic source-review and gene-selection engine.
//
// Input : a table of association records (one row per record, any column names)
//         + an optional table of manual corrections.
// Output: a record-level audit, the counted gene-level records, gene-level
//         evidence under several selection definitions, ready for threshold
//         selection with core.js.
//
// Rules are those of R/10_longevitymap.R, made configurable:
//   * records without gene symbol or interpretable association are excluded
//   * manual corrections are applied first (exclude / reassign / replace / annotate)
//   * a record is multi-gene if it lists more than one gene AFTER corrections;
//     multi-gene records are not counted (default) or credited to every listed
//     gene (sensitivity analysis)
//   * exact duplicates (study, gene, population, association, variant) are removed
//   * one gene-study unit per gene and study, or per gene and cohort when a cohort
//     column is given (records from different studies on the same cohort are
//     then one unit); a unit with any non-significant record is non-significant
import { parseCSV } from "./core.js";

export const FIELDS = [
  { key: "gene", label: "Gene symbol(s)", required: true, hint: "One or more symbols; several genes separated by , ; | or ' / '" },
  { key: "association", label: "Association result", required: false, hint: "significant / non-significant (also yes/no, TRUE/FALSE, 1/0)" },
  { key: "pvalue", label: "P-value", required: false, hint: "Used only when no association column is given" },
  { key: "study", label: "Study (PMID, DOI or ID)", required: true, hint: "Defines gene-study units" },
  { key: "population", label: "Population", required: true, hint: "Label used for the population threshold" },
  { key: "id", label: "Record ID", required: false, hint: "Needed to apply corrections; row number otherwise" },
  { key: "variant", label: "Variant(s)", required: false, hint: "Used to detect exact duplicates" },
  { key: "cohort", label: "Cohort", required: false, hint: "Records on the same cohort form one unit even across studies" },
  { key: "evidence_type", label: "Evidence type", required: false, hint: "e.g. genetic association, expression; can be filtered" },
];

const GUESS = {
  gene: /^(genes?(\(s\))?|gene[_ .-]?symbols?|symbols?|hgnc|mapped[_ .-]?genes?)$/i,
  association: /^(association|result|significan(t|ce)|outcome|finding)$/i,
  pvalue: /^(p|p[_ .-]?val(ue)?|pval)$/i,
  study: /^(pub[_ .-]?med|pmid|study([_ .-]?id)?|doi|reference|publication|paper)$/i,
  population: /^(population|ancestry|country|ethnicity|cohort[_ .-]?population)$/i,
  id: /^(id|record[_ .-]?id|row[_ .-]?id)$/i,
  variant: /^(variants?(\(s\))?|snps?|rsid|marker)$/i,
  cohort: /^(cohort|sample|cohort[_ .-]?id|dataset)$/i,
  evidence_type: /^(evidence[_ .-]?(type|modality)|modality|data[_ .-]?type)$/i,
};

export function guessMapping(headers) {
  const m = {}, used = new Set();
  for (const f of FIELDS) {
    const h = headers.find((x) => !used.has(x) && GUESS[f.key].test(String(x).trim()));
    if (h) { m[f.key] = h; used.add(h); }
  }
  return m;
}

// ---------- reading ----------
// The delimiter (comma, semicolon as saved by Excel with Italian or other
// European settings, or tab) is detected from the header line, ignoring quoted text.
export function detectDelimiter(text) {
  const nl = text.search(/\r?\n/);
  const first = (nl < 0 ? text : text.slice(0, nl)).replace(/"[^"]*"/g, "");
  const n = (d) => first.split(d).length - 1;
  const best = ["\t", ";", ","].map((d) => [d, n(d)]).sort((a, b) => b[1] - a[1])[0];
  return best[1] ? best[0] : ",";
}
export function readTable(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseCSV(text, { raw: true, delimiter });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows, delimiter };
}
// Rows from a spreadsheet (array of arrays, first row = header)
export function tableFromArrays(aoa) {
  const [h = [], ...body] = aoa;
  const headers = h.map((x, j) => squish(x) || `column_${j + 1}`);
  const rows = body.filter((r) => r.some((c) => squish(c) !== ""))
    .map((r) => Object.fromEntries(headers.map((k, j) => [k, r[j] === undefined || r[j] === null ? "" : String(r[j])])));
  return { headers, rows, delimiter: "xlsx" };
}

export const squish = (x) => (x === null || x === undefined ? "" : String(x).replace(/\s+/g, " ").trim());
export const splitGenes = (x) => squish(x).replace(/[;|]/g, ",").split(/\s*,\s*|\s+\/\s+/).map((g) => g.trim()).filter(Boolean);
export const countryLabel = (x) => squish(String(x).replace(/\s*\([^)]*\)/g, ""));

const SIG = /^(significant|sig|yes|y|true|t|1|associated|positive|replicated)$/i;
const NON = /^(non[- ]?significant|not significant|ns|n\.s\.|no|n|false|f|0|not associated|none|null|negative)$/i;
export function interpretAssociation(v, p, alpha) {
  const s = squish(v);
  if (s) {
    if (SIG.test(s)) return "significant";
    if (NON.test(s)) return "non-significant";
    return null;
  }
  if (p !== undefined && p !== null && squish(p) !== "") {
    const x = Number(String(p).replace(",", "."));
    if (Number.isFinite(x)) return x < alpha ? "significant" : "non-significant";
  }
  return null;
}

// ---------- corrections ----------
export const CORRECTION_ACTIONS = {
  exclude: "Record not counted",
  reassign: "Gene field replaced by `genes`",
  replace: "Record replaced by one single-gene record per gene in `genes`",
  annotate: "No change to counting; note kept in the audit",
};
export const CORRECTION_COLUMNS = ["record_id", "action", "genes", "variant", "evidence_type", "population", "association", "note"];

export function readCorrections(input) {
  if (!input || (typeof input === "string" && !input.trim())) return { corrections: [], warnings: [] };
  const { rows } = typeof input === "string" ? readTable(input) : input; // text, or a table from a spreadsheet
  const warnings = [], corrections = [];
  rows.forEach((r, i) => {
    const c = Object.fromEntries(CORRECTION_COLUMNS.map((k) => [k, squish(r[k])]));
    c.action = c.action.toLowerCase();
    if (!c.record_id) return warnings.push(`Correction row ${i + 2}: no record_id`);
    if (!CORRECTION_ACTIONS[c.action]) return warnings.push(`Correction row ${i + 2}: unknown action “${c.action}”`);
    if ((c.action === "reassign" || c.action === "replace") && !splitGenes(c.genes).length)
      return warnings.push(`Correction row ${i + 2}: action ${c.action} needs genes`);
    corrections.push(c);
  });
  return { corrections, warnings };
}

// ---------- review ----------
export const DEFAULT_REVIEW = { alpha: 0.05, dedup: true };

export function review(rows, mapping, corrections = [], opts = {}) {
  const o = { ...DEFAULT_REVIEW, ...opts };
  const get = (r, k) => (mapping[k] ? squish(r[mapping[k]]) : "");
  const byId = new Map();
  for (const c of corrections) (byId.get(c.record_id) ?? byId.set(c.record_id, []).get(c.record_id)).push(c);
  const usedCorrections = new Set();
  const audit = [], counted = [], composites = [], extra = [];
  const warnings = [];

  rows.forEach((r, i) => {
    const id = mapping.id ? get(r, "id") : String(i + 1);
    const a = {
      record_id: id, row: i + 2, gene_original: get(r, "gene"), association_original: mapping.association ? get(r, "association") : get(r, "pvalue"),
      study: get(r, "study"), population: get(r, "population"), variant: get(r, "variant"), cohort: get(r, "cohort"),
      evidence_type: get(r, "evidence_type") || "genetic association",
      association: null, genes: "", n_genes: 0, status: "", action: "", note: "",
    };
    audit.push(a);
    if (mapping.id && !id) return excl(a, "missing record ID");
    a.association = interpretAssociation(get(r, "association"), mapping.pvalue ? r[mapping.pvalue] : null, o.alpha);
    let genes = splitGenes(a.gene_original);
    if (!genes.length) return excl(a, "missing gene symbol");
    if (!a.association) return excl(a, a.association_original ? `association not recognised (“${a.association_original}”)` : "missing association");
    const study = a.study || `record_${id}`;
    const base = { record_id: id, study, population: a.population, association: a.association, variant: a.variant, cohort: a.cohort, evidence_type: a.evidence_type };

    const cs = byId.get(id) || [];
    cs.forEach((c) => usedCorrections.add(c));
    const notes = cs.map((c) => c.note).filter(Boolean);
    a.note = notes.join(" · ");
    if (cs.some((c) => c.action === "exclude")) { a.genes = genes.join(","); a.n_genes = genes.length; a.status = "excluded"; a.action = "excluded by correction"; return; }
    const rep = cs.filter((c) => c.action === "replace");
    if (rep.length) {
      a.genes = genes.join(","); a.n_genes = genes.length; a.status = "replaced";
      let n = 0;
      for (const c of rep) for (const g of splitGenes(c.genes)) {
        n++;
        extra.push({ ...base, gene: g, variant: c.variant || base.variant, evidence_type: c.evidence_type || base.evidence_type,
          population: c.population || base.population, association: c.association ? interpretAssociation(c.association, null, o.alpha) || base.association : base.association,
          source: "correction" });
      }
      a.action = `replaced by ${n} single-gene record${n > 1 ? "s" : ""} (correction)`;
      return;
    }
    const re = cs.find((c) => c.action === "reassign");
    if (re) genes = splitGenes(re.genes);
    a.genes = genes.join(","); a.n_genes = genes.length;
    if (genes.length > 1) {
      a.status = "multi-gene"; a.action = `multi-gene record (${genes.length} genes) not counted${re ? " after reassignment" : ""}`;
      for (const g of genes) composites.push({ ...base, gene: g, source: "multi-gene split" });
      return;
    }
    a.status = "counted";
    a.action = re ? `reassigned to ${genes[0]} (correction)` : "counted as single-gene record";
    counted.push({ ...base, gene: genes[0], source: "record" });
  });

  for (const c of corrections) if (!usedCorrections.has(c)) warnings.push(`Correction for record “${c.record_id}” matches no valid record`);

  // exact duplicates among counted single-gene records (records first, then replacements)
  let all = [...counted, ...extra];
  const seen = new Map(), dups = [];
  if (o.dedup) {
    all = all.filter((x) => {
      const k = [x.study, x.gene, x.population, x.association, x.variant].join("\u0001");
      if (seen.has(k)) { dups.push({ ...x, duplicate_of: seen.get(k).record_id }); return false; }
      seen.set(k, x); return true;
    });
    const auditById = new Map(audit.map((a) => [a.record_id, a]));
    for (const d of dups) {
      const a = auditById.get(d.record_id);
      if (!a) continue;
      if (d.source === "record") { a.status = "duplicate"; a.action = `exact duplicate of record ${d.duplicate_of}`; }
      else a.action += `; ${d.gene} is an exact duplicate of record ${d.duplicate_of}`;
    }
  }
  for (const x of all) x.unit = x.cohort ? `cohort:${x.cohort}` : x.study;
  for (const x of composites) x.unit = x.cohort ? `cohort:${x.cohort}` : x.study;

  const status = (s) => audit.filter((a) => a.status === s).length;
  const summary = {
    rows: rows.length, valid: rows.length - status("excluded-qc"),
    excluded_qc: status("excluded-qc"), counted: status("counted"), multi_gene: status("multi-gene"),
    excluded_by_correction: status("excluded"), replaced: status("replaced"), duplicates: dups.length,
    reassigned: audit.filter((a) => a.action.startsWith("reassigned")).length,
    corrections: corrections.length, studies: new Set(audit.filter((a) => a.status !== "excluded-qc").map((a) => a.study || `record_${a.record_id}`)).size,
    populations: new Set(audit.filter((a) => a.status !== "excluded-qc").map((a) => a.population)).size,
    evidence_types: [...new Set(all.concat(composites).map((x) => x.evidence_type))],
    gene_records: all.length,
  };
  return { audit, records: all, composites, duplicates: dups, summary, warnings };

  function excl(a, why) { a.status = "excluded-qc"; a.action = `excluded: ${why}`; }
}

// ---------- gene-level evidence ----------
// def: { evidenceTypes: [..] | null, multiGene: "exclude" | "split",
//        populationLevel: "label" | "country", populationsFrom: "all" | "significant" }
export const BASE_DEF = { evidenceTypes: ["genetic association"], multiGene: "exclude", populationLevel: "label", populationsFrom: "all" };

export function geneEvidence(rev, def) {
  const d = { ...BASE_DEF, ...def };
  const keep = (x) => !d.evidenceTypes || d.evidenceTypes.includes(x.evidence_type);
  let recs = rev.records.filter(keep);
  if (d.multiGene === "split") recs = recs.concat(rev.composites.filter(keep));
  const pop = d.populationLevel === "country" ? countryLabel : (x) => x;
  const units = new Map(); // gene -> unit -> {sig, non}
  for (const x of recs) {
    const gu = units.get(x.gene) ?? units.set(x.gene, new Map()).get(x.gene);
    const u = gu.get(x.unit) ?? gu.set(x.unit, { sig: false, non: false, pops: new Set(), studies: new Set() }).get(x.unit);
    if (x.association === "significant") u.sig = true; else u.non = true;
    u.pops.add(pop(x.population)); u.studies.add(x.study);
  }
  const out = [];
  for (const [gene, gu] of units) {
    let n = 0, s = 0, mixed = 0; const popsAll = new Set(), popsSig = new Set(), studies = new Set();
    for (const u of gu.values()) {
      n++; const sig = !u.non; if (sig) s++; if (u.sig && u.non) mixed++;
      u.pops.forEach((p) => { popsAll.add(p); if (sig) popsSig.add(p); });
      u.studies.forEach((x) => studies.add(x));
    }
    const pops = d.populationsFrom === "significant" ? popsSig : popsAll;
    const prop = s / n;
    out.push({ gene, n_studies: n, n_sig_studies: s, n_nonsig_studies: n - s, n_mixed_studies: mixed, n_pop_criterion: pops.size,
      proportion_sig: prop, replication_score: Math.log2(1 + n) * (2 * prop - 1), n_publications: studies.size,
      populations: [...popsAll].sort().join("; ") });
  }
  return out.sort((a, b) => b.replication_score - a.replication_score || a.gene.localeCompare(b.gene));
}

// The five selection definitions of the article, derived from a base definition
export const VARIANTS = {
  primary: {},
  significant_populations_only: { populationsFrom: "significant" },
  country_level_labels: { populationLevel: "country" },
  significant_and_country_level: { populationLevel: "country", populationsFrom: "significant" },
  composite_records_included: { multiGene: "split" },
};
export function criteriaLong(rev, base = {}) {
  const rows = [];
  for (const [name, v] of Object.entries(VARIANTS))
    for (const g of geneEvidence(rev, { ...base, ...v })) rows.push({ ...g, analysis: name });
  return rows;
}

// ---------- helpers for downloads ----------
export function toCSV(rows, cols) {
  cols ??= rows.length ? Object.keys(rows[0]) : [];
  const q = (v) => {
    if (v === null || v === undefined) return "NA";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n") + "\n";
}
