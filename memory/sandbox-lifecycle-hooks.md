# 设计裁决:沙箱生命周期钩子挂在 SandboxSpec 上(`.setup()` / `.teardown()` 链式)

> **部分被后续裁决替代**(2026-07-17):「实验级整场钩子不存在 / ExperimentDef 保持纯配置数据」一条被推翻,见 [[experiment-level-lifecycle-hooks]]——`ExperimentDef.setup`(整场一次、宿主机侧、返回 cleanup)已落地。本条其余裁决(沙箱钩子挂 SandboxSpec、persistentState 不做、sandbox.setup 的顺序)不受影响,仍然有效。

**裁决**(2026-07-10,用户定案):环境预置(「本想烘进 template/Dockerfile、但要按实验变化」的东西——装二进制、预热模型、写 hook 文件、载入/回存跨 attempt 状态)的家是 SandboxSpec 的链式钩子 `.setup(fn)` / `.teardown(fn)`。生命周期四层各归各位:eval 级 setup = 任务夹具,agent 级 = 协议接入,沙箱级 = 环境预置(挂 spec),**实验级整场钩子不存在**——ExperimentDef 保持纯配置数据。

**曾选方案**(同日连续两次翻案,均未落地成代码):

1. `ExperimentDef.setup/teardown`(每沙箱一次,agent.setup 之后)——被否:名字是实验生命周期,节奏却是沙箱生命周期,「实验级字段、沙箱级节奏」的错位;实验生命周期真正的含义是整场一次(第一个 attempt 前/最后一个 attempt 后)。两个 sub agent 已按此 spec 开工,叫停时零文件改动。
2. `ExperimentDef.sandboxSetup/sandboxTeardown`(改名明示沙箱节奏)——用户随即提出更优形态:钩子的载体应该就是 sandbox 本身(`Docker().setup(fn)` 链式),载体与节奏天然对齐,ExperimentDef 保住纯数据性质,钩子函数后端中立、可跨 docker/e2b 复用。

**连带裁决**:`persistentState`(runner 托管跨 attempt 状态 + 按 key 自动串行)**不做**——状态载入/回存由用户钩子自己做,`ctx.experimentId`(同轮新增,路径推导实验 id,钩子与 send 都可见)当状态隔离键,串行仍由实验声明 `maxConcurrency: 1`。这推翻了 [[registermcp-post-hoc-primitive]] 连带评估里「persistentState 值得上游化」的当时结论。

**关键顺序决定**:sandbox.setup 跑在 workspace 上传 / git 基线 / eval.setup **之前**(环境层先于任务材料,像镜像构建先于代码挂载,环境文件进基线、不污染 diff 归因);sandbox.teardown 在 finally 里 agent 级收尾之后、销毁之前(回存状态正好要这个位置)。推论:想改 workspace 文件的条件不属于环境层——任务夹具用 eval.setup,per-实验 workspace 注入过渡期仍用 wrapper、收敛方向是 skills `kind: "local"`。

**落点**:类型与链式 builder 在 `src/sandbox/types.ts`(`SandboxHooks<Self>`)+ `src/define.ts`;runner 接线 `src/runner/attempt.ts`;`ctx.experimentId` 走 attempt ctx 与 session ctx 两条构造链(`src/context/{context,session}.ts`)。契约主文档 `docs/sandbox.md`,公开站 `docs-site/zh/guides/sandbox-backends.mdx`。downstream(coding-agent-memory-evals)的 `withMempal` wrapper 同步迁移为 `mempalMcp`(构造期)+ `mempalSetup/mempalTeardown`(沙箱钩子)。

关联:[[registermcp-post-hoc-primitive]](同一轮讨论的前一个裁决:MCP 只走构造期,不做后置原语)。
