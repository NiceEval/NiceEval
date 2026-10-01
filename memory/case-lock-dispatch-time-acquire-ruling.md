---
format: concord.document/v1
id: case-lock-dispatch-time-acquire-ruling
title: 用例锁改派发时刻取锁,实验闸升级跨进程租约(翻案计划期全量取锁)
createdAt: 2026-07-24T17:52:21+08:00
createdAtSource:
  kind: first-recorded
  path: memory/case-lock-dispatch-time-acquire-ruling.md
  commit: be25b3b04fd8f184638a074e5deee4b50bc77f5c
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---
# 用例锁改派发时刻取锁,实验闸升级跨进程租约(翻案计划期全量取锁)

- **裁决**(2026-07-24):用例锁的取锁时机从「携带规划之后、派发之前(全部待跑用例一次性取锁)」改为**派发时刻逐用例非阻塞取锁**——排队中的用例不持锁,撞锁的用例挂起并把并发位转派给下一条未被锁的用例。配套把实验级 `maxConcurrency` 升级为**跨 Invocation 名额域**(`.niceeval/locks/` 下 `(experimentId, slot)` 租约文件,心跳/过期/接管与用例锁同纪律;两边 N 不一致取最小值)。全局 `--max-concurrency` 维持进程私有,非目标条款收窄为只豁免全局位。契约单源 `docs/feature/experiments/architecture.md#并发-invocation用例锁`,实现 plan 见 `plan/exp-case-lock-dispatch-time.md`。
- **曾选方案(原契约)**:取锁在计划期一次性进行,「要真实派发的用例先取锁,成功才进入派发许可链」。**否决理由**(真机现象,2026-07-24 MemoryBench 双终端):`Effect.forEach` 一口气派生全部 attempt fiber、取锁又在 preflight 之前,于是先启动的 Invocation 把全部待跑用例(24 条)的锁囤在手里、实际只按自己的 `--max-concurrency` 跑 1 条;第二条 Invocation 整体 `elsewhere` 干等,全局吞吐 = 持锁方上限。这与契约自己的两条声明矛盾:非目标说「并发闸不跨进程」(实际持锁方的闸跨了,方向是囤积),粒度裁决说「选用例粒度是为了不无谓折损多开并行度」(全量囤锁把用例锁退化成整个选择集的一把大锁)。改后多开成为水平扩展:两终端各 2 并发 → 全局 4 在飞,分工由锁自然形成,carry 汇合完整结果。
- **实验闸跨进程的动机**:改派发时刻取锁后,「计划期囤锁恰好挡住全量重叠多开踩踏共享状态实验」的偶然保护消失;且该洞**原本就存在**(双终端选不相交子集跑同一个 `maxConcurrency: 1` 实验,锁零交集,状态照踩)——用例手册「`maxConcurrency: 1` 这一行就是全部的正确性声明」的承诺跨进程原本是假的。租约域让承诺在同一工作副本内真正成立;不同实验打同一 agent API 的配额分配仍归用户(真正的配额问题,边界不动)。
- **保留的原裁决**:撞锁=等待不跳过、`elsewhere` 独立计数、用例粒度、心跳/接管纪律均不变(见 [[case-lock-wait-not-skip-ruling]]);本条只翻取锁时机与实验闸作用域。[[case-lock-gate-reorders-global-semaphore-queue]] 的 `caseLockAcquireMutex` 修法是为 preflight 前取锁的乱序而设,新时序下待重估(见 plan TODO A)。
- **实现状态(2026-07-24 复核:已实现)**:代码随 `f0f810e0`(「派发脊柱改显式许可链,用例锁移到派发时刻取」)落地。落点 `src/runner/run.ts`:`tryAcquireCase()`(约第 1138 行)是派发时刻的一次**非阻塞**试锁——非阻塞语义借 `acquireCaseLock` 的 `onWaitStart` 回调 + `giveUp.abort()` 实现,确认要等就当场退出、不进入 `acquireCaseLock` 自己的轮询;调用点在派发循环内(约第 1723 行),不在计划期。跨 Invocation 名额租约在 `src/runner/gate-lease.ts`。后续两条修正一并落地:干净取锁必须重查携带(`d3963179`,见 [multi-open-residual-window-closed-by-narrow-read](multi-open-residual-window-closed-by-narrow-read.md))、`caseLockAcquireMutex` 随新时序删除(见下一条)。
- **`caseLockAcquireMutex` 的重估结论**:删除。[case-lock-gate-reorders-global-semaphore-queue](case-lock-gate-reorders-global-semaphore-queue.md) 的互斥量是为「取锁插在 preflight 之前」的乱序而设;新时序把取锁挪到授位之后,抢位路径上不再有真实磁盘 I/O,它没有存在理由。
