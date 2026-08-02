# Use Case：时间线并发关系

## 目标

证明 `Experiment.maxConcurrency` 只限制自己的 Attempt，且 retry backoff 期间仍占用同一实验的闸。
测试使用公开 NDJSON 事件的身份和偏序，不以“总耗时小于多少毫秒”猜并发。

## Recipe

```ts
// recipes/timeline.ts
import { defineEvidenceRecipe } from "../support/recipe";

export default defineEvidenceRecipe({
  id: "timeline-v1",
  version: 1,
  profile: "deterministic",
  capabilities: ["candidate-package", "process"],
  async prepare(ctx) {
    const project = await ctx.consumerProject("timeline", {
      fixture: "fixtures/timeline",
    });
    const mixed = await project.cli(
      "pnpm exec niceeval exp mixed-concurrency --rerun all --json",
    );
    const retry = await project.cli(
      "pnpm exec niceeval exp retry-holds-gate --rerun all --json",
    );

    return ctx.publishReadOnly({
      artifacts: {
        mixed: mixed.stdoutPath,
        retry: retry.stdoutPath,
      },
    });
  },
});
```

## 完整测试

```ts
// test/behavior/run/timeline-concurrency.test.ts
import { readFileSync } from "node:fs";
import { runnerBehavior } from "../../support/behavior";
import { ndjsonEvents, expectObserved } from "../../support/readback";
import {
  experimentGateIsLocal,
  retryKeepsExperimentGate,
} from "../../support/behaviors";

runnerBehavior(experimentGateIsLocal, async ({ w }) => {
  const timeline = ndjsonEvents(
    readFileSync(w.artifact("mixed"), "utf8"),
  ).attemptTimeline();

  expectObserved(timeline.maxOverlap({ experiment: "serial" }))
    .toEqualValue(1);
  expectObserved(timeline.hasOverlap({
    left: { experiment: "serial" },
    right: { experiment: "parallel" },
  })).toEqualValue(true);
});

runnerBehavior(retryKeepsExperimentGate, async ({ w }) => {
  const timeline = ndjsonEvents(
    readFileSync(w.artifact("retry"), "utf8"),
  ).attemptTimeline();

  expectObserved(timeline.maxLiveAttempts({ experiment: "retry-serial" }))
    .toEqualValue(1);
  expectObserved(timeline.retryStayedWithinAttempt("retry-serial/flaky"))
    .toEqualValue(true);
});
```

## 与单元机制题的分工

E2E 只保留公开事件上的代表关系。generation、lease 写回和概率竞态的全组合由可控 barrier 单元测试证明，避免依赖机器负载碰运气。
