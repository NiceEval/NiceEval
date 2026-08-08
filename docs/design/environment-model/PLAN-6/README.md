# PLAN-6:唯一 Environment 起点,双方在既有 setup 层准备(被 PLAN-7 取代)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md)

**方案正文**:[Library](library.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md)

---

## 方案摘要

Environment 起点选择与 Sandbox 准备是两件事。
每条 Attempt 先由 SandboxSpec 选定唯一的 Sandbox 实例,再按现有层次执行准备:

1. SandboxSpec setup 准备随 Experiment 变化的沙箱条件。
2. EvalDef setup 准备只随当前 Eval 变化的仓库、依赖与 Fixture。
3. Agent 自己的 setup / AgentProvisioner 准备 Agent CLI。

PLAN-6 不公开 Environment Requirement、Eval Base、Experiment Base、融合 Base、依赖图或资源图。
需要检查、安装和复检的工具把逻辑封装在领域 setup 函数内。

## 两条真实路径

Terminal-Bench 的上游 task package 自带 Compose。
数据集 adapter 从原始 task 目录派生 Eval 与 Environment source;Experiment 选择 Docker materializer,其 sandbox setup 再向最终主 Sandbox 安装 mempal。

MemoryBench 的 Experiment 选择预装 mempal 的 E2B template。
Eval 没有 Environment source,其 EvalDef setup 在该 Sandbox 中 checkout 仓库并安装项目依赖。

两条路径的差异只在起点来自哪里。
双方的准备动作始终作用于已经选中的同一个 Sandbox,不需要把两份 Environment 贡献合并成第三份声明。

## 作者心智

普通作者只回答三个问题:

| 问题 | 写在哪里 |
|---|---|
| 这道题是否自带 Environment | `eval.environment`,或由 benchmark adapter 从 task package 派生 |
| 本实验要给 Sandbox 加什么 | `experiment.sandbox.setup(...)` |
| 这道题开跑前要准备什么 | `EvalDef.setup` |

Agent 怎么安装仍由 Adapter 负责。
作者不判断 Base 冲突,不维护 Environment × Experiment 融合表,也不为安装动作声明调度图。

## 唯一起点选择

```text
解析后的 Eval 有 Environment profile/source
  -> SandboxSpec environments[profile] 覆盖
  -> 否则由匹配的 materializer 物化 source

解析后的 Eval 没有 Environment
  -> SandboxSpec 默认 image / template / snapshot
  -> 没有默认值时使用 Provider 中性 case
```

SandboxSpec 默认 template 只服务没有 Environment 的 Eval。
它不会替换 Terminal-Bench task package 自带的 Compose。

Provider 不能按 source 构建并启动 Sandbox 实例时,`environments[profile]` 可以提供完整的预制实现。
这仍是 SandboxSpec 已有的 Provider 映射表,不是 Environment 模型新增的融合表。

## Setup 的约束

setup 是有 owner 的生命周期动作,不是第二种 Environment:

- SandboxSpec setup 对本 Experiment 的所有 Sandbox 生效。
- EvalDef setup 只对当前 Eval 的 Attempt 生效。
- 两者按固定层次串行,数组或链式调用顺序就是执行顺序。
- setup 失败沿既有 phase 归属,且不会进入 Agent turn。

预装优化由 setup 函数自己验证。
例如 `mempalSetup()` 先检查版本与模型 cache,缺失时安装或明确失败;执行安装后再复检。
template 名或 manifest 不能代替实际检查。

第一期不引入通用依赖 DAG 和资源调度器。
需要组合多个步骤时使用显式顺序;只有领域 setup 函数内部知道安全并行时,才由它自己并行。

## 相比 PLAN-11 删除的负担

PLAN-11 要求作者或实现同时理解这些概念:

- Requirement 与 Base Case 是“要求”和“兑现方式”。
- 默认 Base、条件 Base、Eval Base 与融合 case 的分档。
- Eval、Experiment 两套 Requirement 集合及 owner 命名域。
- `dependsOn`、`resources`、prepare single-flight 与多道屏障。
- Environment state、Agent runtime 与隐藏 verifier 的正交相位。

这些机制有些可能在内部工具中有价值,但不是解决两个真实迁移路径的最低公开面。
PLAN-6 把作者面收回现有 `environment`、SandboxSpec setup、EvalDef setup 与 Agent setup 四个位置。

## 不可现场组合的边界

Runner 不合并 image、template、snapshot 或 Compose。
若实验工具无法在某条 Eval 的 Sandbox 中安装,只有两种诚实结果:

1. SandboxSpec 在 `environments[profile]` 提供已经满足双方条件的完整 Provider-native case。
2. 该组合在计划期 `skipped`,或 setup 在 Agent 前明确失败。

必要的预制矩阵成本无法由抽象消除。
PLAN-6 只避免再建立一张语义重叠的 `cases` 表。

## 范围

本候选只裁决 Environment 起点选择与三个 setup 层的职责。
外部实验状态、Agent runtime、turn 后隐藏 verifier 与多容器 ready/cleanup 继续由各自 Feature 契约定义,不参与本主题选型。

## 落地路线

1. 保持 `eval.environment` 的 profile 与 folder-local source 形状。
2. 允许数据集 adapter 从原始 task package 派生普通 EvalDef 与 source。
3. 让 `environments` 与 `materializers` 成为 Environment 起点选择的唯一入口。
4. 保持 SandboxSpec setup、EvalDef setup 与 Agent setup 的固定顺序和错误归属。
5. 为常见重准备提供带 identity、真实检查与复检的领域 setup 函数。
6. 分别写入 Environment 声明、所选 Sandbox 实例与三层 setup activity。
