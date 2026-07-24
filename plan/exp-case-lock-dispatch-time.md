# 用例锁改派发时刻取锁 + 实验闸跨进程租约:实现 TODO

契约已定稿,一律以 docs 为准,本 plan 只列落点。本篇取代 `plan/exp-case-lock.md` TODO B 里「携带规划之后逐用例取锁」的取锁时机描述,其余条目(锁原语、释放路径、反馈)不变:

- 取锁时机(派发时刻、非阻塞、排队用例不持锁)、撞锁挂起并转派并发位、实验闸跨 Invocation 名额域:`docs/feature/experiments/architecture.md#并发-invocation用例锁`(「取锁在派发时刻」「撞上新鲜锁」「实验级 maxConcurrency 的名额域跨 Invocation」三条 + 重写后的非目标段)
- 调度语义(实验级闸名额域跨 Invocation 共享):`docs/runner.md#调度有界并发`
- 多开分工的缓存续接:`docs/runner.md#缓存指纹去重`「并发 Invocation」条
- 用户侧用法:`docs/feature/experiments/use-case/concurrency.md` 用例 10(多开加速)、用例 2/4 的跨进程措辞;`docs-site/zh/explanation/runner.mdx`「并行开多个终端」
- 覆盖类别声明:`docs/engineering/testing/unit/experiments-runner.md`「用例锁与并发 Invocation」(已按新契约重写)
- 裁决出处:`memory/case-lock-dispatch-time-acquire-ruling.md`

## TODO

- [ ] **A. 取锁挪到派发时刻**(`src/runner/run.ts`):`resolveCaseLockGate` 从 preflight 之前(fiber 一起动就取锁,导致囤积整个选择集)挪进并发位授予之后:拿到全局位 → 对该用例**非阻塞**试锁(O_EXCL 一次) → 成功即跑;撞新鲜锁则**立刻释放并发位**、该用例转入挂起集(`elsewhere`),位子按瓶颈优先转派给下一条等待者。注意 `runs>1` 同用例兄弟 attempt 共享同一把 memoized 锁:第一个锁成功后兄弟直接放行(锁属本进程),锁被别人持有时全体兄弟挂起、不重复试锁。原 `caseLockAcquireMutex`(为 preflight 前取锁的乱序问题而设,见 `memory/case-lock-gate-reorders-global-semaphore-queue.md`)在新时序下取锁发生在授位之后、不再影响抢位顺序——评估后移除或收窄,不留无用机制
- [ ] **B. 挂起与续接**:挂起用例每心跳周期重读锁文件(既有轮询);锁消失/过期接管后重查携带(复用 planCarry 逐 attempt 判定)——携入则 `elsewhere` 迁 `reused`,转自跑则迁 `queued`、按原优先级参与下一次授位。全部选中用例挂起时进程整体空转等待(不忙轮全局位)
- [ ] **C. 实验闸租约**(`src/runner/` 新模块,复用 `src/shared/entry-file-store.ts` + `lock.ts` 原语):声明了 `maxConcurrency` 的实验,runSem 换成跨进程名额域——`.niceeval/locks/` 下 `(experimentId, slot)` 逐槽租约文件,取位=对 0..N-1 任一空槽原子独占创建 + 心跳续租,释放=attempt 收尾后删除,过期经 rename 接管;持有期语义不变(attempt 同生命周期,内部等待不释放)。两边 resolved N 不一致时生效名额取在场声明最小值(实现口径:取位前扫描在场租约声明的 N,用 min(自己的 N, 在场声明) 判定可用槽)。未声明 `maxConcurrency` 的实验不建名额域、零开销
- [ ] **D. 反馈核对**:`elsewhere` 计数、`lock_wait` 事件、五项恒等式契约不变,但迁移动态从「启动即整批 elsewhere」变为逐条流动——核对 live 面板与 `--json` 在新动态下仍满足恒等式与迁移规则(`cli.md`「等待并发 run 的显示」)
- [ ] **E. 测试**:只为 experiments-runner.md 已声明类别写测(排队不持锁的锁目录条目数断言、撞锁转派、多开分工不相交且并集覆盖、实验闸跨 runEvals 峰值、min-N);沿用隔离 `niceevalRoot` + `TestClock`;跑通既有回归(尤其瓶颈优先那组,连续多次确认不 flaky,参考 `memory/case-lock-gate-reorders-global-semaphore-queue.md` 的踩坑)
- [ ] **F. 同步义务**:`pnpm run typecheck` + `pnpm test`;真实 eval 仓(`/Users/ctrdh/Code/MemoryBench`)双终端同命令冒烟(见验收);公开面如有新事件成员核对 `pnpm docs:reference`

## 验收

1. 双终端跑**同一条**命令(各 `--max-concurrency 2`,选择全量重叠):两边面板都出现 `running > 0`,全局同时在跑接近 4 个 attempt;没有任何用例被跑两遍;两边结束时都拿到完整结果集(`reused` 含对方跑完携入的部分)。
2. `maxConcurrency: 1` 的实验,双终端选**不相交** eval 子集:同一时刻全局至多 1 个该实验的 attempt 在跑(实验闸租约生效)。
3. `kill -9` 一边:另一边 30s 内接管其用例锁与实验闸租约照常跑完(既有接管语义不回归),结束后 `.niceeval/locks/` 为空。
