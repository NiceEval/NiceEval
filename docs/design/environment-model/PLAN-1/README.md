# PLAN-1:Environment 与 Provision 二分(不推荐)

**本方案**:[Library](library.md) · [Architecture](architecture.md) · [Use Case](use-case/README.md)

**决策主题**:[README](../README.md) · [GOALS](../GOALS.md) · [CASES](../CASES.md) · [LIMITS](../LIMITS.md) ·
[PLAN-2](../PLAN-2/README.md) · [PLAN-3](../PLAN-3/README.md) · [PLAN-4](../PLAN-4/README.md) ·
[PLAN-5](../PLAN-5/README.md) · [DECISION](../DECISION.md)

## 方案定位

按变化来源把声明拆成两类协议。
Eval 用 `composeEnvironment(...)` 声明题目 Environment;Experiment 用 `defineProvision(...)` 定义安装项,以有序 `provisions` 数组声明。
Provision 协议含 identity、inspect、install 与可选的宿主侧 prepare:框架比较 inspect 返回的实际 identity 与目标 identity,不相等才 install,随后复检。
Fixture、Sandbox 状态 Hook 与 adapter 的 Agent CLI 安装各自独立于这两类。

这个划分让 Eval 作者只回答题目需要什么环境,让 Experiment 作者只回答本次实验额外加入什么条件。
Provider 分派、构建协调、资源组启动和有序检查留在 Runner 内部,不进入普通调用点。

## 三种项目形态

| 项目形态 | 变化落在哪一侧 | 用户声明 |
|---|---|---|
| 评估环境较重 | 每道 Eval 有自己的 Dockerfile、Compose、系统包或服务 | `eval.environment` |
| 实验环境较重 | 所有 Eval 共用基础环境,工具、运行时或模型 cache 随 Experiment 变化 | `experiment.provisions` |
| 两边都较重 | 每道 Eval 的环境与每个 Experiment 的工具独立变化 | 同时声明两者,由 Runner 组合 |

第三种形态不维护「Eval 环境 × Experiment 变体」的派生产物。
Runner 先创建 Eval Environment,再在主 Sandbox 中 Ensure 每个 Provision。

## 四个公开概念

| 概念 | 回答什么 | 归谁声明 |
|---|---|---|
| Environment | 这道 Eval 需要怎样的题目环境 | Eval 的 `environment` |
| Sandbox | Agent 与测试实际执行命令、读写文件的隔离运行空间 | Experiment 或 Config 的 `sandbox` |
| Provision | 这个 Experiment 要在 Sandbox 中额外确保什么内容存在 | Experiment 的 `provisions` |
| Fixture | 这道 Eval 开始时要写入 workdir 的任务文件与判分材料 | `EvalDef.setup` / `test(t)` |

Environment 不选择 Provider。
Experiment 选择 Sandbox Provider,但不复制每道 Eval 的环境定义。
Provision 只表达可检查的安装状态;跨 Attempt 运行状态继续由 Sandbox Hook 管理。

完整公开形状见 [Library](library.md),解析、身份、生命周期与记录见 [Architecture](architecture.md)。
[用例手册](use-case/README.md)使用本方案逐项回答决策主题的十个 [Case](../CASES.md)。

## 性能与状态语义分开

| 成本 | 机制 |
|---|---|
| Dockerfile 或 Compose 构建慢 | Provider 按 BuildKey 复用构建产物 |
| Provision payload 下载慢 | `prepare` 按 Provision identity 与目标平台 single-flight |
| 稳定工具安装慢 | 预装进 image、template 或 snapshot,Provision 保留检查 |
| Provider 能克隆准备好的全新环境 | Provider 内部透明缓存,每条 Attempt 仍取得隔离实例 |
| 实验本来就要观察跨 Attempt 状态 | 显式 `sandboxReuse: true` |

`sandboxReuse` 不作为安装太慢的默认答案。
它允许 `$HOME`、`/tmp`、全局安装和后台进程跨 Attempt 存续,因此只在实验接受或研究这种状态边界时使用。

## 优势

- 身份与检查是协议约束:inspect 必须返回实际 identity,不能只返回 boolean,漂移在复检时暴露。
- 两条变化轴正交进 fingerprint,「每题环境 × 每实验工具」不需要维护组合 template。
- 重环境 Eval 免注册:Docker Provider 内建 Compose 支持,Eval 只写环境文件与 `workspaceService`。

## 缺点

- 安装内容按来源分成六个去处:Provision、状态 Hook、Fixture、Experiment setup、adapter 安装后扩展点、预制 template。
  每写一段准备代码都要先分类一次,分类依据是每 Run、每 Sandbox、每 Attempt 的频次以及是否写入 workdir。
- `defineProvision` 没有低成本档位。
  最小 Provision 也要自建 manifest、手写读写与 inspect,并人工递增 recipeRevision。
- `provisions` 是有序数组,附带全组复检与候选破坏者诊断。
  安装顺序成为用户要维护的状态,违反需求 7 的免顺序目标。
- Agent CLI 安装走 adapter 内部协议,与 Provision 平行存在两套安装机制,检查与准备设施各自实现一遍。
- template 入口有三处:Experiment 的 sandbox 配置、`environments` 覆盖表、Eval 的 Environment。
  唯一基底靠多节文档解释,没有单点裁决。

## 对照需求

| GOALS 需求 | 结果 |
|---|---|
| 1 三份要求同时满足 | 满足——Environment、Provision 与 adapter 安装各有归属 |
| 2 双方可带 Base 或 Ensure | 不满足——Eval 固定为 Environment,Experiment 固定为 Provision |
| 3 双 Base 显式融合 | 不满足——template 入口有三处,冲突靠多节文档解释 |
| 4 按 profile 多融合 case | 部分满足——`environments` 覆盖表可按题换 template,没有兑现两份要求的语义 |
| 5 单 Base 下收敛或判不兼容 | 未表达——inspect 未命中只有 install 一条路 |
| 6 运行事实验证 | 满足——inspect 返回实际 identity,安装后复检 |
| 7 免顺序、自动并行 | 不满足——`provisions` 是有序数组 |
| 8 身份入 configHash / fingerprint | 部分满足——两条变化轴正交进入身份,三处 template 入口的归属仍不清 |
| 9 起点产物不制造双 Base 冲突 | 未表达——没有区分默认起点与实验条件基底 |
