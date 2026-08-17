# @niceeval/testkit

NiceEval 场景 Repo 共用的机械测试设施。它只负责进程收据、严格解码、等待、临时资源、artifact staging 和资源终结，
不包含 NiceEval 领域动作或 expected。

`createE2EContext()` 把调用方提供的具名命令前缀绑定到每个 case 的私有项目副本，
回收该 case 启动的进程，然后暂存调用方声明的路径。产品 argv 和 expected 仍留在测试正文。

`ProcessReceipt.expReceipt()` 严格读取 `niceeval exp --json` 的 `start → 中间事件 → receipt`
边界，并返回最后唯一一条 `InvocationReceipt`。它不折叠 Verdict 或 Attempt，也不替测试决定 expected；
这些业务事实必须从中间 `eval` 事件或 receipt 的 Record Runs 读取。

`ProcessReceipt.expEvalEvents()` 严格解码公开的 Eval 结论事件。
`assertExpEvalOutcomes(actual, expected)` 把这些事件与测试文件显式提供的身份、Verdict 和 Attempt 字面量作精确比较。
Testkit 不生成 expected，也不把 `failed`、`errored`、`skipped` 互相折叠。

`retryFailedExpEvalsOnce({ events, targets, runRetry })` 只机械执行调用方明确选出的 live Eval 单次补跑：
串行调用保留在 owner 正文中的完整 argv，严格核对唯一返回身份、`passed` verdict 与零退出码，再按
`(experimentId, evalId)` 替换 effective event。Testkit 不选择 targets、不解释 provider 失败，也不隐藏首轮收据。

根 E2E runner 会对当前 checkout clean-build 此 private package，并仅在隔离的场景副本中以本地
directory dependency 安装它。Testkit 不会被打包、上传或作为发布产物消费。

正式契约见 `docs/engineering/testing/testkit.md`。
