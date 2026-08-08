# PLAN-6 —— Architecture

**相关文档**:[方案](README.md) · [Library](library.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 数据模型

```text
Experiment Run
├── SandboxSpec
│   ├── Provider 与默认 case
│   ├── profile -> Provider-native case
│   ├── source kind -> materializer
│   └── Experiment sandbox setup chain
├── Agent
└── Eval matrix
    └── EvalDef
        ├── optional Environment profile/source
        ├── Eval setup
        └── test/verifier

Attempt
├── one resolved Sandbox Case
├── SandboxSpec setup activities
├── EvalDef setup activity
└── Agent setup activity
```

Environment 是起点选择输入。
setup 是 Sandbox 启动后的有序生命周期动作。
两者没有共同的 contribution 或 Base 接口。

## Environment 起点选择

规划器先计算稳定 profile,再调用当前 SandboxSpec:

```text
explicit profile
  > folder-local source default profile
  > Eval id

environments[profile]
  > materializer(source kind)
  > default case when no Eval Environment
  > Provider neutral case
```

数据集 adapter 可以生成 EvalDef 与 Environment source,但不选择 Provider。
source 合法而当前 SandboxSpec 无法消费时,只把受影响 Eval 标记为 `skipped`。

默认 case 不能静默替代 source。
否则 Terminal-Bench 会在普通 template 中运行,题目规定的系统包、服务、网络和主容器全部丢失。

## 固定 setup 层次

Sandbox ready 后按以下 owner 顺序运行:

```text
SandboxSpec setup
  -> workspace baseline / reset
  -> EvalDef setup
  -> Agent setup
```

SandboxSpec setup 随 Experiment 变化。
它适合安装 mempal、证书、实验 runtime 或预热 cache,并对从默认 template 与 Eval source 创建的 Sandbox 一视同仁。

EvalDef setup 随 Eval 变化。
它适合 checkout 指定 commit、安装项目依赖与创建 Agent 应看到的 Fixture。

Agent setup 仍由 Adapter 拥有。
它保留 Agent CLI 专有的 staged payload、安装模式、探测和运行事实。

三个 owner 不合并错误域。
同一物理命令失败时,phase 决定诊断属于 `sandbox.setup`、`eval.setup` 还是 `agent.setup`。

## 可验证的 setup 函数,不是通用 Requirement 图

setup 默认是显式有序动作。
当某项准备昂贵或可能已经预装时,领域 setup 函数可以实现:

```text
check actual facts
  -> matched: record and continue
  -> missing: prepare/install
  -> recheck actual facts
```

Runner 只为 branded setup 函数提供 deadline、staged payload、identity 与 activity 写入设施。
它不收集 Eval/Experiment Requirement 数组,也不跨 owner 建 DAG。

这样保留真实验证,但把版本检查、安装方式与事实解释留在 `mempalSetup()`、`nodeRepositoryFixture()` 等领域 setup 函数内。
普通作者只看到一个符合所在层次的 setup 调用。

## 预制组合

有些 Provider 不能按 Eval source 构建并启动 Sandbox 实例,或者实验工具无法在题目启动后安装。
SandboxSpec 可以在 `environments[profile]` 提供已经组合好的完整 case。

表项必须兑现原 Environment 的外部行为。
预制组合与 source 的内容身份核对仍是本决策的遗留风险;在预制组合的 provenance 有稳定公开形状前,不让配置用当前 source 动态计算出的声明值替旧组合背书。
启动后的 SandboxSpec setup 仍执行;可验证 setup 函数检查命中时不会重复安装。

Runner 不从默认 template 与 Eval source 合成表项。
组合好的完整 case 由作者或构建系统在运行前准备。

## 身份与写入

```text
Run configHash
  += SandboxSpec default case, environments and materializers
  += SandboxSpec setup helper identities
  += Agent identity

Per-Eval fingerprint
  += Eval Environment profile/source identity
  += selected BuildKey, locator and CaseKey
  += Eval setup helper identity or declared setup revision
```

plain function 的函数体不自动参与哈希。
无 identity 的 plain setup 不参与缓存命中:它每次执行,所在 Attempt 在报告中标注 setup 身份不可比。
需要缓存命中或跨 run 对比的自定义准备,通过 `defineSandboxSetup()` 或既有显式 revision 字段声明身份。

Attempt Record 保存所选 case、每层 setup 的 activity、可验证 setup 函数查得的 facts 与 Agent 安装事实。
这些事实解释本次执行,不成为以后跳过 check 的依据。

## 正交生命周期

外部 Experiment state 在 Agent CLI 就位后按独立 Feature 契约 load/save。
turn 后 hidden verifier 在 Agent 完成后 materialize 并 cleanup。

这些相位不改变 Environment 起点选择或 setup owner。
多容器的 ready、主 Sandbox、finalizer 与 stop 继续属于 Sandbox 实例。
