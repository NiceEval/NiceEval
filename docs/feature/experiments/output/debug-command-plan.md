# debug：生命周期 command plan

带 Docker image 起点和四类 owner 包裹的配对按链接拓扑逐块显示。每个节点保留独立圆角框；debug 只展示静态 identity、eligibility 与 capability，不查询瞬时缓存库存：

```text
╭─ COMMAND PLAN ───────────────────── PARTIAL · 8 opaque · 2 redacted ─╮
│ Guaranteed order is per lane.                                        │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.create ──────────────────────────────────────────── OPAQUE ─╮
│ position: lane eval-group:group · physical lifecycle template enter  │
│ owner: provider:docker                                               │
│ template: docker:image                                               │
│ template owner: experiment:suite/one                                 │
│ configured locator: exact · image="node@sha256:cd849..."             │
│ reason: provider create is a runtime operation                       │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.before ───────────────────────────────────────────── EXACT ─╮
│ owner: experiment:suite/one                                          │
│ phase: before                                                        │
│ occurrence: physical-instance · immutable inputs + stable cohort     │
│ declaration order: experiment:suite/one · 1                          │
│ dependencies: []                                                     │
│ execution order: physical-instance · topological 1                   │
│ guarantee: ordered-within-occurrence                                 │
│ change frequency: 10 · rare · explicit                               │
│ scheduling reason: ready-lowest-change-frequency                     │
│ prefix: sha256:50d2...                                               │
│ cache capability: persistent                                        │
│ cache lookup: not-probed                                             │
│ eligibility: eligible                                                │
│ command: shell "./import-runtimes.sh"                                │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.before ───────────────────────────────────────────── EXACT ─╮
│ owner: eval:group/first                                              │
│ phase: before                                                        │
│ occurrence: attempt · required by fixture input                      │
│ declaration order: eval:group/first · 1                              │
│ dependencies: []                                                     │
│ execution order: slot[group/first,attempt:0] · topological 1         │
│ guarantee: unordered-across-lanes                                   │
│ change frequency: 40 · explicit                                      │
│ scheduling reason: ready-lowest-change-frequency                     │
│ prefix: sha256:aa41...                                               │
│ cache capability: persistent                                        │
│ cache lookup: not-probed                                             │
│ eligibility: eligible                                                │
│ command: shell "printf fixture-ready"                                │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.around.before ───────────────────────────────────── OPAQUE ─╮
│ owner: adapter:codex                                                 │
│ phase: around.before                                                 │
│ occurrence: attempt · Agent default                                  │
│ declaration order: adapter:codex · 2                                 │
│ dependencies: eval:group/first#fixture · explicit                    │
│ execution order: slot[group/first,attempt:0] · topological 2         │
│ guarantee: ordered-within-occurrence                                 │
│ change frequency: 1000 · frequent · explicit                        │
│ scheduling reason: dependency-released-then-lowest-frequency        │
│ reason: callback body cannot be inspected or captured                │
│ capture lineage: closed · opaque-ancestor                            │
│ paired after: slot[group/first,attempt:0].after[agent:2]             │
│ after condition: registered before callback invocation              │
╰──────────────────────────────────────────────────────────────────────╯
```

Human 框与 JSON `commandPlan` 投影同一棵结构化树和同一组字段；框中的标签只是 JSON 字段的人读投影：

同一 attempt occurrence 可以同时包含 Experiment、Group 与 Agent action。例如三者的数值分别为 100、20 与 1000，且都已 ready，框依次显示 Group fixture、Experiment candidate 与 Agent `.env`。owner 不形成排序墙。

| Human | JSON | 含义 |
|---|---|---|
| `declaration order` | `declarationOrder: { owner, ordinal }` | 用户在该 owner 中写下 action 的顺序 |
| `dependencies` | `dependencies: [{ action, source }]` | 显式 action 或 typed capability 形成的入边 |
| `execution order` | `executionOrder: { occurrencePath, topologicalOrdinal, guarantee }` | occurrence 内的拓扑位置，不伪造全局序号 |
| `change frequency` | `changeFrequency: { value, source, label? }` | 求值后的数值与 explicit/defaulted 声明状态；只有精确命中常量值才附标签 |
| `scheduling reason` | `schedulingReason` | 节点为何从 ready set 中被选中 |

同一个 `fixture` 节点的 JSON 不是拼好的文本行，而是可查询的对象：

```json
{
  "owner": { "kind": "eval", "id": "group/first" },
  "phase": "before",
  "occurrence": {
    "kind": "attempt",
    "derivation": "required-by-fixture-input"
  },
  "declarationOrder": {
    "owner": { "kind": "eval", "id": "group/first" },
    "ordinal": 1
  },
  "dependencies": [],
  "executionOrder": {
    "occurrencePath": ["lane:eval-group:group", "slot:group/first:attempt:0"],
    "topologicalOrdinal": 1,
    "guarantee": "unordered-across-lanes"
  },
  "changeFrequency": { "value": 40, "source": "explicit" },
  "schedulingReason": "ready-lowest-change-frequency",
  "cache": {
    "prefix": "sha256:aa41...",
    "capability": "persistent",
    "lookup": "not-probed",
    "eligibility": "eligible"
  },
  "action": { "kind": "shell", "command": "printf fixture-ready" }
}
```

以上三项不是从 command 文本猜出的展示值。exact 只表示安全规范化后的 action；secret、credential、stdin、危险 locator 与 callback 仍然 Redacted 或 Opaque。

运行时反馈才会把 before occurrence 报告为 `hit → restore`、`miss → replay` 或 `unsupported → execute`。省略的 Agent/test 与 after 节点只缩短案例，不改变完整计划的拓扑。完整语义见
[CLI · `debug`](../cli.md#debug)。
