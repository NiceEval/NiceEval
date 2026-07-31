# Agent 安装配方 —— 现状约束

**相关文档**:[README](README.md) · [GOALS](GOALS.md) ·
[PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) ·
[PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md)

---

## 目的

记录候选方案共同面对的现状:E2B 构建 API 能做什么、
niceeval 契约层长什么样、外部参照(Harbor)怎么组合、
需求方(TB 任务镜像)长什么样。只写现状,不下结论。

---

# E2B TemplateBuilder(候选方案的共同地基)

## 产品特性

E2B 的模板构建 API。`Template()` 起一个 builder,链
`.fromTemplate()` / `.fromImage()` 选起点 OCI image 或 E2B template,再链
`.aptInstall()` / `.runCmd()` / `.copy()` 叠步骤。
`Template.build()` 出可发布模板。

## 当前支持

- `.fromTemplate(alias)` 从已发布模板起步,
  `.fromImage(ref)` 从任意 OCI 镜像起步——两种起点在
  API 上等价,后续链完全相同。
- 构建步骤可指定运行用户(`{ user: "root" }`)。
- 构建链里的 `.runCmd()` 失败即整次构建失败,模板不写入
  registry——构建内自检可以当发布门槛用。

## 当前不支持

- `fromImage` 起点 OCI image 或 E2B template的运行用户、UID 与预装内容由镜像自带,
  E2B 不做规范化;官方 agent 模板里成立的路径与权限假设
  在任意镜像上不保证成立。

## 直接影响

起点 OCI image 或 E2B template 可换在 E2B API 层没有障碍,各 PLAN 的差异全在
niceeval 这一侧:配方以什么形态暴露、契约假设由谁校验。

---

# niceeval E2B 契约层

## 产品特性

`niceeval/sandbox/e2b-template` 的分层。
`withNodeToolContract` 把起点 OCI image 或 E2B template的 Node 工具安装面规范化成
统一契约:运行用户的 `npm prefix -g` 是 `/usr/local`、
`/usr/local/bin` 在 PATH、prefix 目录对运行用户可写。
`verifyE2BNodeToolContract` 把这三条断言链进构建当发布
门槛。`e2bCodingAgentTemplate(agent)` 组合起点 OCI image 或 E2B template、契约与
agent CLI 安装出成品。

## 当前支持

- `verifyE2BNodeToolContract` 与 `E2B_NODE_TOOL_PREFIX`
  是公开导出,任何 TemplateBuilder 都能接上校验。
- 契约层与校验层都是
  `TemplateBuilder => TemplateBuilder` 形态,天然可叠加。
- 版本常量单源:模板配方与 adapter 运行时回退安装读同一批
  agent 版本常量
  (见[版本号跟着被装的 Agent 走](../../feature/sandbox/library/prebuilt-environments.md#版本号跟着被装的-agent-走))。

## 当前不支持

- 起点 OCI image 或 E2B template在工厂内部写死为
  `Template().fromTemplate(官方 agent 基线)`,「装 agent
  CLI」这一步没有独立导出,不能叠到别的起点 OCI image 或 E2B template上。
- `withNodeToolContract` 只处理 E2B 官方 `claude` / `codex`
  起点的两套 Node 路径差异;它假设起点 OCI image 或 E2B template已有 Node、包管理器
  是 apt,任意镜像上这两条假设都可能不成立。
- 安装**命令**不单源:版本常量共享,但构建期配方与 adapter
  回退安装的安装命令各写一份,改命令要改两处。

## 直接影响

- PLAN-1 / PLAN-2 都要让契约层长出「任意 OCI image 或 E2B template」能力——处理
  无 Node 的起点 OCI image 或 E2B template、声明支持的包管理器范围。这是构建期三案
  (PLAN-1/2/3)共同的 Case B 成本;PLAN-4 把这份成本挪进
  provisioner 的安装分支,构建期不预付。
- PLAN-3 的配方单源是对「命令不单源」这条的直接回应;
  PLAN-4 对同一条的回应是只单源身份与检查、不单源命令。

---

# Harbor BaseInstalledAgent(外部参照)

## 产品特性

TB 2.0 官方 harness([Harbor](https://github.com/laude-institute/harbor))
的组合模型与 niceeval 相反:任务持有环境(每道题自带
Dockerfile / compose),agent 是一份运行时安装配方,在容器
启动后经 `environment.exec()` 装进去。

## 当前支持

- **幂等短路**:安装前先跑 `--version`,版本匹配即跳过——
  预烘焙镜像自动成为快速路径,同一份配方通吃两种执行时机。
- **包管理器探测**:`ensure_system_dependencies` 用
  `command -v` 探测缺失命令,按 apt-get / dnf / yum / apk
  分发安装,跨发行版包名映射表内置。
- **不假设系统路径可写**:Node 缺失时经 nvm 装进用户
  home,agent CLI 装在用户级,绕开对起点 OCI image 或 E2B template `/usr/local`
  权限的假设。

## 当前不支持

- 探测与安装的成本每个 attempt 都付一遍;没有产物级的
  锁定版本可比性,同一配置在不同时刻可能装到不同环境。
- 存在静默降级点:找不到受支持的包管理器时只记 warning
  继续跑,失败推迟到 agent 启动,归因困难。

## 直接影响

- 证明了「配方脱离特定起点 OCI image 或 E2B template存在」可行,PLAN-3 的配方形态
  (幂等 + 探测 + 双执行时机)与 PLAN-4 的「检查在前」
  都以它为原型。
- 它的 latest 安装与静默降级正是 GOALS 设计原则要避开的
  两条,借形态不借默认值。

---

# TB 任务镜像(需求方)

## 产品特性

TB 任务的基础镜像(如
`ghcr.io/laude-institute/t-bench/ubuntu-24-04`)由基准
维护方发布,任务依赖烘在镜像层里。

## 当前支持

- Ubuntu 24.04 底,apt 系,glibc;八道卡住的题需要的
  `Rscript` / `cv2` / `mpirun` / `sqlite3` / `libGL`
  全部在镜像层内。

## 当前不支持

- 镜像不带 Node,也不带任何 agent CLI;任务侧 Dockerfile
  的 `RUN` 行不含这些依赖的安装命令——镜像内容本身就是
  安装面,文本扫描推导不出环境需求。

## 直接影响

- Case B 的第一批真实起点 OCI image 或 E2B template全是 apt 系,支持面从 apt 起步
  即可覆盖;musl(如 Alpine)与 rpm 系是否进支持面是
  独立取舍,见各 PLAN 与 [DECISION](DECISION.md)。

---

# 共通限制

- **Docker 侧没有中间件挂点**:Dockerfile 是文本,不是
  builder 链;配方要惠及 Docker 用户只能以可引用的 shell
  片段形式存在,由 `RUN` 引用。
- **Vercel 无可发布产物原语**:配方在 Vercel 上只有运行时
  一种执行时机
  (见[Run 构建流程](../../feature/sandbox/library/prebuilt-environments.md#vercel-sandbox从运行实例拍-run))。
