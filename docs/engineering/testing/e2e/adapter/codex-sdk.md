# Codex SDK converter 仓库

## adapter-codex-sdk-live-compatibility

Repo ID 是 `adapter/codex-sdk`。它在 host 上以 external network 和 Node 24+ 运行，锁定
`@openai/codex-sdk` 版本，并只接收 `OPENAI_API_KEY` 与 `OPENAI_BASE_URL` 两个 live secret。
每次 Experiment 只有一次 Attempt；Vitest 没有 retry，也没有 Judge。

本仓库证明候选包的公共 `createCodexThreadEventStream()` 能消费真实 Codex SDK 的原始
`ThreadEvent` 流。它**不是**官方 Codex SDK factory，也不新增或暗示任何 public factory。
确定性的事件归一、canonical tool、usage 和终态语义由另一个确定性 owner 负责；本 leaf 只保留
锁定上游 SDK 与公共 converter 的真实兼容性证据。

## 受限 consumer 与 Eval

Experiment 内的 Direct Agent 不启动 HTTP 服务或子应用。它只做 SDK invocation：首轮
`startThread()`，后续轮 `resumeThread()`，并把 runner 的原始 `ctx.signal` 传给
`thread.runStreamed()`。每个原始 `ThreadEvent` 不改写地直接交给候选包的
`createCodexThreadEventStream()`；consumer 不构造 `StreamEvent`，不手写字段映射，也不自行
归一 tool、usage 或 status。流异常或取消时会 await iterator `return()`；该 `return()` 失败会继续抛出。

工作目录由原生测试以绝对临时路径注入。每次测试都创建独立的系统临时 `HOME`、`CODEX_HOME` 和
workspace，三者均不进入 artifact。SDK provider 配置采用仓库 Codex SDK 示例的最小
`model_providers` / `model_provider` 形状。

唯一 Eval 是一条 live Journey：要求模型运行带随机 marker 的安全 `printf` 命令，读取公共 converter
产生的 canonical `shell` 调用与 completed 配对，检查 input/output usage 均为正数和
`thread.started` 被 capture。第二轮必须通过 `resumeThread()` 引用首轮随机 sentinel，并以成功终局完成。
Codex SDK 没有公开 HITL callback，因此仓库不伪造 `input.requested`。

## 原生读回与资源终结

测试使用 Testkit `withProcess({ processGroup: true })` 启动安装后的 `niceeval exp`，在 body 中 await
`handle.done` 并核验严格进程 receipt；`withProcess` 的 dispose 路径负责检查该进程组的最终终结。
测试不声称 `ProcessReceipt` 含有不存在的 `groupCleanup` 字段。

Experiment 完成后，测试只经公开 CLI 执行 `show`、`show --json`、`show --run <run-id>` 和
代表 Report 的 `show @locator --report <fixture-module> --page <execution-route>`。读回同时检查 marker、converted tool/result，以及含随机 sentinel 的第二轮，
而不读取 `.niceeval` 的私有布局。
