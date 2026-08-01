**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md) · [PLAN-9](PLAN-9/README.md) · [PLAN-10](PLAN-10/README.md)

---

## 结论

采纳 [PLAN-9](PLAN-9/README.md):单一 Sandbox Recipe、唯一 active template 与 template owner 顺序。

PLAN-10 是在本次结论之后新增的重新评审候选；在下一次明确裁决前，本页仍记录 PLAN-9 的既有决定，不把 PLAN-10 标成已采纳状态。

## 关键裁决

- Eval 与 Experiment 都通过 `sandbox` 字段贡献 SandboxRecipe，不再公开 Environment 与 SandboxConfig 两套作者概念。
- SandboxRecipe 是声明；Sandbox 是启动后执行命令与文件操作的句柄，两种类型不能互换。
- 共享 SandboxRecipe 协议用同一种 SandboxCommand 暴露两种显式 scope：`.setup()` / `.teardown()` 属于 Case 或复用窗口，`.beforeEach()` / `.afterEach()` 属于逐 Attempt。
- template 由具体 factory 的 options 声明，再由 Runner 归一成内部 SandboxTemplate，不公开同形 `recipe.template` 字段。
- 对 Sandbox Agent，每个实际选中的 Eval × Experiment pair 恰好一方声明 SandboxTemplate；两方都有是 conflict，两方都没有是 missing，不存在优先级或 implicit default。
- SandboxTemplate 是完整 Case 起点的穷尽联合，不把 Compose 资源组压成单实例产物。
- template-bearing factory 同时选择 Provider，可以出现在 Eval 或 Experiment；两侧接受同一个 SandboxRecipe 类型。
- Provider 是所属 template 的唯一 planner，并拥有 build、start、ready、证据与资源组 finalizer。
- template owner 分别决定两种 scope 的 owner 顺序：Eval template 走 Eval、Experiment、Agent；Experiment template 走 Experiment、Eval、Agent；afterEach 与 teardown 各自逆序。
- template owner 仍可拥有 setup。预装产物不能代替实际 identity、版本、PATH、权限与健康检查。
- Eval 与 Experiment recipe setup/teardown 都是窗口层；beforeEach/afterEach 是逐 Attempt 层。fresh 因一条 Attempt 恰好一个窗口，两种 scope 都各运行一次。
- SandboxCommandContext 以精确 phase 为类型参数；Window context 没有 `attempt` 字段，Attempt context 的 `attempt` 必填。窗口 command 的 activity、facts 与 diagnostic 归 Case / 复用窗口记录并由 Attempt 引用；逐 Attempt command 直接归当前 Attempt。
- SandboxCommand 只取得无 `stop()` 的 SandboxCommandTarget；其 `runCommand` / `runShell` 非零默认失败，预期非零探测显式使用 `tryCommand` / `tryShell`。
- 复用窗口在两方 setup 后建立 reset anchor；每条 Attempt reset 后按 ownerOrder 执行 beforeEach，并在全部 beforeEach 后建立 Agent diff workspace baseline。
- 复用 pool key 固定 `(CaseKey, templateOwner, ownerOrder, caseScopeRecipeIdentity)`。
- Attempt scope identity 进入 Attempt fingerprint，但不进入 pool key，允许当前 Eval 的 command 变化。
- 绑定 Sandbox 窗口寿命的 service、ready、日志与 finalizer 归 Provider Case，不放普通 recipe setup。
- Eval 与 Experiment layer 共用同一 SandboxCommand 协议；owner 只决定顺序、归因与收尾位置。
- Agent CLI 与 runtime 继续由 AgentProvisioner 与 Agent setup 拥有；其 Sandbox 内副作用虽然也是 command / IO，完整协议不投影成较弱的 SandboxCommand，Adapter 也不能暗中贡献 template 或 Provider。
- 外部 state load/save 保持独立 lifecycle：state load 位于本条 Attempt 的 beforeEach 与 Agent CLI Ensure 之后，state save 位于 Agent teardown 与 afterEach 之间。
- 框架不理解 layer 想满足什么 Requirement；需要利用预装时，作者在同一 command 里手写 check、必要时 install 与 recheck。
- 第一阶段不公开 Requirement、Base contribution、依赖 DAG、资源图或自动并行。
- discovery 后对当前 Run 的全部 Eval × Experiment pair 做一次 link planning。
- template conflict、missing、factory / Agent capability 与 Direct Agent 误配在 Provider 网络、build 或 Sandbox 创建前聚合失败。
- `niceeval check`、`--dry` 与正常执行复用同一个 linker；`check` 保持零 Provider 网络与零资源，正常执行不能绕过它。
- 现场无法按 ownerOrder 组合时，必须让恰好一侧改用已经融合条件的完整 template，或用 selector 明确排除；不增加第二起点覆盖轴。
- `composeSandbox()`、`dockerfileSandbox()`、`dockerImageSandbox()`、`e2bSandbox()` 与 `vercelSandbox()` 都构造 template-bearing SandboxRecipe 并带出 Provider。
- 普通 Experiment 不注册 materializer；Provider 包同点导出自己支持的 SandboxTemplate factory 与 planner。
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
具体 Eval 没有 template,而是在 Agent 前按 Attempt checkout 固定仓库 commit 并安装项目依赖。

