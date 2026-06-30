# Mintlify Documentation Guide

This directory is the public Mintlify documentation site for `fasteval`.

## Structure

- `docs.json` controls Mintlify navigation, theme, logo, and navbar links.
- Top-level `*.mdx` files are entry pages such as the home page, introduction,
  quickstart, and installation.
- `concepts/` explains the core mental model.
- `guides/` contains task-oriented documentation.
- `reference/` contains API and CLI reference pages.
- `zh/` contains the Chinese docs. Treat Chinese positioning and scenario
  examples as the source of truth when English pages or indexes drift.

## Writing Rules

- Keep the product positioning consistent with the root `AGENTS.md`: `fasteval`
  is a lightweight, general-purpose TypeScript agent eval tool.
- When updating English pages, README links, or navigation based on Chinese
  content, sync from `zh/` and the current code instead of inventing new
  capabilities or paths.
- Check current source or `docs/` before claiming that a command, adapter,
  sandbox backend, reporter, or CLI flag is supported.
- Use MDX frontmatter with `title`, `sidebarTitle` when useful, and
  `description`.
- Prefer task-oriented pages for workflows and reference pages for exhaustive
  option lists.
- Use active voice and short sentences.
- Format commands, paths, flags, file names, package names, and code symbols
  with backticks.

## Validation

Run these from the repository root after changing this directory:

```sh
pnpm run docs:validate
pnpm run docs:links
```

Mintlify validation currently needs an LTS Node version such as Node 22.
