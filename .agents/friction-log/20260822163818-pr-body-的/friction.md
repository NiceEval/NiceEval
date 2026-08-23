---
title: 'pr:body 的 Terminology 校验与 PR 模板不一致'
severity: 'minor'
---

## Expected Behavior

`.github/PULL_REQUEST_TEMPLATE.md` 与 `pnpm pr:body check` 对 Terminology case 使用同一体裁，按模板写完的 draft 可直接通过检查。

## Current Behavior

模板只要求每个新增术语有一段 Before、一段 After 和解释段落。`pnpm pr:body check --source <draft> --no-remote` 却要求 Before 与 After 各至少两个 fenced code block，并额外要求 `##### User impact`，导致严格照模板写的 draft 被拒绝。

## Possible Solution

让 PR body compiler 的 Terminology schema 与模板一致；若统一采用通用 inventory case 体裁，则同步更新模板中的 Terminology 示例与说明。

## Minimal Reproducible Example

按 `.github/PULL_REQUEST_TEMPLATE.md` 写一个 `## Terminology` / `### Added terms` case，只包含模板展示的 Before code block、After code block和解释段落。运行 `pnpm pr:body init --source <draft>` 后执行 `pnpm pr:body check --source <draft> --no-remote`，检查器报告缺少 `User impact`，并称 Before 与 After 各需要两个 fenced code block。

## Context

本次 Judge Material roadmap PR 通过补充第二个结果 code block 与 `User impact` 绕过；模板与工具的分歧仍会让后续作者重复返工。
