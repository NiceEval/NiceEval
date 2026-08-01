# Bug 组：基础函数正确不代表宿主组合正确

fix commit `1d2fb08e` 同时修复两个真机冒烟缺陷。
两例的底层单元都已经绿，错误发生在把底层能力接进 Sample 与 Report host 的地方。

## 正例：精确 experiment id 被扩成三个变体

`matchExperimentSelector` 已有单测证明精确 id 优先于同前缀变体。
`Sample.scope()` 却把每个候选 id 单独交给 selector；函数看不到完整候选全集，精确优先规则永远无法生效。

真实静态导出把 `compare/codex-gpt-5.6-luna` 窄化为它自身、`--mempal` 与 `--nowledge` 三个实验。
`ExperimentDetails` 随后报「需要一个实验，实际三个」。
fix 对全集一次性求匹配集合，但 commit 未新增测试。

用户侧 proof 不需要知道 `Sample.scope()`。
它只从公开 Report 入口选择一个已知精确实验，并断领域身份集合不多不少。

```ts
reportBehavior(exactExperimentWinsOverVariants, async () => {
  const { stdout } = await cli(
    "pnpm exec niceeval show --report standard --exp compare/codex-gpt-5.6-luna",
  );
  const report = reportView(stdout);
  expectObserved(report.experimentIds()).toShowExactRows(["compare/codex-gpt-5.6-luna"]);
});
```

## 同形反证：host 使用另一份 locator 查询实现

同一 commit 的第二个 bug 中，record 单元已证明 `resolveLocator()` 能定位历史与多实验 attempts。
Report host 却委托给 `dist/report` 编译单元中的另一份查询实现；WeakMap 索引按 results 对象身份挂在 raw src 模块实例，换实例必然 not found。

真机 `show @<locator> --report standard` 暴露问题。
这再次证明「给基础函数补更多单元」不能覆盖宿主组合；需要从真实 package entry 做 locator 往返。

```ts
reportBehavior(reportHostConsumesRecordLocator, async () => {
  const locator = w.locator("tool-call");
  const { stdout } = await cli(`pnpm exec niceeval show ${locator} --report standard`);
  const report = reportView(stdout);
  expectObserved(report.attempt(locator).evalId()).toEqualValue("tool-call");
});
```

两条案例共用现有 `cli()`、consumer world 与领域身份查询，没有新增 matcher。
新增的是缺陷形态：组合层必须用至少一个真实入口 proof 闭合，不能因参与组合的基础函数各自有单元就省略。

## 六项检查

| 检查 | 结论 |
|---|---|
| 契约不变不误红 | 精确集合只锁 experiment identity；locator proof 只锁对应 attempt，不锁完整渲染文案 |
| 不能改断言放行 | 精确选择不能改成有序子序列；locator 值来自实际 producer，不能换一个较新的 locator 绕过 |
| 观察失败显式报错 | CLI 崩溃在 invoke；候选集合错误或 attempt 缺失在 observe / outcome |
| 用户侧直接定位 | 失败列 selector、候选全集、实际命中，或 producer / consumer module identities 与 locator |
| 设施不造假 | 命令从 consumer 的候选包入口执行；world 锁定 producer symbol closure |
| 用户已有用法不改 | 复用精确 `--exp` 与 `show @locator --report`；不要求报告作者加探针 |