这证明反向路径同样存在:Experiment 显式 template 决定起点,Eval recipe beforeEach 再准备题目。
它不需要 Eval 再贡献一份 Base,也不需要把 checkout 与 `yarn install` 抽象成 Environment Requirement。

## 为什么 PLAN-5 的 DX 过重

PLAN-5 把四类不同问题同时暴露给作者:

1. 起点所有权:Eval Base、默认 Base、条件 Base 与融合 case。
2. 条件建模:Eval/Experiment Requirement 与 owner 命名域。
3. 调度建模:`dependsOn`、`resources`、single-flight 与多道验证屏障。
4. 正交生命周期:state、Agent runtime、普通文件传输与 send 窗口。

作者为“在最终 Sandbox 装一个工具”付出了理解整个组合系统的成本。
而两家真实仓库只要求两个稳定动作:Experiment 给 Sandbox 装实验工具,Eval 给 Sandbox 准备题目依赖。

PLAN-5 正确识别了显式 `e2bSandbox({ template })` 与 Eval template 的起点冲突，但为此公开了完整 Base contribution 与融合模型。
PLAN-9 保留这条硬约束而不公开组合语言：两个 template 在 pair link planning 直接 conflict，零 template 直接 missing，没有游离的 Provider default 补洞。

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
  -> Eval / Experiment window setup
  -> Eval / Experiment beforeEach
  -> Agent

Eval 无 template
  -> Experiment template
  -> Experiment / Eval window setup
  -> Experiment / Eval beforeEach
  -> Agent
```

PLAN-9 因此保留 PLAN-8 的完整 Case、Provider 内建 planner 与运行时检查，只统一作者声明为 SandboxRecipe。
为了让这条顺序在 Sandbox 复用中不漂移，PLAN-9 在两个显式 scope 内分别使用同一 ownerOrder：窗口 setup 只执行一次，逐 Attempt 准备由 beforeEach 表达。

## 候选对照

| 候选 | 作者要理解的公开概念 | 对两个真实方向的处理 | 结论 |
|---|---|---|---|
| PLAN-1 | Environment、Provision | 固定 Eval 环境/Experiment 安装,反向路径别扭 | 否决 |
| PLAN-2 | 单 template、Layer | Compose 被压扁,领域边界丢失 | 否决 |
| PLAN-3 | Eval Case、Experiment Addon | Terminal-Bench 自然,MemoryBench 仍偏向 Eval 起点 | 否决 |
| PLAN-4 | Requirement、Base、Ensure | 两方可贡献，但 Base 冲突与融合作者面过重 | 否决 |
| PLAN-5 | 两组 Requirement、四档 Base、融合 case、调度图 | 表达力最大,作者面和实现面也最大 | 否决 |
| PLAN-6 | Environment、SandboxSpec setup、EvalDef setup、Agent setup | 环境 owner 正确，但 hidden verifier 仍靠顶层登记和手工协调 | 被 PLAN-7 取代 |
| PLAN-7 | PLAN-6 的 owner 加普通上传动态依赖 | 运行时内核成立，公开命名与 materializer 装配仍泄漏 | 被 PLAN-8 取代 |
| PLAN-8 | EnvironmentSource、SandboxConfig、Sandbox 与三层 setup | 边界准确，但作者仍需在 Environment 与 Sandbox 配置之间分类 | 被 PLAN-9 取代 |
| PLAN-9 | SandboxRecipe、Provider-bound SandboxTemplate、Sandbox 与双 scope owner stack | 一个字段表达起点和 command；恰好一份 template 决定 Provider 与 owner 顺序 | 采纳 |
| PLAN-10 | SandboxLayer、固定 root-first 准备链与 pair-local root | Eval / Experiment 同形，Agent 安装进入同一时间线；普通 command 只有逐 Attempt 频次 | 待重新裁决 |

## 两条迁移路径

Terminal-Bench:

```text
每题 EvalDef 引用自己的 task package
  -> composeSandbox() 通过 factory 参数声明 Eval template 起点
  -> Docker Provider 内建规划并启动完整 Case
  -> Eval recipe setup
  -> Experiment recipe setup（可为空）
  -> 建立 reset anchor
  -> Eval / Experiment recipe beforeEach
  -> 建立 Agent diff baseline，再执行 Agent Ensure and setup
  -> send 返回后 Eval 用普通 API 上传本地测试、跑测与断言
  -> Runner 记录 transfer manifest，并折叠 send-window diff
```

MemoryBench:

```text
Eval recipe 无 template
  -> Experiment E2B template 启动完整 Case
  -> Experiment recipe setup 检查 mempal 预装状态
  -> 建立包含 mempal 的 reset anchor
  -> Eval recipe beforeEach checkout + yarn install
  -> 建立 Agent diff baseline，再执行 Agent Ensure、state load 与 Agent turn
  -> 窗口结束时 Experiment recipe teardown 清理 mempal
