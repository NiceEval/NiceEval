# 运行中旁路查看

你已经在一个终端启动评估，希望在另一个终端确认当前 Attempt、阶段、近期 Diagnostic 和终态计数。
旁路读取不能占用被观察进程的 stdin，也不能维护另一套生命周期状态。

```bash
niceeval watch
```

只有一个 active Invocation 时，命令直接附着。
存在多个候选时，命令列出 Invocation 与 Experiment，并要求显式选择：

```bash
niceeval watch inv_01ac42f0
niceeval watch --exp compare/codex
```

TTY 使用共享 Reducer 的 snapshot 渲染 active Attempt、phase、elapsed 与计数。
断线重连从不透明 cursor 继续；cursor 已超出观测保留时段时，服务端先发送 `resync` snapshot，再追加新的 LiveRecord 条目。
snapshot 和 heartbeat 只属于 live transport，不能写回 Record 或改变 Verdict。

脚本需要稳定机器形状时使用：

```bash
niceeval watch --json --once
niceeval watch inv_01ac42f0 --json
```

输出是 [CLI](../cli.md#机器输出) 定义的 NDJSON。
完整 transcript、命令输出和 diff 不进入默认 live tail；它们通过固定 revision 的终态读取面复核。
