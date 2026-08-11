# Eval 选择 —— Architecture

Experiment 条件和 CLI 条件是两个独立表达式。两者完成求值后，运行路径只接收 ID 集合，不再调用作者 predicate。

## 集合

| 名称 | 含义 |
|---|---|
| `D` | discovery 后的全部 Eval ID |
| `S_E` | 一个 Experiment 的静态选择集 |
| `U` | 所有 `S_E` 的并集 |
| `C` | CLI 在 `U` 上的临时选择集 |
| `F_E` | 一个 Experiment 本次实际选择，`S_E ∩ C` |

每个原子条件都在自己的候选域内校验零命中。一个 `F_E` 为空时只排除该 Experiment；全部为空才让 Invocation 失败。

`knownEvalIds = S_E` 保留静态统计分母，`selectedEvalIds = F_E` 表示本次计划。表达式的语法位置不进入 configHash 或 Attempt fingerprint；相同 ID 集不会因等价条件的重排失效。

## Eval Group

Group 发现时把每个 definition 对应到唯一 Eval ID，再把 ID 规范化排序。
它不把作者数组位置写入可观察状态，也不向 Agent 或结果公开 index。
同一 Group 的真实 Attempt 按规范化 ID 串行，不同 Group 可并行。

Group `definitionHash` 包含 ID、完整规范化 ID 集、`onUnavailable`、Sandbox Layer identity 与 Group source 闭包。
inline `evals` 的重排被规范化。可执行 Hook、opaque command 或其项目内导入模块改动仍改变 hash。

选择、Group link 与 Plugin link 都在 provider 网络、Sandbox create 和资源 materialize 前完成。
