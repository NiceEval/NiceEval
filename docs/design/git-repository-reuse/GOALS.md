# Goals

- 同一复用组、同一物理 Sandbox、同一 repository 只在实例准备时访问 origin。
- 每道 Eval 继续声明自己的完整 base commit，不把 commit 顺序藏进组实现。
- 每条 Attempt 开始时丢弃上一题的工作树改动与可写 Git metadata。
- 后续题目只做 Sandbox 内本地 checkout，不执行 clone 或 fetch。
- seed、工作树切换、验证与失败处理由官方 API 统一拥有。
- Sandbox 替换时重新执行一次实例准备，不把下载状态提升到宿主或跨 Sandbox 共享。

本设计不承诺同组 commit 互相保密，也不新增 `niceeval cache` 命令。
