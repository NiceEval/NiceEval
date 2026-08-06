# Use Case：真实进程与机器出口

## 目标

一条 Behavior 同时观察真实 pipe、机器摘要和进程退出，证明结果折叠与交付边界之间的关系。
JSON 或 JUnit 的结构正确不能替代真实子进程完整交付。

## Recipe

```ts
// recipes/machine-output.ts
import { defineEvidenceRecipe } from "../support/recipe";

export default defineEvidenceRecipe({
  id: "machine-output-v1",
  version: 1,
  profile: "deterministic",
  backend: "consumer-project",
  producer: {
    module: import.meta.filename,
    export: "default",
    inputs: ["fixtures/retry-absorbs-failure"],
  },
  capabilities: ["candidate-package", "process"],
  async prepare(ctx) {
    const project = await ctx.consumerProject("machine-output", {
      fixture: "fixtures/retry-absorbs-failure",
    });
    await project.installCandidate(ctx.candidateTarball);
    const experiment = await project.cli(
      "pnpm exec niceeval exp retry-absorbs-failure --junit junit.xml",
    );
    const summary = await project.cli(
      "pnpm exec niceeval show retry-absorbs-failure --json",
      { pipe: true },
    );

    return ctx.publishReadOnly({
      consumers: { "machine-output": project },
      processes: { experiment },
      artifacts: {
        summary: summary.stdout.path,
        junit: project.path("junit.xml"),
      },
    });
  },
});
```

## 完整测试

```ts
// test/behavior/read-results/process-and-machine-output.test.ts
import { readFileSync } from "node:fs";
import { reportBehavior } from "../../support/behavior";
import {
  jsonSummary,
  junitReport,
  expectObserved,
} from "../../support/readback";

reportBehavior({
  id: "reports.machine-output-process-closure",
  task: {
    repository: "niceeval",
    path: "docs/feature/experiments/use-case/机器输出/CI门禁.md",
    anchor: "全流程",
  },
  contract: {
    repository: "niceeval",
    path: "docs/feature/reports/show/json.md",
    anchor: "json任何视图的结构化形态",
  },
  title: "机器摘要经真实 pipe 完整交付并与进程结果一致",
  risk: "release-blocking",
  primary: {
    layer: "e2e",
    target: {
      entry: "cli",
      observations: ["process-result", "json", "junit"],
      boundaries: ["installed-package", "real-cli"],
    },
    execution: {
      mode: "read-only",
      evidenceRecipeId: "machine-output-v1",
    },
  },
  requiredBoundaryProofs: [],
}, async ({ w }) => {
  const run = w.process("experiment");
  const summary = jsonSummary(readFileSync(w.artifact("summary"), "utf8"));
  expectObserved(summary.evalIds()).toShowExactRows(["flaky/gate"]);
  expectObserved(summary.eval("flaky/gate").verdict()).toEqualValue("passed");
  expectObserved(run.exitCode()).toEqualValue(0);

  const junit = junitReport(readFileSync(
    w.artifact("junit"),
    "utf8",
  ));
  expectObserved(junit.caseIds()).toShowExactRows(["flaky/gate"]);
  expectObserved(junit.case("flaky/gate").outcomeTag()).toEqualValue("passed");
});
```

## 区分力

- pipe 截断时 `jsonSummary()` 在 observe 阶段报告字节数、parse offset 和 stdout evidence。
- retry 后 eval 已通过但进程仍返回 1 时，exit assertion 在 outcome 阶段失败。
- JUnit 把失败误写成 error 时，按 case 身份读取的 outcome 明确失败，不靠 XML 子串猜测。

## 执行登记

```ts
registerExecution({
  behaviorId: "reports.machine-output-process-closure",
  cadence: "pull-request",
  resourceClass: "ordinary",
  timeoutMs: 90_000,
  releaseRisk: "机器出口被 pipe 截断或与最终进程 verdict 分叉时，CI 会读到不完整或相反的结果",
});
```
