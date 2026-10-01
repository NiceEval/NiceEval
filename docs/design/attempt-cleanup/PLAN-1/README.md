---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# 资源实现声明排空预算

## 解决的问题

取消原因缺少正式类型，固定资源释放时段不足以排空已发请求。

## 核心心智

Attempt 是通用运行边界，Agent 在应用层提供 Session 与 Turn。
资源实现声明预算，运行时拥有取消裁决和整个资源释放时段。

## 范围

增加 Adapter 实现预算、强类型执行 signal 和 cleanup 实际期限。
不增加框架轮次，也不重新分配 Agent 或 Sandbox 的释放预算。

## 入口

[Library](library.md) 定义调用面，[Architecture](architecture.md) 定义资源归属，[Lifecycle](lifecycle.md) 定义终态顺序。
