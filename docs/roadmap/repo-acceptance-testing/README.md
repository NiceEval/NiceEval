# Repo 验收：主干走消费方仓库，边界走单元矩阵

还没定为当前契约的候选设计，见 [Roadmap 约定](../README.md)。

## 定位

本方案是 [NiceEval 测试体系重构](../e2e-acceptance-testing/README.md)与 [E2E 验收 DSL](../e2e-acceptance-dsl/README.md)在**组织机制**上的替代候选。它继承前者的历史缺陷账本、验收题库、准入门槛与分层归属结论，替换承载这些结论的机器：Behavior 注册表、Evidence Recipe 与 World digest 链、Retirement Manifest、领域 matcher 词表。对原方案哪些机制被继承、被轻量化、被显式放弃，见「触发、预算与纪律」「保留的规则」「删除项与理由」三节；本候选对 DSL 是完整替代，对测试体系重构是部分替代加显式取舍。

组织单位从「注册表里的一条 Behavior 声明」改为「一个可运行的消费方仓库」：

- **加题就是加一个 repo，或在既有 repo 的 `experiments/` 下加一个实验。**每个 repo 是真实 NiceEval 用户项目，自带 `package.json`、lockfile、config、evals；候选包沿现有 tarball 注入与指纹核验进场。
- **断言同时覆盖过程与结果。**外层 verify 用 vitest 写普通代码，只读公开出口。两面按事实种类分，不按出口分：过程面是执行过程的公开事实——NDJSON 事件流、exit 与 signal、stdout 与 stderr 分流、`show` 的执行 / 时序 / 复用切片；结果面是 verdict、locator 往返、Report 领域值、导出物与外部资源终态。

现有 `e2e/`（adapter 各仓、cli、report 与 `scripts/` 注入链）已经是这个形态的雏形；本方案把它补完，不另起炉灶。

## 问题

原方案对现状的诊断成立（[四个闭包](../e2e-acceptance-testing/current-system-gaps.md)），但药方与病灶错配，有一个已复核的真实反例：声明 `sandboxReuse` 的实验因镜像 root 执行身份被复用账本静默退休，公开结果全绿、复用从未发生。这条缺陷同时穿过原方案三处：

- 九题验收域没有 Sandbox 复用：账本形态「身份声明与实际执行事实脱钩」本可容纳它，但十九种形态对应的题目没有一条把复用承接立为验收对象；
- 读面清单没有复用承接序号的领域查询，「复用真的发生了」无处落笔；
- 执行边界把真实 Docker 排除在常规题之外，而根因（镜像 `Config.User`）只有真实容器能暴露。

在 repo 形态下，这条缺陷的守护是三行实验配置加三条过程断言（见题库映射），不需要新缺陷形态、新读面词或机制题扩展。四个闭包也没有一个由「缺少领域词表」造成：验收脚本的病在「后置 verifier 改写共享结果根」与「线性 fail-fast 不能单例重跑」，产物只读加 vitest 即可解决其中的证据闭包与失败闭包；覆盖闭包与执行闭包的机器守护见「触发、预算与纪律」。

## 分层所有权：多层并列，不是单层通吃

repo 验收只拥有主干路径；edge case 按最早失败层分家。防重复靠一条继承原则：**一个等价类矩阵只能有一个 owner**，E2E 只取有区分力的代表验证接线，不复制矩阵。

