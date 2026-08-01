# PLAN-9 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md)

## Owner

| Owner | 声明 | 运行职责 |
|---|---|---|
| Eval | 可选 template、setup / teardown、test | 题目起点或题目准备、Agent 交互与判分 |
| Experiment | Provider、fallback/profile Case、setup / teardown | Provider 选择、实验起点或实验准备 |
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
  -> reset 或建立干净 workdir
  -> Eval recipe setup
  -> Experiment recipe setup
  -> 建立 workspace baseline
  -> AgentProvisioner ensure
  -> 独立 state load
  -> Agent runtime setup
  -> test(t):upload / send / command / assertion
  -> Agent teardown 与 state save
  -> Experiment recipe teardown
  -> Eval recipe teardown
  -> Case finalizer，或保留复用窗口
```

Terminal-Bench 走这条路径。
Experiment fallback 完全不参与起点选择，但 Experiment setup 仍在 Eval setup 之后叠加。

## Experiment template 路径

```text
发现 Eval recipe、Experiment Provider recipe 与 Agent
  -> Eval recipe 没有 template
  -> Experiment 显式或 Provider 内建 fallback 激活
  -> build / start / ready 完整 Sandbox Case
  -> reset 或建立干净 workdir
  -> Experiment recipe setup
  -> Eval recipe setup
  -> 建立 workspace baseline
  -> AgentProvisioner ensure
  -> 独立 state load
  -> Agent runtime setup
  -> test(t):upload / send / command / assertion
  -> Agent teardown 与 state save
  -> Eval recipe teardown
  -> Experiment recipe teardown
  -> Case finalizer，或保留复用窗口
```

MemoryBench 走这条路径。
Eval 没有 template 不表示没有 recipe；checkout、依赖与 Fixture 仍可由 Eval setup 声明。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| template 选择、Provider 规划与 BuildKey | Run 规划期 | Run 规划期 |
| Case create / ready | 每 Attempt | 每复用窗口 |
| workdir baseline / reset | 每 Attempt 建立 | 首条建立，后续每 Attempt reset |
| Eval 与 Experiment recipe setup | 每 Attempt按 ownerOrder | 每 Attempt reset 后按同一 ownerOrder |
| Agent Ensure、state、Agent runtime 与 test | 每 Attempt | 每 Attempt |
| recipe teardown | 每 Attempt逆序 | 每 Attempt逆序 |
| Case finalizer / stop | 每 Attempt | 每复用窗口 |

复用窗口只能容纳相同 CaseKey、ownerOrder 与相容 recipe identities 的 Attempt。
reset 或任一 teardown 无法恢复已知边界时立即退休窗口。

## Setup 与 baseline

两条 recipe setup 都在 workspace baseline 前完成。
它们写入 workdir 的内容属于 Eval 或 Experiment 准备事实，不进入 Agent diff；Runner 仍按 owner activity 分开归因。

Agent Ensure、state 与 Agent runtime setup 在 baseline 后执行，但 Agent 安装物不得写入任务 workdir。
`test(t)` 中只有 send 窗口内的变化归因给 Agent，窗口外普通上传和跑测属于 Eval。

## 依赖方向

template owner setup 是 stack 的第一层，只能依赖 template 已兑现的能力。
第二个 owner 可以依赖第一层，Agent 可以依赖前两层。

如果需要反向依赖，作者不能通过把 setup 写成重试循环掩盖。
应把前置条件放入 template、选用 profile 完整 Case，或明确报告该组合不支持。

## Command 与预装

每 Attempt 重跑 command 不表示每次重装。
command 自己在 shell 里检查实际版本，命中直接返回；缺失时安装再复检，安装后仍不匹配则 Attempt `errored`。Runner 只看到命令、退出码与证据，不理解其中的 Requirement。

多个 command 按声明顺序执行。
本方案没有自动依赖图、资源锁或跨 owner 并行。

## State

外部 state load 在两条 recipe setup 与 Agent CLI Ensure 后运行，Agent runtime setup 随后收敛。
Agent teardown 完成后执行 state save，再进入 recipe teardown。
它有独立 identity、activity、临界区与失败语义，不随 template owner 改变顺序。

跨 Attempt 活状态由 `sandboxReuse` 与 State Feature 共同约束。
普通 recipe teardown 不应销毁声明要跨 Attempt 保留的状态；Case finalizer 在窗口结束时负责资源组清理。

## Cases

| Case | PLAN-9 路径 |
|---|---|
| C1 | Eval compose/dockerfile recipe 激活，Provider 内建规划 |
| C2 | Experiment fallback 激活，Experiment setup 先执行 |
| C3 | Eval template 激活，Eval、Experiment、Agent 形成一条 stack |
| C4 | 同 owner command 按阅读顺序串行 |
| C5 | 预装只让 command 内的 shell 检查提前返回，不删除 owner setup |
| C6-C7 | State 独立于 recipe stack；复用后每 Attempt 重建相同 ownerOrder |
| C8 | Experiment template 先，Eval checkout setup 后 |
| C9 | profile 完整 Case 替换物理 template，templateOwner 仍为 Eval |
| C10 | 每条 Eval 独立解析 active template 与 ownerOrder |
| C11 | `test(t)` 使用普通上传与 send 顺序，生成 transfer manifest |
