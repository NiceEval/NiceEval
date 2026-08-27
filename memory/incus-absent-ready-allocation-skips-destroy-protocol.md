---
format: niceeval.memory/v1
id: incus-absent-ready-allocation-skips-destroy-protocol
title: Incus 对账为缺失 ready allocation 跳过销毁协议
createdAt: 2026-08-26T19:32:40+08:00
kind:
  type: problem
  state: open
promotions:
  - kind: feature
    current:
      - docs/feature/sandbox/nested-docker/lifecycle.md#sigkill-与控制进程重启
    history: []
---
# Incus 对账为缺失 ready allocation 跳过销毁协议

## 观察

NiceEval-Eval 的真实 Incus SetupPrefix builder 在 allocation 进入 `ready` 后被宿主进程强制终止，operator 随后按 allocation metadata 精确删除 VM 与 dependent volume。下一次 `reconcileDomain()` 看见 owner 已死且两个 Provider object 均 absent，却报错：

```text
Incus allocation 052d93df-d8b6-440d-82ce-2e882d228850 attempted an invalid ready -> destroyed transition
```

`niceeval sandbox provider doctor incus --development` 因仍占用这笔 intent，只显示 `3 free of 4`。

## 根因

object 双 absent 分支直接调用 `transitionAllocationIntent(... state: "destroyed")`。这只碰巧适用于部分前态；`ready` 必须与正常 detached destroy 一样先经过 fenced `destroy-requested`，再凭 instance 与 volume 的 absent receipt 提交 `destroyed`。

## 修复与验证

缺失 object 且 owner 已证明死亡时改走既有 `destroyAllocation()`，不再另写一条简化状态迁移。以原始 ledger 与已删除的 exact Provider object 重跑同一 reconciler 后，active allocation 与 instance 均为零；安装后的 candidate doctor 恢复 `4 free of 4`，active session 为零。

Problem 保持 open，直到真实 Incus lifecycle E2E owner 以 canonical regression 接管这条强杀后对账路径。
