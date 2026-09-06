---
format: niceeval.memory/v1
id: incus-clone-volume-admission-race
title: Incus 并行准备误判尚未重标记的克隆磁盘
createdAt: 2026-09-06
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_4ZWAZXWP4WRPKQH2
      - netake_R960DF8AWJXHAWPV
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/lifecycle/test/sandbox-setup-prefix-cache.test.ts#necase_APN2MNBEXSN1G18T"]}
promotions: []
---
## 观察

main CI 33973066999 的准备前缀 DAG 只启动一个 child，等待共同屏障 270 秒后失败。同一候选 SHA-256 `8d3cfed42707fcafde05d12fa8c96c358850f40fe1c30be350ed24cd47a97862` 在隔离消费项目首跑通过，第二次诊断复现单 child 等待。

## 根因

Incus copyInstance 原子复制 VM 与 dependent volume，随后独立 PATCH 才为磁盘写入目标 allocation metadata。admission lease 只覆盖 reconcile、容量检查与 reservation，因此另一 child 的 reconcile 可以读到带源 artifact metadata 的磁盘。最终 volume 校验仅接受目标 metadata，将这份仍由 exact creating VM 拥有的磁盘误报为未登记资源。失败分支已结算，另一分支在测试 rendezvous 等待，造成表面超时。VM 列表与磁盘列表也是独立快照：copy 可能夹在两次读取之间，初始 allocation 快照还可能停在 reserved；只匹配旧 VM 列表仍会漏掉合法 clone。

## 修复边界

仅为 creating allocation 接受 exact VM、精确 providerLocator、精确 dockerDataVolume、同 domain/project 与 dependent disk device 共同证明的短暂窗口。遇到不匹配时，重读同 generation allocation 与精确 VM。如果 PATCH 已先完成，则重读磁盘并要求目标 metadata 完全匹配。ready 等稳定状态及无 exact owner 的资源仍不能借旧 metadata 放行，不延长 admission lease 来串行化准备。

## 验证

沿既有 necase_APN2MNBEXSN1G18T 固定外部 copy/PATCH 窗口；fixture 在两次 concurrent inventory 观察后才放开 metadata PATCH。正式 red、green 与可靠性接管通过后再关联 regression 并关闭本 Problem。Runner 的 30 秒启动观察与 OpenCode Go 外部失败是独立问题。
