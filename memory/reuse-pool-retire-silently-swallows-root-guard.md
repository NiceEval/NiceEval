# 复用池归还静默吞 reset 失败，root 执行身份要等首次归还才被拒

- **现象**(2026-08-04，MemoryBench 全历史 docker 复用记录复盘):`sandboxReuse: true` 在 Docker + `niceeval/codex:0.144.1-r3`(Hub 上该镜像无 `USER` 声明,容器默认 root 执行身份)下,151 条复用记录 `reuseOrdinal` 全部为 1(同期 e2b 最高 13)——每个实例都在第一次归还后被换新,从未真正复用,且现场没有任何报错或诊断指向原因。
- **根因**:`src/runner/ledger.ts` 的 `resetToAnchor()` 早就有安全守卫(执行身份是 root 时 Agent 能读上一条 Attempt 留下的私有分类账对象,拒绝继续复用),但这条守卫只在**归还时**触发——第一条 Attempt 已经跑完、成本已经花掉才现形。`src/runner/sandbox-pool.ts` 归还 finalizer 的 `if (Either.isLeft(reset)) yield* this.retire(entry)` 又把这次失败原样吞掉直接退休换新,不发任何 diagnostic;用户只能看到 `reuseOrdinal` 恒为 1,查不到是 root 身份挡住了复用还是别的原因。
- **修法**:
  1. `ChangeLedger` 新增只读字段 `rootExecutionIdentity`(建账时 `ordinaryUid` 探测的结果);`ReusableSandboxPool.create()` 建完分类账后立刻检查,root 身份在第一条 Attempt 派发前就报错——与 [reuse-ensure-lifetime-generic-bookkeeping-fake](reuse-ensure-lifetime-generic-bookkeeping-fake.md) 同一时点纪律(Provider 缺 `ensureLifetime` 能力时的派发前失败)。`resetToAnchor()` 内的原守卫保留作纵深防御,不删除。
  2. 归还 finalizer 里 reset 失败先经 `feedback.diagnostic({ code: "sandbox-reset-failed", level: "warning", ... })` 发一条运行级诊断(带实例编号与失败原文)再退休,不再静默吞掉。
  3. 落点:`src/runner/ledger.ts`、`src/runner/sandbox-pool.ts`;契约见 [reuse.md](../docs/feature/sandbox/reuse.md)「题间重置」「失败与收尾」;覆盖类别见 [unit/sandbox.md](../docs/engineering/testing/unit/sandbox.md)「Sandbox 复用」。镜像本身补 `USER` 声明是另一条已完成的修法(commit `cbac5659`),不在本条范围内。
