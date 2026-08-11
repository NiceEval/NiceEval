# Eval 选择

Experiment 与 CLI 都先从发现出的 Eval 求出本次范围，再进入 Sandbox link、carry 或运行。
Experiment 的 `evals` 是开放过滤条件；Eval Group 的 `evals` 是封闭归属集，两者不能混用。

| 入口 | 关系 | 顺序语义 |
|---|---|---|
| `ExperimentInput.evals` | 选择可运行 Eval | 发现出的稳定顺序 |
| `niceeval exp` 参数 | 收窄 Experiment 已选范围 | 参数位置无意义 |
| `defineEvalGroup({ evals })` | 声明共享物理 Sandbox 的闭集 | 无业务顺序；内部按规范化 Eval ID 串行 |

Experiment 和 CLI 条件按集合交集组合。每个 Experiment 先得到静态 ID 集，再与 CLI 的临时集合相交；后续阶段只消费已求值的 ID。

Eval Group 的成员必须逐项导入真实 definition。数组位置不构成公开排序、index 或 sequence。
过滤或 carry 不会改变 Group 身份：完整的规范化 ID 集和 Group 的可执行行为仍参与 fingerprint。

## 范围

- Experiment 的 `"*"`、ID 前缀、ID 数组或 predicate 选择；
- CLI 的 Eval 前缀与 tag 过滤；
- 空集反馈、静态统计分母与本次 selected ID；
- Eval Group 的封闭 `evals` 边界。

选择不读取 description、metadata、题型或运行时状态。
它不新增物理资源生命周期；该契约见 [Eval Group](../eval-groups/README.md)。

## 入口

- [Library](library.md) —— Experiment 选择与 `defineEvalGroup()` 形状。
- [CLI](cli.md) —— `niceeval exp` 参数和反馈。
- [Architecture](architecture.md) —— 集合求值、Group 身份和指纹。
