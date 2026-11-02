# Integrative prioritization of human longevity genes and their miRNA regulators

R code and data to reproduce the analyses, figures and supplementary tables of:

Cava C, Castiglioni I. Integrative prioritization of human longevity genes and their miRNA regulators. *Network Modeling Analysis in Health Informatics and Bioinformatics* 15:233 (2026). https://doi.org/10.1007/s13721-026-00908-y

## Website

**Longevity Evidence Explorer**: https://claudiacava.github.io/longevity-mirna-prioritization/

An interactive, static website (folder `site/`) that reads the files in `results/` unchanged. It lets you
inspect the source review record by record, change the selection thresholds and criteria and see the gene
list and the downstream GO, Open Genes and miRNA results update, and apply the same procedure to your own
table of association records (CSV or Excel; data are processed in the browser and not uploaded).
See `site/README.md` for details and validation tests.

The analysis code, data and results in this repository are those of the published article; the website
was added afterwards and does not change them.

## Requirements

- R >= 4.3 (analyses were run with R 4.5.1)
- CRAN: readr, dplyr, tidyr, stringr, purrr, tibble, ggplot2, scales, patchwork, broom, jsonlite, openxlsx
- Bioconductor: AnnotationDbi, org.Hs.eg.db, GO.db, clusterProfiler, enrichplot, multiMiR

`R/00_setup.R` installs missing packages. The versions used are listed in `results/package_versions.csv` and `results/sessionInfo.txt`.

## Usage

Open R in this folder and run:

```r
source("run_all.R")
```

The scripts can also be run one at a time, in the order listed below. Each step writes its output to `results/`, and a log of the run is saved in `results/run_log_*.txt`.

## Input data

| File | Source | Retrieved |
|---|---|---|
| `data/raw/longevity.csv` | LongevityMap Build 3, Human Ageing Genomic Resources (https://genomics.senescence.info/longevity/) | July 2026 |
| `data/raw/open_genes/` | Open Genes API (https://open-genes.com), six datasets; see `open_genes_download_manifest.csv` | 24 July 2026 |
| `data/raw/multimir/multimir_validated_interactions.csv.gz` | multiMiR 1.30.0, database 2.4.0 (miRTarBase 9, TarBase v9, miRecords 4), validated interactions | October 2026 |
| `data/derived/doi_to_pmid_map.csv` | DOI to PMID conversion through the Europe PMC REST API | July 2026 |

Copies of the external data are included so that the results can be reproduced exactly; please cite the original resources when using them. To work with the current versions instead, set `FORCE_DOWNLOAD <- TRUE` in `R/01_download_open_genes.R` and delete `data/raw/multimir/multimir_validated_interactions.csv.gz`. Results may then differ from those reported in the article.

## Scripts

| Script | Description | Output |
|---|---|---|
| `R/config.R` | Paths, analysis parameters and shared functions | |
| `R/00_setup.R` | Package installation and session information | `results/` |
| `R/01_download_open_genes.R` | Open Genes download (skipped if the files are present) | `data/raw/open_genes/` |
| `R/02_map_doi_to_pmid.R` | DOI to PMID mapping for Open Genes publications | `data/derived/` |
| `R/10_longevitymap.R` | Quality control, source review, gene-level evidence, candidate selection and alternative selection criteria | Supplementary 1-2 |
| `R/11_threshold_sensitivity.R` | 100 threshold combinations and gene stability | Supplementary 3, Figure 2 |
| `R/12_go_enrichment.R` | GO Biological Process enrichment, direct-annotation and leave-region-out analyses | Supplementary 4 |
| `R/13_open_genes.R` | Open Genes reconciliation, over-representation and additional candidates | Supplementary 5, Figure 3 |
| `R/14_multimir_query.R` | multiMiR query (skipped if the interaction table is present) | `data/raw/multimir/` |
| `R/15_mirna_analysis.R` | miRNA rankings, assay-restricted analysis and coverage-matched null comparison | Supplementary 6-7, Figure 4 |
| `R/16_downstream_sensitivity.R` | GO and miRNA analyses repeated for each alternative candidate gene list | Supplementary 3 |
| `R/20_figures.R` | Figures 1-4 and Supplementary 7 (PNG, TIFF, PDF) | `figures/` |
| `R/21_supplementary_tables.R` | Supplementary tables (Excel) | `supplementary/` |

All analysis parameters (selection thresholds, GO term sizes, number of random gene sets, random seed) are defined in `R/config.R`.

## Licence

Code: MIT licence (see `LICENSE`). Data obtained from LongevityMap, Open Genes and multiMiR remain subject to the terms of the original resources.

## Contact

Claudia Cava, University School for Advanced Studies IUSS Pavia
