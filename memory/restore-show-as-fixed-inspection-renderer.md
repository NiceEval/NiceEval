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

Restore `niceeval show` as a first-class English terminal read surface over fixed Inspection operations. Keep `niceeval query` as the only JSON surface and keep browser `niceeval view` under Insight.

The adopted command surface is closed: default Overview, repeatable exact `--run`, repeatable exact `--experiment`, and one exact `@<locator>`. An Attempt locator supports the default outline plus `--source`, `--execution [--expand <stable-id>]`, `--timing`, `--usage`, and `--diff`.

## Reversal

The selected CLI Insight design previously removed `show` to avoid a second presentation and aggregation product surface. That removal also eliminated the bounded human terminal workflow: users had to decode machine JSON or start a browser for an overview, a Run summary, or an exact Attempt diagnosis.

The adopted boundary separates the useful delivery surface from the rejected authoring system. `show` formats only named Inspection results for Overview, Experiment, Run, Attempt, source, execution, timing, usage, and diff. Inspection remains the sole owner of selection, membership, denominator, pass rate, score, coverage, issues, timing, usage, diff, and Evidence. The renderer may apply stable ordering and control width, but cannot select members or recompute business meaning.

Exact Experiment selection belongs to `experiment.get`; the CLI cannot filter an Overview result. Attempt timing, usage, and diff likewise belong to `attempt.timing`, `attempt.usage`, and `attempt.diff`. Execution expansion accepts only an `itemId`, `toolOccurrenceId`, or `commandId` exposed by the outline and delegates the exact selection to `attempt.trace.detail`.

`attempt.usage` owns typed input/output token, request, and cost totals together with each total's state and coverage. Show renders those totals and never aggregates them from usage observations or fills missing evidence with zero.

Each projection consumes the narrow typed result of its named operation. Missing required shape is a failure; only contract-declared `null`, optional, `not-recorded`, and `partial` states receive a human fallback. This keeps schema drift observable instead of hiding it behind permissive rendering.

## Rejected restoration

This decision does not restore `show --json`, `--report`, history, stats, fresh, grep, free statistics, Page, theme, component, renderer authoring, static export, or display-position handles such as `tN.cN` and `cmdN`. It also does not add locator handling to `niceeval view`. Query remains the only machine document and View remains the only browser experience.
