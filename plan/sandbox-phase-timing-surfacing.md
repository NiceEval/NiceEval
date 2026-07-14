# PLAN：统一 Attempt 时间树，并在 `show` / `view` 展示

> 面向执行者：把本文件直接交给实现 AI。按阶段顺序执行；每个阶段先满足自己的验收条件，再进入下一阶段。
>
> 来源：2026-07-14 用户对 sandbox eval 可调试性的连续契约挑战——沙箱启动时间、setup 链上每个 hook 及其真实 shell、各生命周期（含收尾）、每轮 send 与轮内 OTel 都要形成一棵可读时间树。设计裁决出处：`memory/phase-timings-teardown-steps-and-show-view.md` 与后续改写它的 `memory/unified-attempt-timing-tree.md`。
>
> 范围（2026-07-14 扩充）：`phases` 契约的收尾段 + 递归 timing children、统一 Sandbox command instrumentation、结构化 turn 与 OTel 关联、show / view 展示面，以及**生命周期词表三套合一**——代码里的 `AttemptPhase` 内部枚举、`LifecycleOperationName` 类型、live 展示 id、agent/ci envelope 的 `phase=` 全部换成 `LifecyclePhase` 统一名（`sandbox-provision`→`sandbox.create`、`running`/`test`→`eval.run`、`agent.tracing`→`telemetry.configure`、`baseline`→`workspace.baseline`、`score`→`scoring.evaluate`、`trace`→`telemetry.collect`，新增 `eval.teardown`）；`AttemptError.operation` / `DiagnosticRecord.operation` 改名 `phase`，`RESULTS_SCHEMA_VERSION` 6→7。`agent.setup` 经过 Sandbox API 的命令必须自动细分；不改 `bench/` 的统计判据逻辑,不把 runner timing 写进独立 Traces 瀑布。

## 开始前必读

1. `CLAUDE.md`：仓库总规则，特别是「先文档后代码」、同步义务表、禁止 feature branch。
2. `docs/engineering/benchmark/README.md`：`phases` 契约的权威语义（主链 / 收尾、递归 children、command/turn/OTel 规则、口径、Vitest 守护清单）。
3. `docs/feature/results/architecture.md`：`LifecyclePhase` / `PhaseTiming` / `TimingNode` 类型契约。
4. `docs/feature/reports/show.md`：首页 `timing:` 行与 `--timing` 切面的预期输出（示例即验收样式）。
5. `docs/feature/reports/view.md`：Attempt 详情统一时间区的契约。
6. `docs-site/zh/guides/viewing-results.mdx`：用户可观察行为的公开口径。
7. memory：`attempt-phase-tracking-teardown-always-last`（teardown 在 finally 里无条件触发的坑）、`attempt-phase-scoped-feedback-api-deferred`（不要越界实现的范围）。
8. 当前实现入口：`src/runner/attempt.ts`（阶段收集与 teardown 顺序）、`src/show/`（首页与证据切面渲染）、`src/cli.ts`（`FLAG_OPTIONS`）、`src/view/`（Attempt 详情）、`test/fixtures/sandbox-hooks`（计时守护复用的流水线）。

## 阶段 1：词表合一 + runner 落盘递归时间树

