# Agent 安装配方

`e2bCodingAgentTemplate(agent)` 把三件事焊在一个工厂里:
用 E2B 官方 agent 基线做底、安装 agent CLI、把 Node 工具
安装面规范化成统一契约。这个形状为「agent 基线为底、项目
依赖上叠」的场景设计,基准移植的方向正好相反:起点 OCI image 或 E2B template由任务
给定(TB 的 `t-bench/ubuntu-24-04`),要往上叠的是 agent。
工厂交付的是成品,下游只能在成品后面追加构建步骤,换不了
起点 OCI image 或 E2B template。

这个决策主题回答:**Agent 安装配方与起点 OCI image 或 E2B template用什么形态组合。**
候选项的分歧值得摊开比较——在工厂上加 `fromImage` 选项、
把安装配方拆成可叠加的模板中间件、让配方成为跨执行时机的
步骤数据,还是把「检查→必要时安装」定为运行时本体并让
预构建退回优化投影。四条路的契约面大小、自定义能力与维护
成本差异都很大。

## 动机:换不了起点 OCI image 或 E2B template,就只能抄内部契约

真实的 TB 移植里有八道题,依赖(`Rscript`、`cv2`、
`mpirun`、`sqlite3`、`libGL`)烘在任务的基础镜像层,不在
任何 Dockerfile `RUN` 行里——`FROM t-bench/ubuntu-24-04`
这一行本身就是安装面,只是内容不可见。任何「从官方 agent
基线派生、往上叠 RUN 行」的动线都到不了这个环境。

在工厂形态下,下游唯一的出路是绕开工厂自己拼:从任务镜像
起,自己装 Node、装 agent CLI,再手抄一遍 niceeval 的
Node 工具契约(npm prefix 收敛、可写目录、user 级 npmrc)。
抄下来的契约不随上游演进,上游一改,下游静默坏掉,坏法是
「agent CLI 能启动、`npm install -g` 成片 EACCES」这类
难以归因的形态。

## 组合模型:起点 OCI image 或 E2B template × Agent 配方 × 项目依赖

把环境组装拆成三个正交轴,各场景就是三轴的不同归属:

| Case | 起点 OCI image 或 E2B template归谁 | Agent 怎么进环境 |
|---|---|---|
| A. Agent 基线为底 | niceeval [官方基线](../../feature/sandbox/library/prebuilt-environments.md#官方-coding-agent-起点) | 烘在基线里 |
| B. 任务镜像为底 | 基准测试给定(`fromImage`) | 构建期叠上去 |
| C. 用户自带预装 | 用户 | 已在镜像里,检查命中 |
| D. 运行时安装 | 任意 | attempt 里检查→安装 |
| E. 多服务拓扑 | 任务给定的一组服务 | 装进其中一个服务 |

本主题裁 Case B 与 D 的形态,并要求 Case A 不回归。
Case C 的「预装是否可用」检测随同一份检查契约走。Case E 是
同一个组合模型的另一根轴——起点 OCI image 或 E2B template从「一个镜像」扩成「一组
服务」——在
[Design · 多容器环境](../multi-container-environments/README.md)
单独对比,两个主题共用本节的三轴模型。

**相关文档**:
[GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) ·
[PLAN-1](PLAN-1.md) ·
[PLAN-2](PLAN-2.md) ·
[PLAN-3](PLAN-3.md) ·
[PLAN-4](PLAN-4.md) ·
[DECISION](DECISION.md)
