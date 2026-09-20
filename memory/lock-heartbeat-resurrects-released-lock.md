---
format: concord.document/v1
id: lock-heartbeat-resurrects-released-lock
title: 心跳续租在飞时释放锁,锁文件会被写回复活(已修)
createdAt: 2026-07-24T19:34:23+08:00
createdAtSource:
  kind: first-recorded
  path: memory/lock-heartbeat-resurrects-released-lock.md
  commit: 02744945e816e83584ce727a7d69aed7b2e5c89e
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
    statement: "# 心跳续租在飞时释放锁,锁文件会被写回复活(已修)"
    proof: []
    source:
      path: memory/lock-heartbeat-resurrects-released-lock.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:b39f53042ab26dff8c10e4e657596a01cc6d0ba7703a5b91493cee6e7aa49665
---
# 心跳续租在飞时释放锁,锁文件会被写回复活(已修)

## 现象

跑完的用例已经调过 `claim.release()`(删掉了锁文件),`.niceeval/locks/` 里那条锁却又出现了。
最小复现(40 次里复活 39 次):

```ts
const { claim } = await acquireCaseLock(root, "e", "v", { pid: 1, host: "h" }, { heartbeatIntervalMs: 1 });
await sleep(5);            // 让某次心跳正在飞
await claim.release();
await sleep(20);
await readdir(locksDirOf(root)); // → 锁文件还在
```

在单测里表现为间歇 flaky:`run.test.ts` 的「撞新鲜锁的用例不派发……」末尾
`expect(await lockFilesRemaining(root)).toEqual([])` 偶尔拿到一条已经跑完的 eval 的锁
(该用例用假时钟一次推 40s,正好让若干次心跳落进另一条 eval 的释放窗口)。全量 `pnpm test`
负载高时更容易命中,单跑该文件几乎不复现。

真实后果:一次运行结束后磁盘上留下一把「新鲜」的锁,下一条 Invocation 撞上它要白等到心跳
过期(30s)才接管——与契约「整批结束后 `.niceeval/locks/` 为空」相悖。

## 根因

`src/runner/lock.ts` 的心跳回调是一段「读—改—写」:

```ts
const current = await readEntryFile<CaseLockRecord>(dir, id);
if (current === undefined) return;
await writeEntryFile(dir, id, { ...current, heartbeatAt: ... });   // ← 这中间锁可能已经被释放
```

`release()` 只做 `clearInterval(timer)` + `rm()`。`clearInterval` 拦不住**已经进入回调、正卡在
`readEntryFile` 的那一次**心跳:它读到的记录还在,等它 `writeEntryFile`(tmp → rename)时锁文件
已经被 `rm` 掉了,于是原路径被重新创建出来。心跳周期越短、释放与心跳越同步(假时钟一次推进
多个周期就是极端情形),命中概率越高。

`src/runner/gate-lease.ts` 的 `renewHeartbeat` 是同一套形状(多一道 `isSameHolder` 判别,但那只
防「槽被别人接管」,不防「自己刚释放」),同一条竞态成立。

## 修法(已修,commit `bd97c9e8`)

先试了"写回之前再查一次 released 标志"(把 `released` 传进 `renewHeartbeat`,在读之前、写之前
各查一次),**实测不够**:1ms 心跳周期下仍然 40/40 复活。根因是检查点本身不是问题——问题在于
一旦某次心跳通过检查、开始调用 `writeEntryFile`,那次调用内部(`mkdir` / 写临时文件 / `rename`)
自己还有多个 `await` 点,`release()` 完全可能在这些 `await` 之间跑完 `rm`,随后心跳的 `rename`
才落地,复活文件。单纯"检查更早"关不上这条缝,因为决定写和写完成之间总有异步窗口。

真正的修法是让 `release()` 承担"排空"责任而不是抢在心跳前面:`acquireCaseLock` / `acquireGateSlot`
内部维护一个 `inFlight: Set<Promise<void>>`,每次心跳发起时登记、结束时摘除;`release()` 先
`clearInterval`(不再有新心跳发起),再 `await Promise.all(inFlight)`(等所有已发起的心跳落地,
不管它们写没写),确认没有写回还在路上,才 `rm`。`renewHeartbeat` 里的 `released` 检查保留(减少
不必要的写回),但真正保证正确性的是排空等待,不是检查时机。落点:`lock.ts` 的 `acquireCaseLock`、
`gate-lease.ts` 的 `acquireGateSlot`,两处同构一起改。

回归测试用极短心跳周期(1ms)重复 40 轮取锁-释放,断言目录始终为空——与本条台账最初的复现手法
完全一致,是验证这类修法是否真正关闭竞态的可靠手段(而不是理论上"看起来对"就够)。

发现于 plan/runner-dispatch-spine-refactor.md 节点 C1(派发时刻取锁)实现期。取锁时机从计划期
挪到派发时刻之后,单条用例的持锁窗口更短、更容易与假时钟推进的心跳重叠,这条一直存在的竞态
才浮出来——它不是 C1 引入的。
