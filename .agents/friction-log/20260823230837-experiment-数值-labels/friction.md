---
title: 'Experiment 数值 labels 使 plan 退化为 [object Object]'
severity: 'major'
---

## Expected Behavior

`defineExperiment({ labels: { rank: 0 } })` matches the documented and typed `Record<string, string | number>` contract. `niceeval exp <id> --dry` should plan successfully and persist or normalize the numeric coordinate.

## Current Behavior

`niceeval exp list` discovers and prints the numeric label, but `niceeval exp <id> --dry` fails during planning with only `ExperimentHostError: [object Object]`. Replacing the number with an equivalent string makes the same experiment plan and run.

## Possible Solution

Close numeric labels consistently at the Runner-to-Record boundary, and preserve the structured typed failure when the host maps planning errors so invalid input never degrades to `[object Object]`.

## Minimal Reproducible Example

```ts
export default defineExperiment({
  agent: deterministicAgent,
  labels: { rank: 0 },
  evals: ["states/pass"],
});
```

Run `niceeval exp <experiment-id> --dry`. The current candidate rejects the numeric label even though `packages/niceeval/src/runner/types.ts` and `docs/feature/experiments/README.md` allow it. Change `rank` to `"0"`; planning succeeds.

## Context

Building the deterministic Report preview fixture hit this at the first clean plan. The string workaround is safe for that fixture, but the contract mismatch and opaque error made a valid public Experiment shape unusable and substantially harder to diagnose.
