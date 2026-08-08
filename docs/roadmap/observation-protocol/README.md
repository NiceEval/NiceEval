# 运行观测协议

一次运行会同时产生运行中进度、Agent 行为、Sandbox 命令、耗时、用量、错误和判定。
这些信息既要供 `watch` 实时读取，也要进入 Record 供 `show`、`view` 与自定义 Report 复核。

如果每个消费面各自定义结果形状，报告字段、运行中事件和磁盘格式会互相推动 schema 变化。
本主题以一份可重新执行的观测协议统一事实出处，同时保留 Record、Sample 与 Reports 的既有层次。

## 解决的问题

- 运行中观察与终态 Record 分别定义事件，容易形成两套生命周期词表与状态折叠逻辑。
- `EvalResult` 同时承担运行时返回、持久化、携带和报告输入，消费便利会反向决定磁盘字段。
- Agent 只在一轮结束后交回事件数组，旁路观察者不能及时看到已经发生的行为。
- OTel 提供时间与跨进程关联，但采集可缺失，也不能涵盖 Runner 的完整生命周期。
- 新报告常常只需要另一种聚合或展示，却被迫修改权威结果 schema。

## 核心心智

运行过程是追加事实，运行状态是 Reducer 对这些事实归约出的 snapshot。

Runner 与 Agent 产生不可变事件，Observation Hub 为事件分配身份和顺序，再交给不同消费者。
Record 保存需要审计的 durable 事件；Live 读取同一事件流的有界切片；Reducer 从事件重建 snapshot；Projector 按需产生 Reports 使用的读模型。

```text
Runner 生命周期 ─┐
Agent 行为 ──────┼─> Observation Hub ─┬─> Record：权威事件流
Sandbox 命令 ────┤                    ├─> Live：watch / exp --json
OTel 遥测 ───────┘                    └─> Reducer：snapshot / Invocation 索引

Provenance ─────────────────────────────> Record
Observation + Provenance ─> Claim ─────> Record
Record ─> Sample ─> Projector ─────────> show / view / Report
```

Record 的权威内容只有三类：

| 类别 | 回答的问题 | 删除后能否从同一份 Record 重建 |
|---|---|---|
| Provenance | 为什么这是这次运行，使用了哪些输入与算法 | 不能 |
| Observation | 实际发生了什么 | 不能 |
| Claim | 当时依据哪些事实作出了什么判断 | 不能恢复当时判断，只能重新求值 |

Projection 是从三类权威内容计算出的读模型。
执行树、时间树、usage、diff、Assertion 与 Verdict 读面都属于 Projection。
Projector 是产生 Projection 的纯函数，不是新的存储 owner。
Record graph 不包含 Projection object、引用或缓存入口；读取面按需重算，并且只在当前进程内复用结果。

trace、Agent 对话、Sandbox 命令、源码与 workspace change 都是用户会下钻复核的真实证据。
它们一旦被采集为 durable Observation 或 Provenance，就必须按各自的 durable schema 全部留在本地 Record；不能因为文件大而删掉整类证据。
事件 schema 仍可对单个失控值实施有标记的预算，但物理文件大小由 Record 分段解决，不由证据丢弃解决。

Report artifact 只携带本次报告实际消费的依据。
导出宿主先枚举全部页面实例与 Projector 请求形成 Export Plan，再执行计划并收集每个可用 Projection 的 `basedOn`。
发布阶段复制这组引用的传递闭包，页面不能在计划外临时打开 Record 查询。
报告使用 trace Projector 时，已经存在的全部 trace 依据都属于强制闭包；复制不完整必须让导出失败，不能降级成“未发布”。
报告根本不使用 trace 时，Report artifact 可以不携带它，但本地 Record 仍保留原事实。

运行期 snapshot 或 Invocation 索引可以为了附着与恢复写入活动 Invocation 存储，但它们位于 Record 之外，并声明重新执行依据。
用户明确导出的 Report 也可以落盘，但它是可删除、可重新生成的交付物，不能成为 Observation、Claim 或下一次 Report 的事实出处。
snapshot、Report 计算结果与 Projection 分属不同 owner，但都不参与 Record 的事实兼容判断。

