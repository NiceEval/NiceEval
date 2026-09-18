---
format: concord.document/v1
id: bub-default-client-closure-drift
title: 默认 Bub 的模型客户端闭包随安装日期漂移
createdAt: 2026-08-19T15:00:54+08:00
createdAtSource:
  kind: first-recorded
  path: memory/bub-default-client-closure-drift.md
  commit: 5f5fc3e27607dc8e7a4aed99f776878cbe1231a2
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [bub-default-client-closure-drift](bub-default-client-closure-drift.md) —
      默认 `bub==0.4.0` 未锁模型客户端使重装后请求协议突变；运行时、E2B 与 Vercel 现共用三行 override 和同一
      marker，旧预制品严格 miss 后重装"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---
# 默认 Bub 的模型客户端闭包随安装日期漂移

**现象（2026-08-19）**：同一个 `bub==0.4.0` 配置此前能跑，重新安装后 session/recall 请求突然以
`prompt_cache_retention` 不受网关模型支持而返回 400；单轮 Eval 仍能通过。

**根因**：Bub 的 PyPI metadata 没有锁住模型客户端。当天 resolver 选到了
`any-llm-sdk==1.17.0` 与 `openai==2.31.0`，请求协议随传递依赖变化。最初修复只让运行时
`bubAgent()` 写三行 override 并把闭包纳入 marker，却遗漏了公开 `e2bCodingAgentTemplate("bub")`
与 Vercel snapshot builder；预装配方仍会漂移，marker 也必然与 Adapter 分叉。

**修法**：默认 Bub 0.4.0 同批固定上述两个客户端；Adapter、E2B 与 Vercel 都用相同三行 override
计算安装 marker。显式选择其它 Bub 版本时不套用 0.4.0 的闭包。已发布旧制品保持不可变，严格 marker
探测会让它们在首次使用时回退到运行时重装，不覆盖旧 tag。

**防线**：`e2e/package/test/bub-e2b-template.test.ts` 从安装后的公开 factory 读取 E2B 原生
Dockerfile，锁定三行 override 与匹配 marker；真实 Bub live owner继续验证安装后的运行路径。
