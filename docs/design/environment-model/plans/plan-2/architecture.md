# PLAN-2：Architecture

本篇是 PLAN-2 的 template 读取、Layer 执行、身份、生命周期和失败语义单一出处。
公开 API 见 [Library](library.md)。

## 数据模型

每条 Attempt 最终只有一个 `ResolvedTemplate`：

```typescript
interface ResolvedTemplate {
  provider: string;
  profile?: string;
  identity: JsonValue;
  source:
    | "provider-default"
    | "experiment-template"
    | "eval-environment"
    | "profile-template";
}
```

`ResolvedTemplate` 是单实例 Provider 起点的抽象。
它没有主 Sandbox、伴随 service、ready、能力句柄、证据和资源集合 finalizer 字段，因此不能完整承载 `Sandbox Case`。

安装单元统一归一为：

```typescript
interface ResolvedLayer {
  owner: "experiment" | "eval" | "agent";
  name: string;
  identity: LayerIdentity;
  inspect?: LayerSpec<LayerIdentity>["inspect"];
  install: LayerSpec<LayerIdentity>["install"];
}
```

`owner` 只供身份归属和诊断使用，不改变执行协议。

## template 读取

规划期按下表选择 template：

| Eval environment | Experiment 侧声明 | 结果 |
|---|---|---|
| 省略 | 普通 template | 使用 Experiment template |
| 声明 | 未声明普通 template | 使用 Eval environment 读取结果 |
| 声明 | `templates` 命中 profile | 使用 map 指定的预制 template |
| 声明 | 只声明普通 template | 启动期双 template 冲突 |
| 省略 | 两处都省略 | 使用 Provider 默认起点 |

`templates` 表项被解释为同 profile Eval environment 的预制替代。
Runner 不验证替代项分别兑现了 Eval 与 Experiment 的要求。

所有冲突和缺失 profile 在创建 Sandbox 前一次穷举报出。
当前 Provider 无法把 folder-local environment 归一成单 template 时，本方案没有完整 `Sandbox Case` 作为退路；该能力缺口必须显式暴露，不能退回普通默认 template。

## Layer 执行

创建 Sandbox 后，Runner 合并 Experiment、Eval 与 Agent 的 Layer。
重名是启动期配置错误；集合按 `name` 排序只用于稳定身份，不用于决定执行顺序。

每条 Attempt 的执行过程为：

```text
读取全部 Layer
  → 默认 manifest 检查，或调用自定义 inspect
  → 收集全部 miss
  → 所有 miss 并行 install
  → 默认路径写入受管 manifest
  → 进入 Sandbox 状态 Hook、Fixture 与 Agent 运行
```

本方案没有依赖边、资源锁和保守串行资源。
两个 Layer 即使同时修改 apt、npm global 或同一 PATH，也会并行。
作者只能把有依赖或共享写入面的内容合并成一个 Layer。

默认 manifest 命中后不读取实际文件系统。
自定义 `inspect` 可以读取实际 identity，但本方案没有规定安装后的全组真实复检屏障。
后安装项破坏先安装项时，Runner 因而可能把不满足声明的 Sandbox 交给 Agent。

## 生命周期与 Sandbox 复用

Layer 位于 Sandbox ready 之后、状态 Hook 与任务 Fixture 之前。
Agent CLI 被 Adapter 投影成内部 Layer，因此 Layer 池结束后，状态 Hook 可以使用已经安装的 Agent 命令。
Agent 的鉴权、配置和会话初始化仍留在 Adapter 的 Attempt 生命周期。

状态载入与回存不是 Layer：

```text
template 创建 Sandbox
  → Layer 池
  → Sandbox setup 状态 Hook
  → workdir baseline 与 Eval Fixture
  → Agent 运行
  → Sandbox teardown 状态 Hook
  → 销毁 Sandbox
```

省略 `sandboxReuse` 时，每条 Attempt 创建全新 Sandbox。
开启复用时，每条 Attempt 仍重新经过 Layer 检查；默认检查只读取受管 manifest，因此无法发现 Layer 安装内容被前一条 Attempt 改坏。

## 身份与登记

身份按声明出处分配：

```text
configHash
  += Experiment template identity
  += Experiment Layer 的排序后 { name, identity }
  += Agent Layer identity

逐 Eval fingerprint
  += Eval environment 或命中的 profile template identity
  += Eval Layer 的排序后 { name, identity }
```

Agent Layer 的 identity 可以进入 configHash，但统一协议没有 staged payload digest、读取平台和安装模式的位置。
template 的 provider locator 可以进入身份，却不能描述 Compose 的完整运行资源集合。

运行时至少登记 Layer owner、目标 identity、检查命中与安装失败诊断。
本候选没有穷尽定义实际 identity、逐项活动、复检结果和候选破坏者的落盘形状，因此不满足完整可解释性要求。

## 失败语义

| 失败点 | 结果 |
|---|---|
| template/profile 声明冲突或缺失 | 启动期配置错误，零 Sandbox 创建 |
| Provider 无法兑现 folder-local environment | 明确能力缺口，不能静默使用默认 template |
| 自定义 `inspect` 抛错 | Attempt `errored`，归 Sandbox 准备 |
| Layer `install` 失败 | Attempt `errored`；并行失败逐项保留 |
| manifest 与目标 identity 不同 | 执行 install |
| manifest 命中但实际状态已漂移 | 不报错；这是本方案的假命中缺口 |
| install 退出成功但实际状态未收敛 | 默认路径不报错；本方案没有强制真实复检 |

Layer 失败不记成 Agent 做题 `failed`。
并行池中一个 Layer 失败不抹掉其它同时失败项的诊断，但其余安装可能已经产生部分副作用。
