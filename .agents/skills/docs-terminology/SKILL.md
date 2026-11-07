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
- Edit the catalog Markdown or policy JSON directly, then run `concord writing check --path <path> --json`.
- Run `concord docs check --json`, inspect each finding in context, then run `pnpm lint`.

Global concepts live in `docs/concepts.md`: each `## term {#id}` heading gives the single accepted spelling and stable ID, the first paragraph is the sourced definition, and later text explains it. Only the term counts as usage; `其它写法` lines are search aids, not aliases. Deprecated names in the frontmatter produce unconditional derived bans. Catalog names cannot carry path exemptions. Put scoped deprecation rules in the writing policy with the concept reference in `why`, and remove their unconditional catalog duplicate. Preserve the distinction between adopted Feature terms and Roadmap candidates in the definition and source link.

Global writing policy lives in `docs/concord-writing.json`. Preserve the scan roots and each ban's roots, exemptions and allowed phrases. Design-only bans use `docs`; site-only bans use `apps/docs-site/zh`; shared bans list both. Sentence and paragraph limits apply to both roots. Issue observations are exempt from all bans and use a local policy with null length limits; Issue schema validation remains with Concord Issue/check. Only the 0.19 deprecations exempt design/research/memory archives; retain the scopes of earlier bans. Use exact lifecycle and slot phrases, not bare setup, teardown or Slot. Each authored ban requires a concrete replacement and reason.

Use scoped `concepts.md` or `concord-writing.json` only when a directory owns a separate decision. Local roots cannot escape that directory. Removing a referenced concept requires resolving its imports first.

Do not mechanically replace every finding. API identifiers and historical spellings quoted as inline code are distinct from prose; inspect the owning contract before changing either. NiceEval's API-example and SVG checks remain under `lint/docs/` and read the same Concord terminology decisions where applicable.
