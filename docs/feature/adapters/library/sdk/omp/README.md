# Oh My Pi

`ompAgent(config?)` 是 Sandbox coding-agent Adapter，驱动锁定版本的
`@oh-my-pi/pi-coding-agent` 与 Bun。`OmpConfig` 接受 `apiKey`、`baseUrl`、`version` 与 `bunVersion`；
凭据只在运行时注入子进程变量。`models.yml` 保存凭据变量名与本轮的 provider/model 选择，由 OMP 解析模型窗口和输出能力。

`send()` 运行 `omp --print --mode json`，把完整 JSONL `AgentSessionEvent` 交给
`createPiAgentEventStream()`。返回 Turn 需要进程以 0 退出，且 JSONL 里恰有一个
`isTerminal: true`、带 `messages` 数组的 `agent_end`。
非零退出、信号、无效 JSONL、终态缺失或冲突均为 `SendFailure`。
在可返回的 Turn 内，assistant message 明确以 `error` 或 `aborted` 停止时返回 `Turn.status: "failed"`。

事件、action、message、usage 与 status 来自真实协议帧；OMP print mode 没有独立 `Turn.data`。
当前工厂不宣称 session/resume 或 HITL，也不加入 `BUILTIN_AGENTS`。

- [Cost 口径](cost.md)
[Adapter 性质](../../../README.md#性质)涵盖协议归一与真实兼容性。
