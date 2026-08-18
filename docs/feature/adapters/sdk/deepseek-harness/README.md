# DeepSeek Harness

`deepSeekHarnessAgent(config?)` 是 Sandbox coding-agent Adapter，驱动锁定版本的 `@deepseek-ai/dsh`。
`DeepSeekHarnessConfig` 接受 `apiKey`、`baseUrl` 与 `version`。每个 Sandbox 使用隔离的 `DSH_HOME`，
`settings.yaml` 只保存 `deepseek-official` provider、实验 model 与 `danger-full-access` 权限预设；
secret 只通过 `DEEPSEEK_API_KEY` 注入子进程。

`send()` 运行 `dsh --profile headless <prompt>`。只有 exit 0 且 stdout 存在非空最终 assistant 文本时返回
`completed` Turn；非零、信号或空终局都是 `SendFailure`。headless 协议不暴露工具轨迹和 token usage，
因此 events/actions/usage 如实标成 unavailable，messages 与 status 则由公开输出与进程终态完整观测。

当前工厂不宣称 session/resume 或 HITL，也不加入 `BUILTIN_AGENTS`。

- [Cost 口径](cost.md)
- [Live E2E 验收](../../../../engineering/testing/e2e/adapter/deepseek-harness.md)
