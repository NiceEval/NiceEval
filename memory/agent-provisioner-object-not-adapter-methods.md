---
format: concord.document/v1
id: agent-provisioner-object-not-adapter-methods
title: 裁决:Ensure 的公开形态是独立 AgentProvisioner 对象,不是 SandboxAgentDef 上的方法
createdAt: 2026-07-30T19:32:03+08:00
createdAtSource:
  kind: first-recorded
  path: memory/agent-provisioner-object-not-adapter-methods.md
  commit: bf0b0c489aa0c82226537d36faf5bb90f4667e9d
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history:
  - at: 2026-09-14T15:00:25.173Z
    action: revise
    reason: "- 部分被后续裁决替代
      [agent-provisioner-object-not-adapter-methods](agent-provisioner-object-n\
      ot-adapter-methods.md) — 裁决(2026-07-30):Ensure 公开形态是独立 `AgentProvisioner`
      值对象(identity/check/install 原子替换,经工厂参数拔插),否决在 SandboxAgentDef 上散布方法;Runner
      只额外消费 identity 与 prepare;check 返回结构化事实不返回 boolean"
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
    eventAt: 2026-07-30
---
# 裁决:Ensure 的公开形态是独立 AgentProvisioner 对象,不是 SandboxAgentDef 上的方法

> 2026-08-01 被 [[pure-adapter-official-installer]] 部分替代:check(probe)留在 Adapter 的 ensure 声明,install 拆出为官方 AgentInstaller 按 identity 配对;原子性由 identity 同源保证,不再要求同一值对象。

- **日期**:2026-07-30
- **裁决**:Agent Ensure 以独立值对象 `AgentProvisioner`(identity / check / install,外加内置默认路径的 prepare)承载,经 sandbox agent 工厂参数替换(`codexAgent({ provisioner })`)。它由 Sandbox Agent 拥有并在 `agent.setup` 内执行;Runner 不新增第四个生命周期参与者,只额外消费 `identity`(进 configHash)与 `prepare`(Run 级 single-flight,记 `agent.artifact.prepare`)。同批裁定 `check` 返回结构化检查事实(含实际版本),不返回 boolean。
- **曾选方案**:在 `SandboxAgentDef` 上直接加 `identity` / `check` / `install` 几个方法,不引入新对象。论据是概念更少,且 check 依赖的知识(哪个命令、什么版本、什么运行条件)本来就属于 adapter。
- **否决理由**:
  1. identity / check / install 必须原子替换——只覆盖 install 不覆盖 check 会让指纹与实际环境静默漂移(agent-install GOALS 的 R4「身份与检查同源」),散布成三个可覆盖方法时类型系统拦不住半替换;打包成一个值,替换天然原子。
  2. `prepare` 是 Run 级、宿主侧、以 identity 为 key 的 single-flight(与 `sandbox.build` 对称),而 `SandboxAgentDef` 现有方法全是 attempt 级、沙箱内;混进同一方法袋会让一个对象携带两种生命周期节奏,协调器也失去稳定的 single-flight 单位。
  3. 内置 adapter 的 def 是工厂产出、对用户不透明;方法长在 def 上,换安装逻辑就得展开重包整个 adapter,工厂参数是最小替换缝。
  4. Direct Agent 不需要这些方法;放在 `Agent` 联合上会给 direct 分支带一组恒 undefined 的可选方法(踩 CLAUDE.md「可选字段加进共享接口要数调用点」的反面)。
  「知识属于 adapter」不构成反对:默认 provisioner 就由 adapter 作者在工厂内部定义,对象只是让它可整体拔插。
- **check 返回形态**:结构化事实而非 boolean——「检查命中 / 本次安装 + 实际版本」要落 attempt facts,boolean 会逼 adapter 在旁边再探测一次同样的信息。
- **契约落点**:`docs/feature/adapters/architecture/agent-ensure.md`(理由段与 `AgentCheckResult` 同页)。
