# Decision

采用 [PLAN-3：组级 repository seed](PLAN-3/README.md)。
使用两层声明：`defineGitRepository()` 定义组级 repository，`checkout()` 在每道 Eval 中选择完整 commit。
`defineSandboxGroup()` 显式列出该 repository，使 Runner 能在首条 Attempt 前收集并验证所有组内 commit。

每台物理 Sandbox 保存一个 workdir 外 seed。
seed 只在实例准备阶段访问 origin；每条 Attempt 从 seed 建立新的工作树与可写 Git metadata，不沿用上一题 `.git`。

否决 [PLAN-1](PLAN-1/README.md)，因为每题 clone 直接造成重复下载。
否决 [PLAN-2](PLAN-2/README.md)，因为 hook、config、remote 与其它 metadata 已经由 Agent 控制。
否决宿主 SourcePool、跨 Sandbox cache 与 Git cache CLI，因为需求只要求复用当前组的活跃 Sandbox。

该模式保证题间写污染隔离，不保证组内对象保密。
要求未来 commit 不可见的题必须使用 fresh Sandbox；文档和反馈不得把这项加速描述成对象级隔离。
