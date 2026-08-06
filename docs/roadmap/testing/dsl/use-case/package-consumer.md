# Use Case：候选包消费边界

## 目标

从外部项目 cwd 装载候选包中的内建 Report，证明 package export、JSX runtime 与真实 Record 接线正确。
组件排版和完整文案不属于这个 Behavior。

## 测试正文中的领域观察

```ts
// test/behavior/load-report/package-consumers.test.ts
import { reportBehavior } from "../../support/behavior";
import { cli, reportView, expectObserved } from "../../support/readback";
import { loadsCandidateAcrossConsumers } from "../../support/behaviors";

reportBehavior(loadsCandidateAcrossConsumers, async ({ w }) => {
  const run = await cli(
    `pnpm exec niceeval show --report scatter.tsx --record ${w.resultsRoot}`,
    { cwd: w.consumerDir("foreign-report") },
  );
  const report = reportView(run.stdout);

  expectObserved(
    report.chart({ x: "Cost", y: "Pass rate" }).seriesIds(),
  ).toHaveSeries(["main"]);
  expectObserved(report.table("Attempts").rowIds())
    .toShowRows(["tool-call"]);
});
```

## Recipe 与重跑

CJS、foreign Report、公开 example 与 optional-peer 冷路径目录由同一个 read-only recipe 准备，并各自安装同一
候选 tarball。它们共用一个 Behavior ID；本篇只展示 Report 领域观察，其余动作见完整 Recipe / Behavior。

完整 Recipe 见[测试方案的候选包消费方矩阵](../../e2e/use-case/package-consumer-matrix.md)。

## 边界

测试断言公开入口装载成功、组件被求值以及真实事实穿过包边界。
它不锁完整图表标题、方向注解措辞、DOM class 或 JSX 编译产物。
