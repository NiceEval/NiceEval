# Use Case：候选包消费方矩阵

## 目标

同一候选 tarball 在 CJS 初始化、跨 cwd Report、公开文档 example 与不安装 optional peers 的最小项目中运行。
prepare 只执行一次；这些是同一个“候选包可被真实外部项目消费”Behavior 的宿主 scenario，不各铸一个 ID。

## Recipe

```ts
// recipes/package-consumers.ts
import { defineEvidenceRecipe } from "../support/recipe";

export default defineEvidenceRecipe({
  id: "package-consumers-v1",
  version: 1,
  profile: "deterministic",
  backend: "consumer-project",
  producer: {
    module: import.meta.filename,
    export: "default",
    inputs: [
      "fixtures/foreign-report",
      "fixtures/reports/scatter.tsx",
      "fixtures/runnable-doc-example",
    ],
  },
  capabilities: ["candidate-package", "process"],
  async prepare(ctx) {
    const record = await ctx.deliberateRecord("fixtures/tool-call");
    const consumers = await Promise.all([
      ctx.consumerProject("commonjs-init", { packageType: "commonjs" }),
      ctx.consumerProject("foreign-report", {
        fixture: "fixtures/foreign-report",
        jsx: "react-jsx",
      }),
      ctx.consumerProject("runnable-doc-example", {
        fixture: "fixtures/runnable-doc-example",
      }),
      ctx.consumerProject("minimal-no-optional-peers", {
        tsconfig: false,
        omitOptionalPeers: ["dockerode", "@e2b/code-interpreter"],
      }),
    ]);

    for (const consumer of consumers) {
      await consumer.installCandidate(ctx.candidateTarball);
      if (consumer.name === "foreign-report") {
        await consumer.write("scatter.tsx", ctx.fixture("reports/scatter.tsx"));
        await consumer.cli("pnpm exec tsc --noEmit");
      }
    }

    return ctx.publishReadOnly({
      resultsRoot: record.resultsRoot,
      consumers: Object.fromEntries(
        consumers.map((consumer) => [consumer.name, consumer]),
      ),
    });
  },
});
```

## Behavior 矩阵

```ts
// test/behavior/load-report/package-consumers.test.ts
import { reportBehavior } from "../../support/behavior";
import { cli, reportView, expectObserved } from "../../support/readback";
import { loadsCandidateAcrossConsumers } from "../../support/behaviors";

reportBehavior(loadsCandidateAcrossConsumers, async ({ w }) => {
  await cli("pnpm exec niceeval init && pnpm exec niceeval list", {
    cwd: w.consumerDir("commonjs-init"),
  });

  const shown = await cli(
    `pnpm exec niceeval show --report scatter.tsx --record ${w.resultsRoot}`,
    { cwd: w.consumerDir("foreign-report") },
  );
  const report = reportView(shown.stdout);
  expectObserved(report.chart({ x: "Cost", y: "Pass rate" }).seriesIds())
    .toHaveSeries(["main"]);
  expectObserved(report.table("Attempts").rowIds())
    .toShowRows(["tool-call"]);

  const documented = await cli("pnpm tsx example.ts", {
    cwd: w.consumerDir("runnable-doc-example"),
  });
  expectObserved(documented.exitCode()).toEqualValue(0);

  const cold = await cli("pnpm exec niceeval list", {
    cwd: w.consumerDir("minimal-no-optional-peers"),
  });
  expectObserved(cold.exitCode()).toEqualValue(0);
});
```

`loadsCandidateAcrossConsumers` 是唯一 Behavior declaration，scenario 只出现在 action trace 与失败证据中。
图表标题措辞、DOM class 和 JSX 编译细节不进入预期；真实事实没有穿过候选包边界时测试才失败。

## 执行登记

```ts
registerExecution({
  behaviorId: "packages.consumer-matrix",
  cadence: "pull-request",
  resourceClass: "ordinary",
  timeoutMs: 120_000,
  releaseRisk: "候选包只在仓库 ESM 根可用，真实 CJS、跨 cwd、文档或无 optional peer 消费方会在启动前崩溃",
});
```
