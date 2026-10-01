# 执行轨迹的应用展示 · plan-2 —— Architecture

## 数据建模

```text
Attempt
 ├─ niceeval.execution-traces                       → Events section
 │    └─ Trace snapshot (traceId) → Event (eventId)：payload、evidence
 ├─ niceeval.agent-turns / niceeval.turn-contexts   → Conversation section
 ├─ niceeval.sandbox-commands                       → Commands section
 ├─ niceeval.runner-diagnostics                     → Diagnostics section
 └─ Attachments
```

读取时每个事件得到一份 `DisplayResolution = { state: "resolved"; blocks } | { state: "unavailable"; code }`。
它只存在于一次读取的 result 中，不持久化，也不缓存进 Record。

## 数据流

1. Host 打开 Record，在固定 cutoff 下读出四个 section 的事实。
2. Host 求值当前项目配置，按 Attempt 的 Adapter identity 与 `schema.id` 取得 Adapter 定义。
3. Inspection 对 Events section 的每个事件调用对应 formatter（同步、50 ms 时限），校验输出词汇与上限。
4. `query`、`show` 与 View 消费同一 result。

## Section

`attempt.trace` 的 outline 由四个 section 组成，按固定顺序排列。顺序只是展示约定，不表示跨 source 因果。

| 顺序 | section | source family | 稳定 selector | outline 预算 |
|---|---|---|---|---|
| 1 | Events | `niceeval.execution-traces`；没有该 family 时为 Conversation 投影 | `eventId`、`evidenceId` | 每页最多 32 个事件，序列化后最多 64 KiB |
| 2 | Conversation | `niceeval.agent-turns`、`niceeval.turn-contexts` | `itemId`、`toolOccurrenceId` | 最多 32 个 Turn、64 个 item；每段文本预览 1 KiB |
| 3 | Commands | `niceeval.sandbox-commands` | `commandId` | 最多 8 条命令；命令文本与每流预览各 1 KiB |
| 4 | Diagnostics | `niceeval.runner-diagnostics` | — | 最多 16 条 |

每个 section 的预算独立，互不挤占。每个 section 都出现，并带 `not-recorded`、`complete`、`partial` 或 `invalid` 状态；partial 即使零项也显示 limitations。

Attempt 没有 `niceeval.execution-traces` collection、但有 Conversation 事实时，Events 由 Conversation item 投影，类型为 `agent.<item kind>`。
`--actor`、`--type` 与 continuation 只作用于 Events；其它 section 交付有界首段并报告 omitted 计数。
Stable identities 按类型分组，每行一个标签与一个 ID，每类最多 256 个并报告遗漏。

formatter 只作用于 `niceeval.execution-traces` 的事件。Conversation 投影、Conversation、Commands 与 Diagnostics 由 Inspection 从封存事实直接关闭。
Section 按 source family 选择，renderer 不读取 Adapter 名。

## 不变量

- formatter 输出词汇封闭；Events section 的 renderer 只按 `kind` 分支。
- 展示不进入 Assertion、Judge、Verdict、score 或 fingerprint。
- 读取路径执行项目代码。同一 Record 的展示取决于读取时的项目源码。

## 生命周期与错误

| 阶段 | 失败 | 终态 |
|---|---|---|
| 项目求值 | 无项目、配置报错 | 全部 Events 事件 `unavailable: project-unavailable` |
| Adapter 定位 | 名字不存在或 `schema.id` 不符 | `unavailable: adapter-not-found` |
| formatter 查找 | 事件 `type` 没有对应 formatter | `unavailable: formatter-missing` |
| formatter 执行 | 抛错、超时、非法输出 | 该事件 `unavailable: formatter-failed` |

所有失败都不让读取失败，事件以 envelope、summary 与 JSON 呈现。

## 身份与复用

- formatter 不进入任何 identity；修改 formatter 不触发重跑。
- 同一 Record 的展示随 formatter 版本变化，Record 中没有“当时显示了什么”的事实。
