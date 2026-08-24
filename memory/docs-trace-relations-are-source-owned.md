---
format: niceeval.memory/v1
id: docs-trace-relations-are-source-owned
title: Docs Trace 关系由事实 owner 持有
createdAt: 2026-08-24T15:29:14+08:00
kind:
  type: decision
  state: adopted
promotions:
  - kind: engineering
    current:
      - docs/engineering/docs-traceability/README.md
    history: []
---
# Docs Trace 关系由事实 owner 持有

## Context

Feature 与 Use Case 需要反查页面、E2E、Feedback、Memory 和 Issue provenance。把这些反向列表写进 Feature frontmatter 或集中 JSON，会复制已有 owner 的事实，并让并行修改争写同一位置。

README、Library、CLI、Architecture、Lifecycle 与 Reference 的页面角色已经由 Feature package placement 稳定表达，不需要额外 metadata。

## Decision

- `niceeval.docs-node/v1` 只保存节点身份和该节点拥有的强关系。
- Feedback v2 保存原始观察、Issue provenance、adoption current/history 与 Feedback→Memory relation。
- structured Memory 保存 Problem、Decision、Insight 和 promotion current/history。
- E2E test/spec header 保存 owner、regression 与测试 Issue provenance。
- Trace Snapshot 从这些正向 owner 动态形成固定投影；Feature 与 Use Case 不回写反向列表。
- 人读树和 JSON receipt 消费同一 Snapshot；formatter 偏好不进入持久 metadata。

## Consequences

关系新增、retire、关闭、重开和 supersede 必须经具名命令维护 exact RepoRef 与 immutable history。所有 Trace 可见 metadata mutation 共用 preimage、结构锁与 generation；查询不会返回跨 generation 的混合结果。

支持页面按最长合法 package owner 取得 Roadmap、Feature 或 Engineering scope。Use Case 必须精确命中自己的 docs node，避免目录继承伪造用户场景关系。
