// Checks that the generic engine (js/review.js), applied to the raw LongevityMap
// table plus the corrections file, reproduces the R results of the article.
// Run from the repository root:  node site/tests/validate_review.mjs
import { readFileSync } from "node:fs";
import { parseCSV, selectGenes, stability, splitList, CRITERIA } from "../js/core.js";
import { readTable, guessMapping, readCorrections, review, geneEvidence, criteriaLong } from "../js/review.js";

const root = new URL("../../", import.meta.url);
const txt = (p) => readFileSync(new URL(p, root), "utf8");
const res = (p) => parseCSV(txt("results/" + p));
let checks = 0, fails = 0;
const check = (name, ok, detail = "") => { checks++; if (!ok) { fails++; console.log("FAIL", name, detail); } };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const { headers, rows } = readTable(txt("data/raw/longevity.csv"));
const mapping = guessMapping(headers);
check("column guess", mapping.gene === "Gene(s)" && mapping.association === "Association" && mapping.study === "PubMed" &&
  mapping.population === "Population" && mapping.id === "id" && mapping.variant === "Variant(s)", JSON.stringify(mapping));
const { corrections, warnings: cw } = readCorrections(txt("site/examples/longevitymap_corrections.csv"));
check("corrections read", corrections.length === 9 && !cw.length, cw.join("; "));
const rev = review(rows, mapping, corrections);
check("no warnings", !rev.warnings.length, rev.warnings.join("; "));
const S = rev.summary;
check("records read 550", S.rows === 550);
check("valid records 547", S.valid === 547, S.valid);
check("distinct studies 270", S.studies === 270, S.studies);
check("population labels 81", S.populations === 81, S.populations);
check("multi-gene after correction 63 (61 + G461, G469 replaced)", S.multi_gene + S.replaced === 63, `${S.multi_gene}+${S.replaced}`);
check("APOE reassigned 5", S.reassigned === 5, S.reassigned);
check("significant 273", rev.audit.filter((a) => a.status !== "excluded-qc" && a.association === "significant").length === 273);

// gene-level records = results/10_longevitymap/gene_level_records_all_modalities.csv
const glr = res("10_longevitymap/gene_level_records_all_modalities.csv");
check("gene-level records 484", rev.records.length === glr.length, `${rev.records.length} vs ${glr.length}`);
const key = (x) => [x.study_unit ?? x.unit, x.gene, x.population, x.association].join("|");
const r1 = rev.records.map((x) => key({ ...x, unit: x.unit.replace(/^(\d+)$/, "PMID_$1") })).sort();
const r2 = glr.map((x) => key(x)).sort();
check("gene-level records identical (unit, gene, population, result)", JSON.stringify(r1) === JSON.stringify(r2));

// gene evidence: genetic and all modalities
for (const [file, def, nUniverse, nSel] of [
  ["gene_evidence_genetic.csv", { evidenceTypes: ["genetic association"] }, 213, 21],
  ["gene_evidence_all_modalities.csv", { evidenceTypes: null }, 219, 22],
]) {
  const ref = res("10_longevitymap/" + file), got = new Map(geneEvidence(rev, def).map((g) => [g.gene, g]));
  check(`${file}: universe ${nUniverse}`, got.size === nUniverse && ref.length === nUniverse, got.size);
  let bad = 0;
  for (const r of ref) {
    const g = got.get(r.gene);
    if (!g || g.n_studies !== r.n_studies || g.n_sig_studies !== r.n_sig_studies || g.n_nonsig_studies !== r.n_nonsig_studies ||
      g.n_mixed_studies !== r.n_mixed_studies || g.n_pop_criterion !== r.n_populations || Math.abs(g.replication_score - r.replication_score) > 1e-9) {
      bad++; if (bad < 4) console.log("   ", r.gene, JSON.stringify(g), JSON.stringify(r));
    }
  }
  check(`${file}: all per-gene counts identical`, bad === 0, `${bad} genes differ`);
  const sel = selectGenes([...got.values()].map((g) => ({ ...g, analysis: "primary" })), { criterion: "primary", minSig: 2, minPop: 2, minProp: 0.6 });
  check(`${file}: ${nSel} selected`, sel.length === nSel, sel.length);
}

// five criteria and the 100-scenario grid
const long = criteriaLong(rev);
const refLong = res("10_longevitymap/criteria_sensitivity_long.csv");
for (const c of Object.keys(CRITERIA)) {
  const a = long.filter((x) => x.analysis === c), b = refLong.filter((x) => x.analysis === c);
  const m = new Map(a.map((x) => [x.gene, x]));
  const diff = b.filter((r) => { const g = m.get(r.gene); return !g || g.n_studies !== r.n_studies || g.n_sig_studies !== r.n_sig_studies || g.n_pop_criterion !== r.n_pop_criterion; });
  check(`criterion ${c}: universe ${b.length} and counts identical`, a.length === b.length && !diff.length, `${a.length} vs ${b.length}; ${diff.slice(0, 3).map((x) => x.gene).join(",")}`);
}
for (const s of res("10_longevitymap/criteria_sensitivity_summary.csv"))
  check(`criterion ${s.analysis}: selection`, same(selectGenes(long, { criterion: s.analysis, minSig: 2, minPop: 2, minProp: 0.6 }), splitList(s.selected_genes)));
let gridBad = 0;
for (const s of res("11_sensitivity/threshold_scenarios_genetic.csv"))
  if (!same(selectGenes(long, { criterion: "primary", minSig: s.min_sig, minPop: s.min_pop, minProp: s.min_prop }), splitList(s.selected_genes))) gridBad++;
check("100 threshold scenarios identical", gridBad === 0, gridBad);
const st = stability(long, "primary");
check("gene stability identical", res("11_sensitivity/gene_stability_genetic.csv").every((g) => Math.abs(st.get(g.gene) - g.stability) < 1e-9));

// generic formats: tab-separated, p-values instead of a result column, cohort column
{
  const tsv = ["SNP\tGene\tPMID\tAncestry\tP\tCohort",
    "rs1\tFOXO3\t111\tGerman\t0.001\tGEHA",
    "rs2\tFOXO3\t222\tItalian\t0.20\tGEHA",          // same cohort as above -> one mixed unit
    "rs3\tFOXO3\t333\tDanish\t1e-5\t",
    "rs4\tAPOE; TOMM40\t333\tDanish\t1e-9\t",       // multi-gene
    "rs5\tAPOE\t444\tJapanese\t0,01\t",              // decimal comma
    "rs6\t\t555\tChinese\t0.01\t"].join("\n");       // missing gene
  const t = readTable(tsv), m = guessMapping(t.headers);
  check("TSV mapping", m.gene === "Gene" && m.study === "PMID" && m.population === "Ancestry" && m.pvalue === "P" && m.cohort === "Cohort" && m.variant === "SNP", JSON.stringify(m));
  const r = review(t.rows, m, []);
  const ev = new Map(geneEvidence(r, {}).map((g) => [g.gene, g]));
  check("cohort merges studies into one unit", ev.get("FOXO3").n_studies === 2 && ev.get("FOXO3").n_sig_studies === 1 && ev.get("FOXO3").n_mixed_studies === 1, JSON.stringify(ev.get("FOXO3")));
  check("p-value with decimal comma", ev.get("APOE").n_sig_studies === 1);
  check("multi-gene excluded by default", !ev.has("TOMM40") && r.summary.multi_gene === 1);
  check("multi-gene split", geneEvidence(r, { multiGene: "split" }).some((g) => g.gene === "TOMM40"));
  check("missing gene excluded", r.summary.excluded_qc === 1);
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
