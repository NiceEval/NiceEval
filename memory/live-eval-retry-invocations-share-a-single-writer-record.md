# Live Eval 补跑 Invocation 共享单写者 Record

## 现象

2026-08-13，PR #47 Docker batch（run `31679732962`）中，Codex live E2E 首轮产生两个
可补跑的 `verdict: failed`。测试用 `Promise.all` 同时启动两条精确的
`niceeval exp <experiment> <eval> --rerun all --json`，其中一条不到一秒就以
`RecordWriterBusy` 退出且没有 receipt，后续 `expReceipt()` 因空 stdout 再报错。

## 根因与修法

Repo batch 之间可以并行，单个 `niceeval exp` 内部的 Attempt 也可以并行；但同一 Repo 的
多条补跑 Invocation 继续写同一个 `.niceeval/record`。Record 的并发契约是单写者，多个
独立 CLI writer 进程不能重叠。这里把 I/O 密集误解成所有层次都能继续超开，反而制造了
确定性的 writer 冲突。

修法只把罕见的失败补跑 Invocation 按首轮事件顺序串行；主 Invocation 内部并发、不同 Repo
batch 并发和所有首轮运行均保持不变。不要通过忽略 `RecordWriterBusy`、另建未纳入 locator
链的临时 Record，或并行后重试 writer 冲突来伪造绿色。
