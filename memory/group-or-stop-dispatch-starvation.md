# Eval `.orStop()` 的 Group lane 饥饿排查

**现象**（MemoryBench，2026-08-16）：`compare/codex-gpt-5.6-terra--remem` 中两个 `.orStop()` 后失败，live 面板一度持续显示 `1 running · 14 queued`，只剩另一个 Group 在执行。

**契约**：`.orStop()` 只结束当前 Eval。Eval Group 是 capacity-one lane；不同 Group 仍可并行。物理 Sandbox 不可用才适用 `stop-group`，其余未开始 slot 必须成为 stopped / skipped，不能伪装成 queued。

**排查结论**（2026-08-16）：以安装后的 CLI、三个真实 Docker Group lane 和 agent 内屏障验证后，两个 `.orStop()` 的后继及第三条 Group lane 都会进入 Agent；“`.orStop()` 停掉全部 Eval”未复现。外部面板的瞬时低并发不足以证明 runner 根因，若再次出现应先保存同一时刻的 `session show` 与各 Group 的 running / queued 分布。

**守护**：`e2e/runner/test/group-or-stop-dispatch.test.ts` 固定两个 Group 的首条 Eval `.orStop()`，并让两个后继和第三条 Group 同时到达 agent 内屏障。任一 lane 未派发会超时；测试顶部引用本条。
