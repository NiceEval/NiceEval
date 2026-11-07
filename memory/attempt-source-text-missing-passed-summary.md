# AttemptSource text 面全通过时不显示 passed 计数

## 现象

`docs/feature/reports/show/attempt.md`（正文，`AttemptSource` 一节）明确写着：

> 全通过的断言只在没有失败可看时才会出现，且只按 group 折成 `✓ passed · <group> · <count>` 一行，不逐条展开。

但 `src/report/components/attempt-detail/faces.ts` 的 `attemptSourceText` 实现只做了：

```ts
const failed = data.lines.flatMap((line) => line.assertions.filter((a) => a.outcome !== "passed"));
const lines = failed.map((a) => `  ${assertionLine(a)}`);
```

只输出非 passed 断言的行，全通过时 `failed` 数组为空、整个 assertions 区块因此没有任何输出——不是文档要求的 `✓ passed · <group> · <count>` 摘要行，而是彻底的空白。

对比：`attemptAssertionsText`（`AttemptSource` 不可用时的降级路径）确实为 `passedGroups` 各输出一行 `✓ passed · <group> · <count>`，行为正确；只有 `attemptSourceText` 这条路径缺了这一步。

## 根因

`AttemptSourceData` 没有携带 `passedGroups` 这类聚合摘要——它只有逐行的 `assertions` 数组（挂在源码行上）。`attemptSourceText` 要计算"全通过时的 group 摘要"需要额外从 `data.lines` 里把全部断言摊平、按 outcome 分组、按 groupPath 二次分组，目前完全没做这一步。

## 影响范围

任何全部断言都 passed 且该 attempt 有 source 能力（`capabilities.source === true`，即多数沙箱型 eval 的常态）时，`niceeval show @locator` 与 `--report` 装载的默认 `AttemptDetail` 都不会展示任何 "N passed" 的确认信息——终端上看起来像是"这个区块本来就没有内容"，而不是"全过了"。web 面（`AttemptSource.tsx`）未核实是否有同样的缺口，本条只核实了 text 面。

## 发现场景

节点 1.5（`defineScoreEval`）验收阶段在 MemoryBench 跑真实计分制冒烟 eval 时发现：全部 5 个检查点都 passed 的 attempt，默认 `niceeval show @locator`（走 `AttemptSource`，因为该沙箱型 eval 有 source 能力）什么断言信息都不显示，一度怀疑是新加的 `.points` 显示逻辑没接上；改用 `--report` 传入只含 `AttemptAssertions`（不含 `AttemptSource`）的自定义报告后才看到正确的 `✓ passed · <group> · <count> · +N pts` 输出，确认问题出在 `AttemptSource` 分支本身、与本节点无关（预先就存在）。

## 修法

已修（`b7d274c6`，2026-07-23）。落点 `src/report/components/attempt-detail/faces.ts` 的 `attemptSourceText`：`AttemptSourceData` 补了 `passedGroups`（`compute.ts` 复用 `attemptAssertionsData` 同一份 `groupByPath`，得分点豁免收纳的规则也共用），text 面据此改成二选一——有失败可看就平铺 attention 条目，否则输出 `  ✓ passed · <group> · <count>` 摘要行。同批修掉一个相邻缺口：判定"有没有失败可看"时 unmapped 区（没有 loc、指向别的文件或越界的断言）也要一起检查，否则"unmapped 里藏着真实失败、行内 attention 恰好为空"的 attempt 会被错折成一条 `✓ passed`。

web 面 `AttemptSource.tsx` 复核结论：**没有同样的缺口**。它逐行渲染整份源码，passed 断言所在行照常带 `good` 色调标记与可展开的 `AssertionDetail`，全通过时页面上看得见每一条；`✓ passed · <group> · <count>` 这条折叠规则本来就只是 text 面的紧凑化手段，不是双面共同契约。

适用场景：任何检查 `show`/`--report` 默认输出"是否如实反映全通过"的工作。
