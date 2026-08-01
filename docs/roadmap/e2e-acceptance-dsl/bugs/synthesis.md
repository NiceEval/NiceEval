# 最终综合：用最少公开行为覆盖历史缺陷

## 结论

七轮抽样覆盖 CLI、runner、record、report、browser、provider、sandbox、adapter、构建与文档消费方。
第 6、7 轮连续跨模块挑战都没有新增缺陷形态、测试原语或机制缺口，当前抽象可以收敛。

收敛结果不是“为每个旧 bug 写一个 matcher”，而是六组可复用能力：

| 能力 | 最小作者面 | 它证明什么 |
|---|---|---|
| 证据 world | `world()`、只读 manifest、私有 `clone()`、命名 `run(action)` | 所有动作与观察属于同一个输入世界；只读 proof 不会改写证据 |
| 真实进程 | `cli()`、长驻 `service()` | argv、cwd、pipe、stdout / stderr、exit / signal、服务提前退出与收尾是真实事实 |
| 公开结构读面 | `reportView()`、`ndjsonEvents()`、`jsonSummary()`、`junitReport()`、`sandboxInventory()` | 从用户实际收到的 stdout、机器出口和资源清单按公开身份读回 |
| 真实消费 / 托管形态 | `w.consumerDir(name)`、`hosting` | CJS、foreign cwd、发布包入口、无尾斜杠子路径等宿主差异进入矩阵 |
| 浏览器动作闭环 | Playwright 原生动作、领域寻址、步骤轨迹 | DOM producer、增强脚本、URL 基底、网络取件与可见结果在真实浏览器闭合 |
| 独立比较 | `expectObserved()`、短文本 `toMatchScrubbedFileSnapshot()` | 预期来自题面，不从候选实现回抄；失败携带来源与提取路径 |

`attemptIntervals()`、`truncations()`、`executionNodes()` 是上述公开读面的领域查询，不是各自的
runner 或观察机制。它们只有公开文档已经存在对应概念时才立词。

## 一条统一因果模型

历史 bug 虽跨模块，漏测链条都能落到五个最早失败阶段：

| 阶段 | 应先证明的事实 | 代表缺陷 |
|---|---|---|
| prepare | recipe、候选包、结果根、producer closure、可变权限正确 | 共享 evidence 被后置验收污染 |
| invoke | 用户命令能在指定 consumer / hosting / provider world 正确启动 | CJS config、foreign Report、marketplace 名、空 view |
| observe | 用户实际收到的流、artifact、URL、结构字段完整可消费 | pipe 截断、diff 三态、artifact 404、diagnostic code |
| outcome | 多个局部事实折叠后的 verdict、identity、formula、timeline 关系正确 | retry exit、并发闸、carry、Report 公式 |
| cleanup | 进程结束后，框架承诺负责的外部资源和 lease 已真正释放 | teardown 被切断、Compose orphan、心跳复活锁 |

失败消息固定为：已执行 action 轨迹、失败阶段、公开对象身份、实际观察、期望与最短复现命令。
观察器自己解析失败必须在 observe 阶段显式报错；不得回退成空数组、`undefined`、文本包含或“跳过”。

## 分层归属

### 用户侧必须证明

只有跨层组合、真实进程 / 宿主差异、浏览器或外部资源最终状态，才值得付 E2E 成本。
主集合压缩为九题，详见[验收题库](acceptance-bank.md)：

1. 机器出口经真实 pipe 仍完整，进程 outcome 与最终结果一致。
2. CJS、foreign cwd、文档 example 作为真实候选包消费方可运行。
3. 公开 locator 与历史选择能在多步运行后往返，宿主不丢 identity closure。
4. 调度只断区间关系：实验隔离、retry 持闸、BuildKey ready 即放行。
5. adapter 的公开身份由真实事件 / 安装状态读回，不由配置或厂商中间名猜测。
6. diff、artifact 与机器出口保留“缺失 / 空 / 有内容”及“完整 / 截断”的公开边界。
7. Report 领域值在 text / web 中一致，公式由非对称输入独立确定。
8. clean-url 托管、交互增强与热重载在真实浏览器完成动作闭环。
9. SIGINT / SIGKILL 后，外部 inventory 与下一次 Invocation 证明资源所有权已闭合。

### 单元 / 结构守护负责

这些事实可在最早层确定，放进 E2E 只会更慢、更难定位：

| 守护 | 必须覆盖的反例 | 不交给 E2E 的理由 |
|---|---|---|
| provider SDK contract case | paginator / page、真实类型、unknown 状态 | 远端歧义故障不可确定重现，类型与纯适配最早失败 |
| scheduler / lease 压力单元 | retry backoff、release 后在飞 heartbeat、两类 lease 共用行为 | 概率竞态需可控 barrier，不应靠 E2E 多跑碰运气 |
| BuildKey 来源矩阵 | service / build 声明、探测回落、执行入参同源 | 组合数量高，纯输入矩阵定位更直接 |
| adapter contract matrix | 每条 SDK / CLI 路径的 canonical identity、真实 JSON fixture | 一个代表真机 proof 足够，其余路径不重复付费 |
| artifact registry contract | 每类大字段的保存 / 截断策略、后续命令仍完整 | 策略是 registry 的穷举事实，不靠一条巨大用户 fixture 证明全量 |
| Report compute contract | 三种可区分公式、failure reason 优先级、跨 experiment identity | 计算层最早失败；用户 E2E 只留一个代表组合题 |
| runnable example census | 每个公开键 / flag 至少有一个真实 consumer case | 这是覆盖完整性，不是单个页面渲染行为 |
| producer symbol closure | Report host 不加载第二份 record / locator 实现 | 防测试 recipe 自己选错入口制造假红假绿 |

