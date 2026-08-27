---
format: niceeval.memory/v1
id: restore-show-as-fixed-inspection-renderer
title: Restore show as a fixed Inspection renderer
createdAt: 2026-08-27T00:00:00+08:00
kind:
  type: decision
  state: adopted
promotions:
  - kind: feature
    current:
      - docs/feature/inspection/cli.md#niceeval-show
    history: []
---
# Restore show as a fixed Inspection renderer

## Decision

Restore `niceeval show` as a first-class English terminal read surface over fixed Inspection operations. Keep `niceeval query` machine-only JSON and keep browser `niceeval view` under Insight.

## Reversal

The selected CLI Insight design previously removed `show` to avoid a second presentation and aggregation product surface. That removal also eliminated the bounded human terminal workflow: users had to decode machine JSON or start a browser for an overview, a Run summary, or an exact Attempt diagnosis.

The adopted boundary separates the useful delivery surface from the rejected authoring system. `show` formats only named Inspection results for overview, Run, Attempt, source, and execution. Inspection remains the sole owner of membership, denominator, pass rate, score, coverage, issues, and Evidence. The renderer may sort and control width, but cannot select members or recompute business meaning.

Each projection consumes the narrow typed result of its named operation. Missing required shape is a failure; only contract-declared `null`, optional, `not-recorded`, and `partial` states receive a human fallback. This keeps schema drift observable instead of hiding it behind permissive rendering.

## Rejected restoration

This decision does not restore `show --json`, `--report`, history, stats, free statistics, Page, theme, component, renderer authoring, static export, or display-position handles such as `tN.cN` and `cmdN`. Query remains the only machine document and View remains the only browser experience.
