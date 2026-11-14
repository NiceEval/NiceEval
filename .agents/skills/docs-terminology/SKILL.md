---
name: docs-terminology
description: Maintain NiceEval concepts and documentation writing policies through Concord, and diagnose terminology or readability findings.
metadata:
  command: concord writing
  design: docs/engineering/repository-tools/README.md
---

# Documentation terminology

Read the [writing rules](../../../docs/README.md#写给人读), then run `concord --skill document` and read the installed package's `docs/feature/documentation-quality/policy.md`.

Use `concord writing --help` and `concord concepts --help` for command syntax. Concord owns the concept catalog and policy; other Markdown links to catalog definitions instead of keeping a second term table.

- Run `concord concepts index --json` and `concord writing index --json` to discover owners and scopes.
- Read an owner with `concord concepts show --path <path> --json` or `concord writing show --path <path> --json`.
- Edit the catalog or `writing.md` Markdown directly, then run `concord docs check --json`.
- Inspect each finding in context, then run `pnpm lint`.

Global concepts live in `docs/concepts.md`: each `## term {#id}` heading gives the single accepted spelling and stable ID, the first paragraph is the sourced definition, and later text explains it. Only the term counts as usage; `其它写法` lines are search aids, not aliases, and Concord does not read them. A `旧写法：` paragraph after the definition lists deprecated spellings in inline code; Concord reports them anywhere in the checked scope. Preserve the distinction between adopted Feature terms and Roadmap candidates in the definition and source link.

Global writing rules live in `docs/writing.md`: the first paragraph sets sentence and paragraph limits, `## 不用的词` is the five-column table (词、改成、为什么、只在、例外), and `## 检查范围` lists `docs` and `apps/docs-site/zh`. A nested `writing.md` adds banned terms for its directory and may override the length limits; it inherits the parent table unless its section opens with `不继承上级不用的词`. Leave `只在` empty for the whole check scope, or write one root such as `docs` or `apps/docs-site/zh`; do not enumerate sibling directories. When a document must cite a retired name (rename tables, research history), put it in backticks instead of carving out a directory. `docs/issues/writing.md` raises the length limits and does not inherit the table because Issue observations quote raw evidence. The table only holds retired product and API names, slang or vague metaphors, and progress wording; ordinary words such as 环境、记录、解析 stay allowed, and an ambiguous sentence names its object instead. Use exact lifecycle and slot phrases, not bare setup, teardown or Slot. Each ban requires a concrete replacement and reason.

Use a scoped `concepts.md` or `writing.md` only when a directory owns a separate decision. Removing a referenced concept requires resolving its imports first.

Do not mechanically replace every finding. API identifiers and historical spellings quoted as inline code are distinct from prose; inspect the owning contract before changing either. NiceEval has no TS lint for docs: Concord does not yet check SVG text or code examples, so reviewers apply the same terminology decisions to diagrams and verify API examples against the public signatures; request missing checks as Concord Issues.