```

## 预装与真实检查

PLAN-9 不承诺运行时合并两个 template。
显式 Experiment template 选中自带 template 的 Eval 时，link planning 直接报告冲突，不会静默选一方。
若 mempal 作为 Experiment command 不能按 ownerOrder 装进某条 Compose template，作者必须让恰好一侧改用已经融合 mempal 的完整 template，并用 selector 形成合法 pair；不能在 Experiment 再挂第二份起点。

预制 case 或 template 名不证明工具可用。
`mempalSetup()` 这类普通 command 必须自己检查实际版本，缺失时安装或明确失败，执行安装后再复检。
这保留 PLAN-5 最有价值的真实性要求，但框架不理解这些 shell 分支，也不公开 Requirement 协议。

## 实现边界

第一阶段需要十四项增量:

1. `EvalDef.environment` 改成 `EvalDef.sandbox`；Eval 与 Experiment 的 `sandbox` 都使用同一个 SandboxRecipe 类型。
2. 旧 `EvalDef.setup` / `teardown` 若是逐 Attempt hook，迁入 Eval SandboxRecipe 的 `.beforeEach()` / `.afterEach()`；确属窗口条件时才迁入 `.setup()` / `.teardown()`，不保留双入口。
3. 所有 template-bearing factory 同时选择 Provider，并可放在 Eval 或 Experiment。单实例起点用 `dockerImageSandbox({ image })` 等必填参数表达，不提供 provider-only 形式或 implicit default。
4. factory 产物在 Runner 内部归一成 SandboxTemplate，不给共享 SandboxRecipe 增加可手写的 `template` / `provider` 属性；第一阶段不公开 profile registry，共享起点用普通 TypeScript helper。
5. 增加只声明 command stack、不声明起点的 `defineSandboxRecipe()`。共享协议提供四个 phase，用类型参数让 Window context 没有 Attempt。command 只取得 checked-by-default、无 `stop()` 的 SandboxCommandTarget；纯数据 command 或显式 identity/revision/inputs 才稳定，直接传入的 callback 一律 opaque，以此闭合 carry 和 pooling。
6. `SandboxSource` 内部重命名为 SandboxTemplate 联合；运行中的 Sandbox 类型保持不变。
7. `mainService` 政名为 `workspaceService`。
8. Provider 包同点导出 template factory 与 planner；普通 recipe 删除 `materializers` 注册表，Experiment 不另选 Provider。
9. discovery 与 Eval selection 后统一构造全矩阵 pair link。Sandbox Agent 的 1×1 conflict、0×0 missing、Direct Agent / empty selector 等错误在 Provider 网络前聚合失败。
10. 从同一 pair plan 解析 active template、templateOwner 与 ownerOrder，并让正常执行、dry plan 和记录按 Window/Attempt scope 显示同一形状与频次。
11. Eval 与 Experiment recipe setup/teardown 按 Sandbox Case / 复用窗口执行，beforeEach/afterEach 按 Attempt 执行。两方 setup 后建立 reset anchor，两方 beforeEach 后建立 Agent diff baseline。pool key 固定 Case scope identity，不固定当前 Attempt command。
12. State load/save 与 AgentProvisioner 保持独立 phase，不并入通用 SandboxCommand。
13. 普通上传增加 URL source；carry planner 重算历史 manifest，Provider 记录 Agent 可见 closure并执行泄漏比对。
14. 记录 logical/physical template origin、所选 Case、双 scope owner stack、逐 owner command scope/activity 与 transfer manifest；删除文件专用登记面。

依赖图、资源锁与跨 command 自动并行不进入本决策的第一阶段。
外部 state API 由对应 Feature 定义；PLAN-9 只固定它在 Agent CLI Ensure 与 Agent runtime setup 之间的相位，不把它回填成 Sandbox recipe。

## 遗留风险

- SandboxRecipe 必须是 opaque factory 产物；command 链只能保留原有 template contribution，不能追加 template、Provider 或第二个 Case。
- 每题 SandboxTemplate 的 build context 必须排除 solution 与本地测试，并检查 Compose bind mount 泄漏。
- 两种 scope 的顺序都随 templateOwner 改变。任何 command 若依赖同 scope 的另一个 owner 先执行，都必须服从 stack 依赖方向，或让唯一 template 直接包含所需条件。
- 旧 hook 迁移时必须显式判断频次：窗口安装/清理使用 setup/teardown，checkout、Fixture 与逐题清理使用 beforeEach/afterEach。仅保持调用链形状不能证明生命周期未变。
- pool key 必须包含完整 Case scope recipe identity；否则相同 CaseKey 下不同 setup 会错误共享 reset anchor。Attempt scope 不得反向污染 pool key，否则不同 Eval 无法复用兼容窗口。
- 某些工具同时需要安装与跨 Attempt 状态。PLAN-9 把 state 保留为独立 lifecycle；对应 Feature 必须定义 load/save、临界区与失败提交策略。
