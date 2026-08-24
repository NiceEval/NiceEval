---
format: niceeval.feedback/v2
id: 20260822205314-pr-body-create
title: pr:body create 未建立 check --pr 所需编号草稿
state: open
reportedAt: 2026-08-22T20:53:14+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
subject: repository
claim: friction
observation: |
  ---
  title: 'pr:body create 未建立 check --pr 所需编号草稿'
  severity: 'minor'
  ---

  ## Expected Behavior

  按 `pnpm pr:body --help` 的 create 工作流，用具名 `--source` 创建 PR 后，可以直接运行 `pnpm pr:body check --pr <number>` 校验远端正文；或帮助明确要求同时传 `--pr` 与 `--source`。

  ## Current Behavior

  `pnpm pr:body create --source <draft> ...` 成功创建并校验 PR，但没有建立 `.git/.../niceeval/pr-body/<number>.md`。随后 `pnpm pr:body check --pr 101` 报 `draft does not exist`。运行 `init --pr 101` 只生成未填写的完整模板，再次 check 会报告全部 placeholder。实际可用命令是帮助 Usage 未表达的 `pnpm pr:body check --pr 101 --source <draft>`。

  ## Possible Solution

  让 create 把具名 source 关联或复制到编号草稿；或者把帮助和仓库指南统一改成 `check --pr <number> --source <draft>`，并在 Usage 中明确两项可以同时出现。

  ## Minimal Reproducible Example

  ```sh
  pnpm pr:body create --source <draft.md> --title <title> --base main
  pnpm pr:body check --pr <created-number>
  ```

  第二条稳定报 `draft does not exist`，即使第一条刚刚成功。

  ## Context

  在 PR #101 的创建流程中复现。具名 source 本身通过 `check --no-remote`，create 也确认远端正文一致；摩擦只影响 create 后独立复验的文档化路径。
impact: "`pnpm pr:body create` 成功后，按帮助继续运行编号草稿检查会稳定失败；维护者必须额外保留并再次传入原 source。"
memoryRelations: []
adoptions:
  current: []
  history: []
---
---
title: 'pr:body create 未建立 check --pr 所需编号草稿'
severity: 'minor'
---

## Expected Behavior

按 `pnpm pr:body --help` 的 create 工作流，用具名 `--source` 创建 PR 后，可以直接运行 `pnpm pr:body check --pr <number>` 校验远端正文；或帮助明确要求同时传 `--pr` 与 `--source`。

## Current Behavior

`pnpm pr:body create --source <draft> ...` 成功创建并校验 PR，但没有建立 `.git/.../niceeval/pr-body/<number>.md`。随后 `pnpm pr:body check --pr 101` 报 `draft does not exist`。运行 `init --pr 101` 只生成未填写的完整模板，再次 check 会报告全部 placeholder。实际可用命令是帮助 Usage 未表达的 `pnpm pr:body check --pr 101 --source <draft>`。

## Possible Solution

让 create 把具名 source 关联或复制到编号草稿；或者把帮助和仓库指南统一改成 `check --pr <number> --source <draft>`，并在 Usage 中明确两项可以同时出现。

## Minimal Reproducible Example

```sh
pnpm pr:body create --source <draft.md> --title <title> --base main
pnpm pr:body check --pr <created-number>
```

第二条稳定报 `draft does not exist`，即使第一条刚刚成功。

## Context

在 PR #101 的创建流程中复现。具名 source 本身通过 `check --no-remote`，create 也确认远端正文一致；摩擦只影响 create 后独立复验的文档化路径。
