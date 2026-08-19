# `exp --json`：NDJSON 流

机器输出按事件逐行写入，最后恰好一条 receipt：

```json
{"format":"niceeval.exp","schemaVersion":2,"event":"start","total":3,"configs":1,"concurrency":1,"reused":0}
{"event":"judge_precheck","status":"done","durationMs":42}
{"event":"progress","elapsedMs":30000,"total":3,"reused":0,"running":1,"elsewhere":0,"queued":2,"passed":0,"failed":0,"errored":0,"skipped":0,"sandboxReuse":[{"experimentId":"compare/openai","displayName":"OpenAI comparison","group":{"kind":"experiment"},"active":1,"created":1,"assignments":1,"replacements":0}]}
{"event":"warning","code":"sandbox-retry","level":"warning","message":"retrying","experimentId":"compare/openai","displayName":"OpenAI comparison","evalId":"qa/basic"}
{"event":"sandbox_reuse","final":true,"sandboxReuse":[{"experimentId":"compare/openai","displayName":"OpenAI comparison","group":{"kind":"experiment"},"active":0,"created":1,"assignments":3,"replacements":0}]}
{"type":"receipt","receipt":{"invocationId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","runIds":["8f3d6f62-1d34-4cf3-99c7-84ba3c483706"],"startedAt":"2026-08-09T10:00:00.000Z","completedAt":"2026-08-09T10:01:00.000Z","completion":"completed"}}
```

progress 和 diagnostic 只服务当前 Invocation。机器调用方用最后的 receipt 取得 Run ID，再从 Record reader 读取业务事实。完整语义见
[CLI · `--json`](../cli.md#--json)。
