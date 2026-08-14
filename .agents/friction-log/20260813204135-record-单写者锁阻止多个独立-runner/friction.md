---
title: 'Record 单写者锁阻止多个独立 runner 共享正式结果目录'
severity: 'major'
---

## Expected Behavior

同一批互不重叠的实验可由多个独立 shell 并行执行，并安全写入同一个 Record；至少应提供官方的多写者协调机制，使一批结果天然落在一个可查看、可审计的目录中。

## Current Behavior

Record 采用单写者锁。MemoryBench 五条件批次若让五个独立 shell 指向同一 Record，后启动者无法写入，因此只能为每个 shell 创建隔离 Record。结果虽可分别判定，但正式批次被拆散。

## Possible Solution

让 Record writer 支持进程间安全协调，或提供由一个协调器接收多个 runner 事件的官方写入拓扑，并明确锁的生命周期、崩溃恢复与冲突语义。

## Minimal Reproducible Example

1. 在两个 shell 中启动两个互不重叠的 `niceeval exp`。
2. 两者配置同一个 Record 目录。
3. 第一个进程取得 writer lock；第二个进程无法并行写入。
4. 改用两个 Record 后均能运行，但批次结果不再位于同一正式 Record。

## Context

MemoryBench 五条件正式批次需要五个独立 shell 并行执行，最终不得不保留五个隔离 Record，结果根目录为 `/home/ctrdh/.herdr/memorybench-five-KEhUrv`。
