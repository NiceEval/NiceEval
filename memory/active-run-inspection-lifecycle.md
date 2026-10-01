---
format: concord.document/v1
id: active-run-inspection-lifecycle
title: Inspection 把部分发布的 Run 误呈现为完成
createdAt: 2026-09-07
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: |-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - netake_285XFX4X679TK3GB
            - netake_P8KT8TMM795FGW24
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-journey.test.ts#necase_71RKBRSMD0ER677F","e2e/record/test/record-journey.test.ts#necase_SVJG4JP8WN5TWCQF"]}
    proof:
      - netake_285XFX4X679TK3GB
      - netake_P8KT8TMM795FGW24
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-journey.test.ts#necase_71RKBRSMD0ER677F","e2e/record/test/record-journey.test.ts#necase_SVJG4JP8WN5TWCQF"]}
    source:
      path: memory/active-run-inspection-lifecycle.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:53d8595eb681ff2419349593b057d328d6831b53988190280642f9832acd7007
---
# Inspection 把部分发布的 Run 误呈现为完成

## 问题与根因

Run create 和生命周期已持久化，run list/show 能读取它们。Inspection 却只枚举已发布 Core，并把阶段性 Core 的 completedAt 当成整次运行完成时间。零 Attempt 发布时找不到 Run；部分发布时 query 暴露提前时间，show 固定显示 sealed。

## 修复边界

从同一 pinned reader 内的 Run resource 取得真实状态、expected slots 和终态时间。Inspection 保持 run.value、members、attempts 的既有包装，不改持久 Core 或 SQLite schema。active Run 不提供最终 completedAt，未发布 slot 为 pending；终态使用 Run close 事实解释 absence。

读取身份必须覆盖 Run create 和 close，不能只散列已发布 Core。采用同一事务中的 publication clock，避免相同 cutoff 下跨请求看到不同生命周期。

## 红灯

旧候选源为 `fc6f749556e81ab4a2c68e6edc36e30c2b2743d4`，SHA-256 为 `535194ac72b8350c135125463ebbdab8189ab70b45155c8a199cc1ef1fb2ae04`。

- `nered_PNS8R1VDWZJT24SN`：已创建 Run、首个 Attempt 尚未发布时，公开 query 返回 not found。
- `nered_T9ZFE5P5HDKSNZ85`：第一条 Attempt 发布后，run.value 缺少 active 状态并提前包含 completedAt。

测试通过确定性 backend 阻塞和释放建立阶段，不用固定延时猜测 publication，不读取内部数据库作为状态 oracle。
