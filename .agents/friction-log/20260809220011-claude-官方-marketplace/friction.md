---
title: 'Claude 官方 marketplace 配 ref 后被本地 clone 触发保留名拒绝'
severity: 'major'
---

## Expected Behavior

`claudeCodeAgent.plugins[].marketplace` 同时声明官方 GitHub source 与 `ref` 时，应能从该固定 revision 安装官方 Plugin。

## Current Behavior

适配器为实现 `ref` 先把仓库 clone 到临时本地目录，再执行 `claude plugin marketplace add <local-path>`。Claude Code 2.1.207 会拒绝这种注册：官方保留 marketplace 名只允许来自 Anthropic 组织的 GitHub source，因此固定 revision 无法使用。去掉 `ref`、直接添加 `anthropics/claude-plugins-official` 可以安装。

## Possible Solution

为官方 GitHub marketplace 保留远程来源身份并以 Claude CLI 支持的方式固定 revision；若 CLI 本身不支持 ref，则在配置解析时给出明确的不支持错误，不要晚到 setup 阶段才失败。

## Minimal Reproducible Example

配置 marketplace `{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", ref: "3160b166dcefc641f84e48ea2d136b8890f1de65" }` 后运行 experiment；setup clone 成功，但 marketplace add 报保留名只能使用 Anthropic GitHub source。

## Context

为 Claude Code 新增官方远程 Plugin E2E 时复现。最终实验去掉 `ref` 后，在线安装 `frontend-design` 并加载其 namespaced Skill 成功。
