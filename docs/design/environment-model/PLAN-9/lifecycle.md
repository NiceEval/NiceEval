# PLAN-9 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md)

## Owner

| Owner | 声明 | 运行职责 |
|---|---|---|
| Eval | 可选 template、setup / teardown、beforeEach / afterEach、test | 题目起点、窗口条件、逐 Attempt 准备、Agent 交互与判分 |
| Experiment | Provider、fallback/profile Case、setup / teardown、beforeEach / afterEach | Provider 选择、实验起点、窗口条件或逐 Attempt 准备 |
| Agent | AgentProvisioner、setup、send、teardown | Agent CLI Ensure、鉴权、配置与 turn |
| Provider Case | planner、build、start、ready、finalizer | 创建、观测并清理完整资源组 |

Eval 与 Experiment 都贡献 SandboxRecipe。
Provider Case 与运行中的 Sandbox 是解析结果，不是第四份作者 recipe。

## Eval template 路径

```text
发现 Eval recipe、Experiment Provider recipe 与 Agent
  -> Eval recipe template 激活
  -> templates[profile] 覆盖，或 Provider 内建 planner
  -> 协调 BuildKey
  -> build / start / ready 完整 Sandbox Case
  -> Eval recipe setup
  -> Experiment recipe setup
  -> 建立 reset anchor
  -> 每条 Attempt：
       reset 到 anchor
       -> Eval recipe beforeEach
       -> Experiment recipe beforeEach
       -> 建立 Agent diff 的 workspace baseline
       -> AgentProvisioner ensure
       -> 独立 state load
       -> Agent runtime setup
       -> test(t):upload / send / command / assertion
       -> Agent teardown 与 state save
       -> Experiment recipe afterEach
       -> Eval recipe afterEach
  -> 窗口结束：Experiment recipe teardown
  -> Eval recipe teardown
  -> Case finalizer
```

Terminal-Bench 走这条路径。
Experiment fallback 完全不参与起点选择，但 Experiment 的两个 scope 仍分别在 Eval 对应 scope 之后叠加。

## Experiment template 路径

```text
发现 Eval recipe、Experiment Provider recipe 与 Agent
  -> Eval recipe 没有 template
  -> Experiment 显式或 Provider 内建 fallback 激活
  -> build / start / ready 完整 Sandbox Case
  -> Experiment recipe setup
  -> Eval recipe setup
  -> 建立 reset anchor
  -> 每条 Attempt：
       reset 到 anchor
       -> Experiment recipe beforeEach
       -> Eval recipe beforeEach
       -> 建立 Agent diff 的 workspace baseline
       -> AgentProvisioner ensure
       -> 独立 state load
       -> Agent runtime setup
       -> test(t):upload / send / command / assertion
       -> Agent teardown 与 state save
       -> Eval recipe afterEach
       -> Experiment recipe afterEach
  -> 窗口结束：Eval recipe teardown
  -> Experiment recipe teardown
  -> Case finalizer
```

MemoryBench 走这条路径。
Eval 没有 template 不表示没有 recipe；checkout、依赖与 Fixture 仍可由 Eval beforeEach 声明。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| template 选择、Provider 规划与 BuildKey | Run 规划期 | Run 规划期 |
| Case create / ready | 每 Attempt | 每复用窗口 |
| Eval 与 Experiment setup / teardown | 每 Attempt 所属唯一窗口各一次 | 每复用窗口按 ownerOrder / 逆序各一次 |
| reset anchor | 两方 setup 后建立 | 每窗口在两方 setup 后建立一次 |
| reset | 唯一 Attempt 进入前 | 每 Attempt 进入前恢复到 anchor |
| beforeEach / afterEach | 每 Attempt按 ownerOrder / 逆序 | 每 Attempt按 ownerOrder / 逆序 |
| Agent diff workspace baseline | beforeEach 后每 Attempt 建立 | beforeEach 后每 Attempt 建立 |
| Agent Ensure、state、Agent runtime 与 test | 每 Attempt | 每 Attempt |
| Case finalizer / stop | 每 Attempt | 每复用窗口 |

