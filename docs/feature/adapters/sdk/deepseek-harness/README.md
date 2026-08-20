# DeepSeek Harness

`deepSeekHarnessAgent(config?)` 是 Sandbox coding-agent Adapter，驱动锁定版本的 `@deepseek-ai/dsh`。
`DeepSeekHarnessConfig` 接受 `apiKey`、`baseUrl`、`version` 与 `plugins`。`plugins` 是声明顺序保留的精确 npm
`package@version` 数组；tag、range 与同名重复项在创建 Agent 时拒绝。

```ts
deepSeekHarnessAgent({
  plugins: ["dsh-plugin-a@1.2.3", "dsh-plugin-b@4.5.6"],
});
```

每个 Sandbox 使用隔离的 `DSH_HOME`，
`settings.yaml` 只保存 `deepseek-official` provider、实验 model 与 `danger-full-access` 权限预设；
secret 只通过 `DEEPSEEK_API_KEY` 注入子进程。

CLI 与插件是两条有顺序的 Agent Ensure。插件探测命令只读验证 headless profile 的直接依赖、实际 package
版本、`dsh.bundle` 声明与启用 bundle 集合；全部命中便跳过。缺失或集合不一致时，installer 用 DSH 原生
`dsh plugin --profile headless add` 一次性安装完整声明，并用可加载的 dump-config 复检。派生镜像只要使用
同一运行用户、`HOME` 与 `DSH_HOME=$HOME/.niceeval-dsh` 预装，就会直接命中该层；普通镜像首次联网安装，
复用 Sandbox 的后续 Attempt 再命中。

`send()` 运行 `dsh --profile headless <prompt>`。只有 exit 0 且 stdout 存在非空最终 assistant 文本时返回
`completed` Turn；非零、信号或空终局都是 `SendFailure`。headless 协议不暴露工具轨迹和 token usage，
因此 events/actions/usage 如实标成 unavailable，messages 与 status 则由公开输出与进程终态完整观测。

当前工厂不宣称 session/resume 或 HITL，也不加入 `BUILTIN_AGENTS`。

- [Cost 口径](cost.md)
- [Live E2E 验收](../../../../engineering/testing/e2e/adapter/deepseek-harness.md)
