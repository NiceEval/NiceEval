---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# PLAN-1：中央 Trace Registry

## 解决的问题

本方案签入一份 Registry。它集中列出每个文档节点、E2E owner、测试、Memory 与双向边，查询无需扫描仓库。

## 核心心智

Registry 是唯一查询入口。Feature、测试头、Memory frontmatter 和目录结构被导入后，还要把变更同步写回 Registry。

```yaml
format: niceeval.trace-registry/v1
nodes:
  - ref: feature:reports
    path: docs/feature/reports/README.md
edges:
  - from: e2e/report/test/report-export.test.ts
    type: verifies
    to: feature:reports#static-export
```

命令提供 `list`、`show`、`check` 与 `create`。`check` 比较 Registry 与文件系统；`create` 同时写 package 和 Registry。

## 范围与代价

集中结构让任意图查询和可视化容易实现，也能直接保存反向索引。代价是每条关系至少在 owner 与 Registry 出现两次。

Roadmap 移动、测试 owner 变化或 Memory promotion 时必须同步修改多个声明。并行 Agent 也会持续争写同一 Registry 文件。

Registry 最终会承担节点身份、采用状态、测试完整度状态和反向列表。它会与 Feature、testing owner、Memory 和 Git 历史形成竞争真源。

## Cases

T1、T2 的读取很直接；T5、T6 需要中央事务。T3 会诱导 Registry 保存测试完整度空状态，T7 的共享写热点无法消除。
