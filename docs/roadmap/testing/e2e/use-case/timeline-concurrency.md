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
  backend: "consumer-project",
  producer: {
    module: import.meta.filename,
    export: "default",
    inputs: ["fixtures/timeline"],
  },
  capabilities: ["candidate-package", "process"],
  async prepare(ctx) {
    const project = await ctx.consumerProject("timeline", {
      fixture: "fixtures/timeline",
    });
    await project.installCandidate(ctx.candidateTarball);
    const mixed = await project.cli(
      "pnpm exec niceeval exp mixed-concurrency --rerun all --json",
    );
    const retry = await project.cli(
      "pnpm exec niceeval exp retry-holds-gate --rerun all --json",
    );

    return ctx.publishReadOnly({
      artifacts: {
        mixed: mixed.stdout.path,
        retry: retry.stdout.path,
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
import { schedulerTimelineClosure } from "../../support/behaviors";

runnerBehavior(schedulerTimelineClosure, async ({ w }) => {
  const mixed = ndjsonEvents(
    readFileSync(w.artifact("mixed"), "utf8"),
  ).attemptTimeline();

  expectObserved(mixed.maxOverlap({ experiment: "serial" }))
    .toEqualValue(1);
  expectObserved(mixed.hasOverlap({
    left: { experiment: "serial" },
    right: { experiment: "parallel" },
  })).toEqualValue(true);

  const retry = ndjsonEvents(
    readFileSync(w.artifact("retry"), "utf8"),
  ).attemptTimeline();

  expectObserved(retry.maxLiveAttempts({ experiment: "retry-serial" }))
    .toEqualValue(1);
  expectObserved(retry.retryStayedWithinAttempt("retry-serial/flaky"))
    .toEqualValue(true);
});
```

## 与单元机制题的分工

E2E 只保留公开事件上的代表关系。generation、lease 写回和概率竞态的全组合由可控 barrier 单元测试证明，避免依赖机器负载碰运气。

## 执行登记

```ts
registerExecution({
  behaviorId: "runner.scheduler-timeline-closure",
  cadence: "pull-request",
  resourceClass: "ordinary",
  timeoutMs: 90_000,
  releaseRisk: "实验闸错误跨实验串行或 retry 提前放闸时，运行吞吐与并发上限会同时失真",
});
```
