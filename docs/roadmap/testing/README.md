# NiceEval 测试体系重构

本目录是尚未落地的目标契约，遵守 [Roadmap 约定](../README.md)。PLAN-2 → Portfolio → Recipe / World → DSL
的依赖方向、治理裁决 G1–G5 和三项实现选择都已固定。实现者可以按 [Example](example/README.md) 直接搭第一条
proof，并用本文的准入、退役和预算门禁判断成败；落地前不改变现行
[`docs/engineering/testing/`](../../engineering/testing/README.md) 契约。

## 定位

本方案重构 NiceEval 的完整测试体系，不是在现有 unit 之上追加一层 E2E。它决定：

- 哪些稳定用户结果需要 Behavior 主证明；
- 哪些机制风险只能由 unit / structure proof 最早、确定地证明；
- 本批触及或替代哪些旧测试，以及哪些无资格旧测应直接删除；
- proof 怎样复用 evidence、在哪个频率运行、失败由谁负责。

E2E 是主证明可能选择的执行边界，不是本方案的身份。纯确定性 Library 行为可以由 unit 主证明；候选包、
CLI、协议、PTY、HTML 或浏览器行为由 E2E 主证明。两者进入同一份 proof inventory，接受同一套数量预算、
唯一 owner、历史 bug kill 和退役审计。

Behavior 的声明形状、用户任务链接、主证明与 supporting proof 关系已经由
[PLAN-2 · 用户任务规格与类型化可观察读面](../../design/user-readable-testing/PLAN-2/README.md)定义，本方案不再造第二套作者 schema。
测试正文如何读取 stdout、HTML、浏览器与机器出口，不在这里重复定义；它由
[E2E 验收 DSL](dsl/README.md)提供领域读面与 matcher。

两者的依赖方向只有一条：

```text
Feature / 历史缺陷
        ↓
PLAN-2：Behavior 身份、用户任务、契约、主证明与边界要求
        ↓
测试体系：proof portfolio、unit 选择/退役、Behavior 组合、recipe、频率与准入
        ↓
验收 DSL：cli / world / reportView / browser target / matcher
        ↓
所属 E2E 仓库的 scripts/e2e.ts 与 CI
```

DSL 不决定“应该有哪条测试”；测试方案不重定义 Behavior，也不按 DOM、输出字符串或内部函数发明另一套断言语言。

## 入口

- [Architecture](architecture.md) —— Recipe、World、执行登记、调度、失败阶段、身份复用与准入。
- [Proof Portfolio 与测试退役](portfolio.md) —— 测试数量预算、唯一矩阵 owner、unit 保留条件和替代删除协议。
- [E2E](e2e/README.md) —— Recipe、World、runner、频率与公开边界用例。
- [Unit](unit/README.md) —— mechanism proof、matrix owner、fixture 与迁移规则。
- [现行 testing 体系失效分析](reference/current-system-gaps.md) —— 当前规则为什么仍会漏掉完整产品回归。
- [历史缺陷研究与证据账本](reference/bugs/README.md) —— proof 的真实反例、反证和实施顺序。
- [最近修复覆盖审计](reference/bugs/recent-fixes-2026-08-04-to-05.md) —— 2026-08-04 至 2026-08-05 的修复怎样归入既有 owner，以及哪些缺口必须补进方案。
- [完整目录与 TypeScript Example](example/README.md) —— 一条 Report target proof 从声明、Recipe、World、测试正文到 runner 与退役守护的目标落盘形态。

## 为什么从 DSL 中拆出

原目录同时放了媒介词表、evidence 生命周期、九题验收、历史 bug 账本与 rollout 批次，导致三种责任混在一起：

- 改一个 matcher，容易被理解成更改覆盖范围；
- 新产品能力只补了 DSL 词，却没有进入任何必跑 Behavior；
- 浏览器场景仍按旧的 attempt 专用词组织，而产品已经变成通用参数化页。

拆分后的判据是：

| 问题 | 归属 |
|---|---|
| 用户必须完成什么任务、哪种旧 bug 必须变红 | 本测试方案 |
| proof 使用哪份 evidence、是否可变、何时运行 | 本测试方案 |
| read-only proof 能否并发、service / cleanup 是否串行 | 本测试方案 |
| stdout、HTML、浏览器页面怎样变成领域对象 | 验收 DSL |
| 寻址失败、结构比较与 web-first 等待怎样表达 | 验收 DSL |

现行 testing 体系已有大量正确局部，但仍缺覆盖、执行、证据与失败四个闭包；完整失效分析见
[现行测试体系为什么仍会漏掉完整产品回归](reference/current-system-gaps.md)。

