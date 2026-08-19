# debug：生命周期 command plan

带 Docker image 起点和 Eval prepare 命令的配对按真实包裹位置逐块显示：

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
│ position: lane eval-group:group · slot group/first #0                │
│ owner: eval:group/first                                              │
│ command: shell "printf fixture-ready"                                │
╰──────────────────────────────────────────────────────────────────────╯
```

省略的 lifecycle 节点只缩短案例，不改变完整计划的顺序。完整语义见
[CLI · `debug`](../cli.md#debug)。
