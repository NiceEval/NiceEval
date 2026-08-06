# Use Case：浏览器交互

## 目标

真实 Chromium 证明过滤、参数化 target 下钻与增强 tooltip 的用户可见结果。
所有等待绑定具体状态，领域 adapter 集中拥有 selector。

## 完整测试

```ts
// test/behavior/read-report/browser-interaction.test.ts
import { expect as expectWeb } from "@playwright/test";
import { reportBehavior } from "../../support/behavior";
import { openSite } from "../../support/browser";
import { expectObserved } from "../../support/observed";
import {
  filterNarrowsRows,
  targetOpensInDialog,
  chartPointShowsTooltip,
  driveCallReturnsInlineExecution,
} from "../../support/behaviors";

reportBehavior(filterNarrowsRows, async ({ w }) => {
  await using ui = await openSite(w.exportDir("site"), {
    hosting: "directory-root",
  });
  const table = ui.table("Comparison");

  await expectWeb(table.visibleRows()).toHaveCount(3);
  await ui.filter().fill("main");
  await expectWeb(table.visibleRows()).toHaveCount(1);
  await expectWeb(table.row("main")).toBeVisible();
});

reportBehavior(targetOpensInDialog, async ({ w }) => {
  await using ui = await openSite(w.exportDir("site"), {
    hosting: "clean-url-subpath",
  });
  const target = w.target("tool-call-attempt");

  await ui.expectTargetDoc(target);
  await ui.table("Experiment").expand("main");
  await ui.table("Experiment").expand("tool-call");
  await ui.targetLink(target).click();

  await expectWeb(ui.dialog()).toBeVisible();
  await expectWeb(ui.dialog()).toHaveAttribute("data-page-id", target.pageId);
  await ui.closeDialog("escape");
  await expectWeb(ui.dialog()).not.toBeVisible();
  await expectWeb(ui.targetLink(target)).toBeFocused();
});

reportBehavior(chartPointShowsTooltip, async ({ w }) => {
  await using ui = await openSite(w.exportDir("site"), {
    hosting: "directory-root",
  });

  await ui.chartPoint({ series: "main", x: "Cost" }).hover();
  await expectWeb(ui.tooltip()).toBeVisible();
  await expectWeb(ui.tooltip()).toContainText("Pass rate");
  expectObserved(ui.consoleErrors()).toShowExactRows([]);
  expectObserved(ui.networkFailures()).toShowExactRows([]);
});

reportBehavior(driveCallReturnsInlineExecution, async ({ w }) => {
  await using ui = await openSite(w.exportDir("site"), {
    hosting: "clean-url-subpath",
  });
  await ui.targetLink(w.target("source-and-events")).click();

  const source = ui.dialog().attempt().source();
  const send = source.driveCall({
    api: "t.send",
    path: "evals/tool-call.eval.ts",
    occurrence: 1,
  });

  await send.expand();
  expectObserved(send.returned().entryKinds())
    .toShowRows(["assistant", "tool"]);
  expectObserved(send.returned().toolNames())
    .toShowRows(["get_stock_price"]);
});
```

## 边界

场景文件不出现 CSS selector、`:visible` 或固定 sleep。几何与 computed style 只有在视觉事实本身属于契约时使用 Playwright 原生读取。
`drive.expand()` 是 NiceEval dialect 的领域动作；通用 kernel 只负责点击、等待、ActionTrace 与 evidence，不认识
`t.send`。完整的两轮错挂反例与页面尾部去重归
[测试体系 Use Case](../../e2e/use-case/attempt-execution-evidence.md)，这里不复制矩阵。
全量 target census 与 hosting 代表矩阵见[测试方案用例](../../e2e/use-case/report-target-closure.md)。
