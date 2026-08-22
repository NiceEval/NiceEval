# debug：生命周期 command plan

带 Docker image 起点、sandbox/attempt preparation 和 lifecycle 的配对按规范化顺序逐块显示。debug 只展示静态 identity、eligibility 与 capability，不查询瞬时缓存库存：

```text
╭─ COMMAND PLAN ───────────────────── PARTIAL · 8 opaque · 2 redacted ─╮
│ Guaranteed order is per lane.                                        │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.materialize ─────────────────────────────────────── OPAQUE ─╮
│ position: lane eval-group:group · physical lifecycle template enter  │
│ owner: provider:docker                                               │
│ template: docker:image                                               │
│ template owner: experiment:suite/one                                 │
│ configured locator: exact · image="node@sha256:cd849..."             │
│ reason: provider materialization is a runtime operation              │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.prepare ──────────────────────────────────────────── EXACT ─╮
│ source position: experiment:suite/one · preparation 1                │
│ normalized position: physical lifecycle · sandbox scope · step 1     │
│ owner: experiment:suite/one                                          │
│ scope: sandbox · inferred from immutable inputs                      │
│ prefix: sha256:50d2...                                               │
│ cache capability: persistent                                        │
│ cache lookup: not-probed                                             │
│ eligibility: eligible                                                │
│ command: shell "./import-runtimes.sh"                                │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.prepare ──────────────────────────────────────────── EXACT ─╮
│ source position: eval:group/first · preparation 1                    │
│ normalized position: lane eval-group:group · slot group/first #0     │
│ owner: eval:group/first                                              │
│ scope: attempt · required by fixture input                           │
│ prefix: sha256:aa41...                                               │
│ cache capability: persistent                                        │
│ cache lookup: not-probed                                             │
│ eligibility: eligible                                                │
│ command: shell "printf fixture-ready"                                │
╰──────────────────────────────────────────────────────────────────────╯

╭─ sandbox.lifecycle.setup ─────────────────────────────────── OPAQUE ─╮
│ normalized position: lane eval-group:group · slot group/first #0     │
│ owner: adapter:codex                                                 │
│ scope: attempt                                                       │
│ reason: callback body cannot be inspected or captured                │
│ capture lineage: closed · opaque-ancestor                            │
│ paired teardown: after Agent/test cleanup                            │
╰──────────────────────────────────────────────────────────────────────╯
```

运行时反馈才会把 preparation occurrence 报告为 `hit → restore`、`miss → replay` 或 `unsupported → execute`。省略的 Agent/test 与 teardown 节点只缩短案例，不改变完整计划的顺序。完整语义见
[CLI · `debug`](../cli.md#debug)。