## 一个体系，不是 unit 加 E2E

NiceEval 仍只有 unit 与 E2E 两种执行层，不新增第三种测试类型。变化的是测试的组织单位：从“测试文件和覆盖
类别越多越安全”改成“一个稳定 Behavior 恰有一个主证明，少量机制风险各有一个唯一 owner”。

| proof | 责任 | 频率 |
|---|---|---|
| 单元 / 结构守护 | 纯计算、schema、SDK 形状、全量组合矩阵、可控 barrier 竞态 | `pnpm test`，每次相关改动 |
| 确定性公开入口 E2E | 真 CLI、候选包、静态导出、浏览器和本地服务；不依赖模型或公网 | 本地变更卡与每个 PR |
| 外部协议 E2E | 真实模型、SDK、CLI、sandbox 与 pinned 外部输入 | PR 的便宜代表档或定期 lane |
| 生命周期 E2E | signal、teardown、orphan、lease 与下一次消费者 | 串行定期 lane |

这里有意修正现行“全部 E2E 都需要真实 provider 凭据”的规则。真实优先应绑定**待测边界**：adapter proof 的真实边界是 SDK / 模型，Report target proof 的真实边界是候选包、子进程、文件、HTTP 与 Chromium。后者使用确定性 Record 不是 mock 产品行为。

组合原则是“最早层失败”：纯公式不经浏览器穷举，概率竞态不靠 E2E 多跑碰运气；跨进程、跨宿主、真实 URL、浏览器动作和外部最终状态必须留用户侧 E2E。

同一输入矩阵只在一个 proof 中完整展开。其它层只补主证明无法观察、且删除后会放走已命名错误算法的机制事实，
不能复制同一矩阵换一层断言。新增或升级 Behavior 若实际触及旧 proof，就提交 retirement manifest；净新能力
只解释 `netNewReason`，不为通过门禁普查全仓旧测试。详细规则见 [Proof Portfolio](portfolio.md)。

## 运行模型

所有 Behavior 使用 prepare、invoke、observe、outcome、cleanup 五阶段。
Recipe 产生可校验身份的只读 World；需要修改输入的 Behavior 使用私有 clone 和登记过的 mutation action。
并发由 read-only、mutable-clone、service 与 exclusive-external 四种资源类别决定。

支持面是 Linux CI 与 macOS 本地；Windows 不在支持面内。PTY 读面只在 Linux 与 macOS 上提供。

类型、数据流、并发规则和失败折叠单源在 [Architecture](architecture.md)。
Report 参数化页的全集 census、Chromium 代表矩阵与 hosting 路径见
[Report target 闭环](e2e/use-case/report-target-closure.md)。

## 变更卡与门禁

每次公共行为变更先按影响面登记 Behavior，再改实现：

| 改动 | 必跑 |
|---|---|
| `src/view/**`、Report target / page / hosting、`enhance.js` | 单元结构 census + `report-target-closure` |
| Report compute / renderer | 对应 compute contract + text/web 代表 E2E |
| AttemptDetails / SourceView 行内返回 / Conversation | `reports.attempt-execution-evidence`；共享 Show projection 改动再追加 `reports.evidence-slices-roundtrip` |
| CLI / process output | 真实子进程、流与 exit Behavior；Show 证据切片改动追加 `reports.evidence-slices-roundtrip` |
| package exports、optional peer import、Report 对外编译入口 | `packages.consumer-matrix`；只跑四个有独立区分力的消费任务 |
| accept、run / carried identity、record 的 `configHash` / `selectedEvalIds` | fingerprint / carried 唯一机制矩阵 + 多步历史 A3 |
| scheduler / retry / BuildKey | 可控 barrier 单元 + timeline 代表 E2E |
| cleanup / sandbox ownership | cleanup 单元 + 串行生命周期 lane |
| 官方 sandbox recipe、执行 user、managed PATH 或 baseline 镜像 | U10 每次相关改动；A10 官方环境代表在 scheduled / release lane |
| `site/**` 的 post registry、blog index 或 markdown renderer | U12 structure + A11 discover → read |
| 生成 TypeScript / feedback source 的转义逻辑 | U11 发布源码文本完整性扫描 |

单元结构 census 双向比对两个来源：产品侧 `enumerate()` / `planSite` 输出的 pageId 集合，与 `docs/feature/reports/` 声明的 target 种类登记表。代码新增 pageId 种类而 docs 未登记，或 docs 登记而 census 未覆盖，两种漂移都判红；[综合分层与试点顺序](reference/bugs/synthesis.md)的 U9 行同步这条约束。

