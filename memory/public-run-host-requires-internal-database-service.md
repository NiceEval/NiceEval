---
format: niceeval.memory/v1
id: public-run-host-requires-internal-database-service
title: 公开 Run Host 的 Effect requirements 无法由公开入口闭合
createdAt: 2026-09-05
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "Installed public Run Host case necase_JNE1HTBAPBV34014: inventory neinv_9WF1Q8Y3FQZR0N9W; takeover netake_QX7V472MF2F3H30B; candidate sha256 ad830d005f1e9763021bd5992ac682325fdb932b940467656d908824c331c422. Independent red bound in current regression evidence."
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/record/test/record-journey.test.ts#necase_JNE1HTBAPBV34014"]}
promotions: []
---
# 公开 Run Host 的 Effect requirements 无法由公开入口闭合

P1；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Astra review，父 agent 独立复核。入口：`packages/niceeval/src/run/host/types.ts:90`。

独立应用通过 `niceeval/run/host` 调用 list/get/delete/recover 时，四项操作的 requirements 都包含内部 ProjectStateDatabase。目标 [Run Library](../docs/feature/run/library.md) 声明可直接组合的高层领域操作，SQLite capability 应保持内部。

`run/storage/sqlite.ts` 的 runCommand 实际取得该 Service；Run Host 的导出入口和 package exports 没有交付对应组合能力。NodeRecordLive 仅由内部 Record 入口导出，CLI bootstrap 自己提供它，因此 CLI 可用不能证明外部 Host 可用。

待验证：安装后独立 TypeScript consumer 仅使用 package exports 完成一次读取 CLI 创建的 Run，类型检查和执行都应通过。包级 import/require 与 frozen-object 检查不足以证明 requirements 闭合。不要通过导出内部 SQLite facets 草率绕过架构边界。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。
