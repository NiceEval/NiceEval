---
format: concord.document/v1
id: retry-reacquire-delays-interruption
title: 退避槽位收回会延后中断传播
createdAt: 2026-07-22T21:11:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/retry-reacquire-delays-interruption.md
  commit: 4b37775c604228a4be3d167153da3b574e96ab0e
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---
# 退避槽位收回会延后中断传播

## 现象

turn 重试在退避前释放并发槽位。睡眠被中断后，执行体仍会等待重新取得该槽位，随后才向外传播中断；高并发下这个等待可能超过用户预期。

## 裁决

当前优先保证 permit 记账守恒：释放过的槽位必须重新取得，不能因中断永久丢失名额。该阶段性取舍已在 `docs/feature/error-classification/architecture.md` 的重试执行体表格公开；若以后需要更及时的中断，必须先改造槽位所有权协议，不能直接跳过 reacquire。