CI 的 push / PR workflow 仍通过根命令注入候选 tarball并运行所属 E2E 仓库；本方案额外要求确定性 Behavior 不依赖 secret，因而本机也能在提交前执行。未 push 的本地提交不能以“CI 将来会跑”代替本地变更卡。CI 的 path-filter 规则从试点第一批就挂上，不等 Registry 落成才接入。

`risk: release-blocking` 的 Behavior 集合是一份签入清单文件；任何把成员移出 PR cadence 的动作——降 `scheduled`、隔离或代表收缩——都必须先修改这份清单才能过门禁。

PR lane 有预算：runner 每次运行把耗时读数落成 JSON，一条静态守护断言读数存在且不超预算。初始预算取首批冷跑实测的 1.5 倍，硬上限 15 分钟。预算收缩允许把矩阵项降出 PR lane，但不得使任何 pageId 类别在 PR lane 失去代表；便宜替代是给该类别配一条无 JS 的 HTML 可达性验证。

高风险跨层 coverage category 直接绑定 PLAN-2 的稳定 Behavior id。Behavior 声明已经持有 `task`、`contract`、`risk`、`primary.target` 与 `primary.execution`；所属 E2E 仓库的执行登记再为 Behavior id 指定 cadence 与并发 class。机器守护只核对覆盖类别、主证明与执行登记的双向存在，不把具体 scenario 清单复制进文档。这样 Feature 从 attempt 升级为 target 时，旧 Behavior 不能只凭“文件还在”继续冒充覆盖。

