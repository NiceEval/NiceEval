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
[Design · 多容器环境](../multi-container-environments/README.md)。
「预装是否可用」的检测属于本决策的检查契约,各 agent
接入页的检测细节按结论对齐。

---

## 设计原则

- **锁定身份的可复现优先**:评测可比性要求 attempt 使用的
  Agent 身份(名字、精确版本、配方修订)在规划期锁定并进入
  指纹。构建期烘焙与运行时安装都必须落到同一个锁定身份;
  无锁定身份的探测式安装(装到什么算什么)不进任何路径。
  预制产物的价值是命中检查、省掉安装耗时,不是身份的来源。
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
- **R4 身份与检查同源**:构建期烘焙与运行时安装声明同一个
  Agent 身份、通过同一个检查后置条件;改版本只有一处要改。
  两条路径的安装命令可以各用 provider 原生工具,漂移由共享
  检查兜住。
- **R5 自定义口子**:未内置的 agent 可由用户提供同形态的
  配方,与内置配方消费同一套组合与校验机制。
- **R6 任意构建路径零手抄**:用户在 provider 原生构建工具
  (含 Dockerfile)里预装 Agent 时,不需要手抄 niceeval 的
  内部契约;预装缺失或不完整时由运行时把环境补齐到同一个
  检查后置条件,而不是静默坏掉。

---

## 不是本 doc 的目标

- **无锁定身份的探测式安装**——Harbor 默认形态里的两个
  半边不采纳:找不到包管理器只记 warning 继续跑(静默
  降级),以及不锁版本、装到什么算什么(身份不可比,见
  [LIMITS](LIMITS.md))。幂等短路与「检查在前」的形态
  本身不在排除之列。
- **多服务拓扑**——归
  [Design · 多容器环境](../multi-container-environments/README.md)。
- **Vercel 的产物原语**——Vercel 没有可发布模板,维持
  [Run 构建流程](../../feature/sandbox/library/prebuilt-environments.md#vercel-sandbox从运行实例拍-run),
  不伪造。
- **Adapter 的会话与配置语义**——检查通过之后 Agent 怎么
  对话、怎么读配置,归各 agent 接入页,本决策不碰。
