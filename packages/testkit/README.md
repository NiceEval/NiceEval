# @niceeval/testkit

NiceEval 场景 Repo 共用的机械测试设施。它只负责进程收据、严格解码、等待、临时资源、artifact staging 和资源终结，
不包含 NiceEval 领域动作或 expected。

`ProcessReceipt.expResult()` 严格读取 `niceeval exp --json`，原样返回公开事件流最后的
`ExpResultEvent`；它不折叠 verdict，也不替测试决定 expected。

根 E2E runner 会对当前 checkout clean-build 此 private package，并仅在隔离的场景副本中以本地
directory dependency 安装它。Testkit 不会被打包、上传或作为发布产物消费。

正式契约见 `docs/engineering/testing/testkit.md`。
