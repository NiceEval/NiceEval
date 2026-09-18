---
format: concord.document/v1
id: vm0-has-public-rest-contract
title: vm0-has-public-rest-contract
createdAt: 2026-07-02T23:41:59Z
createdAtSource:
  kind: first-recorded
  path: memory/vm0-has-public-rest-contract.md
  commit: 8e283b79a9f76d51beb7f75ebad884d7499e9479
description: vm0 其实有公开、版本化的 REST 契约可程序化接入(POST /api/agent/runs + 轮询 events),"无公开
  API"的旧调研结论是错的;examples/zh/origin/vm0 已按此重写为真集成
kind: memory
memoryKind: problem
state: captured
epoch: 0
promotions: []
history: []
---

**现象**:`examples/zh/origin/vm0` 曾按"vm0 没有 npm SDK、没有公开文档化的 HTTP API"的调研结论做成 mock 占位(`docs/adapters/targets.md` 的 vm0 行也是同一结论)。用户指出实现是错的;2026-07-02 重新调研(直接读 `@vm0/cli@9.221.5` 的 bundle 源码 + vm0 仓库 `turbo/packages/api-contracts/`)证实旧结论只对了一半。

**根因**:旧调研只查了 npm 上有没有可 `import` 的 SDK(确实没有,只有 CLI 和自托管 runner)和有没有 API 文档站(确实没有),据此推断"没有集成面"。但 vm0 的集成面是**公开源码的 ts-rest 契约**:官方 CLI 就是 `POST /api/agent/runs`(首轮 `agentComposeId` + `prompt`,续轮 `sessionId` + `prompt`)+ 轮询 `GET /api/agent/runs/:id/events?since=-1`(1s 间隔)的薄客户端;`vm0 auth setup-token` 是官方给 CI/程序化调用发 `VM0_TOKEN` 的通道(官方 GitHub Action 同样用法);`eventData` 就是沙箱内 claude-code/codex 的原生 stream-JSON 事件,schema 跟着 `framework` 走。

**补充(同日二次调研,"vm0 是不是本地 agent")**:不是。CLI 无任何本地执行模式(无 `dev`/`local` 子命令、无 `--local` flag,无 token 直接 `Not authenticated`);`@vm0/runner` 是"自带算力"的任务轮询器(Ably `runner-group:<group>` + `/api/runners/poll|claim|heartbeat`),沙箱在自己机器上跑但编排仍在平台,要求 Linux+KVM+Firecracker,且 runner token / kernel/rootfs 镜像没有公开发放渠道,demo 无法复现;整个平台自托管 BUSL 允许但零文档。compose 的 `experimental_runner.group` 字段就是把 run 路由给自托管 runner(注释原文 "instead of E2B"——托管默认沙箱后端是 E2B)。结论:demo 保持托管 API 接法,README「能不能本地跑?」一节有完整记录。

**修法**:接 vm0 不是装 SDK,而是:(1) `vm0 compose vm0.yaml` 部署 agent compose;(2) 后端带 `Authorization: Bearer $VM0_TOKEN` 直接打上述 REST 端点;(3) 把 eventData 原样转发给前端按 claude stream-JSON 渲染。关键坑:请求 schema 是 `.strict()`(不能传 `agentName`,要先 `GET /api/agent/composes?name=` 解析成 id);平台只存 secret **名字**不存值,`CLAUDE_CODE_OAUTH_TOKEN` 这类 run secrets **每轮都要重传**(官方 `vm0 run continue` 也这么做);run 是真实 microVM 任务,首条回复几十秒起,前端必须按事件流渲染。完整实现见 `examples/zh/origin/vm0/`;`docs/adapters/targets.md` 里"事件 schema / usage 未公开"的判断如再评估 adapter 时需要按此更新。
