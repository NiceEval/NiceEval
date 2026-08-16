# SIGINT 让同 Run 已完成 Attempt 随 draft 一起不可见

**现象**（2026-08-16）：同一 Run 的第一条 Attempt 已输出 locator，第二条仍在复用 Sandbox 中运行。此时发送 `SIGINT` 后，`niceeval show @<locator> --json` 返回 locator not found；第一条的 Eval 事件与 Attempt 数据已经形成，却因 Run 没有 `complete` 而整体不可读。

**根因**：中断发布把任何含 reserved Attempt 的 Run 整体排除。已完成 Attempt 只在 Invocation 收尾统一写 fixed families；在飞 Attempt 又从未关闭自己的 writer session，因此 Run 无法 seal。

**修法**：受控中断先保留所有已完成 Attempt 的 outcome 与固定事实，再把仍在飞的 reserved Attempt 关闭为 Core `interrupted`，把未 reserved slot 写为 `interrupted` Member，最后走普通 Run seal。硬退出或收尾写失败仍留下 incomplete directory，reader 不新增 draft 旁路。

**守护**：`e2e/lifecycle/test/interrupt-cleanup.test.ts` 在真实 Docker Sandbox 的第二次复用已开始后发送 `SIGINT`，随后只通过安装候选的 `show @locator --json` 与 `show --json` 证明第一条 Attempt 可读。
