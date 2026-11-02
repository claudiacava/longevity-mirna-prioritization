// Checks that the browser logic reproduces the R results exactly.
// Run from the repository root:  node site/tests/validate.mjs
import { readFileSync } from "node:fs";
import { parseCSV, selectGenes, splitList, stability, indexDownstream, setKey, CRITERIA, openGenesTest } from "../js/core.js";

const read = (p) => parseCSV(readFileSync(new URL("../../results/" + p, import.meta.url), "utf8"));
const long = read("10_longevitymap/criteria_sensitivity_long.csv");
let fails = 0, checks = 0;
const same = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
function check(name, ok, detail = "") { checks++; if (!ok) { fails++; console.log("FAIL", name, detail); } }

// 1. Primary selection = 21 genes in primary_genes.txt
const primary = readFileSync(new URL("../../results/10_longevitymap/primary_genes.txt", import.meta.url), "utf8").split(/\s+/).filter(Boolean);
check("primary set", same(selectGenes(long, { criterion: "primary", minSig: 2, minPop: 2, minProp: 0.6 }), primary));

// 2. 100 threshold scenarios (genetic evidence table)
for (const s of read("11_sensitivity/threshold_scenarios_genetic.csv")) {
  const got = selectGenes(long, { criterion: "primary", minSig: s.min_sig, minPop: s.min_pop, minProp: s.min_prop });
  check(`grid ${s.min_sig}/${s.min_pop}/${s.min_prop}`, same(got, splitList(s.selected_genes)) && got.length === s.n_genes, `${got.length} vs ${s.n_genes}`);
}

// 3. Five selection criteria at default thresholds
for (const s of read("10_longevitymap/criteria_sensitivity_summary.csv")) {
  const got = selectGenes(long, { criterion: s.analysis, minSig: 2, minPop: 2, minProp: 0.6 });
  check(`criterion ${s.analysis}`, same(got, splitList(s.selected_genes)));
}

// 4. Gene stability
const stab = stability(long, "primary");
for (const g of read("11_sensitivity/gene_stability_genetic.csv"))
  check(`stability ${g.gene}`, Math.abs(stab.get(g.gene) - g.stability) < 1e-9, `${stab.get(g.gene)} vs ${g.stability}`);

// 5. Every gene list reachable from the controls on the grid has precomputed downstream results
const idx = indexDownstream(read("16_downstream_sensitivity/downstream_sensitivity_summary.csv"));
const reach = new Map();
for (const c of Object.keys(CRITERIA)) for (let a = 1; a <= 5; a++) for (let b = 1; b <= 4; b++) for (const p of [0.5, 0.6, 0.7, 0.8, 0.9]) {
  const genes = selectGenes(long, { criterion: c, minSig: a, minPop: b, minProp: p });
  if (genes.length) reach.set(setKey(genes, CRITERIA[c].universe), { c, a, b, p, n: genes.length });
}
const missing = [...reach].filter(([k]) => !idx.has(k));
const gridPrimaryMissing = missing.filter(([, v]) => v.c === "primary");
check("downstream available for every primary-grid list", gridPrimaryMissing.length === 0, gridPrimaryMissing.length + " missing");

// 6. Open Genes over-representation (unadjusted Fisher test) for the primary list
const og = openGenesTest(read("13_open_genes/gene_by_category_presence.csv"), primary);
for (const r of read("13_open_genes/open_genes_overrepresentation.csv")) {
  const m = og.find((x) => x.evidence_type === r.evidence_type);
  check(`Open Genes ${r.evidence_type}`, m && m.a === r.candidates_with_evidence && Math.abs(m.p - r.fisher_p) / r.fisher_p < 1e-6 && Math.abs(m.fdr - r.fisher_fdr) / r.fisher_fdr < 1e-6, m ? `${m.p} vs ${r.fisher_p}` : "missing");
}

console.log(`${checks - fails}/${checks} checks passed`);
console.log(`Distinct non-empty gene lists reachable from the controls: ${reach.size}; with precomputed GO/miRNA results: ${reach.size - missing.length}`);
process.exit(fails ? 1 : 0);
