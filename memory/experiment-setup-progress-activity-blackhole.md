# experiment-setup-progress-activity-blackhole

**现象**:`niceeval exp` 跑到实验级 `setup` 期间界面完全无输出——状态行显示 `0 running · N queued`,极像调度卡死;即使 setup 钩子老老实实调了 `ctx.progress(...)`,终端上也一个字都不出现(真实 repo `coding-agent-memory-evals` 实测,2026-07-18)。

**根因**:两层叠加。

1. **runner 对 setup 不发布任何自动事件**。`ensureExperimentSetup`(`src/runner/run.ts`)在调用 `run.setup!(ctx)` 前后没有任何 reportActivity / durable 事件;等待 setup 的 attempt 按设计不占并发位,在状态行里就是 queued。「懒触发 + 不占位」是文档定稿的设计,但 `docs/feature/experiments/cli.md` 从头到尾没有为 experiment setup 定义任何显示行(attempt 阶段表只有 sandbox/eval/agent setup),「setup 正在跑」这件事在 CLI 契约里是缺口——docs 里也完全没出现过 "activity" 这个概念。
2. **`ctx.progress` 是死信通道**。链路是 `ctx.progress` → `reportActivity`(sink)→ coordinator 的 `renderer.activity?.(text, snapshot)`(可选调用)。四个渲染器——human TTY dashboard、human 非 TTY plain、agent、ci——**全都没实现**可选的 `activity` 钩子,消息被静默丢弃。`run.ts` 里另外两处 `reportActivity`(`runner.judgePrecheck`、`runner.resumeCarry`)同样是死信;braintrust reporter 的 experiment URL、vercel session rotate 通知等底层调用方也一并被吞。

**修法**(2026-07-18,契约先行、同日落码):

- **可见性不再依赖钩子作者**:钩子起止改为 runner 自己发布的运行级反馈事件。新增 durable 事件 `experiment-hook`(started/done/failed,done/failed 带 durationMs)与短命事件 `experiment:progress`,reducer 维护 `RunFeedbackState.experimentHooks`。契约新增在 `docs/feature/experiments/cli.md`「实验级钩子的显示」。
- **Human TTY**:ACTIVE 区为在飞钩子渲染运行级行 `experiment setup · <experimentId>`(排 attempt 行前),`ctx.progress` 只更新该行 detail;成功钩子不写 scrollback。**agent/ci/非 TTY human**:起止各追加一行(`NICEEVAL experiment_setup … status=…` / `niceeval: experiment_setup …` / human 文案)。
- **activity 通道修活**:human 两个变体实现 `activity()`(TTY 落 scrollback、非 TTY 追加并重置 heartbeat),agent/ci 按契约继续不输出瞬时文本。`runner.resumeCarry`/`resumeCarryDetail` 两处调用连同 i18n key 删除——per-experiment 复用清单违反 cli.md「Reuse 只给数量」的既有裁决,plan 头行已覆盖数量。
- 落点:`src/runner/types.ts` + `feedback/{reducer,sink,coordinator,human,agent,ci}.ts` + `run.ts` + `src/i18n/{en,zh-CN}.ts`;测试按 `docs/engineering/unit-tests/experiments-runner/cases.md`「实验级生命周期」新登记的行落在 `reducer/human/agent/ci/run` 五个 test 文件。

**排查提示**:`0 running · N queued` 长时间不动 ≠ 调度 bug,先想 setup 是不是在跑(修后应能直接看到运行级行;同类展示型误诊见 live-who-key-mismatch-freezes-rows)。npm 已发布版本(≤0.8.x)仍是旧行为,消费 repo 要等下一次发版。
