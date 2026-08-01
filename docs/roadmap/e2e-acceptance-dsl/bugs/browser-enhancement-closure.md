# Bug 组：浏览器增强必须证明用户动作，不能证明选择器字符串

这一组用图表 tooltip 选择器失效作正例，用同文件两段早已死亡的列表增强作反证。
它没有新增 DSL 原语：现有 `openSite()`、`chartPoint()`、`tooltip()` 和 Playwright 收敛断言已经足够。

## 正例：页面有 tooltip 元素，增强态却从不出现

fix commit `d489dfd4` 前，renderer 已把图表点类名改成 `.niceeval-chart-dot`，`enhance.js` 仍监听旧的 scatter / line point 类名。
页面保留 `<title>` 和 tooltip CSS，因此 hover 仍显示浏览器原生黄框，看起来不像完全损坏；样式化 tooltip 实际从未创建。

公开错误事实是用户 hover 数据点后看不到契约中的系列 / 横轴 / 数值提示。
类名、事件监听器和 `<title>` 搬运都只是实现手段。

fix commit 只改 JS / CSS 并记录人工 Chromium 验证，没有自动测试。
组件单元能证明 SVG 点与 `<title>` 存在，enhance 脚本也能独立加载；没有真实 hover，它们会一起绿。

```ts
reportBehavior(chartPointShowsTheStyledTooltip, async () => {
  const ui = await openSite(w.exportDir("charts"), { hosting: "directory-root" });
  const point = ui.chartPoint({ series: "main", x: "task-a" });

  await point.hover();
  await expect(ui.tooltip()).toBeVisible();
  await expect(ui.tooltip()).toContainText(["main", "task-a", "0.75"]);
});
```

失败轨迹停在“找到公开数据点 → hover → tooltip 未出现”，用户无需理解 CSS selector。
断言按 series / x 身份寻址，不按圆点位置或类名。

## 同形反证：死选择器不应该全部复活

同一修复还删除了 ExperimentList / AttemptList 的旧排序过滤代码。
这些组件已经迁到 Table 原语，对应旧 selector 全仓没有 producer；死代码里甚至有非法 `:sample`，却因为从未命中而没有抛错。

这条反证否定“遍历 enhance.js 中每个 selector，要求页面至少命中一个元素”的方案：

- 不是每个页面都应包含每种组件，会制造假红。
- 已退役能力应删除，不应为让 selector 体检变绿而补假 DOM。
- selector 命中仍不能证明 hover、过滤或排序的用户结果正确。

可复用方案是每项仍在公开契约里的增强各有一个用户动作闭环。
Table 过滤复用 `ui.filter()` 与 `visibleRows()`；tooltip 复用上面的 chart identity；退役能力不留断言。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 按公开数据身份和可见文本断言，不锁 DOM 类名与坐标 |
| 不能改断言放行 | 系列、x、值来自签入数据；不能把期望改成“存在 title” |
| 观察失败显式报错 | 数据点找不到与 hover 后 tooltip 不出现分阶段报告 |
| 用户侧直接定位 | 消息含页面、series、x、步骤轨迹、截图和浏览器错误 |
| 设施不造假 | 真实 Chromium、启用 JS、真实静态产物；不直接调用 enhance 函数 |
| 用户已有用法不改 | 用户 Report 与组件不加 test id 或内部观察点 |
