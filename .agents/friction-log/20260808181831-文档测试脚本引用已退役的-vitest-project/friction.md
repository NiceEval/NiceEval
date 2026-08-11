---
title: '文档测试脚本引用已退役的 Vitest project 名'
severity: 'major'
---

## Expected Behavior

`pnpm test:docs` 与 `pnpm test:docs-site` 应选择 Vitest 配置中存在的 project，并让本地与 CI 收集对应文档守护。

## Current Behavior

`vitest.config.ts` 在 main 上把 project 改为 `lint-docs` 与 `lint-docs-site`，但 `package.json` 仍传入 `--project docs` 与 `--project docs-site`。两条命令都在收集测试前以 `No projects matched the filter` 退出，CI 的 `Typecheck and docs lint` 与 `docs-site` job 因此稳定失败。

## Possible Solution

让 package scripts、CI 与 Vitest project 使用同一组名称，并用一条守护验证每个脚本引用的 project 确实存在。

## Minimal Reproducible Example

在 origin/main `1ba4ac5a` 或合并它的分支运行 `pnpm test:docs`；Vitest 报 `No projects matched the filter "docs"`。运行 `pnpm test:docs-site` 得到同类 `docs-site` 错误。

## Context

PR #9 合并最新 main 后，本地复现并由 GitHub Actions run 31252437698 再次确认。问题发生在测试收集前，与该 PR 的 assertion 文档内容无关。