影响图同样绑定稳定 Behavior id，但只登记能够改变该公开任务的精确 path set，不用顶层目录制造全量误跑。
Show 的 flag、切片宿主、attempt evidence 读取、对应组件装配和候选包入口由
[`reports.evidence-slices-roundtrip`](e2e/use-case/evidence-slices-roundtrip.md#变更触发路径)共同守护；

Web Attempt 对 drive 调用、行内返回、unmapped Conversation 与缺失 warning 的组合由
[`reports.attempt-execution-evidence`](e2e/use-case/attempt-execution-evidence.md#变更触发路径)守护。

共享 projection 只有实际改变对应公开读面时才触发一条或两条 Behavior。producer 路径只有在改变落盘
evidence 契约时才进入闭环。重命名按 diff 新旧路径匹配，共享 helper 取完整传递闭包，确保
“文件挪走所以规则不再命中”本身不能绕过门禁。

## Proof 准入门槛

Proof 必须通过当前候选、历史逆补丁、同形反证、非契约扰动和 observer malformed case 五类判定。
完整准入不变量见 [Architecture · 身份、复用与准入](architecture.md#身份复用与准入)。

准入还要求完成数量审计：主证明已有 owner、supporting proof 有独有机制风险、被替代旧测试已经删除，且同一
scenario matrix 没有在 unit、human formatter、JSON 和 E2E 四处复制。测试总数允许因新契约净增加，但每项
增加必须对应新的 Behavior 或独有错误算法，不能对应一个新函数、类型或 DTO 字段。

## 题库与实施顺序

- [历史缺陷研究与证据账本](reference/bugs/README.md)
- [用户侧验收与单元 / 机制题](reference/bugs/acceptance-bank.md)
- [综合分层与试点顺序](reference/bugs/synthesis.md)
- [现行 testing 体系失效分析与迁移面](reference/current-system-gaps.md)
- [完整工程 Use Cases](e2e/use-case/README.md)

实施按“验收器内核 → 便宜确定性 proof → 事件与计算 → 浏览器 target 闭环 → 高成本生命周期 → 机制缺口”推进。每批只有在当前版绿、旧 bug 红、无关扰动仍绿、observer 不假绿后才能进入下一批。

## 采用边界与目标形状

本目录不直接改变当前 `docs/engineering/testing/` 契约。实现时先按 Example 落 walking skeleton；验收通过后把
稳定契约整体迁入 Engineering，而不是在现行体系旁边增加 acceptance 子系统：

```text
docs/engineering/testing/
  README.md
  architecture.md
  portfolio.md
  migration.md
  unit/
  e2e/
  dsl/
    README.md
    library.md
```

本目录的 portfolio、unit 退役、Behavior、recipe 与执行规则共同进入 Engineering；DSL 只作为公开观察工具。
`current-system-gaps.md` 和逐 bug 研究不进入目标状态正文。采用时将稳定规则写入 Engineering，把历史原因留在 memory。

采用必须同步改写 [现行 testing 文档清单](reference/current-system-gaps.md#对现行-testing-文档的采用改动)，不能只移动目录或增加索引链接。

## 已冻结的治理裁决

下列五条是实现输入，不再保留平行选项。DSL 领域词仍按“先有已准入 Behavior，后加观察能力”的顺序增长。

### G1. Repo acceptance 归入 Recipe backend

Repo acceptance 不构成第二套顶层体系。它的消费方仓库、候选 tarball、真实 CLI 和独立 lockfile 能力，
归入 `consumer-project` Recipe backend；Behavior、Portfolio、World、DSL、Outcome 和唯一命令仍由本方案拥有。
[backend 契约](e2e/consumer-project-backend.md)只定义消费方准备边界，不再保留顶层替代关系。

### G2. Mechanism proof 硬规则

每个 mechanism proof 必须声明：

1. 若删除该 proof，哪一类错误算法会重新进入 release；
2. 为何 Primary Behavior 无法稳定制造或区分该错误算法。

禁止「觉得重要就加 unit」而无错误算法集合。

机器形状使用 `wrongAlgorithms` 与 `whyPrimaryCannotCatch` 两个必填字段；缺一项的 proof 不进入 Registry。

### G3. WorldManifest 职责边界

`WorldManifest` 在 schema 层物理拆成 `identity`、`resources`、`evidence` 与 `permissions` 四区。
Identity 只决定复用；Resource 只描述不可变树与运行资源；Evidence 只保存可读事实索引；Permissions 只声明
clone 写集和 action。完整穷尽形状见 [Architecture · Recipe 与 World](architecture.md#recipe-与-world)。

### G4. 迁移完成定义与选择性旧测审计

迁移不做旧测试 100% 映射，也不把旧 inventory 当需求来源。先从 Behavior、机制风险和发布边界得到目标
portfolio，再只审计本批触及、明显重复或被新 proof 替代的旧测试。旧测试没有以下任一存在资格就直接删除：

- 它是一个稳定用户结果的唯一主证明；
- 它拥有主证明无法稳定制造或定位的具名错误算法矩阵；
- 它暂时填补一个已登记、带截止条件的迁移缺口。

Retirement Declaration 只记录本批实际删除、吸收和临时保留的 proof，不要求给仓库里每个历史测试贴标签。
迁移完成 = 目标 portfolio 闭合、重复矩阵清零、本批声明的删除已经发生、临时缺口可追踪。覆盖率下降、snapshot
已存在或测试写了很久都不是保留理由。详见 [Portfolio](portfolio.md)。

### G5. Behavior 增长规则

新增 Behavior 必须同时具备：

1. 用户任务边界（PLAN-2 锚点）；
2. release 风险（删了放走什么）；
3. 公开契约锚点（CLI / 包导出 / 文档）。

禁止「一个 Feature 默认一个 Behavior」膨胀。

`BehaviorDeclaration` 的 `task`、`contract`、`risk` 仍由 PLAN-2 单源定义；Portfolio 另要求一条
`releaseRisk`，明确删除这条主证明会放走的用户错误事实。Registry 拒绝缺任务锚点、契约锚点或
`releaseRisk` 的 Behavior，也拒绝同一个用户结果被多个 Behavior 换媒介重述。

## 已冻结的实现选择

1. **Behavior 选择归自治仓库。** 每个仓库的 `scripts/e2e.ts` 唯一解析 `prepare`、`verify --world --behavior`
   与完整运行。根 `e2e/scripts/run.ts` 只选择仓库、构建并注入候选包，再把 behavior filter 原样透传；它不解释
   Recipe、World 或 matcher。
2. **mutable clone 的 v1 复制声明写根。** 实现优先 reflink，平台不支持时普通复制；不得复制整个 world，
   也不得用硬链接。manifest 记录写根 digest 和复制方式，clone 前后只核对声明写集，越界写入直接失败。
3. **三个 hosting 都进入相关 PR。** `directory-root` 跑交互主路径，`clean-url-subpath` 跑 target、artifact
   与 308 基底，`file-url` 跑禁用 JavaScript 的静态可读性。矩阵可按 pageId 取代表，但三种 hosting
   不能降出 Report target / hosting 影响路径的 PR lane。
4. **浏览器断言固定使用 Playwright web-first `expect`。** Vitest 只负责收集、筛选和结果聚合；浏览器
   locator 断言从 `@playwright/test` 导入 `expectWeb`，不依赖 Vitest matcher 模拟等待。
5. **PTY v1 只落粗粒度 smoke。** 首批固定证明 ANSI、面板与终态；折行、CJK 显示宽度等精确词只有在
   已准入 Behavior 明确需要时增加，不与 stdout parser 共建全量第二实现。
