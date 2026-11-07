# 止损闸不是「一把 Effect.Latch」:同步读与 Promise 世界的等待各要一个载体

## 现象

按 `docs/feature/error-classification/architecture.md`「Effect 边界」的字面提示,止损闸用
`Effect.makeLatch` 实现(close 幂等 → 落闸幂等)。真接线时发现单靠 latch 落不了地,两处卡住:

1. **派发检查点读不出闸的状态**。`checkDispatchHalt(a)` 在许可链的每一轮循环开头被调用,是个
   同步函数(返回 `{halted}` 让调用方立刻决定要不要记账并 return)。`Effect.Latch` 的公开面只有
   `open` / `unsafeOpen` / `close` / `unsafeClose` / `await` / `release` / `whenOpen`——**没有任何
   同步的状态读**。要用 latch 表达状态,检查点就得变成 `yield* latch.await` 或
   `latch.whenOpen(...)`,而那两个的语义都是「等」,不是「问」——闸的契约恰恰是**不等,直接不派发**。
2. **等待集有一半根本不在 Effect 世界里**。`run.ts` 的两处长等待——实验闸名额租约
   (`acquireGateSlot`,Promise + `AbortSignal`)与撞用例锁后的 elsewhere 轮询
   (`delayOrAbort`,Promise + `AbortSignal`)——都是 Promise 世界的原语,`latch.await` 对它们
   没有作用力。而契约要求「等待集中同闸的 attempt 走既有 interruption 中止、退出等待集」,
   这两处正是唯一可能**无限期**等下去的地方(对方 Invocation 一直持锁 / 一直占着名额)。

## 根因

`Effect.Latch` 是**同步点**原语(让一批 fiber 停在门口,开门放行),不是**状态位**原语。止损闸
需要的是「状态位 + 唤醒」两件事:状态位要能被 Effect 之外的同步代码读,唤醒要能同时作用于
Effect fiber 和 Promise 世界的 `AbortSignal` 链。一个 latch 只覆盖后者的一半。

## 修法

闸做成三件套(`src/runner/run.ts` 的 `interface HaltGate`,commit 737f1344):

| 载体 | 角色 | 为什么不能省 |
| --- | --- | --- |
| `latch: Effect.Latch`(`unsafeMakeLatch(false)`,落闸 = `unsafeOpen()`) | 「等到这把闸落下」的 Effect,给排在**全局并发位**上的 fiber 当中止信号 | `open` 幂等且不可回退,把「落闸幂等、invocation 内不可逆」变成结构保证而不是调用方自律 |
| `halted: boolean` | 同步镜像,派发检查点读它 | Latch 没有同步状态读;检查点每轮循环问一次,不能为此付一次 await |
| `abort: AbortController` | 唤醒 Promise 世界的等待(gate-lease 名额、elsewhere 轮询) | 那是本仓既有的 interruption 通路,不为止损闸另造第二条 |

三者在 `closeHaltGate` 里同一时刻置位,顺序固定 **先置 `halted` 再 `unsafeOpen()`**——反过来会
出现「latch 已开、同步镜像还是 false」的窗口,被唤醒的 fiber 回到循环顶发现闸没落,又重新入场
排队,空转一圈。

**旁支两条(都是当场踩到的)**:

1. **竞速取全局位时 `ensuring(release)` 必须提到最外层**。`withGlobalSlot` 用
   `Effect.raceFirst(reacquire, haltSignal)` 让等位的 fiber 能被闸打断。极端时序下
   `globalSem.take(1)` 已经成功、竞速却判 `haltSignal` 赢(两个 fiber 同一 tick 内先后 resume),
   这时旧写法的 `ensuring(release)` 只挂在「拿到位子」的分支上,那个 permit 就**永久泄漏**,全局
   并发上限被静默减一。修法是把 `ensuring(release)` 挂在竞速之外(`release` 本来就按
   `state.held` 幂等,没拿到位是 no-op)。
2. **闸中止 elsewhere 挂起窗口时,窗口仍必须跑完 `recheckCarry` 并发出 `lock_wait resolved`**。
   少发一次 resolved,这批 attempt 就永远停在 `elsewhere` 上,五项计数恒等式当场破(与
   `--force` 路径上曾经漏发 resolved 是同一个坑)。所以中止只作用于轮询的 `delayOrAbort`,
   不作用于窗口本身。

## 落地状态(2026-07-24 复核:已实现)

三件套全部在 `src/runner/run.ts` 里:`interface HaltGate`(约第 795 行)三个字段
`latch: Effect.Latch` / `halted: boolean` / `abort: AbortController` 齐备,`haltGateOf()` 用
`Effect.unsafeMakeLatch(false)` + `new AbortController()` 预先建闸(不懒建,好让等待中的 fiber
先订阅),落闸路径 `gate.latch.unsafeOpen()`。上面那段「先置 `halted` 再 `unsafeOpen()`」的顺序
约束已写进 run.ts 的紧邻注释,不靠这条 memory 传递。

## 适用场景

任何要给「跑到一半的调度」加一道**只停新派发、不抢占在飞**的闸时:先分清检查点是「问」还是
「等」,再数清等待集分布在 Effect 和 Promise 哪几个世界里——Effect 原语选型按这两条走,不按
文档里出现过的那个类名走。
