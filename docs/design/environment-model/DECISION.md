**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [PLAN-8](PLAN-8/README.md)

---

## 结论

采纳 [PLAN-8](PLAN-8/README.md):唯一 Environment、Provider 内建解析、三层 Sandbox 准备与普通 Eval 文件传输。

## 关键裁决

- Environment 只负责选择起点。它是 profile 或 Provider-neutral EnvironmentSource，不是 Sandbox Case 或运行中的 Sandbox。
- Environment 可以由 Eval 作者声明,也可以由数据集 adapter 从原始 task package 派生。
- SandboxConfig 选择 Provider。当前 Provider 是唯一解析者，每条 Attempt 只选择一个完整 Sandbox Case。
- `environments[profile]` 优先于 Provider 内建规划；`defaultEnvironment` 只在 Eval 没有 Environment 时使用。
- 随 Experiment 变化的沙箱准备放 SandboxConfig setup。
- 随 Eval 变化的题目准备放 EvalDef setup。
- Agent CLI 与 runtime 继续由 Agent/Adapter setup 拥有。
- 三层 setup 都作用于已经启动的主 Sandbox，不能新增 service、改写网络或生成新的起点产物。
- 起点 owner 与 setup owner 正交。Eval 或 Experiment 提供起点后，自己的 setup 层仍可继续执行。
- 需要预装命中的准备封装成领域 setup helper,在 helper 内 check/install/recheck。
- 第一阶段不公开 Requirement、Base contribution、依赖 DAG、资源图或自动并行。
- 现场无法组合时复用 `environments[profile]` 提供预制完整 case,或明确 skip/fail。
- `sandboxReuse` 窗口内 SandboxConfig setup 只跑一次,跨 Attempt 会变化的条件禁止放这层。
- 无 identity 的 plain setup 不参与缓存命中,报告标注 setup 身份不可比。
- `composeEnvironment()` 与 `dockerfileEnvironment()` 从 `niceeval/environment` 导出，返回 EnvironmentSource。
- 普通 Experiment 不注册 materializer；Docker Provider 内建 Compose 与 Dockerfile Environment 支持。
- 公开配置类型名为 SandboxConfig，运行中的操作句柄继续叫 Sandbox。
- `workspaceService` 指明 Agent、Eval、文件 API、workdir 与 diff 的共同执行空间。
- 每道 Eval 保持自包含，不要求数据集 adapter 或共享 Eval 工厂消除重复。
- 起始文件与测试文件都走普通 Sandbox 上传；相对 `send` 的源码顺序决定 Agent 可见性。
- Runner 从真实本地上传生成 transfer manifest，send 窗口负责 agent diff 归因。
- 不增加文件专用 EvalDef field、Verifier context 或 Agent 结束状态机；正常路径没有模块顶层登记副作用。
- Eval 模块保持纯声明；Compose nonce、临时目录与日志收集由 Provider 内部 materializer 按 Attempt 管理。

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
| PLAN-8 | EnvironmentSource、SandboxConfig、Sandbox 与三层 setup | 保留完整 Case，普通调用点不注册 materializer | 采纳 |

## 两条迁移路径

Terminal-Bench:

```text
每题 EvalDef 引用自己的 task package
  -> composeEnvironment() 产生 EnvironmentSource
  -> Docker Provider 内建规划并启动完整 Case
  -> Experiment sandbox setup 安装 mempal
  -> EvalDef setup
  -> Agent setup
  -> send 返回后 Eval 用普通 API 上传本地测试、跑测与断言
  -> Runner 记录 transfer manifest，并折叠 send-window diff
```

MemoryBench:

```text
Eval 无 Environment
  -> Experiment E2B defaultEnvironment 启动默认 Case
  -> Experiment sandbox setup 检查 mempal 预装状态
  -> EvalDef setup checkout + yarn install
  -> Agent setup 与 Agent turn
```

## 预制与真实检查

PLAN-8 不承诺运行时合并两个起点。
若 mempal 不能装进某条 Compose 环境,Experiment 必须在 `environments[profile]` 提供预制完整 case,否则该组合明确 skip/fail。

预制 case 或 template 名不证明工具可用。
`mempalSetup()` 这类领域 helper 必须检查实际版本与 cache identity,缺失时安装或明确失败;执行安装后必须复检。
这保留 PLAN-5 最有价值的真实性要求,但不把通用 Requirement 协议暴露给所有作者。

## 实现边界

第一阶段需要十二项增量:

1. `composeSandbox()` 政名为 `composeEnvironment()`，并迁移到 `niceeval/environment`。
2. `dockerfileSandbox()` 与 `SandboxSource` 分别改名为 `dockerfileEnvironment()` 与 `EnvironmentSource`。
3. 公开 SandboxSpec 类型改名为 SandboxConfig，运行中的 Sandbox 类型保持不变。
4. image、template 与 snapshot fallback 收进 `defaultEnvironment`，并固化只在 Eval 无 Environment 时使用。
5. Docker Provider 内建 Compose Environment 支持，普通 SandboxConfig 删除 `materializers` 注册表。
6. `mainService` 政名为 `workspaceService`。
7. SandboxConfig setup 确认作用于最终解析出的主 Sandbox,不只作用于默认 case。
8. EvalDef setup 确认在 workspace baseline 后、Agent setup 前执行。
9. `defineSandboxSetup()` 为少数重准备 helper 提供 identity、check/install/recheck 与 staged payload。
10. 普通上传增加 URL source；carry planner 重算历史 manifest，源码变化时直接重跑。
11. Provider 内部 materializer 记录 Agent 可见 closure，判定封口前与本地 source 动态比对。
12. 记录所选 Sandbox Case、三层 setup activity、普通上传 activity 与 transfer manifest；删除文件专用登记面。

依赖图、资源锁、跨 helper 自动并行与外部 state API 不进入本决策的第一阶段。
出现独立真实样本后再按对应 Feature 扩展,不回填进 Environment contribution。

## 遗留风险

- 预制 case 需要携带构建时写入的 Environment source provenance,规划期才能与当前 source 的内容身份核对。不能从当前 source 动态计算声明值给既有产物背书;在产物元数据与 per-eval fingerprint 拥有同源输入前,不公开 `fulfills` 之类的声明字段。
- 每题 Environment 的 build context 必须排除 solution 与本地测试，并检查 Compose bind mount 泄漏。
- 某些工具同时需要安装与跨 Attempt 状态。PLAN-8 保留现有 setup/teardown 写法;若以后引入独立 state lifecycle,应由对应 Feature 单独迁移。
