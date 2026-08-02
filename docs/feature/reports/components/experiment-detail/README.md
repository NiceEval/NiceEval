# Experiment 详情

`ExperimentDetails` 显示单个实验的完整读面。
它是 [`standardExperimentPage`](../../library.md#参数化页attempt-与-experiment-详情) 的 render，也可直接放进任何 page：

```tsx
<ExperimentDetails input={sample.scope({ experiments: ["agents/codex"] })} />
```

它从显式 `input` 或当前 `ctx.scope` 读取 Sample。
收窄结果必须恰好包含一个实验：零个或多个都按完整用户反馈报错，指出收窄到了哪些实验——静默取第一个会把调用方的收窄 bug 藏成错数据。

## 区块

| 区块 | 内容 |
|---|---|
| 实验身份 | experiment id、agent、model、flags、`evaluationKind`、最近运行时间 |
| 读数摘要 | 主读数、成本、tokens、耗时，以及 evals × attempts 覆盖 |
| 结果构成 | eval verdict 计票 |
| 题目清单 | Eval → Attempt 层级，每条 attempt 的 locator 是 attempt 详情目标 |
| 覆盖缺口 | 未跑到的 eval 占位行与补跑命令 |
| 实验级 notices | experiment 作用域的 facts 与封口警告 |

实验级 notices 只在这里有落脚点：attempt 级事实进 `AttemptDetails`，run 级事实进 run notices，experiment 作用域的事实由本组件解释。

## 两面

text 面按同一份值输出区块列表，locator 换成下钻命令；web 面把 locator 渲染成 attempt 详情目标链接。
两面消费同一份转换结果，不各自取数。

## 相关阅读

- [Library · 参数化页](../../library.md#参数化页attempt-与-experiment-详情)
- [Experiment scatter](../summaries/experiment-scatter.md) —— 默认散点，点目标指向本读面。
- [Attempt details](../attempt-detail/README.md) —— 题目清单下钻的目的地。
