---
title: 'AGENTS.md 指向不存在的 pnpm test:docs'
severity: 'minor'
---

## Expected Behavior

文档验证指令应与 package.json 中的实际脚本一致。

## Current Behavior

根 AGENTS.md 要求运行 `pnpm test:docs`，但 package.json 没有该脚本；pnpm 失败后提示实际入口是 `pnpm lint:docs`。

## Possible Solution

把 AGENTS.md 的文档验证命令同步为 `pnpm lint:docs`，或恢复 `test:docs` alias。

## Minimal Reproducible Example

在仓库根运行 `pnpm test:docs`。

## Context

Eval Group 文档变更验证时先执行了失效命令，随后改用 package.json 的实际入口。
