# Use Case · 浏览器交互:指名步骤与状态收敛

## 场景

report 仓库对导出站验收[交互契约](../../../engineering/testing/e2e/report.md#5-渲染面):过滤框收窄可见行、层级 Table 逐层展开、attempt locator 下钻打开详情 modal、图表点悬停出提示。
现行写法的三种反模式引发过一轮无契约变化的连环跟改(记录:[memory 条目](../../../../memory/e2e-browser-scenario-probe-loop-brittleness.md)),是[浏览器交互词表](../library.md#浏览器交互词表)的直接动机。

## 现行断言

摘自 `e2e/report/scripts/report-components/` 各 scenarios 文件:

```ts
// ① 探测循环:逐层点开「任何」未展开行,直到出现 locator
for (let depth = 0; depth < 4; depth += 1) {
  const locator = table.locator("a.niceeval-locator:visible").filter({ hasText: /^@/ }).first();
  if ((await locator.count()) > 0) { await locator.click(); /* … */ return; }
  await table.locator("details:not([open]) > summary:visible").first().click();
}

// ② 机制断言加固定 sleep:隐藏用的 class 与 100ms 都不是契约
await filter.fill("main");
await page.waitForTimeout(100);
assert.equal(await panel.locator(".niceeval-metric-table tbody tr:not(.niceeval-row-hidden)").count(), 1);

// ③ class 存在等于用户可见:证明的是类名出现,不是矩阵渲染
assert.equal(await page.locator("#tab-page-overview .niceeval-metric-matrix").count(), 1);
```

① 把「宿主缺详情页 / 层级未渲染 / 链接不可点」折叠成同一种失败:宿主报告丢失 attempt 详情页时,症状是「层级有了但点不开」,定位靠人工重放。
② 断言实现机制,且即时 `count()` 配固定 sleep 有竞态。
③ 断言不了任何用户可见效果。

## 候选写法

```ts
reportBehavior(filterNarrowsVisibleRows, async () => {
  const ui = await openSite(w.exportDir("site"));
  await ui.goto("Scoreboard");

  const table = ui.table("Comparison");
  await expect(table.visibleRows()).toHaveCount(3);   // Given:三个 experiment 全部可见
  await ui.filter().fill("main");                     // When
  await expect(table.visibleRows()).toHaveCount(1);   // Then:自动重试到收敛,无 sleep
});

reportBehavior(drillDownFromHierarchyToAttemptDialog, async () => {
  const ui = await openSite(w.exportDir("branded"));
  await ui.expectAttemptDoc(w.locator("tool-call"));  // Given:宿主导出了详情文档

  const table = ui.table("Experiment");
  await table.expand("main");                          // When:指名展开 Experiment 行
  await table.expand("tool-call");                     // 再指名展开 Eval 行
  await ui.attemptLink(w.locator("tool-call")).click();
  await expect(ui.dialog()).toBeVisible();             // Then:locator 复用详情 modal
});

reportBehavior(hoveringAChartPointShowsTheStyledTooltip, async () => {
  const ui = await openSite(w.exportDir("site"));
  await ui.goto("Scoreboard");

  await ui.chartPoint({ series: "main", x: "Cost" }).hover();
  await expect(ui.tooltip()).toBeVisible();
  await expect(ui.tooltip()).toContainText("main");
});
```

- 过滤场景:可见行数由 `visibleRows()` 单点判定加 web-first `toHaveCount` 自动重试,`:visible` 方言与 sleep 都不出现在场景文件里。
- 展开场景:路径逐层指名,每一步失败都落在自己的词上——`expand("main")` 找不到行时列出实际行,`expectAttemptDoc` 失败直指宿主报告改坏;探测循环的「折叠成一种失败」不复存在。
- ③ 不是交互场景:「矩阵渲染出来」是文档结构事实,归导出 HTML 读面:

```ts
expectObserved(ui.region("Overview").table("Matrix").rowIds()).toShowRows(["deliberate-error"]);
```

## 回归剧本

| 真实踩坑 | 现象 | 新写法在哪一步红 |
|---|---|---|
| [渲染面改类名,增强脚本静默失效](../../../../memory/enhance-hooks-rot-silently-when-renderer-renames-classes.md) | 图表点从 `.niceeval-scatter-point` 改名成 `.niceeval-chart-dot`,`enhance.js` 的选择器选不中,样式化 tooltip 从此不出现;降级形态与增强形态看着都对 | invoke 或 outcome 阶段:`chartPoint(...).hover()` 之后 `ui.tooltip()` 恒不可见,自动重试到超时后报「悬停后未出现提示元素」,步骤轨迹指到 hover 这一步 |
| [探测循环折叠失败原因](../../../../memory/e2e-browser-scenario-probe-loop-brittleness.md) | 宿主报告误删 Attempt 详情页整组,症状是「层级有了但点不开」,失败落在离病因最远的断言上 | invoke 阶段:`expectAttemptDoc()` 是第一步,宿主缺页当场红并说明缺哪个文档;展开与点击不会执行到 |

第一条还回答了那条 memory 想要的「整页体检」该长成什么样。
领域词到选择器的映射在 adapter 里单点实现,一次改名只坏一处并报出实际候选;每个增强能力(提示、过滤、展开)各有一条可见效果断言,合起来就是能持续生效的体检。
这与[类名 grep 守护的退役裁决](../../../../memory/css-classname-grep-guard-retired.md)是同一条边界:文本对得上证明不了效果生效,只有真实产物能证明。

## 边界

- **领域词负责**:寻址与前置文档存在;等待与断言直接用 Playwright web-first `expect`,adapter 不做第二层包装。
- **结构断言**:交互后的结构收敛(展开出的行、dialog 内语义块)用同一批领域词读,与导出 HTML 读面同源。
- **保留的低层断言**:计算样式结构事实与几何,[html-export](html-export.md) 的边界不变。
- **不断言**:隐藏机制的 class、内部 DOM 结构;展开状态只按公开契约声明的可访问性属性读。
- **BDD 的取舍**:场景语言用公开概念(页名、表标题、locator 文本),Given / When / Then 落在注释与断言分段;Gherkin 文本层维持[否决](../README.md#评估过不采纳的路线),定位力由步骤轨迹提供。
</content>
