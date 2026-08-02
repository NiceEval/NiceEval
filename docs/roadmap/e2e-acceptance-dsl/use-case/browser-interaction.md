# Use Case：浏览器交互

## 目标

真实 Chromium 证明过滤、参数化 target 下钻与增强 tooltip 的用户可见结果。
所有等待绑定具体状态，领域 adapter 集中拥有 selector。

## 完整测试

```ts
// test/behavior/read-report/browser-interaction.test.ts
import { expect } from "vitest";
import { reportBehavior } from "../../support/behavior";
import { openSite } from "../../support/browser";
import { expectObserved } from "../../support/observed";
import {
  filterNarrowsRows,
  targetOpensInDialog,
  chartPointShowsTooltip,
} from "../../support/behaviors";

reportBehavior(filterNarrowsRows, async ({ w }) => {
  await using ui = await openSite(w.exportDir("site"), {
    hosting: "directory-root",
  });
  const table = ui.table("Comparison");

  await expect(table.visibleRows()).toHaveCount(3);
  await ui.filter().fill("main");
  await expect(table.visibleRows()).toHaveCount(1);
  await expect(table.row("main")).toBeVisible();
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

  await expect(ui.dialog()).toBeVisible();
  await expect(ui.dialog()).toHaveAttribute("data-page-id", target.pageId);
  await ui.closeDialog("escape");
  await expect(ui.dialog()).not.toBeVisible();
  await expect(ui.targetLink(target)).toBeFocused();
});

reportBehavior(chartPointShowsTooltip, async ({ w }) => {
  await using ui = await openSite(w.exportDir("site"), {
    hosting: "directory-root",
  });

  await ui.chartPoint({ series: "main", x: "Cost" }).hover();
  await expect(ui.tooltip()).toBeVisible();
  await expect(ui.tooltip()).toContainText("Pass rate");
  expectObserved(ui.consoleErrors()).toShowExactRows([]);
  expectObserved(ui.networkFailures()).toShowExactRows([]);
});
```

## 边界

场景文件不出现 CSS selector、`:visible` 或固定 sleep。几何与 computed style 只有在视觉事实本身属于契约时使用 Playwright 原生读取。
全量 target census 与 hosting 代表矩阵见[测试方案用例](../../e2e-acceptance-testing/use-case/report-target-closure.md)。
