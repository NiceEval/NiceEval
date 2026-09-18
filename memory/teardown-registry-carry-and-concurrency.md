---
format: concord.document/v1
id: teardown-registry-carry-and-concurrency
title: 全携带与并发 run 曾使实验级收尾义务丢失
createdAt: 2026-07-22T21:11:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/teardown-registry-carry-and-concurrency.md
  commit: 4b37775c604228a4be3d167153da3b574e96ab0e
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
    statement: "- 已修
      [teardown-registry-carry-and-concurrency](teardown-registry-carry-and-con\
      currency.md) — 全携带零派发曾跳过强杀遗留的启动自愈，单实验槽位又会让并发 run 互相覆盖；修为调度前逐条认领与
      experimentId+pid 条目键"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 全携带与并发 run 曾使实验级收尾义务丢失

## 现象

强杀发生在实验级 teardown 执行期后重跑同一命令时，已完成的 attempts 全部被 carry，调度器零派发，原先只由首个派发 attempt 触发的启动自愈因而永不执行。另一个独立缺陷是收尾登记只按 `experimentId` 命名：同宿主并发运行同一实验时，后写登记覆盖前者，先结束的 run 又会删掉仍在运行的另一份义务。

## 根因

启动自愈被错误地当作 setup 的局部前置步骤，而不是选中实验的启动期职责；登记表的数据键也没有表达并发 run 这一契约事实。

## 修法

2026-07-22：`src/runner/run.ts` 在 attempt 调度前按选中实验扫描、原子认领并补执行所有遗留登记；无 `teardown` 的新定义由 CLI 保留提醒。`src/runner/teardown-registry.ts` 的条目键改为 `experimentId + pid`，正常收尾只删除本进程条目，自愈和 `--teardown` 均逐条扫描并认领。`experimentFile` 曾按命名惯例编造，无法代表真实来源，随登记契约一并删除。

回归由 `run.test.ts` 的零派发自愈与 `teardown-registry.test.ts` 的双 pid 隔离覆盖。
