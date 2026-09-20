---
format: concord.document/v1
id: attempt-phase-scoped-feedback-api-deferred
title: 设计裁决:adapter/provider 公开 scoped feedback API(progress/diagnostic)推迟出本次反馈模型重构范围
createdAt: 2026-07-14T09:56:17+08:00
createdAtSource:
  kind: first-recorded
  path: memory/attempt-phase-scoped-feedback-api-deferred.md
  commit: 62bf6cc8fc1f62a1752a0931e348006837608f3a
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---
# 设计裁决:adapter/provider 公开 scoped feedback API(progress/diagnostic)推迟出本次反馈模型重构范围

**裁决**(2026-07-13,`plan/exp-output-feedback-models.md` 执行阶段的明确 SCOPE DECISION):本次交付只实现 `AttemptPhase` 作为 runner 内部的闭集合枚举——由 `attempt.ts` 既有的顺序步骤(创建 sandbox / `SandboxSpec.setup()` / workspace 准备 / `EvalDef.setup` / `Agent.setup` / telemetry 配置 / `EvalDef.test` / diff / scoring / trace / teardown)在各自**实际执行**的边界上发出 phase 转换事件,没有对应 hook/配置的步骤直接跳过,不伪造空阶段。已有的 adapter 自由文本进度(`AgentContext.log` / `ctx.progress` 风格)继续作为 `detail` 字符串挂在 runner 当前认定的 phase 上,只更新 human dashboard 当前 active 行的次要文本,`agent` / `ci` profile 不展示;adapter/provider/hook 不能借此改变 phase 本身。

**曾选方案**(设计文档已写但本次不实现,见 `docs/feature/experiments/cli.md`「Attempt 阶段」一节的完整表格):把 phase 拆成按所有权分层的具名 operation scope——`sandbox.provision` / `sandbox.setup` / `sandbox.teardown` / `workspace.prepare` / `workspace.diff` / `eval.setup` / `eval.run` / `agent.setup` / `agent.run` / `agent.teardown` / `telemetry.configure` / `telemetry.collect` / `scoring.evaluate`。每个 scope 由 runner 创建并绑定后交给对应层各自持有一份 `ScopedFeedback { progress(update): void; diagnostic(input): void }`,让自定义 Sandbox provider、`SandboxSpec.setup/teardown` hook、`EvalDef.setup/test`、Agent adapter 的 setup/send/teardown、telemetry、scoring 六类第三方扩展点都获得一份新的稳定公开契约。

**否决理由(推迟,不是否定)**:这是一个材料上远大于 `plan/exp-output-feedback-models.md` TODO 清单本身的公开 API 面——一次性给六类第三方扩展点都发一份新契约,仓促实现容易埋下两类风险:

1. **违反 core 中立边界**(`AGENTS.md`「Architecture Boundaries」):要让 runner 正确地把每个 operation 绑定到对应层、并保证"调用方不能传 scope/operation/phase、不能越权改变 Attempt 状态机",很容易在核心调度路径里长出 `agent == X` / `sandbox == Y` 式的特判分支,而不是干净的按接口分发。
2. **公开 API 面一旦发布,收窄成本远高于观望成本**——先让 runner 内部用这套 phase 枚举跑通三种反馈 profile(human dashboard 的 active 行、agent/ci 的 `phase=` 字段),观察真实用法把映射关系跑稳,再决定要不要、以及以什么确切形状对外暴露,比照着一份还没被验证过的表格直接把六个新方法签名钉成公开契约更安全。

因此这次只做「runner 内部投影」这一半:`AttemptPhase` 由 `attempt.ts` 沿既有生命周期步骤发出,不新增任何第三方可调用的 `progress()` / `diagnostic()` 公开方法;`AgentContext.log` 保留原样(仍是运行器的观测通道),只是现在明确文档化为"只更新 human dashboard 当前行的 detail,`agent` / `ci` profile 不展示,不写入 results",而不是获得 phase 控制权。

**适用场景**:下一次要做这件事的人,先确认 runner 内部的 phase 枚举已经在真实的 human / agent / ci 三种反馈里跑够久、映射关系稳定,再决定是否把 `ScopedFeedback` 提升为公开 API;不要因为 `docs/feature/experiments/cli.md` 已经画好完整的 operation-scope 表格就默认"顺手也实现了"——这是本次工作明确排除在外的范围,不是遗漏。落地时优先检查会不会把 `agent == X` / `sandbox == Y` 式判断带进 `runner/run.ts` / `runner/attempt.ts` 这类核心路径。

关联:`docs/feature/experiments/cli.md`「Attempt 阶段」一节(完整设计,含此处推迟的 operation-scope 表与 `ScopedFeedback` 接口);`plan/exp-output-feedback-models.md` 的 A2 章节「给 provider、hook、adapter scoped feedback」(与本条裁决对应的未实现 TODO)。

**新判断**(2026-07-14,见 scoped-feedback-finalized 条目):设计契约已定稿并单一归属 `docs/feature/experiments/library.md`,roadmap 提案页删除;本条的推迟继续约束**实现排期**与「警惕核心路径特判」的落地纪律,不再约束文档的定稿状态。
