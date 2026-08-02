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

## 一条 proof 的生命周期

所有 Behavior 使用同一套五阶段因果模型：

| 阶段 | 必须先成立的事实 | 典型失败 |
|---|---|---|
| prepare | 候选包、recipe、结果根、fixture、producer closure 与权限正确 | 复用了旧产物、共享 evidence 被污染 |
| invoke | 用户命令能在声明的 cwd、consumer、hosting 或 provider world 启动 | CJS / foreign cwd 装载失败、服务未就绪 |
| observe | 用户收到的流、文件、HTTP、DOM 与结构完整可消费 | pipe 截断、目标文档 404、observer parse 失败 |
| outcome | verdict、identity、公式、时间线与页面状态满足公开契约 | retry exit 错误、并发闸错误、dialog 未打开 |
| cleanup | 子进程、浏览器、端口、sandbox、lease 与外部资源收束 | teardown 被切断、orphan、锁复活 |

失败报告必须给出 Behavior id、已执行 action 轨迹、失败阶段、公开对象身份、实际观察、期望、证据路径和最短复现命令。observer 自己坏了必须在 observe 阶段失败，不得退化成空数组、`undefined` 或跳过。

## Evidence world 与衔接

每个 evidence recipe 产出一个原子发布、可校验身份的 world manifest：

- `candidateDigest`：实际安装并执行的候选包；
- `recipeId` 与 `recipeDigest`：输入、producer helper、fixture 与环境；
- `resultsRoot`、命名导出目录、公开 locator / target；
- producer 与 verifier 各自的版本身份；
- 可写范围、外部资源 owner 与异常清理入口。

prepare 完成后默认只读。普通 Behavior 前后比较文件树 digest；要追加 run、修改 Report 或维持长驻服务的 Behavior 必须申请私有 clone，并且只可执行 recipe 签入的命名 action。旧的“某个 verifier 必须最后运行”顺序约定删除。

同一份真实 evidence 可以被多个只读 Behavior 消费，模型和导出不重复执行；但共享的是冻结事实，不是可写目录、Page 或端口。

## 并发与运行拓扑

并发规则按资源所有权决定，不按测试文件名决定：

- 只读 Behavior 可以并发；每例使用独立 BrowserContext / Page 和独立临时输出目录。
- 同一个浏览器进程可以复用，但 Page、console/request 日志和截图归各 Behavior 所有。
- mutable clone 之间只有在写集、端口命名空间和外部 owner 全部分离时才能并发；同一 clone 内 action 串行。
- `service()`、signal、Docker/Compose、orphan 与 lease proof 默认串行，并注册无条件异常清理。
- 端口动态分配，不维护全局端口表，不在并发任务间共享长驻服务。
- 调度契约比较带身份事件的偏序与 overlap，不比较墙钟阈值；retry/heartbeat 等概率竞态的主守护使用可控 barrier 单元测试。

## Report：通用 target 闭环

Report 的用户模型是通用参数化目标：

```ts
type ReportTarget = { pageId: string; key: string };
```

一条 target proof 必须闭合下面整条链：

```text
最终 Report page 清单
→ params.enumerate(有效根)
→ <pageId>/<key>.html
→ 来源页 target href
→ 声明的 hosting 形态下 HTTP 200
→ 浏览器拦截并更新 hash
→ dialog 展示该 target 的同一份内容
```

### 结构 census

结构守护对最终 Report 清单中的所有参数化页执行全集检查：

1. `enumerate()` 的每个 key 恰有一个导出文档；
2. 页面产生的每个内部 target 链接都指向清单中的 pageId 和有效 key；
3. 链接目标与产物集合双向闭合，不允许孤儿链接或无入口文档；
4. 任一实例渲染失败时，静态导出保持全有或全无；
5. 收窄后的页面、target 文档与 artifact 使用同一份有效根。

这一层负责全量，不启动浏览器。

### 浏览器代表矩阵

真实 Chromium 不遍历每个实例，只保留具有区分力的代表：

| 代表 | 必须证明 |
|---|---|
| `attempt/<locator>` | 点击后请求 200、dialog 可见、判定与详情身份正确 |
| `experiment/<key>` | 实验行下钻打开实验详情，不被 attempt 专用逻辑漏掉 |
| 自定义参数化页 | 宿主只按 pageId 清单工作，不认识业务实体 |
| `experiment → attempt` | dialog 内嵌套 target 仍可下钻，hash 与内容切换正确 |

每个代表还要覆盖：直接 hash deep link、关闭按钮 / `Esc` / 遮罩、关闭后的 URL、焦点进入与恢复、背景滚动锁、修饰键点击放行，以及无 JavaScript 时独立文档仍可读。

hosting 至少包含 `directory-root`、`file-url` 与 `clean-url-subpath`。浏览器 proof 同时收集 console error、page error、request failure、最终请求 URL、HTTP 状态和截图；“链接存在”或“文件存在”不能单独通过。

这组 Behavior 取代 attempt 专用的 A8，使用本地确定性 deliberate run 生产最小 Record，不调用模型或公网；目标命令形态为：

```sh
pnpm e2e --repo report --behavior report-target-closure
```

在 runner 支持 Behavior 选择前，命令仍可由 `report` 仓库唯一的 `pnpm e2e` 执行，但该组必须能独立复用 prepare 后的 world 重跑。

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

每条新 proof 必须同时满足：

1. 当前修复版经真实公开入口通过；
2. fix parent 或最小历史逆补丁在预期最早阶段失败；
3. 至少一个同形反证也失败，证明没有写 bug 专用 matcher；
4. 文案、DOM class、ANSI、无关毫秒值等非契约扰动不误红；
5. malformed / unsupported 公开输出使 observer 显式失败；
6. 不要求用户修改 Eval、Report 或产品代码添加测试探针。

## 题库与实施顺序

- [历史缺陷研究与证据账本](bugs/README.md)
- [九题验收与单元 / 机制题](bugs/acceptance-bank.md)
- [综合分层与试点顺序](bugs/synthesis.md)
- [现行 testing 体系失效分析与迁移面](current-system-gaps.md)

实施按“验收器内核 → 便宜确定性 proof → 事件与计算 → 浏览器 target 闭环 → 高成本生命周期 → 机制缺口”推进。每批只有在当前版绿、旧 bug 红、无关扰动仍绿、observer 不假绿后才能进入下一批。

## 待裁决分歧

1. Behavior 选择是扩展根 `e2e/scripts/run.ts` 的 `--behavior`，还是只透传给仓库自己的命令；唯一要求是本地、CI 与远程执行仍走同一入口。
2. mutable clone 复制整个结果根还是只复制声明写集；第一个 mutation recipe 用真实体积数据裁决。
3. 浏览器三个 hosting 是否在每个 PR 全跑，还是 `directory-root` 每 PR、另外两种按影响路径运行；`clean-url-subpath` 对 view/Report 路径改动必须是硬门禁。
