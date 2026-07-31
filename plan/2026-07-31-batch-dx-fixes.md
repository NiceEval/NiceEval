# MemoryBench 跑批暴露问题的实施清单(2026-07-31)

契约都已在 docs 定稿,本清单只列「代码待跟」的项与其出处,按建议顺序排列;每项完成后按 CLAUDE.md 表格履行验证与同步义务,并把对应 memory 条目标「已修」。

## 1. ExperimentFatalError 呈现修复(最小、契约现成)

- 契约:`docs/feature/error-classification/README.md`「止损语义」——experiment 闸只停本实验、message 双通路(反馈流 + `run.json`)、退出码按 verdict 折叠为 1。
- 台账:`memory/experiment-fatal-presented-as-user-interrupt.md`。
- 验收:多实验并跑 fixture 里一条泳道 setup 抛 fatal,正文可见、其余实验照跑、退出码非 130。

## 2. compose 资源组进孤儿核对与 prune

- 契约:`docs/feature/sandbox/architecture.md`「孤儿核对」新增的资源组条目;`cli.md` 的 `list --orphans` / `prune` 整组语义。
- 覆盖类别:`docs/engineering/testing/unit/sandbox.md`「孤儿核对与 prune」,含「主实例已消失、只剩网络残留」区分力场景。
- 台账:`memory/compose-orphan-check-misses-resource-groups.md`。

## 3. 共享构建:瞬时错误退避重试 + 逐 BuildKey 放行

- 契约:`docs/feature/sandbox/case.md`「Run 级构建协调」第 4–6 条(重试是本次新增,逐 key 放行是既有声明)。
- 覆盖类别:同文档注册表「BuildKey single-flight、失败扇出和预算」。
- 台账:`memory/shared-build-single-barrier-not-per-buildkey.md`。

## 4. BuildKey 的 platform 事实化

- 台账(含两个修法方向,择一):`memory/buildkey-platform-declared-not-enforced.md`;定稿方向后若契约措辞受影响,先改 `case.md` 再动代码。

## 5. `--timing` 的时限归属标注

- 契约:`docs/feature/reports/show/timing.md` 命令节点 deadline 段;来源层词表见 `docs/feature/sandbox/architecture.md`「时限归属」。
- 覆盖类别:`docs/engineering/testing/unit/reports.md`「`--timing` 的两棵树」新增条目。
- 同步义务:flag 文案改 `src/cli.ts` `FLAG_OPTIONS` JSDoc 后跑 `pnpm docs:reference`。

## 6. `show @<locator>` link 工作树崩溃排查

- 台账(含排查起点):`memory/show-locator-crashes-under-linked-worktree.md`。

## 7. E2B 按需构建 provider(最大件,单独排期)

- 台账与动机:`memory/e2b-on-demand-build-capability-hollow.md`;补上后 MemoryBench 241 题可整体上云并行。
