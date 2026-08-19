# `exp --json`：NDJSON 流

机器输出按事件逐行写入，最后恰好一条 receipt：

```json
{"type":"progress","invocationId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","message":"running","current":1,"total":3}
{"event":"warning","code":"sandbox-retry","level":"warning","message":"retrying"}
{"type":"receipt","receipt":{"invocationId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","runIds":["8f3d6f62-1d34-4cf3-99c7-84ba3c483706"],"startedAt":"2026-08-09T10:00:00.000Z","completedAt":"2026-08-09T10:01:00.000Z","completion":"completed"}}
```

progress 和 diagnostic 只服务当前 Invocation。机器调用方用最后的 receipt 取得 Run ID，再从 Record reader 读取业务事实。完整语义见
[CLI · `--json`](../cli.md#--json)。
