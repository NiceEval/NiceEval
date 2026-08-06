# Bug 组：展示迁移不能重新发明公开计算口径

这一组用 RunOverview 通过率漂移作正例，用失败原因优先级与组摘要丢失作同形反证。
它挑战的不是 DOM，而是“页面仍能渲染合理数字时，领域事实是否仍与既有契约相同”。

## 正例：两级聚合被偷换成 attempt 原始比例

视觉迁移 commit `d0b6718` 把旧 view 迁入通用双面 Report 后，RunOverview 在渲染层用
`passed / (passed + failed + errored)` 现场重算通过率。
旧公开口径则按 eval × snapshot 分桶，桶内计算 attempt 均值，再跨桶平均；attempt 数不同或含
partial credit 时，两者不同。页面没有崩，只显示了一个看似合理的错误百分比。

fix commit `f98713ae` 让 `compute.ts` 预先产出唯一 `MetricCell`，web / text 只显示它。
修复测试刻意构造三个彼此不同的答案：官方两级聚合 `5/6 = 83.3%`、attempt 原始比例 `3/4 = 75%`、
eval 折叠投票 `2/2 = 100%`。这个非对称 fixture 是区分力，不是大 snapshot。

用户侧验收复用已有真实 `cli()`、短文本 scrubbed golden 与浏览器领域寻址。
recipe 使用只包含官方 RunOverview 的小 Report，让逐字承诺面保持窄稳：

```ts
reportBehavior(overviewUsesDeclaredTwoLevelPassRate, async () => {
  const stdout = (await cli(
    "pnpm exec niceeval show formula-fixture --report overview-only.tsx",
  )).stdout;
  const browser = await openSite(w.exportDir("formula-site"));

  expectObserved(stdout).toMatchScrubbedFileSnapshot("golden/two-level-pass-rate.txt");
  await expectWeb(browser.getByText("83.3%", { exact: true })).toBeVisible();
  await expectWeb(browser.getByText("4/5", { exact: true })).toBeVisible();
});
```

验收题把 fixture 输入和独立推导写在题面；候选实现不能导出自己的 `passRate` helper 给 oracle。
若要改变契约，必须先改公开计算说明与验收题的公式身份，不能只把 `83.3%` 改成页面当前数字。

## 同形反证：失败原因和组摘要也被展示层重算或漏算

同一次迁移还发生两条同形旧 bug：

- 原口径是 `error → skipReason → 所有失败 gate（保持声明顺序）`，soft 不决定 verdict；新组件却先取
  第一条失败断言，连 soft 也会抢占 error。
- 组级通过率、失败 / 错误数、总成本和最后运行时间没有迁入新组件，信息完整消失。

`f98713ae` 提炼 `reasonFor()` / `failingGateAssertions()` 和 `GroupSummaryData`，让 MetricTable、
CaseList、official report 与双面 renderer 共用同一计算层。修复测试分别用“同时含 error、两个 gate、
一个 soft”的非对称 result，以及跨 experiment 同名 eval、不同 attempt 数、null cost 和全 skipped
组来排除貌似合理的错误公式。

仍只需要既有 `table()` / `row()` / `cell()`、summary metric 与跨表面 `toEqualObserved()`：

```ts
const row = stdout.table("Cases").row("algebra/x");
expectObserved(row.cell("Reason").text()).toEqualValue("adapter crashed");

expectObserved(groupOnlyStdout).toMatchScrubbedFileSnapshot("golden/group-summary.txt");
await expectWeb(groupBrowser.getByText("33.3%", { exact: true })).toBeVisible();
await expectWeb(groupBrowser.getByText("$0.70", { exact: true })).toBeVisible();
```

不增加 `summary()`、`computedPassRate()`、`firstFailure()` 或 hierarchy 专用 matcher。
`f1f4efd6` 的层级 record 裁决也说明同一边界：投影决定每层公开 Cell，Table renderer 不根据行层级
猜一个新的 `k/n 通过` 形态；现有 Cell 读面已足够。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 断领域 metric / cell 与精确值，不锁 DOM class、布局、字形或附带文案 |
| 不能改断言放行 | 每题使用能区分至少三种候选公式的输入，并在题面写独立推导和公式身份 |
| 观察失败显式报错 | summary、row、cell 缺失与值错误分开；跨面不一致单独报告 |
| 用户侧直接定位 | 消息列 fixture 输入、独立推导、实际 text / web 值和领域路径 |
| 设施不造假 | oracle 不 import 候选 compute；stdout 与浏览器各自解析公开输出 |
| 用户已有用法不改 | 复用既有结果、官方 Report 和公开 show / view；不改 Eval 或结果 schema |
