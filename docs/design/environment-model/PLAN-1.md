**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) · [DECISION](DECISION.md)

---

## 实现方案 1(Environment 与 Provision 二分,不推荐)

### 简述

按变化来源把声明拆成两类协议。
Eval 用 `composeEnvironment(...)` 声明题目 Environment;Experiment 用 `defineProvision(...)` 定义安装项,以有序 `provisions` 数组声明。
Provision 协议含 identity、inspect、install 与可选的宿主侧 prepare:框架比较 inspect 返回的实际 identity 与目标 identity,不相等才 install,随后复检。
Fixture、Sandbox 状态 Hook 与 adapter 的 Agent CLI 安装各自独立于这两类。

### 优势

- 身份与检查是协议约束:inspect 必须返回实际 identity,不能只返回 boolean,漂移在复检时暴露。
- 两条变化轴正交进 fingerprint,「每题环境 × 每实验工具」不需要维护组合 template。
- 满足需求 1:Docker Provider 内建 Compose 支持,Eval 只写环境文件与 `workspaceService`。

### 缺点

- 安装内容按来源分成六个去处:Provision、状态 Hook、Fixture、Experiment setup、adapter 安装后扩展点、预制 template。每写一段准备代码都要先分类一次,分类依据(每 Run / 每 Sandbox / 每 Attempt 的频次、workdir 内外)是运行器知识。
- `defineProvision` 没有低成本档位:最小可用的 Provision 也要自建 manifest 格式、手写 manifest 读写与 inspect、人工递增 recipeRevision。框架比较 identity,但读写 manifest 的样板每个作者重复实现一遍。
- `provisions` 是有序数组,附带全组复检与「候选破坏者」诊断;安装顺序成为用户要维护的状态,违反需求 4。
- Agent CLI 安装走 adapter 内部协议,与 Provision 平行存在两套安装机制,违反需求 3。
- template 入口有三处:Experiment 的 sandbox 配置、`environments` 覆盖表、Eval 的 Environment;唯一性靠多节文档解释,需求 5 只部分满足。

### 对照需求

| GOALS 需求 | 结果 |
| --- | --- |
| 1 重环境 Eval 免注册 | 满足 |
| 2 一个安装单元、样板归框架 | 不满足 |
| 3 安装内容同一概念 | 不满足 |
| 4 免顺序、默认并行 | 不满足 |
| 5 template 来源唯一 | 部分满足 |

完整候选契约(库 API、架构、六篇用例)见 git 历史中的 `docs/roadmap/environment-model/`。
