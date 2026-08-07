---
title: 'Pullfrog 自动 review instructions 只能存 Console，prompt_file 会丢失事件 payload'
severity: 'minor'
---

## Expected Behavior

自动 PR review 的仓库级 prompt 可以由版本库文件声明，并保留 Pullfrog 服务器下发的 PR 事件上下文。

## Current Behavior

Pullfrog Console 的 Review instructions 是服务器侧配置；仓库 workflow 的 `prompt_file` 与 `prompt` 互斥，而且源码会把文件内容当普通 prompt，不能同时接收带 `~pullfrog` 的 review dispatch payload。因此不能直接用 `prompt_file` GitOps 化自动 review prompt。

## Possible Solution

Pullfrog 为 event instructions 增加仓库文件引用，服务器仍下发事件 payload，Action 再从可信 base SHA 加载并合并该文件。当前仓库用 base `AGENTS.md` 指向 base SHA 上的 `.github/pullfrog-review-prompt.md` 规避。

## Minimal Reproducible Example

查看 Pullfrog `action.yml`：`prompt` 与 `prompt_file` 要求二选一；查看 `utils/payload.ts#resolvePromptInput`：`prompt_file` 返回纯字符串且不解析内部 JSON dispatch payload。

## Context

希望 NiceEval 的 API/CLI PR review prompt 经过 PR 审查并避免 Console 配置漂移。