| 层 | 拥有什么 | 例 |
|---|---|---|
| repo E2E（主干） | 每个验收域一条代表性全链路，过程与结果同断 | pipe 交付、消费方矩阵、复用承接、浏览器 target |
| 单元与结构守护（edge 矩阵） | 错误公式互异、截断策略穷举、平台组合、SDK 形状；原方案 [U1–U9](../e2e-acceptance-testing/bugs/acceptance-bank.md#单元与结构题) 保留 | 核心仓 `src/**/*.test.ts` 与 `test/` 仓库守护 |
| 负例 repo（edge 场景） | 坏输入、坏配置的用户可见拒绝行为 | 带 `runs: 3` 的配置断非零退出 |
| 机制 harness（故障编排） | repo 与单元都造不出的外部故障序列 | provider 故障序列（M1） |

三条落点说明：

- 原 U8 的被测对象是被本候选删除的 World digest 机制，「原样保留」不成立；它改写为「共享结果根 hash 守护」的自测（见保留的规则），其余各题落点不变。
- 负例 repo 依赖的产品机制尚未落地时，只在题库映射表标 `GAP`、不进泳道，继承原方案「不写替代品断言」的规则；机制与负例同批转正，恒红仓库不进入任何门禁。
- PTY 与显示宽度：`cli/` 仓保留粗粒度 PTY smoke（有 ANSI、有面板、到达完成态）；折行与 CJK 宽度细节归单元层排版解析，继承原 DSL 的两读面边界。

## 目录布局与泳道

```text
e2e/
  cli/          # A1 进程交付 · A3/A3b 历史往返与证据切片 · A6 证据边界 · PTY smoke
  consumers/    # A2：cjs/ foreign-report/ doc-example/ 各自独立 repo，模块差异由 package.json 天然表达
  scheduling/   # A4 区间关系 · Sandbox 复用承接
  report/       # A7/A7b 公式与双面 · A8 浏览器 target / hosting / 热重载
  adapter/*     # A5 真实模型身份读回（现有仓）
  lifecycle/    # A9 SIGINT / SIGKILL / 锁闭合
  scripts/      # 候选构建、注入、指纹核验、汇总（现有，不变）
```

泳道沿用原方案三档，落成 repo 级元数据（`e2e.json` 一个字段）：

| 泳道 | 频率 | 成员 |
|---|---|---|
| deterministic | 每 PR，无 secret，本机可跑 | cli、consumers、report、scheduling 的无凭据部分 |
| external | 定期或代表档，pinned 凭据 | adapter 各仓、scheduling 的真实 Docker 复用 smoke |
| lifecycle | 串行定期，无条件异常清理 | lifecycle |

三档拆分是对现行契约的修改：现行 [E2E 总则](../../engineering/testing/e2e/README.md)规定全部 E2E 仓库需要真实凭据、矩阵里不存在脚本化 Agent，今天的 `e2e/cli` 与 `e2e/report` 也确实依赖模型凭据。deterministic 泳道因此有一个前置产品能力——最小确定性 agent（见下文「前置」），落地前这两仓留在 external 档运行。

## 触发、预算与纪律

泳道只定频率；触发、耗时与失败纪律由三条机器规则接住，分别对应原方案的变更卡、PR 预算与 flake 政策：

- **变更卡与 path-filter**：每个 repo 在 `e2e.json` 声明自己的触发路径集（核心仓源码路径加本仓路径）。CI path-filter 与本地变更卡由这份元数据生成，随各仓在试点批次落地时同批挂上；改了 `src/view/**` 却没跑 `report/` 由机器拦，不靠操作卡记忆。路径集是静态声明，不自动跟踪重命名与共享 helper 迁移；`src` 重组时路径集变更须同批评审，这相对原方案的影响图是又一处显式弱化。
- **PR 预算**：runner 每次运行把耗时读数落成 JSON，一条守护断言读数存在且不超预算；初始预算取首批冷跑实测的 1.5 倍，硬上限 15 分钟。缓存先不建，用预算红线倒逼裁剪。
- **flake 与隔离**：flake 台账、隔离三件套（降档、开缺陷、记 memory）、release-blocking 签入清单整体继承[原方案规则](../e2e-acceptance-testing/architecture.md#flake-政策)，记账单位翻译到本形态——台账与清单成员按「repo 加实验 / 测试 id」记，隔离动作对应泳道降档；规则语义不变。

## 题库映射

题面、覆盖的历史缺陷与区分性要求单源仍在[验收题库](../e2e-acceptance-testing/bugs/acceptance-bank.md)；这里只登记落点与两面断言。

| 题 | 落点 | 过程断言 | 结果断言 |
|---|---|---|---|
| A1 pipe / exit / quiet / fatal | `cli/` | exit、signal、流归属 | JSON 可 parse、locator 集合完整 |
| A2 消费方矩阵 | `consumers/*` | 命令 exit、stderr | Report 表与 locator 可读 |
| A3 / A3b 历史与证据切片 | `cli/` | 携入身份事实今天无 CLI 公开出口（`attempt.carried` 属 `openRecord()` 库读面）；落地前只断 NDJSON `start` / `result` 事件的携入计数与 `--dry` 计划面，逐 attempt 读回见前置 3 | locator 往返打开同一 attempt |
| A4 调度区间 | `scheduling/` | attempt 与 activity 区间偏序；依赖前置 3 的生命周期事件，当前只能从 `show --timing` 的结果面读 | 各实验 verdict 正确 |
| Sandbox 复用承接 | `scheduling/` | `show --history --json` 的 `sandbox.reuseOrdinal` 达到 attempt 数、`sandboxId` 去重后为一；NDJSON 无 `sandbox-reset-failed` warning（实验声明 `maxConcurrency: 1`） | 残留敏感的 Eval 仍按题面通过 |
| A5 adapter 身份 | `adapter/*` | `show --execution` 的规范工具名 | 原 Eval gate 通过 |
| A6 diff 与截断三态 | `cli/` | truncation 标记、原始与保留字节 | 零改动显示「零改动」而非「无证据」 |
| A7 / A7b Report 公式与行内返回 | `report/` | — | text 与 web 逐字段相等、独立推导值 |
| A8 target / hosting / 热重载 | `report/` | 请求 URL、HTTP 状态、console 无错 | dialog 身份、tooltip、热重载后 DOM |
| A9 资源闭合 | `lifecycle/` | exit 130、SIGKILL、`lock_wait` 缺席 | 外部 inventory diff、下一次 Invocation 行为 |

映射不进 repo、如实留在原处的：U1–U9 归单元层；M1 provider 故障编排是真机制缺口；A8 的 pageId 双向 census 是核心仓结构守护（U9）。

**映射守护**：映射表每行绑定对应 Feature 契约 anchor，一条 vitest 双向核对——行引用的 anchor 必须存在，声明覆盖某类别的 repo 与实验必须存在。断言命题是否仍覆盖当前抽象，机器不判，由 escape audit 与评审承担；这弱于原方案 Registry 的类别绑定，是本候选的显式代价（见删除项与理由）。

## 从原方案保留的规则

这些与 DSL 无关，是原方案里真正值钱的部分，逐条继承：

- **六条准入门槛**（[综合方案](../e2e-acceptance-testing/bugs/synthesis.md#候选-proof-的准入门槛)）：当前版绿、逆补丁红、同形反证红、化妆扰动不误红、malformed 不假绿、不改用户用法。落成每个新 repo 或新实验的 review checklist。
- **escape audit**：缺陷逃逸后先问哪个 repo 本该抓住，加强该 repo 的断言或补实验；只有新验收域才开新 repo。审计模板固定加一问：该缺陷的等价类矩阵当前在几处展开？超过一处即合并到唯一 owner。禁止一个缺陷一个回归文件。
- **verify 写作规则**：断言函数解析不到就显式失败并列出实际候选，不返回空集；golden 只留逐字承诺的短文本；时序只比事件偏序，不比毫秒；失败消息带阶段、公开身份、实际观察与最短复现命令。
- **产物只读的机器化**：verify 套件前后对共享结果根做 hash 对比（共享 helper），越权写入直接红；需要变更的场景自建私有结果根。这是原 World digest 链「受保护根前后核对」的轻量继承，也是 U8 改写后的自测对象。
- **解析层归属**：stdout 结构解析以[排版原语](../../feature/reports/library/layout.md)的文档声明为规范来源，是渲染契约的第二实现，失配即真发现；落点在 report 仓共享模块，测试正文只出现领域函数名，不出现字面正则与整句 golden。这继承 DSL 的落点结论；删除的只是先于重复度设计的公共词表。其它仓（如 `consumers/` 的 A2）对 Report 输出只做现行契约允许的有界读回（自有事实的子串级检查），不各自长出第二套解析器。
- **退役守护**：verify 迁移批次提交签入清单（新断言对应的待退役旧脚本路径），一条 vitest 断言清单中的待退役文件已消失，防止新旧双轨长期共存。
- **读取边界**：继承现行 [E2E 总则](../../engineering/testing/e2e/README.md)——`openRecord()` 库读面专属 report 仓，其余仓的 verify 只走 CLI 公开出口。
- **fixture 边界**：单元层继承 fixture builder 规则——测试不手写完整生产 DTO，由矩阵 owner 提供最小 builder。

## 删除项与理由

| 删除 | 理由与残余风险 |
|---|---|
| 领域 matcher 词表（`e2e-acceptance-dsl/`） | 领域查询在 vitest 里是普通函数；解析层的规范来源与落点按上节继承，两仓出现相同稳定需求再评审抽公共包 |
| Evidence Recipe、WorldManifest 与 digest 链 | 身份漂移由 lockfile 加候选包指纹核验覆盖；防污染由共享结果根 hash 守护覆盖；两层缓存不继承，用 PR 预算红线倒逼 |
| Portfolio Registry 与 Retirement Manifest | 退役降为签入清单加一条 vitest；duplicated matrix 由 escape audit 问句抽查；blast radius 演练与净数量报告不继承——第五闭包（portfolio）的防线弱于原方案，这是显式取舍，裁决时需知情 |
| Behavior 声明与执行登记的双向机器守护 | 降为映射守护（anchor 与存在性双向核对）；命题级覆盖审查交给 escape audit 与评审 |

## 前置：断言过程，过程就必须公开

repo 形态规定断言只读公开出口，于是「某个过程事实断不到」在本方案里判定为产品公开契约或能力的缺口，处理方式是补公开事实，不是加 DSL 词。当前已知缺口，按对泳道的阻塞面排序：

1. **最小确定性 agent**：一个不需要模型凭据、能在真实 Docker sandbox 内执行 attempt 的官方 agent。它是整个 deterministic 泳道的前置，`cli/`、`consumers/`、`report/`、`scheduling/` 四组都靠它摆脱凭据依赖。今天的产品没有这个能力；unit 层的内存 fake（recordingSandbox、scriptedAgent）不经过真实容器生命周期，替代不了。
2. **复用过程事实进运行流**：`exp --json` 的事件词表（单源 [Experiments CLI](../../feature/experiments/cli.md)）不携带任何 Sandbox 复用承接字段（`reuseSandbox` / `reuseOrdinal`），attempt 级复用事实只在 `show --json` 的 history 视图透传。[Sandbox 复用运行级汇总](../reuse-feedback/README.md)的 `created` / `assignments` / `replacements` 正是这个缺口的契约候选，`replacements` 接近 attempt 数即红灯。
3. **attempt 与 activity 生命周期事件、携入身份的 CLI 读回**：NDJSON 没有 attempt 级 start / complete 事件，也没有构建类活动事件；携入事实在 CLI 出口只有计数，没有逐 attempt 身份。A3 与 A4 的过程断言依赖这两者，今天只能退到 `show` 的结果面与计数。这是比复用汇总更大的事件契约扩展，须先于 `scheduling/` 的区间题定稿。
4. **执行侧 attestation**（原 [M2](../e2e-acceptance-testing/bugs/acceptance-bank.md#机制题)）：容器实际执行身份与镜像 platform 进公开结果，覆盖复用降级的根因层。
5. **未知配置键拒绝**（原 M3）：落成 `consumers/` 的负例 repo，机制落地前按 `GAP` 规则不进泳道。

顺序固定为先补公开事实，再补断言；不为断言开产品后门。

## 试点顺序

| 批次 | 内容 | 进入下一批的可判定标准 |
|---|---|---|
| 1 | 复用承接三断言先落既有 adapter 仓（有 `sandboxReuse` 实验与凭据的 external 档），确定性 agent 落地后迁 `scheduling/` | 当前修复版绿；镜像换回 root 版（逆补丁）三断言红；无关文案扰动仍绿 |
| 2 | `cli/` 与 `consumers/` 拆分，verify 迁 vitest，产物只读加 hash 守护 | 单例可重跑；一处失败不遮同批其它断言；退役清单守护生效，旧脚本已删除；path-filter 同批挂上 |
| 3 | `report/` 双面与浏览器 target | 三类代表 target 可达；census 结构守护在核心仓落地；PR 预算读数落盘 |
| 4 | `lifecycle/` 串行 lane | 异常清理无论成败都执行；下一次运行证明无残留 |

## 采用改动

采用本候选时至少同步改写：[E2E 总则](../../engineering/testing/e2e/README.md)（三档泳道、脚本化 Agent、凭据与触发元数据；`openRecord()` 读取边界不变）、[验收脚本写法](../../engineering/testing/e2e/verification.md)（vitest 宿主、产物只读、单例重跑与失败聚合）、[测试总纲](../../engineering/testing/README.md)（变更卡指向 repo 触发元数据）。原方案[采用改动表](../e2e-acceptance-testing/current-system-gaps.md#对现行-testing-文档的采用改动)的其余行按裁决结果处置。

## 待裁决分歧

1. 与原两份 roadmap 的关系：按 [Design 约定](../../design/README.md)升格为并列 `PLAN-N/` 正式比较，还是采纳本候选后把原两目录压缩为账本与题库留存。
2. 与 [user-readable-testing 决策](../../design/user-readable-testing/DECISION.md)的关系：该决策已采纳 PLAN-2 的 Behavior 声明与 `Observed<T>` 作者面，本候选把作者面回到普通 vitest 代码，构成部分翻案。采用时要么正式改判并把理由记入 memory，要么论证 verify 写作规则满足 PLAN-2 的失败反馈要求、只翻声明机器不翻作者面原则。
3. `consumers/` 粒度：每种模块形态独立 repo（lockfile 各自为政），还是共享 lockfile 的子目录；以第一个 CJS 消费方的真实维护成本裁决。
4. 最小确定性 agent 的形态与优先级：现行契约明文「E2E 矩阵里不存在脚本化 Agent」，补它是契约级决定。候选形态是脚本化 shell agent（按声明的命令序列在 sandbox 内真实执行），优先级取决于 deterministic 泳道的价值是否抵得过维护一个非用户能力的官方 agent；否决它则 deterministic 泳道整体降格为 external 的便宜代表档。
