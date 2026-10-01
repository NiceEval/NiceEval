---
format: concord.document/v1
id: concurrency-independent-evals
title: 独立 Eval 使用默认并发
createdAt: 2026-07-27T18:06:13+08:00
kind: use-case
feature: docs/feature/experiments/README.md
---

# 独立 Eval 使用默认并发

Eval 之间不共享可变状态时，不配置 Experiment `maxConcurrency`。
Runner 使用全局并发位并按瓶颈优先派发，让快慢任务自然混跑。

只有出现本机资源耗尽或 Provider 限流时，才调整 [`--max-concurrency`](concurrency-max-global.md)；不要为了“看起来更确定”默认串行，串行会直接放弃吞吐。
