# Use Case：候选包消费边界

## 目标

从外部项目 cwd 装载候选包中的内建 Report，证明 package export、JSX runtime 与真实 Record 接线正确。
组件排版和完整文案不属于这个 Behavior。

## 完整测试

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

    expectObserved(
      report.chart({ x: "Cost", y: "Pass rate" }).seriesIds(),
    ).toHaveSeries(["main"]);
    expectObserved(report.table("Attempts").rowIds())
      .toShowRows(["tool-call"]);
  });
}
```

## Recipe 与重跑

三个消费方目录由同一个 read-only recipe 准备，并各自安装同一候选 tarball。
任一 scenario 可以使用 Behavior ID 单独重跑，不重新生产 Record 或改写其它消费方。

完整 Recipe 见[测试方案的候选包消费方矩阵](../../e2e-acceptance-testing/use-case/package-consumer-matrix.md)。

## 边界

测试断言公开入口装载成功、组件被求值以及真实事实穿过包边界。
它不锁完整图表标题、方向注解措辞、DOM class 或 JSX 编译产物。
