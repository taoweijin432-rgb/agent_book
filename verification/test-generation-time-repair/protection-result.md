# Authorization-time repair protection verification

Baseline: [workspace-before.json](workspace-before.json), saved before edits. Existing baselines and historical reports were not regenerated or overwritten. Dependency/cache directories, .git, temporary outputs and symbolic links excluded; node_modules not traversed.

```json
{
  "baselineFiles": 379,
  "unchanged": 375,
  "changed": 4,
  "deleted": 0,
  "prototypeFiles": 247,
  "historicalVerificationFiles": 59,
  "originalTestFiles": 14,
  "docs00to15": 16,
  "migrations001to006": 6,
  "syntaxFiles": 50,
  "liveMarkdownLinksBeforeManifest": 189
}
```

- Exactly four permitted original files changed: 007, its verifier, README and DOC-16. No deletions or unauthorized additions/changes. The other 375 originals are byte-identical.
- 001-006, all 14 original tests/support files, all 13 prototypes (247 files), docs/00-15 and all 59 historical verification files retain their original file sets and SHA-256.
- Root package.json, pnpm-lock.yaml, .gitignore, both configuration examples and both user archives unchanged. No dependencies, 008, new business stage, schema or ledger added.
- Six original before-snapshots match baseline hashes. Before/after experiment migration hashes match their respective actual source. Before evidence is retained unchanged; no new evidence overwrites it.
- All 50 formal .mjs syntax checks passed. Live documentation paths/heading fragments checked; raw before/ snapshots intentionally retain their original repository-relative link base.
- Before experiment used one isolated instance; standalone after experiment used another. Final pnpm test used the usual 17 isolated instances, reused its fresh instance for 11 extra runner cases, and cleaned each owned container/anonymous volume/temp credential/result. An earlier full repair run also cleaned its own 17 instances. No global Docker cleanup; unrelated containers untouched.
- Final full run: original Node regressions pass, 11 new runner-independent cases pass, zero failed/skipped, live database logs read again after the new cases and disclosure scan zero. Failure/COMMIT/rollback/upgrade evidence retained separately.
- No Git staging, commit, push, reset, clean or remote setup. Git categories remain untracked as at start.

Scope/results: [repair-summary.md](repair-summary.md). Before proof: [before-experiment.json](before-experiment.json). Final full execution: [after/run-result.md](after/run-result.md). Deployment limits: [deployment-check.json](deployment-check.json).
