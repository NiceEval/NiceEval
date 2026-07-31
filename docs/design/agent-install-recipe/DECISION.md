# Agent 安装配方 —— 结论

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) ·
[PLAN-3](PLAN-3.md) · [PLAN-4](PLAN-4.md)

---

## 结论

定稿契约的完整正文在 Feature,本篇只保留选型理由:
[Adapters · Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) ·
[Record · 两层时间模型](../../feature/record/architecture.md#两层时间模型生命周期锚点与开放-activity)。

采纳 **PLAN-4(Ensure 协议)**:「检查→缺失时安装→复检」
是 Adapter 在 `agent.setup` 里执行的契约本体,Agent 身份
(名字、精确版本、配方修订)是纯数据、进指纹。官方
template、自建 template、任务镜像与空白环境走同一条协议,
差别只是第一次检查是否命中。

本结论推翻此前「采纳 PLAN-2(中间件拆分)」的裁决。推翻的
动因来自[多容器环境](../multi-container-environments/DECISION.md)
的逐题按需构建:数百道题各有自己的环境产物时,「把 agent
烘进产物」会强制发布「题目 × Agent」笛卡尔积的image 或 template 组合矩阵,
构建期组合无论以工厂还是中间件形态存在都解决不了这一点。
两个主题的 PLAN-4 互为前提,一起采纳。

## 依据

对照 [GOALS](GOALS.md) 逐条:

- **R1 起点 OCI image 或 E2B template 可换**:任务可以给定任意 OCI image 或 E2B template。
  Ensure 在运行时把
  Agent 补齐到锁定身份;下游不接触 niceeval 内部契约,契约
  内容变化时下游自动跟随——达成方式从「构建期叠中间件」
  换成「运行时补齐」,目标本身达成得更彻底。
- **R2 Case A 不回归**:官方 template 的构建脚本与产出
  不变;变化只有一处——attempt 里对它也执行检查,不按
  template 名受信短路。检查命中即零安装动作。
- **R3 支持面显式**:支持面声明在各 provisioner 的前置要求
  上(需要什么包管理器、可写目录、网络);缺项时点名报错,
  不猜一个近似命令继续跑。
- **R4 身份与检查同源**:两条路径共享同一 `identity` 与
  同一 `check`;安装命令允许各用原生工具,漂移由发布门与
  运行时复检兜住。
- **R5 自定义口子**:自定义 provisioner 同时拥有身份、检查
  与安装三面,内置与自定义消费同一套机制;比 PLAN-2 只有
  构建期半边完整。
- **R6 任意构建路径零手抄**:Dockerfile 用户按自己的习惯
  预装或干脆不装;装对了检查命中,装错或没装由 Ensure 补齐
  或点名报错。Node 工具契约从「所有起点 OCI image 或 E2B template必须满足的系统级
  契约」降为内置 Node Agent provisioner 自己的前置要求。

## 否决的候选项

- **PLAN-1(工厂加选项)**:维持否决,理由在本结论下更强
  ——构建期组合整体退为优化投影后,给工厂加起点选项连
  原先「台阶」的候选资格都没有了。
- **PLAN-2(中间件拆分)**:此前的采纳改判为**降级**。
  `withNodeToolContract` / `withCodingAgent` 可以作为 E2B
  构建优化 helper 存在,服务于「想把检查快速路径做进自建
  template」的项目;它是可选投影,其存在与否都不改变任意
  template 能否运行 Agent。原采纳理由里「任意 OCI image 或 E2B template能力是
  Case B 的真实成本」这一判断被推翻:成本挪到了 provisioner
  的安装分支,不需要在构建期预付。
- **PLAN-3(recipe 数据 + 三渲染器)**:从「保留待启用」
  改判为**否决**。它的幂等短路与 verify 自检形态被 Ensure
  协议吸收;步骤词汇表(`InstallStep[]` DSL)被明确拒绝。
  原三个启用条件全部失去指向:未内置 agent 由自定义
  provisioner 完整承接;构建期与运行时的漂移由共享检查
  兜住;Dockerfile 引用片段的动机随 R6 的新达成方式消失。
- **无锁定身份的探测式安装**:维持排除
  ([GOALS](GOALS.md) 非目标节)。Ensure 借 Harbor 的
  「检查在前」形态,不借它的 latest 安装与静默降级默认值。

## 遗留风险

- **冷启动安装成本**:未预装 Agent 且不复用沙箱时,每个
  attempt 都付一次安装(分钟级);高并发下还叠加 npm
  registry 限流面。缓解手段是既有工具:官方 / 自建预装
  产物命中检查、沙箱复用由多个 attempt 共用一次安装成本、provider 侧带 Agent identity
  的派生 cache。「什么时候烤进 template、什么时候 Ensure
  现场装」的选择指引落 docs-site 教程。
- **check 的深度取舍**:只比版本字符串会放过 PATH、运行
  用户或依赖损坏;检查太重又抬高每 attempt 固定成本。各
  内置 provisioner 的检查项逐个评审,以「Adapter 启动依赖
  什么就查什么」为界。
- **任意镜像的用户与权限差异**:起点 OCI image 或 E2B template默认用户、UID 与
  `/usr/local` 权限不受 niceeval 控制。内置 Node Agent
  provisioner 优先用运行用户拥有的安装目录,确需系统包才
  提权;检查必须以运行用户身份断言,不以 root 跑出假绿。
  验收保留一个非 root 默认用户镜像的回归。
- **构建期与运行时命令漂移**:不强制命令逐字符同源,漂移
  由「同一 identity + 同一 check」的发布门与运行时复检
  发现,但不能像命令 DSL 那样从结构上消灭重复。第二次因
  漂移出事故时重估这条取舍,材料记 memory。
- **离线与审计环境**:安装期需要网络或内部安装包源;离线
  场景必须预装并用 `verifyOnly`,或提供自定义 provisioner。
  框架不凭空解决网络,只保证失败点名、不静默降级。
