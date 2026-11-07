---
relations:
  - role: spec
    target: docs/engineering/docs-traceability/README.md#feedbackmemory-与-issue-分层
---

# pnpm memory add 后旧 INDEX lint 仍要求手工双写

`pnpm memory add` 成功创建结构化 Memory 后，`pnpm lint` 的 `memory-index.lint.ts` 仍以“每个 memory 条目都有索引行”失败，要求在 `memory/INDEX.md` 手工增加同一条目。

## Impact

正式 Memory 命令与 Feedback/Memory 设计声明的单文件原子写入不闭合；贡献者必须违反“不逐条双写索引”的目标才能通过仓库门禁。

复现：运行 `pnpm memory add --input <metadata> --body <markdown>` 成功后再运行 `pnpm lint`。`lint/docs/memory-index.lint.ts` 报告新结构化文件没有出现在 `memory/INDEX.md`，但当前 Feedback/Memory 设计明确声明结构化条目由命令动态发现，不逐条双写索引。
