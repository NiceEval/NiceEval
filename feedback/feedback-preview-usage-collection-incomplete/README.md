---
format: niceeval.feedback/v1
id: feedback-preview-usage-collection-incomplete
title: Preview 把完整 usage 报成 collection incomplete
state: closed
reportedAt: 2026-08-24T14:07:42+08:00
source:
  kind: dogfood
  repository: NiceEval/NiceEval-Preview
  originId: preview-pr-110-usage-collection-incomplete
  commit: 705d90329848825b25b1fbde389905b513ccb93a
subject: product
claim: defect
observation: 在 https://deploy-preview-110--niceeval-report-preview.netlify.app/#/group/named/pass-gallery 的数据说明中，重复出现十条 `analysis-missing — usage collection is incomplete`；该 preview 使用刚重新生成并提交的示例 Record。
impact: Report 把样本已经记录的 input/output token usage 显示为无数据，并用十条重复告警暗示新跑 Record 的 usage 采集不完整，读者无法比较实验 Tokens，也无法判断问题来自样本还是 NiceEval。
adoptedContract:
  path: docs/feature/analysis/library.md
  anchor: 已发布的输入与成员集
memoryRelations:
  - kind: root-cause
    memory: analysis-usage-projection-conflates-conversation-limitations
closure:
  kind: fixed
  memory: analysis-usage-projection-conflates-conversation-limitations
  proof:
    - Installed-candidate E2E red/green and the complete reliability takeover passed for e2e/report/test/report-show.test.ts with fixed candidate SHA-256 f32967516356bdb2e70bc63454f97eaa1785133bb4ac81d8af74699ff6d68537.
    - The unchanged NiceEval-Preview commit 705d90329848825b25b1fbde389905b513ccb93a and sealed Records produced zero usage collection is incomplete problems for /group/named/pass-gallery; pass-gallery/candidate remained 4/4 available at 208 tokens.
---
# Preview 把完整 usage 报成 collection incomplete

用户在 PR 110 的公开 Report preview 中观察到十条重复的 `analysis-missing — usage collection is incomplete`，并要求确认是新跑样本、运行过程还是 NiceEval 的问题。公开 `niceeval show` 可读到对应 Attempt 的 input/output token buckets 与 provider cost。
