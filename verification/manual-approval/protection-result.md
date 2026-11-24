# Manual approval protection verification

Baseline: [workspace-before.json](workspace-before.json), captured before this task. Existing baselines were not regenerated or overwritten. Excluded .git, node_modules, dependency caches, temporary outputs and symbolic links.

```json
{
  "baselineFiles": 347,
  "unchanged": 340,
  "changed": 7,
  "deleted": 0,
  "prototypeFiles": 247,
  "historicalVerificationFiles": 40,
  "originalTests": 10,
  "docs00to15": 16,
  "migrations001to005": 5,
  "markdownLinksBeforeManifest": 170
}
```

- All file sets and SHA-256 values re-enumerated: no unauthorized changes, deletions or additions. Only the seven explicitly permitted original files changed; 340 originals remain byte-identical.
- docs/00-15, all 13 prototypes (247 files), 001-005 migrations, 10 original test/support files and 40 historical verification files remain byte-identical.
- Root .gitignore, dependencies/lockfile, both configuration examples and user archive remain unchanged. package.json only changes the test entry. No dependencies, prototype, second schema or ledger added.
- Syntax: 41 formal .mjs files passed. Full pnpm test exit 0; standalone pnpm test:unit also passed all 7 controls. Local Markdown paths and heading fragments validated.
- All 15 final-run instances were removed by their owning runner using exact names and run labels, each confirmed absent; anonymous volumes and temporary credentials/results removed. Three task-local diagnostic entrypoints removed. No global Docker cleanup.
- No Git staging, commit, push, reset or clean. The repository remains untracked as at task start; no new repository initialized.

Execution, rollback, actual blocking PIDs and disclosure scans: [run-result.md](run-result.md). Initial failed run and repair: [approval-contract.md](approval-contract.md).
