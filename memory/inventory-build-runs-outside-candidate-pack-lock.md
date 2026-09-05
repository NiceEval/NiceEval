---
format: niceeval.memory/v1
id: inventory-build-runs-outside-candidate-pack-lock
title: Workspace inventory 在 candidate pack lease 外重复构建共享 dist
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# Workspace inventory 在 candidate pack lease 外重复构建共享 dist

P2；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Sol review，父 agent 独立复核。入口：`packages/e2e-runner/src/workspace-inventory.ts:158`。

collectWorkspacePrepared 先运行 build:package，再调用 packCandidate。前一次构建不持有 candidate pack lease；pack 的受锁 prepack 又构建一次，既重复也留下共享 dist 的写入窗口。

`injection.ts` 的 buildCandidateTarball 在 acquireCandidatePackLock 后执行 pnpm pack；NiceEval prepack 已包含 build:package。前置 build 在此锁外，若外部进程已持有 pack lease，它仍能改写正在被打包的 dist。当前会话的 E2E 独占纪律不能代替工具自身的跨进程保护。契约见 [E2E execution](../docs/engineering/testing/e2e/execution.md)。

待验证：通过仓库工具入口，在另一进程持有 pack lease 时启动 inventory，检查在获得 lease 前没有共享 runtime 写入。修复可消除重复前置构建，或把确需保留的构建纳入同一 ownership。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。
