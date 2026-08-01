**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md) · [PLAN-9](PLAN-9/README.md)

---

## 结论

采纳 [PLAN-9](PLAN-9/README.md):单一 Sandbox Recipe、唯一 active template 与 template owner 顺序。

## 关键裁决

- Eval 与 Experiment 都通过 `sandbox` 字段贡献 SandboxRecipe，不再公开 Environment 与 SandboxConfig 两套作者概念。
- SandboxRecipe 是声明；Sandbox 是启动后执行命令与文件操作的句柄，两种类型不能互换。
- 每条 Attempt 恰好激活一个 SandboxTemplate。Eval recipe 有 template 时优先，否则使用 Experiment 或 Provider fallback。
- SandboxTemplate 是完整 Case 起点的穷尽联合，不把 Compose 资源组压成单实例产物。
- Experiment Provider recipe 选择 Provider。Provider 是 template 的唯一 planner，并拥有 build、start、ready、证据与资源组 finalizer。
- `templates[profile]` 可以替换 Eval template 的物理实现，但不改变 template owner。
- template owner 决定 setup 顺序：Eval template 走 Eval、Experiment、Agent；Experiment template 走 Experiment、Eval、Agent。
- template owner 仍可拥有 setup。预装产物不能代替实际 identity、版本、PATH、权限与健康检查。
- Eval 与 Experiment recipe setup 都是逐 Attempt 层；复用窗口 reset 后仍按相同 ownerOrder 重跑。
- 绑定 Sandbox 窗口寿命的 service、ready、日志与 finalizer 归 Provider Case，不放普通 recipe setup。
- Agent CLI 与 runtime 继续由 AgentProvisioner 与 Agent setup 拥有，不投影成较弱的通用 Layer。
- 外部 state load/save 保持独立 lifecycle：state load 位于 recipe setup 与 Agent CLI Ensure 之后，state save 位于 Agent teardown 之后。
- 需要预装命中的准备封装成领域 setup helper,在 helper 内 check/install/recheck。
- 第一阶段不公开 Requirement、Base contribution、依赖 DAG、资源图或自动并行。
- 现场无法按 ownerOrder 组合时复用 `templates[profile]` 提供预制完整 Case,或明确 skip/fail。
- 无 identity 的 plain setup 不参与缓存命中,报告标注对应 owner recipe 身份不可比。
- `composeSandbox()`、`dockerfileSandbox()` 与 `profileSandbox()` 构造带 template 的 Eval recipe。
- `dockerSandbox()`、`e2bSandbox()` 与 `vercelSandbox()` 构造选择 Provider 的 Experiment recipe。
- 普通 Experiment 不注册 materializer；Provider 内建自己支持的 SandboxTemplate kind。
- `workspaceService` 指明 Agent、Eval、文件 API、workdir 与 diff 的共同执行空间。
- 每道 Eval 保持自包含，不要求数据集 adapter 或共享 Eval 工厂消除重复。
- 起始文件与测试文件都走普通 Sandbox 上传；相对 `send` 的源码顺序决定 Agent 可见性。
- Runner 从真实本地上传生成 transfer manifest，send 窗口负责 agent diff 归因。
- 不增加文件专用 EvalDef field、Verifier context 或 Agent 结束状态机；正常路径没有模块顶层登记副作用。
- Eval 模块保持纯声明；Compose nonce、临时目录与日志收集由 Provider Case 按 Attempt 管理。

## 真实仓库证据

### Terminal-Bench

