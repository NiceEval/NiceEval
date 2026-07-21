# `--execution`：看 agent 做了什么

对话按轮分段、轮内按时间线卡片显示，而不是把长内容塞进表格。表格适合短、同构字段；prompt、命令和 stdout 都可能多行且很长，卡片能保留阅读顺序，也便于复制命令和结果。每轮以 turn 头行开始，头行首列就是[轮标签](../../scoring/library/display.md#turntsend的展示)（与 [`--timing`](timing.md) 的 turn 节点、diff 的 `windows` 同一枚 token），随后是 Turn status、该轮墙钟与 usage；逐卡片语法与 waiting / failed / DATA 卡片的示例见 [Scoring · 断言与 Turn 的展示](../../scoring/library/display.md#turntsend的展示)：

```text
turn1 · completed · 22.4s · 12.4k tok · $0.02
  USER
    You are the engineering manager for this project. ...

  ASSISTANT
    I’m going to inspect the task layout and the decision format first ...

  TOOL · command_execution  +12.8s · 1.3s
    input
      /bin/bash -lc 'find . -maxdepth 2 -type d | sort'
    result · completed · exit 0
      .
      ./.git
      ./tasks
```

`+12.8s` 是相对本次 trace 起点的位置，`1.3s` 是唯一关联到这条事件的 OTel span 耗时；没有可唯一关联的 span 时，这两个时间都省略，事件本身仍照常显示。主时间线只保留用户消息、assistant 消息、skill、subagent 与工具调用。没有关联到这些步骤的 telemetry 不混进对话；末尾会报告省略数量，并给出完整 `trace.json` 路径：

```text
total 50.0s · 0 skill loads · 7 tool calls · 4 AI messages
full events: .niceeval/.../events.json
69 unlinked telemetry spans omitted; inspect the OTel trace for full agent timing.
full OTel trace: .niceeval/.../trace.json
```

`--execution` 以「做了什么」为主，时间只是事件旁的上下文注释；它不负责阶段聚合，也不把未关联 span 猜到某条事件上。要从整个 attempt 回答「时间花在哪里」，使用 [`--timing`](timing.md)。

## 相关阅读

- [`--timing`](timing.md) —— 时间分析入口。
- [`--source`](eval-source.md) —— 从轮次回到源码行。
