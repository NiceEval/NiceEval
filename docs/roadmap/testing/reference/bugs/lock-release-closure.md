# Bug 组：释放完成后不能再有旧写入到达

这一组用 case lock 被在飞心跳写回复活作正例，用 experiment gate lease 的同形竞态作反证。
它没有新增原语：两次真实 CLI action、NDJSON lock 事件和最终结果身份已经足够。

## 正例：已经释放的锁重新出现

fix commit `bd97c9e8` 前，`release()` 只清 interval 再删锁文件。
一次已经进入“读—改—写”的心跳可能在删除之后才完成 rename，把刚删掉的路径重新创建。

真实症状是第一条 Invocation 已结束，第二条立刻运行同一 eval 时仍撞到新鲜锁，白等到过期才能接管。
单跑测试几乎不复现，全量负载和短心跳下更容易命中。

旧测试能证明定时器停止和文件被删，却没有证明删除之后再无旧写入到达。
修复让 release 先阻止新心跳，再等待所有已发起心跳 settle，最后删除；新增单元用 1 ms 心跳重复 40 轮。

单元压力测试适合关闭极窄竞态，但用户侧不应读取 `.niceeval/locks` 内部文件或比较 30 秒：

```ts
runnerBehavior(completedInvocationLeavesNoFreshLockForTheNextOne, async () => {
  const clone = await w.clone("sequential-force-runs");
  await clone.run("first-force-run");
  const second = await clone.run("second-force-run");
  const events = ndjsonEvents(second.stdout);

  expectObserved(events.lockWaits({ eval: "memory/x" })).toShowExactRows([]);
  expectObserved(events.attempt("memory/x@a0").verdict()).toEqualValue("passed");
});
```

两次 action 使用不同真实进程并绑定同一 private clone。
第二次加 `--rerun all`，避免 carry 在取锁前直接满足请求而让 proof 恒绿。

## 同形反证：实验级并发限制租约也会复活

`src/runner/gate-lease.ts` 有同一份异步心跳形状。
只修 case lock 会让单进程或单实验 proof 变绿，多开 Invocation 的实验级并发限制仍可能留下租约。

`bd97c9e8` 同时修改两处并各加一条竞态单元。
可复用结构守护应让所有 heartbeat lease 实现通过同一 contract case：release 返回后等待若干调度轮次，存储中没有当前 holder 的条目，后继 acquire 不进入 wait。

用户侧只保留 case lock 的代表 proof；gate lease 由同一单元 contract case负责，避免两条昂贵 E2E 重复证明同一关系。

## 六项检查

| 检查 | 判断 |
|---|---|
| 契约不变不误红 | 不比等待毫秒；只断后继 Invocation 不出现无属主 lock wait |
| 不能改断言放行 | 第二次明确 `--rerun all`；不能接受“最终 30 秒后通过” |
| 观察失败显式报错 | lock 事件缺身份或 attempt 未启动分别在 observe 报错 |
| 用户侧直接定位 | 列两次 action、eval、holder、lock_wait 事件与结果 |
| 设施不造假 | 私有结果根、两个真实进程；单元竞态测试另用高频心跳放大概率 |
| 用户已有用法不改 | 普通并行 Invocation 与 `--rerun all`，Eval 不加同步点 |