本次复核对象是 [harbor-framework/terminal-bench](https://github.com/harbor-framework/terminal-bench) 的 `d28711d0da2675d0bb1d56de45ae5df6082438a3`,不是已经迁移过的 NiceEval 版本。

上游把每道题组织成 task package。
`TaskPaths` 固定从同一目录取得 `task.yaml`、`docker-compose.yaml`、`run-tests.sh`、`tests/**` 与 solution;harness 把 Compose build/up 后的 `client` 交给 Agent,并在 Agent 结束后才复制测试材料。

这证明 Compose 的 owner 是 task package,不是 Experiment。
每题 Eval 可以直接引用自己的 task package，并在同一份 `test(t)` 中按顺序写 send、普通上传、跑测与断言。

真实迁移还揭示了 PLAN-6 的遗漏。
为了让 verifier 进入指纹，作者不得不在 `defineEval()` 外顶层执行 `loadCriteria`；为了控制可见时机，又要在 `test(t)` 中手工上传、运行和清理同一批文件。
这不是题目差异，而是 Runner 生命周期机械动作。

### MemoryBench

MemoryBench 的 Experiment 选择 E2B template;mempal 变体使用预装 template 与 sandbox setup/teardown。
具体 Eval 没有 Environment source,而是在 Agent 前 checkout 固定仓库 commit 并安装项目依赖。

这证明反向路径同样存在:Experiment 默认 case 决定起点,EvalDef setup 再准备题目。
它不需要 Eval 再贡献一份 Base,也不需要把 checkout 与 `yarn install` 抽象成 Environment Requirement。

## 为什么 PLAN-5 的 DX 过重

PLAN-5 把四类不同问题同时暴露给作者:

1. 起点所有权:Eval Base、默认 Base、条件 Base 与融合 case。
2. 条件建模:Eval/Experiment Requirement 与 owner 命名域。
3. 调度建模:`dependsOn`、`resources`、single-flight 与多道验证屏障。
4. 正交生命周期:state、Agent runtime、普通文件传输与 send 窗口。

作者为“在最终 Sandbox 装一个工具”付出了理解整个组合系统的成本。
而两家真实仓库只要求两个稳定动作:Experiment 给 Sandbox 装实验工具,Eval 给 Sandbox 准备题目依赖。

PLAN-5 还把 `e2bSandbox({ template })` 与 Eval source 解释成两个 Base 的潜在冲突。
但 SandboxConfig 的解析语义可以直接表达:有 Eval Environment 时走 profile Case 或 Provider 内建规划,无 Environment 时才走 defaultEnvironment。
默认值不是第二份 contribution。

## 为什么 PLAN-7 的作者面仍不闭合

PLAN-7 的运行时不变量成立，但公开名字把规划值、配置值与运行值都叫成 Sandbox。
`composeSandbox()` 返回的只是题目环境来源；SandboxSpec 又同时承载 Provider、解析、fallback、profile Case 与 Experiment setup。

Terminal-Bench 进一步暴露了装配泄漏。
Experiment 声明“环境属于 Eval”，却仍必须导入 `dockerComposeMaterializer()`，说明 Experiment 需要知道所选 Eval 的 source kind。

PLAN-8 不改变唯一 Case 与三层 setup 内核，只把边界写回调用点：

```text
EnvironmentSource
  -> SandboxConfig 选择的 Provider 内建解析
  -> Sandbox Case
  -> 主 Sandbox
  -> Experiment / Eval / Agent setup
```

这不是 PLAN-2 的单 template 与统一 Layer。
Compose 仍是完整资源组，三个 setup owner 也保留各自的生命周期与领域能力。

## 为什么 PLAN-8 仍多分了一层作者概念

PLAN-8 已经把 EnvironmentSource、SandboxConfig 与运行中的 Sandbox 分开命名，但作者仍要在两个领域对象之间做分类。
Eval 写 `environment`，Experiment 写 `sandbox`；两者最终却都只是在同一个主 Sandbox 上确定起点或执行 setup。

真实差异可以由顺序表达，而不需要两个字段表达：

```text
Eval 有 template
  -> Eval recipe setup
  -> Experiment recipe setup
  -> Agent

Eval 无 template
  -> Experiment template and recipe setup
  -> Eval recipe setup
  -> Agent
```

PLAN-9 因此保留 PLAN-8 的完整 Case、Provider 内建 planner 与运行时检查，只统一作者声明为 SandboxRecipe。
为了让这条顺序在 Sandbox 复用中不漂移，两条普通 recipe setup 都改成逐 Attempt 语义。

## 候选对照

| 候选 | 作者要理解的公开概念 | 对两个真实方向的处理 | 结论 |
|---|---|---|---|
| PLAN-1 | Environment、Provision | 固定 Eval 环境/Experiment 安装,反向路径别扭 | 否决 |
| PLAN-2 | 单 template、Layer | Compose 被压扁,领域边界丢失 | 否决 |
| PLAN-3 | Eval Case、Experiment Addon | Terminal-Bench 自然,MemoryBench 仍偏向 Eval 起点 | 否决 |
| PLAN-4 | Requirement、Base、Ensure | 两方可贡献,但默认 template 被误判成 Base 冲突 | 否决 |
| PLAN-5 | 两组 Requirement、四档 Base、融合 case、调度图 | 表达力最大,作者面和实现面也最大 | 否决 |
| PLAN-6 | Environment、SandboxSpec setup、EvalDef setup、Agent setup | 环境 owner 正确，但 hidden verifier 仍靠顶层登记和手工协调 | 被 PLAN-7 取代 |
| PLAN-7 | PLAN-6 的 owner 加普通上传动态依赖 | 运行时内核成立，公开命名与 materializer 装配仍泄漏 | 被 PLAN-8 取代 |
| PLAN-8 | EnvironmentSource、SandboxConfig、Sandbox 与三层 setup | 边界准确，但作者仍需在 Environment 与 Sandbox 配置之间分类 | 被 PLAN-9 取代 |
| PLAN-9 | SandboxRecipe、SandboxTemplate、Sandbox 与 owner stack | 一个字段表达起点和叠加，template owner 决定顺序 | 采纳 |

## 两条迁移路径

Terminal-Bench:

```text
每题 EvalDef 引用自己的 task package
  -> composeSandbox() 产生带 template 的 Eval SandboxRecipe
  -> Docker Provider 内建规划并启动完整 Case
  -> Eval recipe setup
  -> Experiment recipe setup 安装 mempal
  -> Agent Ensure and setup
  -> send 返回后 Eval 用普通 API 上传本地测试、跑测与断言
  -> Runner 记录 transfer manifest，并折叠 send-window diff
```

MemoryBench:

```text
Eval recipe 无 template
  -> Experiment E2B template 启动完整 Case
  -> Experiment recipe setup 检查 mempal 预装状态
  -> Eval recipe setup checkout + yarn install
  -> Agent Ensure、state load 与 Agent turn
```

## 预制与真实检查

PLAN-9 不承诺运行时合并两个 template。
若 mempal 不能按 ownerOrder 装进某条 Compose template,Experiment 必须在 `templates[profile]` 提供预制完整 Case,否则该组合明确 skip/fail。

预制 case 或 template 名不证明工具可用。
`mempalSetup()` 这类领域 helper 必须检查实际版本与 cache identity,缺失时安装或明确失败;执行安装后必须复检。
这保留 PLAN-5 最有价值的真实性要求,但不把通用 Requirement 协议暴露给所有作者。

## 实现边界

第一阶段需要十三项增量:

1. `EvalDef.environment` 改成 `EvalDef.sandbox`，类型为不选择 Provider 的 EvalSandboxRecipe。
2. `EvalDef.setup` / `teardown` 迁入 Eval SandboxRecipe，不保留双入口。
3. `dockerSandbox()` 等工厂返回选择 Provider 的 ExperimentSandboxRecipe，并用 `templates[profile]` 提供完整覆盖。
4. `composeSandbox()` 与 `dockerfileSandbox()` 返回带 SandboxTemplate 的 Eval recipe。
5. 增加 `profileSandbox()` 与没有 template 的 `defineSandboxRecipe()`。
6. `SandboxSource` 内部重命名为 SandboxTemplate 联合；运行中的 Sandbox 类型保持不变。
7. `mainService` 政名为 `workspaceService`。
8. Docker Provider 内建 Compose 与 Dockerfile template planner，普通 recipe 删除 `materializers` 注册表。
9. 解析 active template、templateOwner 与 ownerOrder，并让 dry plan 和记录显示同一形状。
10. Eval 与 Experiment recipe setup 改成逐 Attempt 执行；Provider Case 保留每 Sandbox / 窗口 lifecycle。
11. State load/save 与 AgentProvisioner 保持独立 phase，不并入通用 SandboxSetup。
12. 普通上传增加 URL source；carry planner 重算历史 manifest，Provider 记录 Agent 可见 closure并执行泄漏比对。
13. 记录所选 Case、owner stack、逐 owner setup activity 与 transfer manifest；删除文件专用登记面。

依赖图、资源锁与跨 helper 自动并行不进入本决策的第一阶段。
外部 state API 由对应 Feature 定义；PLAN-9 只固定它在 Agent CLI Ensure 与 Agent runtime setup 之间的相位，不把它回填成 Sandbox recipe。

## 遗留风险

- 预制 Case 需要携带构建时写入的 Eval SandboxTemplate provenance，规划期才能与当前 template 的内容身份核对。不能从当前 template 动态计算声明值给既有产物背书；在产物元数据与 per-eval fingerprint 拥有同源输入前，不公开 `fulfills` 之类的声明字段。
- 每题 SandboxTemplate 的 build context 必须排除 solution 与本地测试，并检查 Compose bind mount 泄漏。
- setup 顺序随 templateOwner 改变。任何 helper 若依赖另一个 owner 先执行，都必须服从 stack 依赖方向，或改用完整预制 Case。
- 普通 recipe setup 改成逐 Attempt 后，现有按 Sandbox 窗口运行的 Hook 必须迁到 Provider Case lifecycle 或可检查 helper，不能静默改变频次。
- 某些工具同时需要安装与跨 Attempt 状态。PLAN-9 把 state 保留为独立 lifecycle；对应 Feature 必须定义 load/save、临界区与失败提交策略。
