# Agent 安装配方 —— 目标

**相关文档**:[README](README.md) · [LIMITS](LIMITS.md) ·
[PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) ·
[PLAN-4](PLAN-4.md) · [DECISION](DECISION.md)

---

## 目的

为「agent 进入环境的方式」选一个组合形态,让任务镜像为底
的基准移植(Case B)不必手抄 niceeval 内部契约就能表达,
同时官方基线动线(Case A)一字不改。

范围边界:本决策只管**安装配方与底座的组合关系**——配方
以什么形态存在、叠在什么底座上、由谁校验。多服务拓扑归
[Design · 多容器环境](../multi-container-environments/README.md);
agent 预装的指纹检测语义归各 agent 接入页,不参与本对比。

---

## 设计原则

- **预制产物仍是主路径**:评测可复现性、启动成本与结果
  可比性都要求 attempt 从锁定版本的产物起步。候选方案改的
  是产物**怎么组装**,不改「构建期烘焙优先于运行时安装」的
  分层(见[环境预置放哪](../../feature/sandbox/library.md#环境预置放哪))。
- **不发明跨 provider 构建 DSL**:
  [既有裁决](../../feature/sandbox/library/prebuilt-environments.md#为什么没有跨-provider-构建-dsl)
  继续成立。候选方案给的是 provider 原生构建工具里的可
  组合件,不是新的构建语言;与该裁决有张力时摊开说清。
- **宁可构建期报错,不产出静默坏模板**:配方对底座有假设
  (包管理器、运行用户、可写路径),假设不满足时要在构建
  期被点名拦下;不许构建成功、运行期以难归因的方式失败。
- **核心中立不破**:运行器、评分、报告不出现 agent 名或
  provider 名分支;配方住在 sandbox / adapter 侧
  (见[架构边界](../../architecture.md))。

---

## 需求

- **R1 底座可换**:agent 安装配方能叠加到任务给定的任意
  镜像上,下游零手抄 Node 工具契约;契约内容变化时下游
  自动跟随。
- **R2 Case A 不回归**:`e2bCodingAgentTemplate(agent)` 的
  签名、语义与产出不变;既有构建脚本不改一行。
- **R3 支持面显式**:配方声明它支持的底座范围;范围外的
  底座在构建期报错并点名缺什么,不静默降级。
- **R4 版本与命令同源**:构建期烘焙与 adapter 运行时回退
  安装装同一版 agent、走同一份安装命令;改版本或改命令
  只有一处要改。
- **R5 自定义口子**:未内置的 agent 可由用户提供同形态的
  配方,与内置配方消费同一套组合与校验机制。
- **R6 Docker 侧可引用**:配方的安装步骤能以 provider
  原生形式(shell 片段)被 Dockerfile 引用,Node 工具契约
  有唯一出处,不靠用户手抄。

---

## 不是本 doc 的目标

- **运行时安装作为主路径**——Harbor 的默认(每 attempt
  探测并安装,见 [LIMITS](LIMITS.md))与预制产物主路径
  冲突,不采纳;运行时安装只作为回退与无产物原语 provider
  的出路。
- **多服务拓扑**——归
  [Design · 多容器环境](../multi-container-environments/README.md)。
- **Vercel 的产物原语**——Vercel 没有可发布模板,维持
  [Run 构建流程](../../feature/sandbox/library/prebuilt-environments.md#vercel-sandbox从运行实例拍-run),
  不伪造。
- **agent 预装指纹检测**——契约在各 agent 接入页,本决策
  不改其语义。
