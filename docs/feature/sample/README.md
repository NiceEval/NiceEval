# Sample —— 当前结果集

[Record](../record/README.md) 回答「盘上有什么」。
Sample 回答「当前配置下，每道题现在有什么有效结果」。

```typescript
import { openRecord } from "niceeval/record";
import { currentSample } from "niceeval/sample";

const record = await openRecord(".niceeval");
const sample = currentSample(record, { experiments: "compare/" });

sample.attempts; // 当前配置下每道题选出的 Attempt
sample.coverage; // 完整分母与结构化缺口原因
sample.issues;   // 无法落到单题缺口上的读取问题
```

## 唯一心智

主报告只有一份 current 结果集。
每个 Experiment × Eval 在当前 `configHash` 下有物理 Attempt 就进入 `sample.attempts`，否则进入 coverage 缺口。

Attempt 是实际执行、携带合入还是从可比旧 Run 补入，只属于 provenance 事实，不改变它是不是 current，也不改变计票。
不同 `configHash` 的旧结果只用于解释缺口和进入 History，不混进当前报告。

## 缺口不是第二套结果

缺口统一表示「当前配置下没有结果」，并带下一步所需的原因：

- `never-run`：Record 历史里从未出现这道题的物理 Attempt。
- `previous-result`（旧结果缺口）：历史里有结果，但没有一条能代表当前配置；缺口可带最近旧 locator，供用户重跑或显式 `niceeval accept`。

两种原因都不进入通过率、得分、成本或样本命中范围的分子。
原因只帮助用户决定下一步，不把旧 verdict 变成半有效结果。

## 常见用途

| 用户目标 | 入口 |
|---|---|
| 看当前配置下的完整水平 | `currentSample(record)` |
| 收窄实验或题目 | `currentSample(record, { experiments, evals })` 或 `sample.scope()` |
| 按数据质量删减当前观测 | `sample.filter()` |
| 查看一次 Run 的事实 | Record 中的 `Run` 与 `niceeval show --run` |
| 查看历次执行 | `niceeval show --history` 或 History 页面 |
| 人工确认旧结果仍适用 | `niceeval accept @<locator>` |
| 发布一份自包含 Run | `latestRunSample(record)` 后交给 `publish()` |

`latestRunSample()` 服务发布和单 Run 审计，不定义另一种结果状态。
默认 show、view、自定义报告与统计都从 `currentSample()` 出发。

## 相关阅读

- [Library](library.md) —— current 选择、缺口原因与转换形状。
- [参考方案](reference/README.md) —— 显式选择与转换从哪里学。
- [用例手册](use-case/README.md) —— 局部补跑与人工接受的完整路径。
- [Record](../record/README.md) —— 被选择的物理事实。
- [Reports](../reports/README.md) —— 只消费一份 Sample 的呈现层。
