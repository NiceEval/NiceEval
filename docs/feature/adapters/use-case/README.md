# Adapter 用户路径

每篇只串联一个用户目标。契约单源始终在 [Library](../library/README.md) 及其子页与 [Architecture](../architecture/README.md)，用例不重新定义 API。

## 原生应用：`defineAdapter`

- [用原生操作评估订单应用](native-operations.md)：连接业务客户端，调用原生方法并释放资源。

## 会话服务：`defineAgent` 与 `ctx.session`

- [连接保留会话历史的服务](direct-conversation.md)：传递服务端 session ID，完成两轮对话，再创建独立会话。

## Sandbox CLI：`codexAgent`

- [在 Sandbox 中运行 coding-agent CLI](sandbox-cli.md)：选择内置 Agent 与独立的 Sandbox provider。

## HITL：`requireInputRequest` 与 `respond`

- [回答审批并继续同一会话](resume-approval.md)：从 waiting Turn 取得请求，以结构化回答恢复执行。

## API → 篇目

| API 组 | 用户路径 |
|---|---|
| `defineAdapter`、`onCleanup`、Adapter 的 `defineEval` | [原生应用](native-operations.md) |
| `defineAgent`、`ctx.session.id`、`capture`、`t.newSession` | [服务端会话](direct-conversation.md) |
| `codexAgent`、Experiment 的 `adapter` 与 `sandbox` | [Sandbox CLI](sandbox-cli.md) |
| `t.send`、`requireInputRequest`、`respond` | [审批恢复](resume-approval.md) |