### 仍需框架机制

三项不能用特例断言假装已经覆盖：

| 机制缺口 | 为什么用户侧当前捕获不了 | 关闭标准 |
|---|---|---|
| provider 故障编排 | 普通用户入口不能确定制造“create 超时但远端已创建”、paginator 中途失败等状态 | provider contract harness 能脚本化 SDK page / error 序列；同一用户命令可稳定复现且总清理 |
| Build 执行事实 attestation | provenance 只有声明 / BuildKey，没有实际镜像平台或 builder 结果 | 公开结果记录执行侧平台 / digest，并能与 BuildKey 的有效平台作结构比较 |
| 未知配置键拒绝 | `defineExperiment` 对 `runs` 之类未知顶层键会静默忽略，E2E 只能发现一个具体拼写 | 运行时或 schema 在 config 装载阶段拒绝未知键，错误带文件、键名与最近候选 |

在机制关闭前，题库把它们标为 `GAP`，不写 `expect(...).toBeTruthy()` 一类替代品。

## 候选 proof 的准入门槛

每条试点必须同时提交一张判定卡：

1. **当前修复版通过。**使用真实公开入口，不调用待测内部函数拼最终对象。
2. **真实旧 bug 会失败。**在隔离 checkout 运行 fix parent，或应用最小历史逆补丁；失败必须落在预期的最早阶段。
3. **同形反证也会失败。**正例之外再选一个历史同形 bug，证明原语不是单例特判。
4. **契约不变的扰动不误红。**文案、ANSI、DOM class、事件到达的无关毫秒值或额外非契约行变化后仍绿。
5. **观察器故障不假绿。**喂入 malformed / unsupported 公开输出时必须显式报 observe error，并列实际候选。
6. **用户用法不改。**不得要求修改 Eval、原 assertion、Report 或产品代码来增加观察点；差异只在隔离 recipe / consumer / hosting world。

每题还要写明公开契约来源、独立 oracle 推导与区分性输入。
合法契约迁移必须先改契约文档、迁移说明和题目版本；只运行 `vitest -u` 或把字面值改成当前输出，
不能成为放行方式。

## 已删除的冗余或错误方案

后续证据已证明下列候选会制造假红 / 假绿，最终方案不保留：

- 用 in-process `runShow()` 代替真实子进程、pipe、exit 与 flush。
- 为每个 URL bug 增加 `artifactFetched()`、`attemptLinkBase()`；统一由 hosting world 与真实下钻闭合。
- 增加 `capabilities()`、`lastMeaningfulPhase()`、`computedPassRate()`、`pluginVersion()`；它们会让测试再次从内部近似字段猜公开事实。
- 全量 stdout / HTML golden；golden 只留逐字承诺的短文本，其余按领域身份与结构比较。
- 所有 selector 必须命中的扫描；退役增强应删除，活能力用一次用户动作闭环证明。
- 固定 sleep、墙钟阈值、递归“点到找到为止”的浏览器探测。
- fake SDK / fake CLI canned response 充当主 E2E；它们只属于 unit contract case。
- 共享可写 evidence 加“某脚本必须最后运行”的顺序约定；改为只读 world 与私有 clone。
- 契约变化时直接更新 snapshot；没有独立推导与历史逆补丁证据的 snapshot 不进入题库。

## 试点顺序

| 批次 | 内容 | 进入下一批的可判定标准 |
|---|---|---|
| 0：验收器内核 | `world()`、`cli()`、`Observed`、失败阶段、observer malformed cases | 设施自测能区分 invoke / observe / outcome；只读 world 越权必红；无产品 E2E |
| 1：便宜高收益 | 题 A1 进程 / pipe、A2 consumer matrix、A3 locator roundtrip | 三题当前版绿；对应旧 commit / 逆补丁红在预期阶段；化妆性扰动仍绿 |
| 2：事件与计算 | A4 timeline、A6 artifact boundary、A7 Report semantics | 不用 sleep；每题至少区分两个错误实现；失败消息只靠公开身份定位 |
| 3：浏览器 | A8 clean-url / enhancement / hot reload | 三种 hosting recipe 隔离；缺 DOM、网络 404、服务提前退分别可诊断；无公网 |
| 4：高成本生命周期 | A5 外部 adapter identity、A9 cleanup ownership | pinned 外部输入；串行 lane；无论成功失败都执行异常清理；下一次运行证明无残留 |
| 5：机制关闭 | provider fault harness、Build attestation、unknown-key rejection | 每个 `GAP` 转成结构化公开事实后，先补 unit contract，再决定是否升一个代表 E2E |

任何一批若需要新增 bug 专用 matcher，先回到账本找同形反证；找不到第二个真实案例，不新增。