运行身份只有一棵树：

```text
Invocation（一次 CLI 调用，只存在于运行期与 live 通道）
├─ Run（一个 Experiment 的持久化执行批次）
│  ├─ Attempt（一个 Eval 的一次独立执行与最小状态机）
│  │  └─ Agent Session（一条对话线）
│  │     └─ Turn（一次逻辑 send 的可信 Outcome）
│  └─ Attempt
└─ Run
```

一次 Invocation 可以打开多个 Run，但一个 Run 只属于一个 Experiment，并由创建它的 Invocation 封口。
每个 Attempt 独立拥有生命周期事件、Attempt-scoped finalizer 与 Verdict。
物理 Sandbox release 属于 Invocation resource completion，不反写已经封口的 Verdict。
Agent Session 和 Turn 只细分 Attempt 内的 Agent 行为，不与 Attempt 竞争执行身份。

## 所有者边界

| 所有者 | 职责 | 不负责 |
|---|---|---|
| Runner | 生命周期、Attempt 与 Turn 的作用域、事件排序和最终封口 | 解释 Agent 私有协议 |
| Adapter | 把 Agent 原生输出转成标准行为事件，并声明证据完整性 | 生成 snapshot、verdict 或报告行 |
| Observation Hub | 校验 envelope、分配顺序并把事件交给各 sink | 聚合状态或决定判定 |
| Record | 保存 Provenance、durable Observation 与 Claim | 选择 current、聚合指标或排版 |
| Live | 订阅同一事件流并提供有界 snapshot | 成为第二份 execution log 或终态权威 |
| OTel 接入 | 导入或导出时间、父子关系与跨进程关联 | 决定行为事实、执行错误或 Verdict |
| Sample | 选择可比较的 Attempt 并交代涵盖 | 改写历史 Claim |
| Projector | 从权威内容按需计算带依据的读模型 | 写 Record、保存 Projection 或读取未登记的外部状态 |
| Reports | 组合读模型，按 `basedOn` 收集发布依据并导出交付物 | 读取原始事件 schema、丢弃已引用证据，或让 Report 字段进入 Record |

## 范围

本主题包含：

- Observation envelope、事件身份、作用域、排序、版本与重新执行规则。
- Agent 的增量事件生产契约及终态 Outcome。
- durable Observation、ephemeral progress、Provenance、Claim、Projection 与导出输出的边界。
- Record 与 Report 共用的 frozen graph core、独立 payload 版本、强依赖和未知对象保留规则。
- Observation stream 的固定大小分段、大型 evidence blob 分块与 Report 证据闭包。
- `watch`、`exp --json`、Invocation snapshot 与旁路附着语义。
- OTel 导入、关联和导出的补充地位。
- Report 通过 projector 读取事实的依赖方向。

本主题不包含：

- 新的 Verdict 状态、Sample 选择口径或结果携带策略。
- 把全文 stdout、逐 token delta 或 Agent 原始秘密放进 live 流。
- 用 OTel collector 代替 NiceEval 的 Record writer。
- 为每一种报告预计算并持久化宽表。
- 远程 Web 仪表盘与跨机器 Invocation 控制。

Record reader 只接受本主题定义的容器格式。
契约不提供旧格式 decoder、离线迁移、双写或兼容读取路径。
这次切换不兼容旧 Record 或旧 Report；v2 落地后则是一条长期追加演进的协议线。
旧 v2 reader 必须沿 frozen strong edge 保留未知 typed payload 的完整原始闭包，并继续读取已知对象。
新 reader 把旧数据没有采集的新事实交代为 unavailable，不能补造默认字段。
普通功能不得推动容器升版；只有 frozen bootstrap、typed reference、强闭包、Graph root 封口或 core 信任语义无法继续读取时才允许提出 v3。

## 入口

- [Architecture](architecture.md) —— 事件模型、Hub、Record、OTel、重新执行与 schema 演进。
- [Library](library.md) —— Agent 事件流、Record 读取与 Projector API。
- [CLI](cli.md) —— `watch`、`exp --json`、snapshot 与附着协议。
- [Reference](reference/README.md) —— Projector 命名出处、容器先例、历史 schema 反事实回放与代码对照。
