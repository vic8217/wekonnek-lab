# Vertex POC Synthetic Starter Test Data

This pack contains synthetic development-only visual-search fixtures:

- 50 catalogue images
- 25 distinct customer-style query images
- hard-negative product families/variants
- a generic `dataset.synthetic.json`
- `query-review.csv` for manual ground-truth review

Important:
1. Copy `catalogue/` and `queries/` into your repo fixture directory.
2. Run your repository generator:
   `npm run visual-search:dataset -- benchmark-fixtures/vertex-poc-v1`
3. Review every generated query and populate/verify `mode`, `difficulty`, and `expectedProductIds`.
4. Validate:
   `npm run visual-search:dataset:validate -- benchmark-fixtures/vertex-poc-v1/dataset.json`
5. Do a Vertex `--dry-run` before any live external benchmark.

These images are synthetic and intended only for engineering/benchmark testing. They are not a substitute for a later benchmark using approved real merchant-style product photography.
