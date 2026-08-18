# Oh My Pi

`ompAgent(config?)` 是 Sandbox coding-agent Adapter，驱动锁定版本的
`@oh-my-pi/pi-coding-agent` 与 Bun。`OmpConfig` 接受 `apiKey`、`baseUrl`、`version` 与 `bunVersion`；
凭据只在运行时注入子进程变量，`models.yml` 仅保存凭据变量名与本轮的 provider/model 选择。

`send()` 运行 `omp --print --mode json`，把完整 JSONL `AgentSessionEvent` 交给
`createPiAgentEventStream()`。只有进程 exit 0 且观察到唯一有效终端 `agent_end` 才返回 Turn；非零、信号、
JSON 语法 parse 失败、缺失或冲突终态都是 `SendFailure`。assistant message 明确以 `error`/`aborted` 停止时才返回
`Turn.status: "failed"`。

事件、action、message、usage 与 status 来自真实协议帧；OMP print mode 没有独立 `Turn.data`。
当前工厂不宣称 session/resume 或 HITL，也不加入 `BUILTIN_AGENTS`。

- [Cost 口径](cost.md)
- [Live E2E 验收](../../../../engineering/testing/e2e/adapter/omp.md)