复用 pool key 固定为 `(CaseKey, templateOwner, ownerOrder, caseScopeRecipeIdentity)`。
因此不同 setup/teardown 不会共享窗口；beforeEach/afterEach 可以按当前 Eval 变化，并进入各自 Attempt fingerprint，而不进入 pool key。
reset、afterEach 或窗口边界无法恢复已知状态时立即退休窗口。

## 两个 baseline

reset anchor 在两条 recipe setup 后建立，包含 active template 与两方窗口 setup 的变化。复用中的每条 Attempt 都先回到这个 anchor。

Agent diff 的 workspace baseline 在本条 Attempt 的两方 beforeEach 后建立，包含 reset anchor 与本次题目准备。setup 和 beforeEach 写入 workdir 的内容都不进入 Agent diff；Runner 仍按 owner、scope 与 activity 分开归因。

Agent Ensure、state 与 Agent runtime setup 在 baseline 后执行，但 Agent 安装物不得写入任务 workdir。
`test(t)` 中只有 send 窗口内的变化归因给 Agent，窗口外普通上传和跑测属于 Eval。

## 依赖方向

依赖方向分别在两个 scope 内计算。
template owner setup 是 Window scope 第一层，只能依赖 template 已兑现的能力；第二个 owner setup 可以依赖第一层。
进入 Attempt scope 时两方 setup 都已完成。template owner beforeEach 只能依赖窗口条件，第二个 owner beforeEach 可以再依赖第一层 beforeEach；Agent 可以依赖两方本次准备。

如果需要反向依赖，作者不能通过把 setup 写成重试循环掩盖。
应把前置条件放入 template、选用 profile 完整 Case，或明确报告该组合不支持。

## Command 与预装

四个 lifecycle 方法都接受同一种 SandboxCommand；方法名显式决定它每窗口还是每 Attempt 执行。
窗口 setup 中的昂贵安装仍应检查实际版本，命中直接返回；需要每条 Attempt 重建的 checkout 或 Fixture 放在 beforeEach。Runner 只看到 scope、命令、退出码与证据，不理解其中的 Requirement。

多个 command 按声明顺序执行。
本方案没有自动依赖图、资源锁或跨 owner 并行。

## State

外部 state load 在本条 Attempt 的 beforeEach 与 Agent CLI Ensure 后运行，Agent runtime setup 随后收敛。
Agent teardown 完成后执行 state save，再进入 afterEach；窗口结束时才进入 teardown。
它有独立 identity、activity、临界区与失败语义，不随 template owner 改变顺序。

跨 Attempt 活状态由 `sandboxReuse` 与 State Feature 共同约束。
afterEach 不应销毁声明要跨 Attempt 保留的外部状态；teardown 与 Case finalizer 在窗口结束时负责整窗和资源组清理。

## Cases

| Case | PLAN-9 路径 |
|---|---|
| C1 | Eval compose/dockerfile recipe 激活，Provider 内建规划 |
| C2 | Experiment fallback 激活；Experiment 窗口 setup 每窗口一次 |
| C3 | Eval template 激活；两种 scope 都按 Eval、Experiment ownerOrder 形成 stack |
| C4 | 同 owner、同 lifecycle 方法中的 command 按阅读顺序串行 |
| C5 | 预装不删除窗口 setup；逐 Attempt 验证显式放进 beforeEach |
| C6-C7 | State 独立于 recipe stack；复用后每 Attempt 重跑 beforeEach，不重跑 setup |
| C8 | Experiment template 与 mempal setup 先形成 anchor，Eval checkout beforeEach 每 Attempt 运行 |
| C9 | profile 完整 Case 替换物理 template，templateOwner 仍为 Eval |
| C10 | 每条 Eval 独立解析 active template 与 ownerOrder |
| C11 | `test(t)` 使用普通上传与 send 顺序，生成 transfer manifest |
