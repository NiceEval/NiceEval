# Use Case：终端 Report 结构

## 目标

stdout 证明 Report 的领域结构与真实值，PTY 证明窄终端下的屏幕排版。两种媒介不能互相推断。

## 完整测试

```ts
// test/behavior/analyze/render-structure.test.ts
import { reportBehavior } from "../../support/behavior";
import {
  cli,
  ptyScreen,
  reportView,
  expectObserved,
} from "../../support/readback";
import {
  showsScatterAndExperimentTable,
  wrapsLongExperimentId,
} from "../../support/behaviors";

reportBehavior(showsScatterAndExperimentTable, async ({ w }) => {
  const run = await cli(
    "pnpm exec niceeval show --report reports/scatter.tsx",
    { cwd: w.consumerDir("report") },
  );
  const report = reportView(run.stdout);

  expectObserved(report.chart({ x: "Cost", y: "Pass rate" }).seriesIds())
    .toHaveSeries(["codex", "claude"]);
  expectObserved(report.table("Experiments").rowIds())
    .toShowRows(["main", "rag"]);
  expectObserved(report.table("Experiments").row("main").cell("Pass rate"))
    .toEqualValue("100%");
});

reportBehavior(wrapsLongExperimentId, async ({ w }) => {
  const screen = await ptyScreen(
    w,
    "pnpm exec niceeval show --report reports/long-id.tsx",
    { columns: 80, rows: 24 },
  );

  expectObserved(screen.rowsOccupiedBy("deliberate-error"))
    .toEqualValue(2);
  expectObserved(screen.exitCode()).toEqualValue(0);
});
```

## 边界

stdout 不断言框线、padding、字形或折行位置。PTY 不重新解析表格业务值。
需要完整有序集合时显式使用 `toShowExactRows()`；默认 `toShowRows()` 允许非契约额外项。
