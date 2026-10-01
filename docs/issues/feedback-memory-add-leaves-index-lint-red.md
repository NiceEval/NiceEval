---
format: concord.document/v1
id: feedback-memory-add-leaves-index-lint-red
title: pnpm memory add 后旧 INDEX lint 仍要求手工双写
createdAt: 2026-08-24T12:27:00+08:00
kind: issue
state: draft
memoryRelations: []
adoptions:
  current:
    - docs/engineering/docs-traceability/README.md#feedbackmemory-与-issue-分层
  history: []
origin:
  kind: dev
  repository: NiceEval/NiceEval
  commit: e8b4f34d9436453f088c39b3489da52174a5a2e9
subject: repository
claim: friction
observation: "`pnpm memory add` 成功创建结构化 Memory 后，`pnpm lint` 的 `memory-index.lint.ts` 仍以“每个 memory 条目都有索引行”失败，要求在 `memory/INDEX.md` 手工增加同一条目。"
impact: 正式 Memory 命令与 Feedback/Memory 设计声明的单文件原子写入不闭合；贡献者必须违反“不逐条双写索引”的目标才能通过仓库门禁。
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/feedback-memory-add-leaves-index-lint-red/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:745975457bd5ab45c423bf0dddb4261343945814c48f9920ec6ff804b7b529fe
---
# pnpm memory add 后旧 INDEX lint 仍要求手工双写

复现：运行 `pnpm memory add --input <metadata> --body <markdown>` 成功后再运行 `pnpm lint`。`lint/docs/memory-index.lint.ts` 报告新结构化文件没有出现在 `memory/INDEX.md`，但当前 Feedback/Memory 设计明确声明结构化条目由命令动态发现，不逐条双写索引。
