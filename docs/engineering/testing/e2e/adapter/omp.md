# OMP Adapter

## adapter-omp-target-compatibility

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [adapters](../../../../feature/adapters/README.md)

`adapter/omp` 从安装后的候选包导入 `ompAgent`，在 `NICEEVAL_OMP_DOCKER_IMAGE` 声明的官方预装 Sandbox image 中
运行锁定版本的 Oh My Pi 真实非交互 CLI。场景使用 live OpenAI-compatible provider，保留逐 Eval 的 `passed/1`
oracle，并从公开 CLI 读回 marker 所在的 execution。通用 Runner timing 由
[`runner-generic-timing`](../runner.md#runner-generic-timing) 唯一读回；本 Repo 不重复断言。

`ci` Experiment 证明最终 assistant message 与可信 `agent_end` 终态。`events` Experiment 强制真实 CLI 调用一次
`bash`，并从标准事件流核对规范 `shell` 身份、带 marker 的 `command` 入参与结果、completed 配对、opaque command
分类，以及本轮非零 input/output usage。原生测试列全两个 Experiment/Eval 配对，防止少发现或少运行后假绿。

该 owner 只承担 OMP 当前锁定版本的 target compatibility：它不接管通用 Eval、CLI 或 Report 语义，也不宣称
session/resume/HITL。`agent_end` 终态、JSONL 事件与 usage 映射的确定性产品 owner 仍由
`adapter/sdk-converters` 中的 pi 真实回调用例承担。
