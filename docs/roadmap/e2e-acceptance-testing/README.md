# E2E 验收测试方案

还没定为当前契约的候选设计，见 [Roadmap 约定](../README.md)。

## 定位

本方案决定 **哪些 Behavior 构成发布证明、怎样形成一条完整 proof、在哪个频率运行，以及失败由谁负责**。
Behavior 的声明形状、用户任务链接、主证明与 supporting proof 关系已经由
[PLAN-2 · 用户任务规格与类型化可观察读面](../../design/user-readable-testing/PLAN-2/README.md)定义，本方案不再造第二套作者 schema。
测试正文如何读取 stdout、HTML、浏览器与机器出口，不在这里重复定义；它由
[E2E 验收 DSL](../e2e-acceptance-dsl/README.md)提供领域读面与 matcher。

两者的依赖方向只有一条：

```text
Feature / 历史缺陷
        ↓
PLAN-2：Behavior 身份、用户任务、契约、主证明与边界要求
        ↓
测试方案：Behavior 组合、recipe、分层、频率、并发与准入门槛
        ↓
验收 DSL：cli / world / reportView / browser target / matcher
        ↓
所属 E2E 仓库的 scripts/e2e.ts 与 CI
```

DSL 不决定“应该有哪条测试”；测试方案不重定义 Behavior，也不按 DOM、输出字符串或内部函数发明另一套断言语言。

## 入口

- [Architecture](architecture.md) —— Recipe、World、执行登记、调度、失败阶段、身份复用与准入。
- [Use Cases](use-case/README.md) —— Report target、真实进程、消费方矩阵、时间线和可变 service 的完整代码。
- [现行 testing 体系失效分析](current-system-gaps.md) —— 当前规则为什么仍会漏掉完整产品回归。
- [历史缺陷研究与证据账本](bugs/README.md) —— proof 的真实反例、反证和实施顺序。

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
[现行测试体系为什么仍会漏掉完整产品回归](current-system-gaps.md)。

## Proof 组合

NiceEval 仍只有[单元与 E2E 两层](../../engineering/testing/README.md)。下面是两层内的 proof 组合，不新增第三种测试类型：

| proof | 责任 | 频率 |
|---|---|---|
| 单元 / 结构守护 | 纯计算、schema、SDK 形状、全量组合矩阵、可控 barrier 竞态 | `pnpm test`，每次相关改动 |
| 确定性公开入口 E2E | 真 CLI、候选包、静态导出、浏览器和本地服务；不依赖模型或公网 | 本地变更卡与每个 PR |
| 外部协议 E2E | 真实模型、SDK、CLI、sandbox 与 pinned 外部输入 | PR 的便宜代表档或定期 lane |
| 生命周期 E2E | signal、teardown、orphan、lease 与下一次消费者 | 串行定期 lane |

这里有意修正现行“全部 E2E 都需要真实 provider 凭据”的规则。真实优先应绑定**待测边界**：adapter proof 的真实边界是 SDK / 模型，Report target proof 的真实边界是候选包、子进程、文件、HTTP 与 Chromium。后者使用确定性 Record 不是 mock 产品行为。

组合原则是“最早层失败”：纯公式不经浏览器穷举，概率竞态不靠 E2E 多跑碰运气；跨进程、跨宿主、真实 URL、浏览器动作和外部最终状态必须留用户侧 E2E。

## 运行模型

所有 Behavior 使用 prepare、invoke、observe、outcome、cleanup 五阶段。
Recipe 产生可校验身份的只读 World；需要修改输入的 Behavior 使用私有 clone 和登记过的 mutation action。
并发由 read-only、mutable-clone、service 与 exclusive-external 四种资源类别决定。

类型、数据流、并发规则和失败折叠单源在 [Architecture](architecture.md)。
Report 参数化页的全集 census、Chromium 代表矩阵与 hosting 路径见
[Report target 闭环](use-case/report-target-closure.md)。

## 变更卡与门禁

每次公共行为变更先按影响面登记 Behavior，再改实现：

| 改动 | 必跑 |
|---|---|
| `src/view/**`、Report target / page / hosting、`enhance.js` | 单元结构 census + `report-target-closure` |
| Report compute / renderer | 对应 compute contract + text/web 代表 E2E |
| CLI / process output | 真实子进程、流与 exit Behavior |
| scheduler / retry / BuildKey | 可控 barrier 单元 + timeline 代表 E2E |
| cleanup / sandbox ownership | cleanup 单元 + 串行生命周期 lane |

CI 的 push / PR workflow 仍通过根命令注入候选 tarball并运行所属 E2E 仓库；本方案额外要求确定性 Behavior 不依赖 secret，因而本机也能在提交前执行。未 push 的本地提交不能以“CI 将来会跑”代替本地变更卡。

高风险跨层 coverage category 直接绑定 PLAN-2 的稳定 Behavior id。Behavior 声明已经持有 `task`、`contract`、`risk`、`primary.target` 与 `primary.execution`；所属 E2E 仓库的执行登记再为 Behavior id 指定 cadence 与并发 class。机器守护只核对覆盖类别、主证明与执行登记的双向存在，不把具体 scenario 清单复制进文档。这样 Feature 从 attempt 升级为 target 时，旧 Behavior 不能只凭“文件还在”继续冒充覆盖。

## Proof 准入门槛

Proof 必须通过当前候选、历史逆补丁、同形反证、非契约扰动和 observer malformed case 五类判定。
完整准入不变量见 [Architecture · 身份、复用与准入](architecture.md#身份复用与准入)。

## 题库与实施顺序

- [历史缺陷研究与证据账本](bugs/README.md)
- [九题验收与单元 / 机制题](bugs/acceptance-bank.md)
- [综合分层与试点顺序](bugs/synthesis.md)
- [现行 testing 体系失效分析与迁移面](current-system-gaps.md)
- [完整工程 Use Cases](use-case/README.md)

实施按“验收器内核 → 便宜确定性 proof → 事件与计算 → 浏览器 target 闭环 → 高成本生命周期 → 机制缺口”推进。每批只有在当前版绿、旧 bug 红、无关扰动仍绿、observer 不假绿后才能进入下一批。

## Engineering 采用形状

开放分歧裁决后，两份 Roadmap 合并为一个工程主题，而不是作为两个平行测试系统存在：

```text
docs/engineering/testing/acceptance/
  README.md
  architecture.md
  dsl/
    README.md
    library.md
    architecture.md
  use-case/
```

本目录的测试方案进入 acceptance 的 README 与 Architecture；DSL 目录进入 `dsl/`；两边的目标代码示例汇入同一个 `use-case/`。
`current-system-gaps.md` 和逐 bug 研究不进入目标状态正文。采用时将稳定规则写入 Engineering，把历史原因留在 memory。

采用必须同步改写 [现行 testing 文档清单](current-system-gaps.md#对现行-testing-文档的采用改动)，不能只移动目录或增加索引链接。

## 待裁决分歧

1. Behavior 选择是扩展根 `e2e/scripts/run.ts` 的 `--behavior`，还是只透传给仓库自己的命令；唯一要求是本地、CI 与远程执行仍走同一入口。
2. mutable clone 复制整个结果根还是只复制声明写集；第一个 mutation recipe 用真实体积数据裁决。
3. 浏览器三个 hosting 是否在每个 PR 全跑，还是 `directory-root` 每 PR、另外两种按影响路径运行；`clean-url-subpath` 对 view/Report 路径改动必须是硬门禁。
