# PLAN-8 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

## 两个相位

环境模型分成启动前解析与启动后准备：

```text
Environment selection and planning
  -> one PlannedSandboxCase
  -> build / start / ready
  -> one RunningSandboxCase
       ├── primary Sandbox
       ├── optional capabilities
       └── resource-group finalizer

Post-start preparation
  -> Experiment sandbox setup
  -> workspace baseline
  -> Eval setup
  -> Agent setup
  -> test(t)
```

启动前相位可以决定镜像、template、snapshot、service 拓扑、网络、volume、ready 与主执行空间。
启动后相位只能通过主 Sandbox 的命令、文件与窄能力接口改变运行状态。

这条能力边界阻止 setup 假装合并两个起点。
setup 不能把已经启动的单实例变成 Compose Case，也不能把两个 image 或 template 烘成第三个产物。

## 数据模型

```typescript
type EnvironmentSource =
  | ComposeEnvironmentSource
  | DockerfileEnvironmentSource;

interface EnvironmentRequest {
  profile: string;
  source?: EnvironmentSource;
}

interface PlannedSandboxCase {
  profile: string;
  provider: string;
  caseKind: string;
  caseKey: string;
  buildKeys: readonly string[];
  declaration: ProviderNativeCaseDeclaration;
}

interface RunningSandboxCase {
  sandbox: Sandbox;
  capabilities: readonly SandboxCapability[];
  resources: SandboxResourceGroup;
  stop(): Promise<void>;
}
```

EnvironmentRequest 与 PlannedSandboxCase 是规划值；RunningSandboxCase 与 Sandbox 是运行时资源。
公开 `composeEnvironment()` 只构造 EnvironmentSource，不能返回或冒充后两者。

## 唯一起点解析

解析优先级为：

```text
Eval 声明 Environment
  -> environments[profile] 命中时使用完整预制 Case
  -> 否则交给当前 Provider 的内建 Environment kind 支持

Eval 没有 Environment
  -> 使用 SandboxConfig.defaultEnvironment
  -> 未显式配置时使用 Provider 文档化的内建 defaultEnvironment
```

`defaultEnvironment` 是 fallback，不是 Experiment 与 Eval 同时参与的第二个 Base。
Eval 声明 Environment 后，Runner 不读取普通 defaultEnvironment，也不尝试合并两者。

纯 profile 字符串未命中 `environments` 是配置错误。
folder-local Environment 合法但当前 Provider 不支持其 kind 时，该组合计划期 `skipped`；全部跳过时升级为启动期错误。

## Provider 支持与扩展

内置 Provider 把支持声明与实现放在同一模块：

```typescript
interface EnvironmentPlanner {
  readonly kinds: readonly string[];
  planEnvironment(
    request: EnvironmentRequest,
    context: EnvironmentPlanningContext,
  ): Promise<PlannedSandboxCase>;
}
```

Docker Provider 自带 Compose 与 Dockerfile planner。
Experiment 不注册 planner；否则每个调用点仍必须知道 Eval source kind，正交性只是从类型移动到装配代码。

自定义 Provider 可以在自己的定义中提供 planner。
Runner 只从选中的 Provider 读取它，不合并 config、Experiment 与 Eval 提供的多张 materializer 表。

## 三层不是同一种协议

三个 owner 共享“在主 Sandbox 上准备”的方向，但不共享一个最小公共类型：

| 层 | 变化轴与频次 | 保留的领域能力 |
|---|---|---|
| Experiment sandbox setup | 每 Sandbox 或复用窗口 | setup / teardown、Experiment identity、状态载入与回存 |
| Eval setup | 每 Attempt | Eval identity、Fixture、题目依赖与 eval phase 反馈 |
| Agent setup | 每 Attempt | 平台探测、staged payload、CLI Ensure、鉴权、配置与 Agent facts |

把它们统一成 `identity + install` 会丢失 Agent staged payload、setup teardown 配对与 Eval 归因。
PLAN-8 只统一执行方向和顺序，不统一协议。

普通 setup 可以直接执行命令。
需要预装命中的昂贵条件继续使用领域 helper 封装 identity、inspect、install 与 re-inspect；plain function 不声称可验证命中。

## 起点 owner 不会吞掉 setup owner

起点选择和 setup owner 是两个正交维度：

```text
Eval 有 Compose Environment
  + Experiment sandbox setup
  + Eval setup
  + Agent setup

Eval 无 Environment，Experiment 有 defaultEnvironment
  + Experiment sandbox setup
  + Eval setup
  + Agent setup
```

因此不是“一个 owner 变成 template，剩下两个 owner 才是 layer”。
同一个 Eval 可以既提供 Environment 又提供 Eval setup；同一个 Experiment 也可以既提供 defaultEnvironment 又提供 sandbox setup。

## 身份与记录

EnvironmentSource、命中的 profile Case、Provider planner revision、BuildKey 与完整 CaseKey 进入逐 Eval fingerprint。
Provider defaultEnvironment、Experiment setup helper identity 与 Agent identity 经 configHash 进入 fingerprint。

每条 Attempt 记录：

- 选中的 Environment 分支与 profile；
- 实际 Case kind、Provider、BuildKey、CaseKey 与原生产物 locator；
- 三层 setup activity、identity、actual facts、耗时与失败 phase；
- RunningSandboxCase 的主 Sandbox、能力、伴随资源与清理结果；
- PLAN-7 定义的本地 transfer manifest 与 Agent 可见 closure。

函数体不自动参与哈希。
没有显式 identity 的 plain setup 仍可执行，但结果记录必须标注该 setup 身份不可比较。

## 预制组合

某个 Experiment 条件无法在 Eval Environment 启动后现场安装时，`environments[profile]` 提供完整预制 Case。
Runner 不把 defaultEnvironment 与 Eval Environment 合并，也不把 setup 成功解释成已生成可复用起点。

预制 Case 启动后仍执行 Experiment、Eval 与 Agent 三层检查。
产物名或 manifest 不能证明二进制、PATH、权限、动态库或题目服务仍满足要求。

## 文件与泄漏

普通本地上传在实际读取字节时生成 transfer manifest。
Provider planner 与 materializer 记录 build context、image provenance 与 bind-mount closure。

判定封口前，Runner 对比 send 窗口外的本地 source 与 Agent 可见 closure。
命中时 Attempt `errored`，不接受判分；需要保密时仍依靠物理隔离或 filtered context。

## 错误语义

| 失败点 | 结果 |
|---|---|
| profile 缺失、defaultEnvironment 声明非法 | 启动期配置错误，零 Sandbox 创建 |
| Provider 不支持 Environment kind | 计划期 `skipped`；全 skipped 升级启动期错误 |
| build、start、ready 或资源组失效 | Attempt `errored`，归 Sandbox Case |
| Experiment sandbox setup | Attempt `errored`，归 `sandbox.setup` |
| Eval setup | Attempt `errored`，归 `eval.setup` |
| Agent Ensure 或 Agent setup | Attempt `errored`，归 `agent.setup` |
| 动态泄漏比对 | Attempt `errored`，不接受 verdict |

setup 失败不会倒推成 Environment 解析失败。
Environment 能启动也不证明三层准备已经满足。
