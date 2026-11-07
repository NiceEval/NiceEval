# Case ownership

Write exactly one `// @feature docs/feature/<name>/README.md` or `// @use-case docs/feature/<name>/use-case/<name>.md` above each static test declaration. Keep natural test titles. Several tests may share one contract.

Generate markers with `concord test marker --contract <path> [--issue <issue>]`; run `concord --skill test` for marker rules, retirement with `@status retired`, and the derived references used by `concord test list/show/run`.
