# 找出分不出好坏的判据

## 用户目标

评估作者用同一批题比较三个候选，三边的总分几乎一样。
他想知道是候选真的一样好，还是判据本身分不出差别，并决定哪些题该换。

## 起始状态

项目里有三个 Experiment，各自对同一批 Eval 有已发布的结果。本篇是预期用法，输出均为预期结果。

## 完整路径

1. 把三个 Experiment 的判据排成矩阵。 {#matrix}

   ```sh
   niceeval show --experiment harness/v0.19.0 --experiment harness/v0.20.0 --experiment harness/canary --assertions
   ```

   预期结果：每个 Eval 一张表。第一行是各列的判定与得分，其后每行一条判据；各列不全相同的行带有可见标记。

2. 先看没有标记的行。 {#flat}

   预期结果：这些判据在三个候选上结果完全相同。全是满分的行说明这条判据对当前候选已经没有区分度；
   全是零分的行要先怀疑判据本身：它可能核对了任务不允许的结果，或者它依赖的证据根本读不到。

3. 再看带标记的行，并下钻。 {#distinct}

   ```sh
   niceeval show @<locator> --assertions --entry <entry-id> --full
   ```

   预期结果：从表头复制丢分那一列的 locator，读到这条判据在那次 Attempt 里的材料与理由，确认差异来自候选而不是偶然。

4. 只看一道题。 {#narrow}

   ```sh
   niceeval show --experiment install/v0.20.0 --experiment install/canary --assertions --eval install/db-gpt
   ```

## 结果

作者得到两份清单：有区分度的判据继续保留；持续满分的题换成更难或更新的场景（[T-28](../../../taste.md#t-28)）。
这张表只说明这些判据在这些候选上的表现，不能据此断言候选一样好。

| 情形 | 用户看到的结果与下一步 |
|---|---|
| 某格显示 `—` | 那次 Attempt 里没有这条判据；多半是评估源码在两次运行之间改过 |
| 输出标为 `partial` | 行或格超过上限；用 `--eval` 缩小范围 |
| 某个 Experiment ID 写错 | 整次失败并指出未命中的 ID |
| 判据没有标签 | 不成行，只在 `unlabeled` 里计数；给它加上标签 |

## 相关契约

- [Inspection CLI](../cli.md#跨-experiment-的判据矩阵)：成员选择、行的身份与上限。
