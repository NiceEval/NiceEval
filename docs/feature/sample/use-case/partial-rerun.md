# 局部补跑之后，当前结果怎样形成

## 解决什么问题

一次 Experiment 可能只补跑部分 Eval。
此时「最近一次跑出了什么」和「每道题当前可用的结果」不是同一批数据。
选错会造成两种相反的误读:把没补跑的题当成缺失,或者把不同配置下的旧结果拼进当前比较。

## 场景

Experiment `baseline` 选择 Eval `a` 和 `b`,先后产生三次 Run:

| Run  | 配置         | 实际包含   |
| ---- | ------------ | ---------- |
| `R1` | `model: old` | `a`、`b`   |
| `R2` | `model: new` | `a`、`b`   |
| `R3` | `model: new` | 只补跑 `a` |

`R3` 是最新 Run,但它没有 `b`。

## 全流程

1. **审计最近一份 Run。**
   `latestRunSample(record)`。
   `baseline` 只返回 `R3` 里的 `a`,并通过 `coverage.missing` 报告 `b` 缺失。
   它不会从旧 Run 拼入 `b`——这个口径的单位就是 Run。

2. **看当前结果集。**
   `currentSample(record)`。
   `a` 来自 `R3`,`b` 来自 `R2`。
   两条 attempt 的 `run.configHash` 与基准(`R3`)一致,因此可以组成当前样本。
   `sample.runs` 保留 `R2`、`R3` 两个真实来源,不制造一份合成 Run。

3. **拒绝不可比的旧结果。**
   `R1` 里也有 `b`,但配置是 `model: old`,configHash 与基准不等。
   `currentSample` 不用它填补缺口。
   若 `R2` 不存在,`b` 留在 `coverage.missing`，原因为 `previous-result`，可附上 `R1` 的 locator 作为解释与显式 accept 入口——旧判定不计入当前结果。

4. **继续收窄。**
   `sample.pipe(dropExperiments(…))` 等算子只删减已有来源。
   删掉 `R2` 这个来源后, 来自 `R3` 的 `a` 仍保留,`b` 回到覆盖缺口——分母用原始 `knownEvalIds`,不随删减缩水。
   `pipe` 返回新 Sample,原样本不变。

## 边界

- `latestRunSample` 的单位是 Run,不是逐 Eval 找最新。
- `currentSample` 可以保留同一 Experiment 的多个来源 Run。
- 跨 Run 拼接只在 configHash 相等时发生。
- 携带条目与本次执行条目同等属于 current；来源只留在 Attempt 明细。
- attempt 始终指向真实来源。
  Sample 不重写 locator,也不制造合成来源。
- 要看历史趋势,不要用 `currentSample` 代替时间序列。
  改用 Reports 的 [Experiment 历史用例](../../reports/use-case/分析/跟踪实验历史.md)。
