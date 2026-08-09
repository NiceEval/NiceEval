# Eval 选择

Experiment 与 CLI 都会从发现出的 Eval 中确定本次运行范围。
两者使用同一套精确 ID、ID 前缀和 tag 语义，并在资源动作之前求值成唯一的 Eval ID 集合。
Eval Group 则声明封闭的有序成员关系，不参与过滤。

## 解决的问题

同一个“选择 Eval”任务若同时存在前缀数组、任意函数和位置参数，作者无法从调用点判断选择是否精确、是否可由 CLI 复现，也无法获得逐条件的零命中反馈。
Eval Group 的数组还承担成员归属与队列顺序；把它与开放集合过滤称为同一种选择，会隐藏新增成员对 Sandbox 复用和指纹的影响。

## 核心心智

三处声明分成两种领域关系：

| 入口 | 关系 | 是否开放 | 顺序 |
|---|---|---|---|
| `ExperimentInput.evals` | 签入的 Eval 过滤条件 | 新 Eval 可以因 ID 前缀或 tag 自动进入 | 条件数组无顺序；结果使用发现顺序 |
| `niceeval exp` Eval flags | 本次 Invocation 的临时过滤条件 | 只收窄 Experiment 已选范围 | flag 顺序无意义；结果保持静态选择顺序 |
| `EvalGroupInput.members` | 封闭成员与运行队列 | 只含逐项导入的 definition | 数组位置就是 Group 顺序 |

Experiment 与 CLI 条件按集合交集组合，不把两个对象的同名字段合并。
每个 Experiment 先得到静态集合，再与本次 CLI 集合相交；后续 link、carry、dry 与运行只消费已求值的 ID。

Eval Group 的 `members` 必须是非空的 definition 元组。
过滤可以让某些成员不进入本次队列，但剩余成员仍按原位置排序，Group 的完整成员与顺序继续决定 `definitionHash`。

## 范围

本契约包含：

- Experiment 的声明式 `EvalSelectionInput`；
- `niceeval exp` 的精确 ID、ID 前缀、正 tag 与负 tag flags；
- 静态选择、临时选择、空集反馈与 Record 分母；
- Eval Group 的 `members` 命名及封闭成员边界。

选择条件不读取 description、metadata、题型、进程变量集合或运行时状态，也不接受任意 predicate。
新的跨目录分类先声明稳定 tag；只有出现具名用户任务时，选择词表才增加新轴。

本契约不新增资源生命周期。
选择在 Sandbox link、Provider 规划、结果沿用和 Session 创建之前完成。

## 入口

- [Library](library.md) —— `EvalSelectionInput`、布尔语义与 Eval Group 成员形状。
- [CLI](cli.md) —— `niceeval exp` flags、命令组合与人读/机器反馈。
- [Architecture](architecture.md) —— 集合求值、错误阶段、顺序、Record 与指纹不变量。
- [Eval Group](../eval-groups/README.md) —— Group 的 Sandbox 复用和有序队列契约。
