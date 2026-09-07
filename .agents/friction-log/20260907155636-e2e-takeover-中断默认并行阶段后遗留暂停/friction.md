---
title: 'e2e takeover 中断默认并行阶段后遗留暂停 CLI 与 Docker 容器'
severity: 'minor'
---

## Actual observation
向 e2e takeover 根 Node 进程发送 SIGINT 后退出 130，runner 默认并行阶段仍留下已脱离父进程的 NiceEval CLI；shared-state-pause-holder 为 T 状态，另有 7 个带本轮 PID 标签的 Docker 容器。

## Expected behavior
中断后回收全部本轮进程与容器，包括测试暂停的子进程。

## Impact
下一轮独占 E2E 前需要手动释放资源。本次残留已定向释放，根 runner 回收仍需跟进。

## Public entry-point reproduction
pnpm e2e takeover 运行 runner Repo，进入 repo-default-parallel 后向根 CLI 发送 SIGINT；退出后检查进程和本轮 PID 标签的 Docker 容器。

## NiceEval identity
根 runner commit 42b98e35a1bc5b76389e3f623d7babd278f63caa；本地 rename 候选。

## Environment
Linux，Node.js 24.19.0，pnpm 11.18.0，Docker。

## Source provenance
本地 agent-assisted E2E 直接观察，仅保存 draft。

## Public data confirmation
- [x] I removed secrets, credentials, private customer data, private repository content, and other sensitive material from this issue.
- [x] This issue does not disclose or describe a suspected security vulnerability.
