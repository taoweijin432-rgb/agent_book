# Test generation protection verification

Baseline: [workspace-before.json](workspace-before.json), saved before editing this task. Prior baselines and reports were not regenerated or overwritten. Excluded .git, dependency/cache directories, temporary outputs and symlinks; node_modules not traversed.

```json
{
  "baselineFiles": 361,
  "unchanged": 354,
  "changed": 7,
  "deleted": 0,
  "prototypeFiles": 247,
  "historicalVerificationFiles": 49,
  "originalTestFiles": 12,
  "docs00to15": 16,
  "migrations001to006": 6,
  "localMarkdownLinksBeforeManifest": 179,
  "syntaxFiles": 48
}
```

- Re-enumerated file set and SHA-256: 354 original files byte-identical, exactly seven permitted originals changed; no unauthorized changes/deletions/additions.
- docs/00-15, all 13 prototypes (247 files), 001-006 migrations, 12 original test/support files and 49 historical verification files remain byte-identical.
- Root .gitignore, dependency versions/lockfile, both existing configuration examples and user archive unchanged. No dependencies, prototype, duplicate business schema, identity or migration ledger introduced.
- All 48 formal .mjs files pass syntax checks. Final pnpm test exit 0: new 6 top-level / 32 subscenarios, zero failed/skipped. Existing foundation/design/context/workflow/validation/approval regressions pass at declared boundaries. Seven controls and nine expiry runner scenarios are separate counts.
- Final full run uses 17 independently named/labelled instances; each owning runner removed and confirmed absence of its own containers, anonymous volumes and temporary credentials/results. Earlier task-local debug runs also cleaned their resources; two temporary diagnostic entrypoint files removed. No global Docker cleanup.
- Local Markdown targets and heading fragments checked. File manifest includes root package.json, README and DOC-16, not just application code.
- Git status remains the same untracked project categories as before. No staging, commit, push, reset, clean, remote configuration or second repository initialization.

Actual execution/PIDs/rollback/disclosure: [run-result.md](run-result.md). Trust, state and interruption boundaries: [generation-contract.md](generation-contract.md).
