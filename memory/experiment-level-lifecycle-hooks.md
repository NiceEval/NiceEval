# 设计裁决:实验级生命周期钩子 `ExperimentDef.setup`(推翻「实验级整场钩子不存在」)

**裁决**(2026-07-17,用户定案):`ExperimentDef` 增加唯一生命周期字段 `setup?: (ctx) => void | Cleanup | Promise<void | Cleanup>`——整场至多一次、宿主机侧,返回的 cleanup 就是 teardown。这推翻了 [[sandbox-lifecycle-hooks]](2026-07-10)里「实验级整场钩子不存在、ExperimentDef 保持纯配置数据」的裁决。

**翻案动因**:coding-agent-memory-evals 的 nowledge 实验需要「每实验一份、所有 attempt 共享、跑在宿主机」的隧道(起一次 → 全程共享 → 拆一次)。旧契约把这类资源归到「外部编排」行(`docker compose up && niceeval exp && down` / wrapper 脚本),实践里长成了 `exp-nowledge.sh`——运行配置的一部分(没隧道这个实验就跑不了)住在可签入的 experiment 文件之外,`niceeval exp compare` 一条命令跑不齐全部实验。2026-07-10 否决的方案 1(`ExperimentDef.setup/teardown` **每沙箱一次**)错在「实验级字段、沙箱级节奏」的错位;这次落地的是当时被留在否决理由里的正确形态:**实验级字段、实验级节奏**(第一个 attempt 前 / 全部 attempt 后),与沙箱钩子不重叠。

**关键设计点**(契约正文见 `docs/feature/experiments/architecture.md#实验级生命周期`):

- 单字段 `setup` 返回 cleanup,不设独立 `teardown` 字段——与 `EvalDef.setup` 惯例一致,teardown-without-setup 无意义,返回式注册天然解决「setup 半路失败该不该拆」。
- 懒触发 + memoize:第一个通过派发许可的 attempt 触发;全部 carry 时不跑;等待不占全局并发位。
- setup 抛错 → 本实验**所有** attempt 合成 errored(`experiment-setup-failed` / phase `experiment.setup`)逐条落盘,**绕过 fail-fast**(零成本、报告完整性优先);其它实验不受影响。
- cleanup 靠 per-run 剩余计数 + `Effect.ensuring` 在最后一个 attempt 收尾后必跑(中断也跑);失败只作运行级 diagnostic(warning,`experiment-teardown-failed`)。极端时序(全部 attempt 在 setup 完成前被中断)由 setup 完成回调查 `tornDown` 自清,不留孤儿资源。
- 运行时值(隧道 URL/key)经**模块闭包**流进同文件 agent/sandbox 钩子,runner 不做值中介、不进快照;钩子函数体不进 fingerprint(与 sandbox 钩子同规则,改钩子用 `--force`)。
- `LifecyclePhase` 词表新增 `experiment.setup` / `experiment.teardown` 两员,仅归因用、永不进 `phases[]` 计时;词表扩充不递增 RESULTS_SCHEMA_VERSION(消费方按标签渲染,不做穷尽拒绝)。

**落点**:类型 `src/runner/types.ts`(`ExperimentDef.setup` / `ExperimentHookContext` / `AgentRun.setup` / LifecyclePhase);校验 `src/define.ts`;调度接线 `src/runner/run.ts`(expLifecycles map);human phase 标签 `src/runner/feedback/human.ts`;i18n 两份;测试 `src/runner/run.test.ts`「实验级 setup/teardown」套件;契约 `docs/feature/experiments/{README,architecture,library}.md`、`docs/feature/sandbox/library.md#环境预置放哪`(四行分工表扩成五行)、`docs/runner.md`、`docs/feature/results/architecture.md`(词表);公开站 `docs-site/zh/tutorials/write-experiment.mdx`、`docs-site/zh/explanation/experiment.mdx`。

关联:[[sandbox-lifecycle-hooks]](被部分替代的前裁决)。
