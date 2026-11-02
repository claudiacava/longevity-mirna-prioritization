# Longevity Evidence Explorer (website prototype)

Static website that reads the pipeline outputs in `../results/` **without any conversion** and
lets users explore the source review, the gene selection and its robustness.

## Pages

| Page | Content |
|---|---|
| Overview | Key numbers, pipeline steps, primary gene list, main findings, limits of the evidence |
| Explore selection | Criterion selector and three threshold sliders; the gene list, comparison with the primary list, gene-level table and downstream results update live; the state is kept in the URL (shareable link) |
| Genes | All 213 genes of the LongevityMap universe and the 57 Open Genes candidates |
| Gene page (`#gene/APOE`) | Selection under each criterion, grid stability, counted gene-study units with PMIDs, records not counted and why, Open Genes evidence, validated miRNA interactions |
| Source review | Decisions on multi-gene records, LMNA cohort overlap, filterable record-level audit |
| Analyse your data (`#analyse`) | Generic version of the method for any table of association records: column mapping, corrections table (`exclude`, `reassign`, `replace`, `annotate`), record-level audit, gene-study units (optionally by cohort), selection, 100-combination grid, five alternative definitions, comparison with a reference list, exports and a settings file that reloads the analysis. Runs entirely in the browser |
| Data & methods | Sources and versions, how the site works, validation, limitations, downloads |

## What is computed in the browser and what is precomputed

- **Computed live** (`js/core.js`): gene selection for any criterion and thresholds (same rule as
  `select_genes()` in `R/10_longevitymap.R`), grid stability, and the one-sided Fisher test for
  Open Genes evidence (same as `R/13_open_genes.R`).
- **Looked up**: GO and miRNA results from `results/16_downstream_sensitivity/`, available for the
  lists produced by the threshold grid (primary criterion) and by each criterion at default
  thresholds (33 of the 77 distinct lists reachable with the controls).

## Tests

From the repository root:

```
node site/tests/validate.mjs   # browser logic vs R outputs: 326 checks
node site/tests/validate_review.mjs  # generic engine on raw LongevityMap + corrections = article results: 36 checks
node site/tests/smoke.mjs      # renders every page with the real data, reports runtime errors
```

## View it locally

The pages load CSV files, so they must be served over HTTP (double-clicking `index.html` does not work).
From the repository root, either

```
python -m http.server 8000
```

or, in R, `servr::httd(".", port = 8000)`; then open <http://localhost:8000/site/>.

## Publish on GitHub Pages

Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`. The site is then at
`https://<user>.github.io/<repository>/site/`.

## Generic analysis: input format

One row per reported association. Required: gene symbol(s), study (PMID, DOI or ID), population,
and either an association result (significant / non-significant, yes/no, TRUE/FALSE, 1/0) or a P-value.
Optional: record ID (needed for corrections), variant, cohort, evidence type.
Templates: `examples/template_records.csv`, `examples/template_corrections.csv`.

`examples/longevitymap_corrections.csv` encodes the manual source-review decisions of the article
(five APOE alias corrections, G461, G469, G412, G440). Applied to `data/raw/longevity.csv` it reproduces
the article exactly; without it the same table gives 22 genes selected out of 214.
