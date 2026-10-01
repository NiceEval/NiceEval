---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# 求值时注入上下文

## 解决的问题

业务验收需要隐藏应用取数、复用正式 Match、整组托管问答与官方统计。
重复材料声明和绑定让评估正文泄漏应用结构，完整 journal 作为显式 value 则污染审计容量。

## 核心心智

材料 Match 声明强类型只读取数函数和现有单项 predicate。
Adapter 的应用上下文是一次注入的事实入口，材料 Match 构造期间不读取它。
`check` 判断存在性，`closeQA` 对全部命中项进行一次受管验收问答。

## 范围

集合材料、单个聚合事实、接收者 ctx、正式统计、容量预算与完整读回属于同一框架契约。
业务事件字段、世界完成条件和业务时钟由应用拥有，不进入核心。

## 入口

公开形状见 [Library](library.md)，所有权与不变量见 [Architecture](architecture.md)，时序见 [Lifecycle](lifecycle.md)。
