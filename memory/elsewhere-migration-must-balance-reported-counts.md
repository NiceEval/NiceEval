# `elsewhere` 的迁出条数必须等于迁入条数,不能拿收尾时的 `pending.size` 现算

## 现象

五项恒等式 `total = reused + running + elsewhere + queued + completed` 在两种时序下出问题:

1. **`elsewhere` 挂账不平**:撞锁挂起期间用户 Ctrl+C,窗口里的某条 attempt 提前 settle 让
   `CaseLockState.pending` 缩水;收尾的 `lock_wait resolved` 按缩水后的 `pending.size` 报
   `carried + dispatched`,比 `started` 当初报进去的 `attempts` 少,差额就永远挂在 `elsewhere` 上。
   `cli.ts` 的 `assembleInvocationCompletion` 只把 `state.queued` 计入 `unstarted`,这几条既不在
   `queued` 也没进 `completed`,最终帧的恒等式当场破。
2. **`queued` 瞬时为负**:接管过期锁 / 多开下的全新取锁会补一对瞬时的 `started` + `resolved`
   把携入的 attempt 从 `queued` 迁进 `reused`。旧实现这对事件报的是**整组** `pending.size`,而
   `recheckCarry` 里有 `await`(读盘 + `planCarry`);`runs > 1` 时兄弟 attempt 在这段 await 里看到
   `st.claim` 已置位、直接放行进了 `running`。等这对事件补发时,组里已经有人不在 `queued` 了,
   `queued -= attempts` 就把它扣穿。恒等式的和仍然守恒(减多少加多少),但 `progress` 心跳会给
   消费方一个 `queued: -1`。

## 根因

reducer 只按事件携带的数字加减(纯函数、不自己推),所以「报进去多少条就要报出来多少条」是
**emitter 的义务**。`run.ts` 两处都把这个数字当成「此刻还剩几条待办」现算,而 `pending` 是一个
会被别的路径(attempt settle、兄弟抢先派发)改动的活状态,两个时刻算出来的不是同一批 attempt。

## 修法

- `CaseLockState` 加 `inElsewhere`:`suspendUntilCaseFree` 开窗时记下报进 `elsewhere` 的条数,
  `recheckCarry` 收尾时读它并清零,`carried + dispatched` 恒等于它(`carried` 取
  `min(本轮新携入数, inElsewhere)`)。
- 没有窗口要关的那对瞬时事件(接管 / 多开全新取锁)**只报真正携入的那几条**:没携入的兄弟
  从没离开 `queued`,把它们也报一遍纯属无意义往返,还制造上面第 2 条的中间帧。

落点:`src/runner/run.ts` 的 `recheckCarry` / `suspendUntilCaseFree`(节点 C3)。
`src/runner/feedback/reducer.test.ts` 的 `replay()` 每步都断言五项非负,这类 emitter 侧的失衡在
reducer 单测里看不见——断言面必须是 runner 级(`run.test.ts` 用 `withCoordinator` 读
`coordinator.state`)。
