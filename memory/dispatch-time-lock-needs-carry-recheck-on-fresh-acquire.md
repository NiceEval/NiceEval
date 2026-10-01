---
format: concord.document/v1
id: dispatch-time-lock-needs-carry-recheck-on-fresh-acquire
title: 派发时刻取锁后,「全新取到空锁」也必须重查携带,否则多开会把对方刚跑完的用例再跑一遍
createdAt: 2026-07-24T19:34:23+08:00
createdAtSource:
  kind: first-recorded
  path: memory/dispatch-time-lock-needs-carry-recheck-on-fresh-acquire.md
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
    statement: "- 已修 [dispatch-time-lock-needs-carry-recheck-on-fresh-acquire](dispatch-time-lock-needs-carry-recheck-on-fresh-acquire.md) — 取锁改派发时刻后静态携带规划会过时:对方在「我们规划完」到「我们派发」之间跑完并释放锁,我们干净取到空锁就把它再跑一遍(双开冒烟 6 条里双跑 1 条,开实验闸时全部重跑);修法=multiOpenSeen 判定多开时全新取锁也重查携带。同批记 --force 撞锁不发 lock_wait resolved、租约轮询让进程内名额交接空等 10s 两个坑"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 派发时刻取锁后,「全新取到空锁」也必须重查携带,否则多开会把对方刚跑完的用例再跑一遍

## 现象

实现 plan/runner-dispatch-spine-refactor.md 节点 C1 后,做双 Invocation 冒烟(同一个
`niceevalRoot`、完全重叠的 6 条用例、各 2 并发,fake agent + fake sandbox):两边都拿到完整
结果集、锁目录收尾为空,但**有一条用例被真实派发了两次**(`e4=2`,其余 5 条各 1 次)。
换一组随机时序,双跑的是哪一条会变。开了实验闸(`maxConcurrency: 1`)时更夸张:后到的那条
Invocation 等到名额时对方已经整批跑完,6 条用例**全部**被重跑一遍。

## 根因

取锁从计划期挪到派发时刻之后,静态携带规划(`planCarry`,启动时算一次)的有效期从「整场」
缩成「规划到这条用例真正派发之间」。这段窗口里对方 Invocation 完全可能把某条用例整条跑完、
落盘、并释放锁。等我们派发到它时,锁是空的——于是取锁**既不撞锁、也不接管**,干干净净地
拿到,原实现只在「等待过」或「接管过」两条路径上重查携带,这条路径就照着过期的规划又跑一遍,
违反契约的「两条选择有交集的 Invocation……交集部分只花一份成本」。

实验闸把窗口放大到极致:等名额本身就是一段任意长的等待,等完了对方那批早已落盘。

## 修法(已修;第一版已被推翻)

第一版:`src/runner/run.ts` 引入 `multiOpenSeen`,判定「这个结果根上还有别的 Invocation 在动」
就在**全新取锁**这条路径上也重查一次携带。判据是几个便宜的信号叠加——启动时锁目录非空 /
取锁前读到过别人的记录 / 撞过锁 / 接管过 / 实验闸名额被别人占满等过。之所以只能是启发式,是
因为重查要 `loadLatestResultsPerEval` 全树扫描(110 ms/条),没法每条用例无条件做。它自认留了
一个「并行 Invocation 全程与我们零碰撞」的残留窗口。

**这一版已被推翻**:那个残留窗口不是低概率巧合,是确定性的(先起跑一侧的第二波必然重跑),
而且「重查太贵」本身是读取面粒度用错造成的假前提。定稿修法见
[multi-open-residual-window-closed-by-narrow-read](multi-open-residual-window-closed-by-narrow-read.md)
——收窄读把重查压到 0.3–0.9 ms/条,取到锁一律重查,`multiOpenSeen` 整个删除。

同批发现的两个相关坑:
- `--force`(`opts.priorResults` 恒为 undefined)下真实撞锁等待只发了 `lock_wait started`、不发
  `resolved`,`elsewhere` 计数永远挂着、五项恒等式当场破。重查可以关,窗口必须如实关闭。
- 实验闸租约撞满后按轮询周期(默认 10s)重试,**进程内**名额交接也要空等一整个周期。修法是
  在租约之前垫一把 permit = resolved N 的进程内信号量:permit 在本进程内即时交接,租约仍是
  跨 Invocation 的名额权威。
