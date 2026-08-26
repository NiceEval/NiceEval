---
format: niceeval.memory/v1
id: incus-artifact-publication-cross-process-race
title: Incus artifact publication 把跨进程 loser 当成 reservation owner
createdAt: 2026-08-26T00:55:00+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Incus artifact publication 把跨进程 loser 当成 reservation owner

## 现象

两个安装后的 NiceEval Invocation 并行运行 Install 与 Harness，并共享同一 digest-pinned Incus base 与 artifact project。Harness 的前两条 Attempt 已完成评分，第三条却在 Attempt 创建前以 `Artifact publication is fenced by its reserved generation and project.` 失败；公开收据为 run `b6cd98e5-3bfc-4a1b-b9bc-f81642cdc8e1`。

## 根因

Run 级 coordinator 只在准备链起点 lookup 一次。两个进程同时 miss 同一 SetupPrefix 后，各自执行 action 并进入 capture。旧 `reserveIncusArtifact()` 只在短 admission lock 内创建 intent，却把别人已有的 `reserved | preparing | publishing` intent 作为自己的 reservation 返回；publication 位于锁外，写 ledger 又只有原子 rename、没有 compare-and-swap。

因此 loser 若较晚进入，会拿到 winner 的 `publishing` 快照并触发 fence；若更早进入，双方会拿到同一 `reserved` 快照并并发 copy/覆盖同一 intent；若 winner 已 committed，loser 又会重复建 artifact。原 fence 只检查调用方手里的旧对象，没有重读当前 generation 与完整 preparation identity。

## 修复边界

Incus Provider 用 execution domain、artifact project、SetupPrefixKey 与 manifest digest 派生 exact-prefix 跨进程锁。不同 prefix 继续并行；同 prefix 只有锁持有者可以 reserve/publish。等待者取得锁后必须从 committed intent 重新验证 stopped VM、dependent Docker data volume 与双向 metadata，再复用 winner locator。publication 在 mutation 前重读 ledger，并核对 current generation 与完整 preparation identity。

进程死亡后只按 exact intent/object reconcile：完整 publishing tuple 可以提交；identity 漂移进入 quarantine；多个 committed/in-flight candidate、generation/project 漂移、tuple 验证失败与真实 quota exhaustion 仍 fail closed。loser 自己的 prepare VM 由既有 Effect scope finalizer 销毁，不能删除 winner 资源。

## 验证状态

保持 open，直到修改后的 installed candidate 再次并行运行 NiceEval-Eval 的 Install 与 Harness，证明同-prefix winner/loser 正确收敛、两组业务结果完整读回，并确认 execution project 无 orphan。真实 Incus Provider 与付费模型条件不进入确定性 CI，本轮使用公开 CLI dogfood 收据验收。
