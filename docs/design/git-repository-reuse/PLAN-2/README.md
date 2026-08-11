# PLAN-2：直接复用上一题 `.git`

第一题正常 clone，后续题目在同一个工作树执行 `git reset --hard <commit>` 与 `git clean`。

该方案下载最少，也最接近手写 shell。
但 Agent 已经可以修改 `.git/config`、hooks、refs、reflog 与 objects；下一次调用 Git 前没有可信 metadata 边界。
只清工作树不能证明下一题不会执行上一题留下的 hook 或读取被替换的配置。

该方案不能满足题间写污染隔离，因此否决。
