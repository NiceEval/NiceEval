# Use Case：候选包消费方矩阵

## 目标

同一候选 tarball 在无 tsconfig、classic JSX 与 react-jsx 三种外部项目中装载内建 Report。
prepare 只执行一次，三个只读 Behavior 可并发和独立重跑。

## Recipe

```ts
// recipes/package-consumers.ts
import { defineEvidenceRecipe } from "../support/recipe";

export default defineEvidenceRecipe({
  id: "package-consumers-v1",
  version: 1,
  profile: "deterministic",
  capabilities: ["candidate-package", "process"],
  async prepare(ctx) {
    const record = await ctx.deliberateRecord("fixtures/tool-call");
    const consumers = await Promise.all([
      ctx.consumerProject("no-tsconfig", { tsconfig: false }),
      ctx.consumerProject("classic-jsx", { jsx: "react" }),
      ctx.consumerProject("react-jsx", { jsx: "react-jsx" }),
    ]);

    for (const consumer of consumers) {
      await consumer.installCandidate(ctx.candidateTarball);
      await consumer.write("scatter.tsx", ctx.fixture("reports/scatter.tsx"));
    }

    return ctx.publishReadOnly({
      resultsRoot: record.resultsRoot,
      consumers: Object.fromEntries(
        consumers.map((consumer) => [consumer.name, consumer.root]),
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
import { loadsBuiltInReport } from "../../support/behaviors";

for (const scenario of [
  "no-tsconfig",
  "classic-jsx",
  "react-jsx",
] as const) {
  reportBehavior(loadsBuiltInReport(scenario), async ({ w }) => {
    const run = await cli(
      `pnpm exec niceeval show --report scatter.tsx --record ${w.resultsRoot}`,
      { cwd: w.consumerDir(scenario) },
    );
    const report = reportView(run.stdout);

    expectObserved(report.chart({ x: "Cost", y: "Pass rate" }).seriesIds())
      .toHaveSeries(["main"]);
    expectObserved(report.table("Attempts").rowIds())
      .toShowRows(["tool-call"]);
  });
}
```

`loadsBuiltInReport()` 返回完整 Behavior declaration，三个 ID 分别带 scenario 后缀并绑定同一个 read-only recipe。
图表标题措辞、DOM class 和 JSX 编译细节不进入预期；真实事实没有穿过候选包边界时测试才失败。
