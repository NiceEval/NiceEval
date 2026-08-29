# @niceeval/testkit

NiceEval 场景 Repo 共用的机械测试设施。它只负责进程收据、严格解码、等待、临时资源、跨进程测试锁、artifact staging 和资源终结，
不包含 NiceEval 领域动作或 expected。

`createE2EContext()` 把调用方提供的具名命令前缀绑定到每个 case 的私有项目副本，
回收该 case 启动的进程，然后暂存调用方声明的路径。产品 argv 和 expected 仍留在测试正文。

`ProcessReceipt.expReceipt()` 严格读取 `niceeval exp --json` 的 `start → 中间事件 → receipt`
边界，并返回最后唯一一条 `InvocationReceipt`。它不折叠 Verdict 或 Attempt，也不替测试决定 expected；
这些业务事实必须从中间 `eval` 事件或 receipt 的 Record Runs 读取。

`ProcessReceipt.expEvalEvents()` 严格解码公开的 Eval 结论事件。
`ProcessReceipt.expErrorEvents()` 通过完整 `ExpEventSchema` 的 `error` 分支严格解码公开执行错误。
`ProcessReceipt.expEvents()` 公开严格解码完整 `ExpEvent` 联合；两个筛选 API 都复用它，E2E 无需直接调用
`ndjson<ExpEvent>()`。NiceEval 当前未从 package exports 导出 `ExpEvent` 类型或运行时 Schema，因此 Testkit
仍拥有机器流的严格运行时 Schema，并保持与产品事件词表逐字段一致。
`assertExpEvalOutcomes(actual, expected)` 把这些事件与测试文件显式提供的身份、Verdict 和 Attempt 字面量作精确比较。
Testkit 不生成 expected，也不把 `failed`、`errored`、`skipped` 互相折叠。

`ProcessReceipt` 为 NiceEval 稳定 inspection query 协议提供完整严格解码。产品的纯跨运行时入口
`niceeval/inspection` 拥有 16 项 operation registry、完整 document decoder 与精确窄化；Testkit 调用产品 decoder，
不在自己的 Effect 副本中重解产品 Schema，也不重建 envelope 或 payload。

成功结果可通过泛型 `querySuccess(operation)` 或具名方法读取：`overview()`、`experiment()`、`runsList()`、
`run()`、`runSummary()`、`runOverview()`、`attempt()`、`attemptAssertionDetail()`、`attemptSources()`、
`attemptTrace()`、`attemptTraceDetail()`、`attemptTiming()`、`attemptUsage()`、`attemptDiff()`、
`attemptArtifacts()` 与 `runsCompare()`。`queryExplanation(operation)` 返回同一 operation 的精确 explanation；
`queryDiscovery()` 与 `queryFailure()` 分别读取 discovery 和 failure outcome。完整解码会统一拒绝错误 protocol、
错误 operation、多余字段及不匹配的 outcome；failure 或 explanation 不会被成功方法接收。任何失败都会附带同一命令的
stdout/stderr diagnostic。Testkit 不折叠或兼容 verdict、phase 等产品语义。

Run lifecycle CLI 的 `niceeval.run/v1` 与 inspection 不同。`runListDocument()` 严格读取
`niceeval run list --json`，`runGetDocument()` 严格读取 `niceeval run show --json`；两者直接调用候选包
`niceeval/run` 的唯一 decoder，并返回候选包派生的 `RunListDocument` / `RunGetDocument` 正式类型。
Testkit 从根入口转出这些必要类型，但不复制 Run Schema。既有 `runsList()` / `run()` 继续只表示
`niceeval.query/v1` inspection operation。

`retryFailedExpEvalsOnce({ events, targets, runRetry })` 只机械执行调用方明确选出的 live Eval 单次补跑：
串行调用保留在 owner 正文中的完整 argv，严格核对唯一返回身份、`passed` verdict 与零退出码，再按
`(experimentId, evalId)` 替换 effective event。Testkit 不选择 targets、不解释 provider 失败，也不隐藏首轮收据。

根 E2E runner 会对当前 checkout clean-build 此 private package，并仅在隔离的场景副本中以本地
directory dependency 安装它。Testkit 不会被打包、上传或作为发布产物消费。

`acquireProcessFileLock()` 只协调同一宿主上的测试进程。同一进程对同一路径共享引用计数锁；物理锁内容包含
PID 与随机 ownership token：进程终止后可接管，而迟到的 releaser 不能删除 successor 的锁。调用方仍负责给出具名资源、在资源
生命周期结束时调用返回的 release，并且不能把这项机械协调当成产品 Sandbox 隔离。

正式契约见 `docs/engineering/testing/testkit.md`。
