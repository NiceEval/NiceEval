---
{
  "format": "niceeval.feedback/v1",
  "id": "20260814191842-agent-ensure-的缺字段身份退化成",
  "title": "Agent ensure 的缺字段身份退化成 undefined.trim",
  "state": "open",
  "reportedAt": "2026-08-14T19:18:42+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "repository",
  "claim": "friction",
  "observation": "---\ntitle: 'Agent ensure 的缺字段身份退化成 undefined.trim'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\n从 TypeScript 发现模块加载 Agent ensure 时，缺少 agent、version 或 revision 的 identity 应在配置/发现阶段得到具名 schema 错误，并指出缺失字段。\n\n## Current Behavior\n\nensure.identity 只有任意字段与 revision 时仍能进入运行。assertStableAgentIdentity 先调用 identity.version.trim()，因此得到 agent.ensure / unexpected-error: Cannot read properties of undefined (reading trim)，没有指出真正缺少 version 与 agent。\n\n## Possible Solution\n\n在 discovery 或 defineSandboxAgent 边界验证 AgentIdentity 的三个必填非空字段；assertStableAgentIdentity 也应先做 typeof 检查，再调用 trim，并返回既有的具名 identity 错误。\n\n## Minimal Reproducible Example\n\n定义 Sandbox Agent，ensure.identity 传 { fixture: command-plan, revision: 1 }，probe 传一个成功 shell。运行任意 Eval，观察 agent.ensure 阶段出现 undefined.trim；改成 { agent: acceptance-sandbox, version: 24.19.0, revision: 1 } 后通过。\n\n## Context\n\n为 --dry --commands 的安装后候选验收搭建最小消费项目时复现。公开 show Attempt 只显示 unexpected-error，增加了定位时间。\n",
  "impact": "ensure.identity 只有任意字段与 revision 时仍能进入运行。assertStableAgentIdentity 先调用 identity.version.trim()，因此得到 agent.ensure / unexpected-error: Cannot read properties of undefined (reading trim)，没有指出真正缺少 version 与 agent。",
  "memoryRelations": []
}
---
---
title: 'Agent ensure 的缺字段身份退化成 undefined.trim'
severity: 'minor'
---

## Expected Behavior

从 TypeScript 发现模块加载 Agent ensure 时，缺少 agent、version 或 revision 的 identity 应在配置/发现阶段得到具名 schema 错误，并指出缺失字段。

## Current Behavior

ensure.identity 只有任意字段与 revision 时仍能进入运行。assertStableAgentIdentity 先调用 identity.version.trim()，因此得到 agent.ensure / unexpected-error: Cannot read properties of undefined (reading trim)，没有指出真正缺少 version 与 agent。

## Possible Solution

在 discovery 或 defineSandboxAgent 边界验证 AgentIdentity 的三个必填非空字段；assertStableAgentIdentity 也应先做 typeof 检查，再调用 trim，并返回既有的具名 identity 错误。

## Minimal Reproducible Example

定义 Sandbox Agent，ensure.identity 传 { fixture: command-plan, revision: 1 }，probe 传一个成功 shell。运行任意 Eval，观察 agent.ensure 阶段出现 undefined.trim；改成 { agent: acceptance-sandbox, version: 24.19.0, revision: 1 } 后通过。

## Context

为 --dry --commands 的安装后候选验收搭建最小消费项目时复现。公开 show Attempt 只显示 unexpected-error，增加了定位时间。
