---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# 材料验收问答

## 解决的问题

从自定义应用和 Agent collection 中确定性选择事实，再用受管评分评价实际材料。

## 核心心智

应用取事实，Match 判断事实，框架选择并评分，handle 配置 gate 和 score。

## 范围

统一普通应用与 Agent 求值语义，不引入具体游戏字段。

## 入口

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
