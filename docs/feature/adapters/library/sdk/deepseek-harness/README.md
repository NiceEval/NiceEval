# DeepSeek Harness

`deepSeekHarnessAgent(config?)` 是 Sandbox coding-agent Adapter，默认使用 `@deepseek-ai/dsh@0.2.2-rc.5`。
`DeepSeekHarnessConfig` 接受 `apiKey`、`baseUrl`、`version` 与 `plugins`。`plugins` 是声明顺序保留的精确 npm
`package@version` 数组；tag、range 与同名重复项在创建 Agent 时拒绝。

```ts
deepSeekHarnessAgent({
  plugins: ["dsh-plugin-a@1.2.3", "dsh-plugin-b@4.5.6"],
});
```

每个 Sandbox 使用隔离的 `DSH_HOME`。启动时，`niceeval.patch.yml` 选择 `deepseek-official` provider 与实验 model。
`DSH_PERMISSION_MODE=danger-full-access` 设置权限。密钥与网关地址分别通过 `DEEPSEEK_API_KEY` 和
`DEEPSEEK_BASE_URL` 注入子进程。带 `/v1` 的网关地址直接用于 Messages endpoint。

CLI 与插件是两条有顺序的 Agent Install。插件探测命令只读验证 headless profile 的直接依赖、实际 package
版本、`dsh.bundle` 声明与启用 bundle 集合；全部命中便跳过。缺失或集合不一致时，installer 用 DSH 原生
`dsh plugin --profile headless add` 一次性安装完整声明，并用可加载的 dump-config 复检。派生镜像只要使用
同一运行用户、`HOME` 与 `DSH_HOME=$HOME/.niceeval-dsh` 预装，就会直接命中该层；普通镜像首次联网安装，
复用 Sandbox 的后续 Attempt 再命中。

复检通过 `--dump-config-schema` 导入启用 bundle 的插件。导入失败是安装阶段错误。
预装命中后，Adapter 将 DSH 报告的 bundle 跳过、配置行被禁用与插件激活失败作为 warning diagnostic。
诊断保留原生条目的首行并脱敏。

`send()` 运行 `dsh --profile headless --patch <path> --json -- <prompt>`。首条模型请求使用实验 model。
Adapter 读取 stdout 的逐行 JSON，记录原生 Session ID、助手文本、推理、工具调用和工具结果。
工具调用与结果按原生 call ID 关联。最终回复取 `final.text`，并保留较早的助手消息。

进程以 0 退出且匹配 Session 的 `final.reason.kind` 为 `completed` 时，返回 `completed` Turn。
完成回合须有非空最终回复。进程以 1 退出且同一终局明确报告 DSH 的失败原因时，返回 `failed` Turn。
缺少可信终局、Session ID 不一致、退出码与终局矛盾或信号终止时，返回 `SendFailure`。

正常结束时，最终消息及终态通道为 complete。原生输出只投影主 Session，事件、工具和用量通道为 partial。
原生帧裁剪或缺失使可见证据进一步受限。JSON 协议没有独立的 `Turn.data`，该通道为 unavailable。

每次 `send()` 启动独立 Session。Adapter 校验每次调用的 Session ID，并在会话线上记录首个已确认的 ID。
工厂当前不提供 resume 或 HITL，也不加入 `BUILTIN_AGENTS`。

- [Cost 口径](cost.md)
[Adapter 性质](../../../README.md#性质)涵盖协议归一与真实兼容性。
