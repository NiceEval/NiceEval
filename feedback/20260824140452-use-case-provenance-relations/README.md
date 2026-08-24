---
format: niceeval.feedback/v2
id: 20260824140452-use-case-provenance-relations
title: Feature 的 Use Case 需要显示 Feedback、Memory 与 Issue 关系
state: closed
reportedAt: 2026-08-24T14:04:52+08:00
source:
  kind: dogfood
  repository: NiceEval/NiceEval
  originId: pr-109-use-case-provenance-relations
  commit: 4e6b028e1c3bb0062fbaf311c804c3407a21777a
subject: repository
claim: request
observation: 用户澄清，树型 formatter 不是核心诉求；需要先想清楚 docs 的持久 metadata 应放在 README frontmatter 还是 JSON，以及一个 Feature 的用户场景（Use Case）怎样关联 Feedback、Memory 或 Issue。当前 `feature show` 只能从测试回归间接显示少量 Memory，不能显示 Use Case 被哪些反馈采纳、由哪些调查或裁决支撑、原始 Issue 来自哪里。
impact: Feature、Use Case、Feedback、Memory 与 Issue 仍是分散入口。维护者查看一个用户场景时无法判断它的原始观察、调查裁决与外部来源，也无法区分当前契约关系和普通 Markdown mention。
memoryRelations:
  - kind: decision
    memory: docs-trace-relations-are-source-owned
adoptions:
  current:
    - docs/engineering/docs-traceability/README.md
  history: []
closure:
  kind: delivered
  memory: docs-trace-relations-are-source-owned
  target: docs/engineering/docs-traceability/README.md
  proof:
    - pnpm feature list
    - pnpm test list report
    - pnpm feature show reports --json
    - pnpm feedback check --json
    - pnpm memory check --json
---
# Feature 的 Use Case 需要显示 Feedback、Memory 与 Issue 关系

## 用户澄清

用户指出，问题不只是给 `feature list` / `test list` 加 formatter：

> 如果 docs 需要 metadata，可以用保存到 README.md 的 frontmatter 或者用 JSON，你自己想明白。

随后给出具体关系场景：

> 一个功能的用户场景也可以关联，是关联到 Feedback、Memory 或者 Issue。

## 当前缺口

`niceeval.docs-node/v1` 的 Use Case 只拥有 `composes`；Feedback 的 `adoptedContract` 是单值，Memory promotion 不接受 Use Case，Issue 只有测试头或 Feedback source 的零散入口。当前 Trace Snapshot 不扫描 Feedback，也没有在 Use Case 投影中区分 adoption、investigation、decision、regression 与 Issue provenance。

## 期望结果

定稿唯一关系 owner 与持久格式后，`feature show` 的结构化 receipt 和树型人读输出都能在每个 Use Case 下显示具名、可验证的 Feedback、Memory 与 Issue 关系，同时不建立 sidecar Registry 或双写反向边。
