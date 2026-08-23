---
{
  "format": "niceeval.feedback/v1",
  "id": "20260820131045-成本迁移状态逐-slot-重复且缺少",
  "title": "成本迁移状态逐 slot 重复且缺少 niceeval migrate 动作",
  "state": "open",
  "reportedAt": "2026-08-20T13:10:45+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "product",
  "claim": "friction",
  "observation": "---\ntitle: '成本迁移状态逐 slot 重复且缺少 niceeval migrate 动作'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\n当所有选中 slot 都因 Observability v1 无法读取 Usage 时，顶层成本投影应汇总为 `migration-required`，并在 `niceeval show` 中给出一次明确的 `niceeval migrate` 恢复动作；逐 slot 原因应保持可诊断但不淹没摘要。\n\n## Current Behavior\n\n在 NiceEval-Eval 的历史 Record 上运行 `pnpm exec niceeval show`，Total cost 显示 `cost projection unavailable`，随后在同一单元格逐行重复数十个 `usage-migration-required` 与 `member-not-recorded`。输出没有给出 `niceeval migrate`，用户无法从默认报告判断这是可恢复的 Observability v1 → v2 迁移，而容易误解为所有成本事实损坏。\n\n## Possible Solution\n\n让标准 Report 识别顶层 `CostProjectionMigrationRequired`，只显示一次 migration-required 摘要与 `niceeval migrate` 动作；把 canonicalized per-slot reasons 放在显式详情页或折叠视图。混合 current/v1 且仍有金额时继续保持 partial。\n\n## Minimal Reproducible Example\n\n1. 使用当前 NiceEval 打开一个包含 Observability v1 Usage 的已封口 Record。\n2. 运行 `pnpm exec niceeval show`。\n3. 观察 Total cost 单元格重复输出 `usage-migration-required`，但没有文档要求的 `niceeval migrate` 恢复动作。\n\nNiceEval-Eval 当前 Record 的 Run range 为 2026-08-18 13:17 至 2026-08-19 11:48；Observability v2 于 2026-08-19 20:07 合入。\n\n## Context\n\n`docs/feature/reports/cost-projections/library.md` 明确要求：所有 slot 都因 Observability v1 不可读时，顶层 projection 与 metric state 为 `migration-required`，Report 显示 `niceeval migrate`，不能只把原因藏在 reasons。当前输出与该契约不符。\n",
  "impact": "在 NiceEval-Eval 的历史 Record 上运行 `pnpm exec niceeval show`，Total cost 显示 `cost projection unavailable`，随后在同一单元格逐行重复数十个 `usage-migration-required` 与 `member-not-recorded`。输出没有给出 `niceeval migrate`，用户无法从默认报告判断这是可恢复的 Observability v1 → v2 迁移，而容易误解为所有成本事实损坏。",
  "memoryRelations": []
}
---
---
title: '成本迁移状态逐 slot 重复且缺少 niceeval migrate 动作'
severity: 'minor'
---

## Expected Behavior

当所有选中 slot 都因 Observability v1 无法读取 Usage 时，顶层成本投影应汇总为 `migration-required`，并在 `niceeval show` 中给出一次明确的 `niceeval migrate` 恢复动作；逐 slot 原因应保持可诊断但不淹没摘要。

## Current Behavior

在 NiceEval-Eval 的历史 Record 上运行 `pnpm exec niceeval show`，Total cost 显示 `cost projection unavailable`，随后在同一单元格逐行重复数十个 `usage-migration-required` 与 `member-not-recorded`。输出没有给出 `niceeval migrate`，用户无法从默认报告判断这是可恢复的 Observability v1 → v2 迁移，而容易误解为所有成本事实损坏。

## Possible Solution

让标准 Report 识别顶层 `CostProjectionMigrationRequired`，只显示一次 migration-required 摘要与 `niceeval migrate` 动作；把 canonicalized per-slot reasons 放在显式详情页或折叠视图。混合 current/v1 且仍有金额时继续保持 partial。

## Minimal Reproducible Example

1. 使用当前 NiceEval 打开一个包含 Observability v1 Usage 的已封口 Record。
2. 运行 `pnpm exec niceeval show`。
3. 观察 Total cost 单元格重复输出 `usage-migration-required`，但没有文档要求的 `niceeval migrate` 恢复动作。

NiceEval-Eval 当前 Record 的 Run range 为 2026-08-18 13:17 至 2026-08-19 11:48；Observability v2 于 2026-08-19 20:07 合入。

## Context

`docs/feature/reports/cost-projections/library.md` 明确要求：所有 slot 都因 Observability v1 不可读时，顶层 projection 与 metric state 为 `migration-required`，Report 显示 `niceeval migrate`，不能只把原因藏在 reasons。当前输出与该契约不符。
