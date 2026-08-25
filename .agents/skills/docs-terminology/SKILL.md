---
name: docs-terminology
description: Maintain NiceEval documentation banned wording and diagnose writing-rule failures. Use when listing, adding, removing, or checking entries in docs/writing-rules.json; use docs/concepts.md instead when establishing a preferred domain term.
metadata:
  command: pnpm run repo docs terms
  design: docs/engineering/repository-tools/README.md
---

# Documentation terminology

Read the [writing rules](../../../docs/README.md#写给人读) before changing terminology. Its command owner is defined by [Repository Tools](../../../docs/engineering/repository-tools/README.md#七个领域).

Use `pnpm run repo docs terms --help` as the command reference. Do not hand-edit a second occurrence list.

- Run `pnpm run repo docs terms list <pattern>` before adding a term.
- Use `pnpm run repo docs terms add ... --dry-run` to inspect the exact JSON change, then run the same command without `--dry-run`.
- Choose `--scope docs` for design docs only, `all` for design docs and the Chinese public site, or `site` for public-site wording only.
- Run `pnpm run repo docs terms check`, fix each contextual hit, then run `pnpm lint`.
- Use `pnpm run repo docs terms remove <term> --dry-run` before removing a decision. Removal deletes the entry and its site marker together.

Each handwritten ban needs the literal wording, a concrete replacement, and a reason. Put code identifiers in backticks instead of banning legitimate identifiers. If the decision establishes one preferred domain term over synonyms, record it once in `docs/concepts.md`; the writing lint derives synonym bans from that table.

Do not perform a whole-repository mechanical rewrite merely because a new entry exposes matches. Read each match in its owning feature or engineering context and use the precise action word for that context.
