# PLAN-3：组级 repository seed

复用组声明一个 repository，各成员 Eval 声明自己的完整 commit。
Sandbox 在首题前一次性取得本次选择所需 commits，并把 Git 数据保存在 workdir 外 seed 中。

每条 Attempt 丢弃上一题的工作树与可写 `.git`，从 seed 本地建立新的 metadata，再 detached checkout 到目标 commit。
后续题目不访问 origin；seed 失败时退休整个 Sandbox。

该方案同时满足一次下载与题间写污染隔离，因此采纳。
它不隐藏同组其它 commits；需要未来对象保密的题保持 fresh。
