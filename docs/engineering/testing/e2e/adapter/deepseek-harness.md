# DeepSeek Harness Adapter

## adapter-deepseek-harness-target-compatibility

`adapter/deepseek-harness` 从安装后的候选包导入 `deepSeekHarnessAgent`，在
`NICEEVAL_DEEPSEEK_HARNESS_DOCKER_IMAGE` 声明的官方预装 Sandbox image 中运行。目标是锁定版本的真实
`dsh --profile headless`。场景通过 `DEEPSEEK_API_KEY` 使用 live `deepseek-official` provider 与
`deepseek-v4-flash`，保留 `passed/1` oracle，并从公开 CLI 读回 marker 所在的 execution。通用 Runner timing 由
[`runner-generic-timing`](../runner.md#runner-generic-timing) 唯一读回；本 Repo 不重复断言。

同一条 Eval 在发送消息前还从公开 Sandbox 边界检查 `dsh-dead-links@0.1.1` 已作为 headless profile
的直接依赖与启用 bundle 落地，并以 `dsh --dump-config` 证明 profile 可加载。这个断言锁定 Adapter 的
精确插件声明会先经 Agent Ensure 收敛，而不是在每次 runtime `setup()` 里盲装。

该 owner 只承担 DSH 当前锁定版本的 target compatibility：headless 仅暴露最终 assistant 文本与进程终态，
因此不宣称 actions、usage、session/resume 或 HITL，也不接管通用 Eval、CLI 或 Report 语义。
