# 运行观测协议

一次运行会同时产生运行中进度、Agent 行为、Sandbox 命令、耗时、用量、错误和判定。
这些信息既要供 `watch` 实时读取，也要进入 Record 供 `show`、`view` 与自定义 Report 复核。

如果每个消费面各自定义结果形状，报告字段、运行中事件和磁盘格式会互相推动 schema 变化。
本主题以一份可重放的观测协议统一事实来源，同时保留 Record、Sample 与 Reports 的既有层次。

## 解决的问题

- 运行中观察与终态 Record 分别定义事件，容易形成两套生命周期词表与状态折叠逻辑。
- `EvalResult` 同时承担运行时返回、持久化、携带和报告输入，消费便利会反向决定磁盘字段。
- Agent 只在一轮结束后交回事件数组，旁路观察者不能及时看到已经发生的行为。
- OTel 提供时间与跨进程关联，但采集可缺失，也不能覆盖 Runner 的完整生命周期。
- 新报告常常只需要另一种聚合或展示，却被迫修改权威结果 schema。

## 核心心智

运行过程是追加事实，运行状态是这些事实的投影。

Runner 与 Agent 产生不可变事件，Observation Hub 为事件分配身份和顺序，再交给不同消费者。
Record 保存需要审计的 durable 事件；Live 读取同一事件流的有界切片；Reducer 从事件重建 snapshot；Reports 只读取带依据的投影。

```text
Runner 生命周期 ─┐
Agent 行为 ──────┼─> Observation Hub ─┬─> Record：权威事件流
Sandbox 命令 ────┤                    ├─> Live：watch / exp --json
OTel 遥测 ───────┘                    └─> Reducer：snapshot / Session 索引

Provenance ─────────────────────────────> Record
Observation + Provenance ─> Claim ─────> Record
Record ─> Sample ─> Projector ─────────> show / view / Report
```

Record 的权威内容只有三类：

| 类别 | 回答的问题 | 删除后能否从同一份 Record 重建 |
|---|---|---|
| Provenance | 为什么这是这次运行，使用了哪些输入与算法 | 不能 |
| Observation | 实际发生了什么 | 不能 |
| Claim | 当时依据哪些事实作出了什么结论 | 不能恢复当时结论，只能重新求值 |

Projection 是从三类权威内容计算出的读模型。
snapshot、通过率、汇总用量、执行树、报告行和图表数据都属于 Projection，不参与 Record 的事实兼容判断。

## 所有者边界

| 所有者 | 职责 | 不负责 |
|---|---|---|
| Runner | 生命周期、Attempt 与 Turn 的作用域、事件排序和最终封口 | 解释 Agent 私有协议 |
| Adapter | 把 Agent 原生输出转成标准行为事件，并声明证据完整性 | 生成 snapshot、verdict 或报告行 |
| Observation Hub | 校验 envelope、分配顺序并把事件交给各 sink | 聚合状态或决定判定 |
| Record | 保存 Provenance、durable Observation 与 Claim | 选择 current、聚合指标或排版 |
| Live | 订阅同一事件流并提供有界 snapshot | 成为第二份 execution log 或终态权威 |
| OTel 接入 | 导入或导出时间、父子关系与跨进程关联 | 决定行为事实、执行错误或 Verdict |
| Sample | 选择可比较的 Attempt 并交代覆盖 | 改写历史 Claim |
| Projector / Reports | 从权威内容计算读模型并呈现 | 要求投影字段进入 Record 权威 schema |

## 范围

本主题包含：

- Observation envelope、事件身份、作用域、排序、版本与重放规则。
- Agent 的增量事件生产契约及终态 Outcome。
- durable Observation、ephemeral progress、Provenance、Claim 与 Projection 的边界。
- Record 的稳定容器、独立文档版本和未知事件保留规则。
- `watch`、`exp --json`、Session snapshot 与旁路附着语义。
- OTel 导入、关联和导出的补充地位。
- Report 通过 projector 读取事实的依赖方向。

本主题不包含：

- 新的 Verdict 状态、Sample 选择口径或结果携带策略。
- 把全文 stdout、逐 token delta 或 Agent 原始秘密放进 live 流。
- 用 OTel collector 代替 NiceEval 的 Record writer。
- 为每一种报告预计算并持久化宽表。
- 远程 Web 仪表盘与跨机器 Session 控制。

## 入口

- [Architecture](architecture.md) —— 事件模型、Hub、Record、OTel、重放与 schema 演进。
- [Library](library.md) —— Agent 事件流、Record 读取与 Projector API。
- [CLI](cli.md) —— `watch`、`exp --json`、snapshot 与附着协议。
