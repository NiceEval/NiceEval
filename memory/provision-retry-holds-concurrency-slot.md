---
format: concord.document/v1
id: provision-retry-holds-concurrency-slot
title: provision-retry-holds-concurrency-slot
createdAt: 2026-07-11T19:03:27+08:00
createdAtSource:
  kind: first-recorded
  path: memory/provision-retry-holds-concurrency-slot.md
  commit: 08d4d443c1b6ececbe46a851e21e3cf30afba00c
description: 已修 — provisioning 退避重试期间攥着 sandboxSem 名额,一批 429 能把实际并发拖到个位数
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: 已修 — provisioning 退避重试期间攥着 sandboxSem 名额,一批 429 能把实际并发拖到个位数
    proof: []
    source:
      path: memory/provision-retry-holds-concurrency-slot.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:bfba3c080faa5cc81b27f5615f84e88f0aab9f1da739c2b198a0e480c268a4a8
---

## 现象

`niceeval exp <组>` 显式设了较高并发(如 `--max-concurrency 19`,表头也确实打出 `concurrency 19`),但实时表里同一时刻真正在跑(spinner / `turn N →` 文案)的行常年只有个位数(观测到 7 个左右),其余大量行卡在 `waiting for a slot...`,且这个状态会持续相当长时间,不是短暂的启动抖动。

## 根因

`src/runner/attempt.ts` 里 `sandboxSem.withPermits(1)(...)` 包住的是**整个** `createSandbox()` 调用,而 `createSandbox()`(`src/sandbox/resolve.ts`)内部的 `withProvisionRetry`(`src/sandbox/retry.ts`,d4c028b 引入)在遇到 provider 限流(`rate_limit`)时会指数退避重试,最多 4 次、单次睡眠可达数秒。退避期间只是在 `setTimeout` 里睡觉,并没有真的在创建沙箱,但因为整个 `createSandbox()` 都包在一次 `withPermits(1)` 里,这个并发槽位在睡眠期间仍然被占着。当 provider(典型是 e2b)瞬时限流命中一批并发 create() 调用时,这批 attempt 会**同时**进入退避睡眠,同时攥着并发名额干等,活人能用的名额随之被压缩到远低于 `maxConcurrency` 声明值——正是"表头写 19、实际跑 7"的机制性成因。

## 修法

`src/sandbox/retry.ts` 新增 `ProvisionSlot` 接口(`release()` / `reacquire()` 两个 async 方法,不认调用方是不是 Effect,保持这层 provider 无关);`withProvisionRetry` 在进入退避 `setTimeout` 前调用 `slot.release()`,睡醒后 `finally` 里 `slot.reacquire()`。`src/sandbox/resolve.ts` 的 `createSandbox()` / `createProvider()` 把 `provisionSlot` 一路透传给 `withProvisionRetry`。`src/runner/attempt.ts` 用 `Effect.Semaphore` 的 `release(1)` / `take(1)`(而不是 `withPermits`,后者只支持整体 acquire-once/release-at-end 的作用域式用法)适配出这个 slot,传入 `createSandbox({ ..., provisionSlot })`——外层仍用 `withPermits(1)` 包一次完整调用兜底正常/中断路径的释放,内层退避期间的临时归还/收回是嵌套在同一个信号量计数上的,语义自洽(Effect Semaphore 的 permit 不是按 fiber 归属的,可以跨调用点 take/release)。

同步补了 `docs/sandbox.md`「Provisioning 失败与重试」小节的一句契约声明,以及 `src/sandbox/retry.test.ts` 覆盖三种路径(一次成功不碰 slot、不可重试错误不碰 slot、可重试错误 release→睡眠→reacquire 的顺序)。

## 适用场景

任何"重试/退避逻辑被包在一个更大范围的并发信号量里"的地方都要想到这个反例:信号量应该只覆盖"真正在做事"的那段时间,睡眠等待不算,否则限流触发的退避会反过来把用户设的并发上限打对折甚至打到个位数。见 [[sandbox-provision-ratelimit-retry]](该条目记的是"限流按 provider 归类 + 退避重试放 resolve.ts"这个更早的裁决,本条目是那个设计落地后暴露的一个执行细节 bug)。