- 先做全局换名：`LifecyclePhase` 闭集落 `src/types.ts`，删除 `LifecycleOperationName` 与旧 `AttemptPhase` 字符串；live 表格、feedback coordinator、i18n 展示文案、`error.phase` / `diagnostics[].phase` 一次换齐，不留别名层；`RESULTS_SCHEMA_VERSION` 升 7。grep `sandbox-provision`、`"running"`、`agent.tracing`、`operation:` 确认清零。
- 在 Scope 外创建 attempt 共用 timing recorder；`attempt.ts` 在 eval cleanup / agent teardown / sandbox teardown hook 链 / sandbox stop 各自边界计时，追加 `eval.teardown` / `agent.teardown` / `sandbox.teardown` / `sandbox.stop` 条目。Effect Scope release 完成后才组装最终结果,stop finalizer 失败写 timing/diagnostic 而不丢 body 已有结果。
- 收尾条目的 `failed` 独立标记，不影响 verdict；主链 `failed` 语义不变；`agent.run` 只出现在 `error.phase` / `diagnostics[].phase`，不进 `phases` 数组。
- Sandbox 创建后统一包装中性 `runCommand` / `runShell`：用 async timing context 把公开调用挂到当前 phase/hook/turn,调用原方法时绑定原始 target 防止 provider 内部方法转调重复计时。command display 截断脱敏,env value 与 stdout/stderr 不落 timing。
- `sandbox.setup` / `sandbox.teardown` 逐 hook 建递归 children：具名函数用 `fn.name`，匿名用 `setup#<i>` / `teardown#<i>`；hook 内 command 继续嵌套。相同包装覆盖 baseline、eval/agent setup、telemetry configure、eval 手工命令、adapter Agent CLI、diff 与 teardown。
- `SessionManager.send` 为每轮记录 `sessionIndex` / `turnIndex` / `turnId` / 单调时钟包络；OTel 通道返回的 `traceId` 与 attribution 写进 turn node,不再只 log 后丢弃。无 OTel 仍有 turn timing。
- 所有 duration 改用可注入单调 clock,ISO `startedAt` 单独读 wall clock；每个 child 带 `startOffsetMs`,允许 sibling 重叠。
- 验收：`docs/engineering/benchmark/README.md`「框架自测」第 1–8 条全部落成 Vitest 断言；`pnpm run typecheck`、`pnpm test` 通过。

## 阶段 2：`show` 展示面

- attempt 首页新增 `timing:` 行（主链分解 + `teardown +N` 尾项；无 `phases` 时输出 `phase timing unavailable`），errored 首页在 error 块后给同款单行（含 `✗ failed here`）。
- 新增 `--timing` 证据切面，读取 phases children,再按 turn traceId 从 `trace.json` 临时挂接 OTel agent/model/tool spans；输出样式以 `docs/feature/reports/show.md` 示例为准（phase → hook/turn → shell → OTel、收尾分组、最深失败标记、`total`）。嵌套/并发 children 不求和。
- `--execution` 保留 event 骨架与唯一关联 span 的相对时间/耗时注释；未关联 span 不混入事件。与 `--timing` 展示同一 span 是允许的两种投影。
- `--timing` 进 `src/cli.ts` `FLAG_OPTIONS` 并写 JSDoc（缺注释生成器报错）；跑 `pnpm docs:reference` 重新生成参考页区块；核对 `src/i18n/` 两份 `--help` 速查是否需要点名（手工体裁，按现有取舍）。
- `available` 列表在有 `phases` 时列出 `--timing`。
- 验收：`pnpm run niceeval -- show --help` 冒烟；对真实 sandbox eval 结果跑 `show @<locator>` 与 `show @<locator> --timing`，输出结构与 docs 示例一致；`pnpm test` 通过（含 reference 漂移守护）。

## 阶段 3：`view` 展示面

- Attempt 详情新增统一时间区：主链分解条 + 收尾段列表,phase 可展开 hook/turn/command,turn 可按 traceId 展开 OTel；失败标到最深已知节点。无 phases 时该区显示不可用而非隐藏错误。
- 不把 runner 节点写入或混入独立 Traces 瀑布；Attempt 时间区只在读取时组合两类事实。
- 记得 `pnpm run view:build`（见 memory `codeview-perline-hidden-scrollbar-clips-text` 的教训）。
- 验收：本地 `niceeval view` 打开真实结果核对；`--out` 静态导出后阶段区照常显示。

## 统一验收

```bash
pnpm run typecheck
pnpm test
pnpm run niceeval -- show --help
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate
PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:links
```

并在真实 eval 仓库（如 `/Users/ctrdh/Code/coding-agent-memory-evals`）里 `pnpm exec niceeval` 跑一条 sandbox eval，核对 `result.json` 的 `phases`（含收尾、hook/command/turn children 与 trace 关联）与 `show --timing` 输出和 docs 预期一致。
