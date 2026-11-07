# bub agent workspace 路径不能 hardcode(同 $HOME 的坑，但漏了 workspace）

**现象**：coding-agent-memory-evals 仓库跑 `memory/terminal-cancel-async-tasks` eval，agent=bub，sandbox=e2b，`bub run` 最终 `RuntimeError: max_steps_reached=50` 失败。看 events.json 发现 agent 前 7 次工具调用全是 `pwd`/`find /` 在瞎找文件——`ls -la && sed -n run.py` 直接 `FileNotFoundError`，因为 bub 的 shell 起始 cwd 是 `/home/sandbox/workspace`，但 e2b 的 `uploadDirectory` 实际落地在 `E2B_WORKDIR=/home/user/workspace`（两者不同）。

**根因**：`src/agents/bub.ts` 里 `DEFAULT_WORKSPACE = "/home/sandbox/workspace"` 是硬编码的 Docker 路径（`CONTAINER_WORKDIR`），`setup()`/`send()` 直接拿它当 `--workspace` 传给 `bub` CLI，从没读过 `sb.workdir`（e2b 是 `/home/user/workspace`，vercel 是 `/vercel/sandbox`）。这和 [[sandbox-home-hardcode]] 是同一类坑（同一个文件），但当时只修了 `$HOME` 探测，没顺手把 `workspace` 也换成 `sb.workdir`。

**连带后果**：浪费掉的 7 步只是表面问题；这次真正让 eval 挂掉的是 agent 自己写的 cancellation repro 脚本有 bug（`asyncio.gather(run_tasks(...), cancel_soon())`，`cancel_soon()` 手动 `raise CancelledError` 并不会取消 sibling task，only 传播异常给 gather 调用者），agent 被这个不可靠的自测信号带偏，反复改 `run.py` 而不是改测试方法，一直到 50 步上限都没跑到真正的 pytest。workspace 路径错位会让本就紧张的 step 预算更快耗尽，加大了这类"模型自己测试方法有 bug"场景下触发 `max_steps_reached` 的概率。

**修法**：`src/agents/bub.ts` 的 `setup()` 里 `workspace = sb.workdir`（不要 hardcode 常量），`send()` 里 `sessionInfo` 缺省兜底也要用 `sb.workdir` 而不是写死路径。已修复（2026-07-02）。

**没有修的地方**：bub 的 50-step 上限和"Continue the task until all targets are completed"续跑 nudge 都是 bub CLI 自己（PyPI 包，fork 在 CorrectRoadH/bub）内部逻辑，niceeval 目前没有任何 flag/env 能覆盖它；`BubConfig` 只暴露 `apiKey`/`apiBase`/`pythonPlugins`。想让高难度 eval 有更多 step 预算，得去 bub 自己的仓库加 `--max-steps` 之类的开关，niceeval 这边接不了。
