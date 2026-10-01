---
format: concord.document/v1
id: feedback-preview-usage-collection-incomplete
title: Preview 把完整 usage 报成 collection incomplete
createdAt: 2026-08-24T14:07:42+08:00
kind: issue
state: closed
memoryRelations:
  - kind: root-cause
    memory: memory/analysis-usage-projection-conflates-conversation-limitations.md
adoptions:
  current: []
  history:
    - target: docs/feature/analysis/library.md#已发布的输入与成员集
      commit: d2aa8c65664b88ede3bfd89b838ed314e36d17d3
closure:
  kind: fixed
  memory: memory/analysis-usage-projection-conflates-conversation-limitations.md
  proof:
    - Installed-candidate E2E red/green and the complete reliability takeover passed for e2e/report/test/report-show.test.ts with fixed candidate SHA-256 3c52d917283e7f72b3be8539d1dd999cb72c89eee2ea89681a1426c1b2d4eacc.
    - The unchanged NiceEval-Preview commit 705d90329848825b25b1fbde389905b513ccb93a and sealed Records produced zero usage collection is incomplete problems for /group/named/pass-gallery; pass-gallery/candidate remained 4/4 available at 208 tokens.
origin:
  kind: dogfood
  repository: NiceEval/NiceEval-Preview
  originId: preview-pr-110-usage-collection-incomplete
  commit: 705d90329848825b25b1fbde389905b513ccb93a
subject: product
claim: defect
observation: 在 https://deploy-preview-110--niceeval-report-preview.netlify.app/#/group/named/pass-gallery 的数据说明中，重复出现十条 `analysis-missing — usage collection is incomplete`；该 preview 使用刚重新生成并提交的示例 Record。
impact: Report 把样本已经记录的 input/output token usage 显示为无数据，并用十条重复告警暗示新跑 Record 的 usage 采集不完整，读者无法比较实验 Tokens，也无法判断问题来自样本还是 NiceEval。
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/feedback-preview-usage-collection-incomplete/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:b21db0387ce82484ef9f099258f098ba57e2a4c3bb9d11e89b53ebbc30bb52e2
---
# Preview 把完整 usage 报成 collection incomplete

用户在 PR 110 的公开 Report preview 中观察到十条重复的 `analysis-missing — usage collection is incomplete`，并要求确认是新跑样本、运行过程还是 NiceEval 的问题。公开 `niceeval show` 可读到对应 Attempt 的 input/output token buckets 与 provider cost。
