---
format: concord.document/v1
id: case-lock-gate-reorders-global-semaphore-queue
title: 用例锁的取锁步骤插在 preflight 之前,打乱全局并发位排队的瓶颈优先序
createdAt: 2026-07-24T17:19:49+08:00
createdAtSource:
  kind: first-recorded
  path: memory/case-lock-gate-reorders-global-semaphore-queue.md
  commit: 1986dfd6734256ed9f1cedc957fcadae8cae7e6b
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: '- 已修 [case-lock-gate-reorders-global-semaphore-queue](case-lock-gate-reorders-global-semaphore-queue.md) — 用例锁取锁检查插在 preflight 之前(等待不占位的唯一位置),真实磁盘 I/O 完成顺序不等于到达顺序,打乱瓶颈优先排队隐藏依赖的"抢全局位顺序=数组序";修法=permit=1 互斥量只串行化"一次非阻塞取锁尝试",确认要等待立刻放行;旁记 `vi.advanceTimersByTimeAsync` 在真实 I/O 密集轮询链路上不可靠的独立发现。**该修法已随派发脊柱重构删除**:取锁移到授位之后,抢位路径上不再有真实 I/O,互斥量没有存在理由'
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 用例锁的取锁步骤插在 preflight 之前,打乱全局并发位排队的瓶颈优先序

## 现象

实现 `plan/exp-case-lock.md`(用例锁,契约见 `docs/feature/experiments/architecture.md#并发-invocation用例锁`)时,把取锁检查(`resolveCaseLockGate`)插进 `src/runner/run.ts` 的 `gated` Effect、`preflight` 之前——这是唯一能满足"等锁的用例不占全局并发位、不触发实验级 setup"的位置。接上后,既有回归测试 `describe("runEvals · 全局并发位在退避期间确实让给别的实验")` 开始间歇失败(约 2/3 概率),`vi.waitFor(() => expect(rSendCalls).toBe(1))` 超时——两个不相关实验(`guard-r`/`guard-w`)competing for `maxConcurrency: 2` 的场景里,`r1` 有时完全抢不到全局位。

## 根因

取锁本身是真实磁盘 I/O(`mkdir`/`open('wx')`/`writeFile`/`sync`/`close`/`fsyncDir`)。在改动前,`Effect.forEach` 派生的每个 attempt 的 fiber 都在同一个微任务里同步跑到 `globalSem.take()`(`preflight` 内部没有真实 `await`),所以 N 个 attempt 抢占 M<N 个全局位时,排队顺序天然等于 `attempts[]` 的静态数组序——这正是「派发顺序:瓶颈优先」(`docs/runner.md#派发顺序瓶颈优先`)依赖的隐藏前提:静态排序只算一次优先级,实际抢位顺序假定和数组序一致。

取锁检查插进 `preflight` 之前后,每个 attempt 在触达 `globalSem.take()` 之前都要先 `await` 一次真实磁盘 I/O。3 个不同 key(不同 experimentId+evalId)的取锁操作各自独立发起,libuv 线程池对它们的调度顺序不保证等于发起顺序——用 debug trace 实测确认:取锁本身几乎瞬时完成(entering/resolved 时间戳完全相同的毫秒),但 3 个 attempt 里哪个先"resolved"、进而先摸到 `preflight`/`globalSem.take()`,run 与 run 之间不确定。于是"谁先完成取锁的磁盘 I/O"取代了"数组序"决定了抢全局位的胜负,`r1` 有时被 `w1`+`w2` 一起抢先,凑满了 `maxConcurrency: 2`,而测试脚本只在观察到 `r1` 拿到位之后才会释放 `w1`/`w2` 的 barrier——于是死等。

用背景 agent(Explore 型)扫过全文件确认:文件里另有两处同样在 `preflight` 前插了 async 跳步的场景(`maxConcurrency: 1` 下两个 eval 的退避测试)理论上共享同一条风险,但两处断言都是对称的(不关心具体哪个 eval 先跑),侥幸没暴露;没有发现任何两个 attempt 共享同一把用例锁 key 的场景。

## 修法(已修)

不能简单把取锁挪到 `globalSem.take()` 之后——`runs>1` 时同一个锁 key 下有多个 attempt 共享同一把(memoized)锁,若每个 attempt 各自先抢到全局位再检查锁,持锁等待期间会有除第一个之外的所有兄弟 attempt 白占着全局位干等同一个 promise,`maxConcurrency` 小时会直接死锁。

最终方案:在 `resolveCaseLockGate` 里加一把 `permit=1` 的 `Effect.Semaphore`(`caseLockAcquireMutex`),只把"一次非阻塞取锁尝试"串行化——`await mutex.take(1)` → 读锁 → `acquireCaseLock(...)` → 确认真的要等待(`onWaitStart` 触发)就立刻 `mutex.release()`,不确认要等待就等 `acquireCaseLock` 整体 settle 后再释放。这保证了:

- 无竞争的常见路径(绝大多数 key)完成顺序即到达顺序——恢复了瓶颈优先排队依赖的隐藏前提。
- 真正需要等待的 key 一旦确认要等,立刻放行下一个 key 的非阻塞尝试;不同 key 之间的真实等待仍然完全并发,不会被这把互斥量串行化拖慢。

落点 `src/runner/run.ts`(`caseLockAcquireMutex` + `resolveCaseLockGate` 内的 take/release）。单测:回归测试本身连续跑 10 次确认稳定;未新增专门断言这条互斥机制的测试(观察面是"既有测试不再 flaky",互斥量本身是纯调度实现细节,不是契约的一部分)。

## 旁支:vi.advanceTimersByTimeAsync 在真实 I/O 密集的轮询链路上不可靠

调试与后续补测过程中(本条与后续 `run.test.ts`/`lock.test.ts` 补测两处独立复现)确认:`vi.advanceTimersByTimeAsync(N)` 单次大步推进,在"定时器回调 → 真实磁盘 I/O → 重新挂下一个定时器"这种链路上会在"当前看不到待处理定时器"的那一刻直接返回,把还没来得及被真实 I/O 重新挂上的下一个定时器晾在那——测试挂起到 vitest 默认超时(不是变慢,是真的永远不触发)。用例锁的等待轮询(`acquireCaseLock` 每个心跳周期都夹一次真实文件读写)恰好踩中这条件;此前仅有的 `vi.useFakeTimers()` 用例(turn 重试退避)只跨单个定时器边界,没有暴露过这条。修法:分步推进,每步之间 `await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1))` 等真实 I/O 把下一个定时器重新挂上(或目标条件已经达成)再继续推——落点 `src/runner/run.test.ts` 的 `advancePastCaseLockPolling` helper,纯测试基础设施,不涉及生产代码。
