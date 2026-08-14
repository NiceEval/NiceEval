---
title: 'writer 进程崩溃后遗留锁永久阻止 Record 写入'
severity: 'major'
---

## Expected Behavior

writer 进程异常退出后，Record 的单写者互斥应由系统安全释放；后续 `niceeval accept` 能取得 lease，同时任何进程交错下都不能出现两个 writer。

## Current Behavior

`writer.lock` 使用 exclusive-create 文件并只在 Effect finalizer 中 unlink。进程崩溃会永久留下文件；公开 `niceeval session list --all --json` 已显示对应 Session expired、PID 不存在，但后续 `niceeval accept` 仍返回 `record-writer-busy`。

## Possible Solution

用平台 OS advisory exclusive lock 持有打开的 fd，让内核在正常关闭或进程崩溃时释放。不要用 hostname + PID 自动删文件：PID namespace 或共享文件系统会把活跃 writer 误判为已死并造成双写。

## Minimal Reproducible Example

1. 启动一个会取得 Record writer lease 的命令。
2. 在 release finalizer 前对进程执行 SIGKILL。
3. 用 `niceeval session list --all --json` 确认 Session expired。
4. 执行 `niceeval accept @<locator>`，稳定得到 `record-writer-busy`。

## Context

MemoryBench 2.0 的 expired Session `s_46cd5efe-f4d6-440e-852e-378d7d6df48d`（PID 136983）复现。设计挑战否决了基于 PID 探活删除 stale 文件的候选方案，因为它无法证明跨 PID namespace owner 已死。
