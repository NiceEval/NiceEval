---
format: niceeval.memory/v1
id: eval-group-retained-sandbox-capacity-deadlock
title: Eval Group 保留 Sandbox 导致 provider capacity 死锁
createdAt: 2026-08-31
kind:
  type: problem
  state: open
promotions: []
---
## 现象

当一个 Experiment 含有多条 Eval Group lane，且物理 Sandbox provider 容量小于 Group 数量时，已完成的 Group 仍保留自己的 reusable Sandbox，尚未启动的 Group 永远等不到 provider capacity。队列仍有工作，但运行数逐步降到零。

## 根因

每个 Eval Group 拥有独立 `ReusableSandboxPool`，但 pool 只在整个 Experiment teardown 时停止。Experiment teardown 又要等待所有 Group Attempt 结算，因此“未启动 Group 等容量”与“已完成 Group 等 Experiment 结束才释放容量”形成循环等待。全局/Experiment permit 在 provider admission wait 时会正确释放，Docker profile 也正确执行容量约束；问题是 Runner 的 Group pool 生命周期过长。

## 修复目标

Group 的全部非 carry Attempt 一旦结算，就冻结并停止该 Group 的 pool，释放物理 provider capacity；停止后的 pool 继续作为 registry tombstone，禁止晚到路径重新创建。Attempt scope 清理必须先于 Group stop，Group stop 必须先于 Experiment teardown/sharedState release。Group stop 失败只形成 cleanup diagnostic 与 Experiment cleanup failure，不改写已封存 Verdict，也不阻塞其它 Group。

## 回归证明

正式 E2E 从公开 `niceeval exp` 入口运行两个 Eval Group、三个 Eval；受控 Docker profile 的物理容量为 1。修复前第二个 Group 永久等待；修复后只创建两个物理 Sandbox，最大同时活跃数为 1，最终活跃数与 reservation 均为 0。

## 2026-09-05 证据复查

本轮将该 owner 的 Session 读取改为候选公开严格 decoder，并修复它使用的作者 callback ABI。原红绿凭据绑定的是旧测试源码；当前 source hash 已不相同，不能继续把旧 fixed 凭据当作当前完整回归证明。保留原始调查与 resolution history，暂时 reopen；这表示证据需重新绑定，不表示已经确认 Group pool 的生产死锁复发。当前候选的公开 Journey 需重新验收，重新 fixed 仍须当前源码的独立红灯与完整 takeover。
<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `5a1bc84e8944350574f07553b21ff61cbbd70f0a`

```json
{
  "kind": "fixed",
  "proof": [
    "e2e/runner/test/provider-capacity-queue.test.ts#necase_VXE9ARZNBMZ6V0JT",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/runner/test/provider-capacity-queue.test.ts#necase_VXE9ARZNBMZ6V0JT\"]}"
  ]
}
```
