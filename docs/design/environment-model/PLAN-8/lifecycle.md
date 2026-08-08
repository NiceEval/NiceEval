# PLAN-8 —— Lifecycle

**相关文档**:[方案](README.md) · [Library](library.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md)

## Owner

| Owner | 声明 | 生命周期职责 |
|---|---|---|
| EvalDef | 可选 Environment、setup、test、teardown | 题目 Environment 请求、逐 Attempt 准备、Agent 交互与判分 |
| SandboxConfig | Provider、defaultEnvironment、profile Case、setup / teardown | 规划唯一 Case，启动 service、网络与 volume，准备 Experiment 条件 |
| Agent | AgentProvisioner、setup、send、teardown | Agent CLI Ensure、鉴权、配置与 turn |
| Sandbox 实例 | build、start、ready、finalizer | 创建、观测并销毁完整的隔离 Sandbox |

EnvironmentSource 没有运行时 Hook；它是规划输入，不是一个会执行命令的 owner。

## Fresh Attempt

```text
发现 EvalDef、Experiment、Agent 与源码闭包
  -> 选择 Eval Environment 或 defaultEnvironment
  -> environments[profile] 覆盖，或 Provider 内建规划
  -> 协调 BuildKey
  -> build / start / ready 完整 Sandbox Case
  -> 取得唯一主 Sandbox，并记录 Agent 可见 closure
  -> 按声明顺序执行 Experiment sandbox setup
  -> 建立 workspace baseline
  -> 执行 Eval setup
  -> AgentProvisioner ensure 与 Agent setup
  -> test(t) 按源码顺序执行 upload、send、command 与 assertion
  -> 折叠 send-window agent diff
  -> 重算 transfer manifest，并执行动态泄漏比对
  -> scoring finalize
  -> Eval / Agent / Experiment sandbox teardown
  -> Sandbox Case finalizer and stop
```

setup 层只能操作已经启动的主 Sandbox。
需要在 build、网络、service 或 ready 阶段成立的事实必须进入 Environment 或 Provider-native Case，不能延迟到普通 setup 假装等价。

## 起点分支

```text
Eval 有 Environment?
├─ 是
│  ├─ environments[profile] 命中 -> 使用完整预制 Case
│  └─ 未命中 -> 当前 Provider 规划 EnvironmentSource
└─ 否
   └─ 使用显式或内建 defaultEnvironment
```

分支收敛后，后续生命周期完全相同。
defaultEnvironment 不参与 Eval Environment 分支，三层 setup 也不会因命中预制 Case 而跳过。

## Build、Start、Prepare 与 Fixture

| 动作 | 输入与输出 | 允许改变什么 |
|---|---|---|
| build | Environment / native Case → provider 构建输出 | image、template、snapshot 或 Compose service image |
| start | provider 构建输出 → RunningSandboxCase | 实例、网络、volume、ready、能力与伴随资源 |
| setup | RunningSandboxCase 的主 Sandbox → 运行状态 | 主 Sandbox 内文件、命令、进程与窄能力状态 |
| Fixture / test | 当前 Attempt 的主 Sandbox → 题目输入与判分证据 | workdir、测试材料、send 顺序与断言 |

普通 setup 不产生新的 provider 构建输出，也不改变 CaseKey 来伪装起点变化。
setup identity 作为自己的配置或逐 Eval 身份持久化。

## Fresh 与 Reuse

| 节点 | Fresh Sandbox | `sandboxReuse: true` |
|---|---|---|
| Environment 规划与 BuildKey 协调 | Run 规划期 | Run 规划期 |
| Case create / ready | 每 Attempt | 每复用周期 |
| Experiment sandbox setup / teardown | 每 Attempt | 每复用周期 |
| workspace baseline / reset | 每 Attempt 建立 | 首条建立，后续每 Attempt reset |
| Eval setup、Agent setup 与 test | 每 Attempt | 每 Attempt |
| transfer manifest 与泄漏比对 | 每 Attempt | 每 Attempt |
| Case finalizer / stop | 每 Attempt | 每复用周期 |

复用周期只能包含相同 CaseKey 与相容 SandboxConfig 的 Attempt。
reset 无法恢复已知状态时立即退休该复用周期，不能让下一条 Attempt 继承未声明条件。

## Setup 顺序与复检

Experiment sandbox setup 按链式追加顺序执行；Eval 与 Agent 在各自 phase 内按声明顺序执行。
第一期没有跨 owner 自动并行，也没有让作者维护依赖图。

领域 setup 函数在需要预装命中时执行 check、必要时 install、再 check。
后一个 owner 可能破坏前一个 owner 的条件时，由拥有该条件的 setup 函数或专门最终门负责复检；plain setup 不自动获得状态证明。

## State

外部状态载入与回存继续使用成对 setup / teardown 或对应 State Feature。
状态不是 Environment，也不是 build 构建输出；复用周期身份、临界区与失败提交策略不并入 EnvironmentSource。

Agent runtime 同样保持独立。
Agent CLI 预装只优化 AgentProvisioner 的 ensure 命中，不让 Agent 成为 Environment owner。

## Cases

| Case | PLAN-8 路径 |
|---|---|
| C1 | Eval Environment 由 Docker Provider 内建规划，无 Experiment materializer 注册 |
| C2 | defaultEnvironment 后执行 Experiment sandbox setup |
| C3 | Eval Compose Case 启动后执行 Experiment、Eval 与 Agent 三层准备 |
| C4 | Experiment setup 链按阅读顺序串行 |
| C5 | 预装只优化领域 setup 函数的检查命中 |
| C6-C7 | State 与 Sandbox 复用保持独立 owner 和频次 |
| C8 | Experiment defaultEnvironment 为起点，Eval setup 准备题目 |
| C9 | `environments[profile]` 提供完整预制 Case，Runner 不合并两个起点 |
| C10 | 有 Environment 与无 Environment 的 Eval 走不同起点分支，之后共享同一生命周期 |
| C11 | `test(t)` 使用普通上传与 send 顺序，生成 transfer manifest |
