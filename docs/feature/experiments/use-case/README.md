# Experiments 用例手册

规则难懂的地方来这里按场景查。
一节对应一个 flag、API 组或功能主题，只帮助选择；叶子文档一篇讲一个用户目标的完整路径。
契约单源始终在 [CLI](../cli/README.md)、[Library](../library/README.md) 与 [Runner](../../../runner.md)，用例只做搭配与叙事，不复制定义。

## Library 与配置主题

### 并发

先区分四个控制面：

- CLI `--max-concurrency` 约束本 Invocation 的全局吞吐。
- Experiment `maxConcurrency` 约束本 Invocation 内该实验的宽度。
- Coordination（协调）处理执行去重与同一 Experiment 的 dispatch claim（派发占用）。
- Record 只独立发布 Run。

多个 Invocation 可以追加同一 Record root。只要它们共享外部状态，就用 `sharedState.key` 保护状态区间。

| 目标 | 用例 |
|---|---|
| Eval 互相独立，追求默认吞吐 | [独立评测并行执行](concurrency-independent-evals.md) |
| 跨 Attempt 读写同一份状态 | [串行保护共享状态](concurrency-serialize-shared-state.md) |
| 多开终端时追加同一 Record，并保护共享 checkpoint | [并行 Invocation](concurrency-parallel-invocations.md) |
| 上一次运行被强杀，下一次运行接管过期协调状态 | [恢复中断运行](concurrency-resume-interrupted-run.md) |
| 后一道 Eval 依赖前一道的结果 | [固定执行顺序](concurrency-fixed-order.md) |
| 只有一个 Experiment 撞服务限额 | [限制单个实验](concurrency-max-per-experiment.md) |
| 重复运行必须按结果决定下一次 | [严格顺序重试](concurrency-strict-retry-order.md) |
| 生命周期代码在并发下保存每个 Sandbox 的状态 | [隔离Hook状态](concurrency-isolate-hook-state.md) |
| 本机或 Provider 容量不足 | [限制全局并发](concurrency-max-global.md) |
| 快慢实验混在同一批 | [让调度器混跑](concurrency-mix-fast-slow.md) |
| 多开终端运行同一 Experiment | [并行 Invocation](concurrency-parallel-invocations.md) |

调度与名额持有期的契约单源在 [Runner](../../../runner.md#调度有界并发)。

### 生命周期代码放哪

判断顺序是：资源随什么变化、活在哪一侧，就放进对应层。

| 目标 | 用例 |
|---|---|
| 准备稳定且安装很慢的基础依赖 | [把重依赖烘进镜像](lifecycle-bake-dependencies.md) |
| 准备某道 Eval 自己的任务素材 | [准备任务 Fixture](lifecycle-task-fixture.md) |
| 按 Experiment 改变 Sandbox 内配置 | [配置 Sandbox 准备命令](lifecycle-configure-sandbox-prep.md) |
| 整场运行共享一个临时服务 | [启动实验级共享服务](lifecycle-shared-services.md) |
| 服务需要跨 Run 长期存在 | [交给外部编排](lifecycle-external-long-lived-resource.md) |

完整分工见 [Sandbox 预置分工](../../sandbox/library/README.md)。

### 实验值归属

一句判据：**值是你写下的 → 配置；值是跑起来才知道的 → 运行时观测。**
配置再分一道：会改变 Attempt 里发生的事用 `flags`，只给报告归类用 `labels`。

| 目标 | 用例 |
|---|---|
| 声明会改变运行行为的 A/B 条件 | [用 flags 控制联网](observations-declare-flags.md) |
| 给报告增加不影响运行的坐标 | [用 labels 标注记忆机制](observations-label-report.md) |
| 保存启动后才知道的实例地址 | [上报运行时观测](observations-report-runtime.md) |
| 同一个值既可能是条件也可能是观测 | [按角色选择归属](observations-separate-conditions.md) |

模型名是 `model` 配置，实验 id 是身份，都不属于这三个袋子。
运行时观测不是第三方可扩展的持久化面。只有 NiceEval 已发布的 typed collector 或 Adapter 能力，才能把匹配值写入 Record catalog 中与 owner 匹配的 fixed family。
没有 collector 的值不自动持久化或查询。
完整归属规则见 [Library · labels 与运行时观测](../library/README.md#labels-与运行时观测)。

### Eval 选择

| 目标 | 用例 |
|---|---|
| 按目录让 Experiment 负责一族 Eval | [按路径前缀选择](selection-by-path-prefix.md) |
| 按标签或运行时要求过滤 Eval | [按标签选择](selection-by-tags.md) |
| 同一范围含两种题型 | [拆开混型评测](selection-split-eval-kinds.md) |
| 在一次 CLI 调用中临时收窄并预览计划 | [选择器与 `--dry`](selection-dry-preview.md) |
| 先确认有哪些 Eval 被发现 | [`niceeval list`](selection-list-evals.md) |
| 先确认有哪些 Experiment 可运行 | [`niceeval exp list`](selection-list-experiments.md) |

选择规则单源见 [Library](../library/README.md#evals遍历发现结果自定义选择) 与 [CLI](../cli/README.md#实验选择器怎样求值)。

## 位置参数(选择器)

- [选择器 + `--dry`:几十个实验里只跑要跑的,先看清计划再花钱](selection-dry-preview.md)

## 输出形态(`--json`)

### `--json`

同一个 `--json` 服务两类消费者，但两者需要的流程不同：

| 目标 | 用例 |
|---|---|
| 让 coding agent 驱动运行、读失败、修改与复验 | [AI 修复循环](machine-output-ai-fix-loop.md) |
| 让 CI 根据退出码门禁并归档结构化结果 | [CI 门禁](machine-output-ci-gate.md) |

输出事件词表与流边界见[Experiments CLI](../cli/README.md#机器怎么读--json)。

## 调度

- [`--budget`:一批长跑实验,给烧钱装安全网](budget-limit.md)
- [`--max-concurrency`:本地资源耗尽或 provider 限流,收并发](concurrency-max-global.md)

## 判定

- [`--early-exit`:只想知道能不能做到,不为通过率分布跑满](early-exit.md)

## 缓存

### 缓存与 Attempt 采用

先按改动对象选择场景。
指纹输入的穷尽清单仍以[缓存契约](../architecture/cache.md)为准。

| 改了什么或想做什么 | 用例 |
|---|---|
| Eval、共享模块或数据集 | [修改评测源码](cache-modify-eval-source.md) |
| flags、模型或裁判模型 | [修改运行条件](cache-modify-runtime-condition.md) |
| labels、注释或格式 | [修改非运行元数据](cache-modify-non-runtime-metadata.md) |
| 每轮变化的实例地址 | [留存运行时坐标](cache-retain-runtime-coordinate.md) |
| 审阅后采用单条、整 Run 或已改名实验的历史结果 | [审阅后采用历史结果](cache-adopt-migrated-config.md) |
| timeout 或 Attempt 数量 | [修改执行范围](cache-modify-execution-scope.md) |
| Sandbox 起点、镜像或准备命令 | [修改Sandbox起点](cache-modify-sandbox-origin.md) |
| 升级 NiceEval 本身 | [升级 NiceEval 后沿用已有结果](cache-niceeval-upgrade.md) |
| Agent CLI、被测服务或工厂内部参数 | [外部行为发生变化](cache-external-behavior-change.md) |
| 指纹没变但就是要重验 | [主动重新运行](cache-explicit-rerun.md) |

### `--rerun`

默认情况下，指纹未变的 `passed` 与 `failed` 都会沿用；`errored`、`skipped` 和缺失序号会执行。

| 目标 | 用例 |
|---|---|
| 修复了被测对象，只重新验证旧失败 | [复验失败项](rerun-failures.md) |
| 外部依赖变化，旧的 passed Attempt 也不可信 | [全量重验](rerun-all.md) |
| 声明式 callback 的实现变化，但 identity 没有同步变化 | [全量重验](rerun-all.md#声明式-callback-漏改-identity) |

`--rerun` 是 `--rerun failed` 的简写；`--rerun all` 不自动采用任何历史 Attempt。
两档都是一次性运行口径，不改变指纹定义。
完整契约见[缓存与 Attempt 采用](../architecture/cache.md)。

## 对比怎么计分

通过制 eval(`defineEval`)读 Verdict 的通过率；计分制 eval(`defineScoreEval`)同时读取 Verdict 与 sealed Assertions score facts 的 earned score。
两种 Eval 都保留四态 Verdict；Score Eval 另显示 complete、partial 或 unavailable。`failed + complete` 保留 earned score，但不是成功结果且不进入成功排名。
两种题型拆成两个 Experiment；一次实际选择混型会在启动前失败。
「死在哪层」「部分完成」「质量差」各有下钻读法,契约见[计分粒度](../../assertions/library/score-points.md)。

<!-- concord.use-case-index/v1:start -->
## Use Case 索引（生成）

- [`--budget`:一批长跑实验,给烧钱装安全网](budget-limit.md)
- [审阅后采用历史结果](cache-adopt-migrated-config.md)
- [指纹未变时主动重新运行](cache-explicit-rerun.md)
- [Agent 或外部服务变化后重验](cache-external-behavior-change.md)
- [修改评测源码后只重跑受影响项](cache-modify-eval-source.md)
- [修改 timeout 或 Attempt 数量](cache-modify-execution-scope.md)
- [修改非运行元数据不重跑](cache-modify-non-runtime-metadata.md)
- [修改运行条件后执行新的 Attempt](cache-modify-runtime-condition.md)
- [修改 Sandbox 起点](cache-modify-sandbox-origin.md)
- [升级 NiceEval 后沿用已有结果](cache-niceeval-upgrade.md)
- [留存每轮变化的运行时坐标](cache-retain-runtime-coordinate.md)
- [让 Eval 按固定顺序执行](concurrency-fixed-order.md)
- [独立 Eval 使用默认并发](concurrency-independent-evals.md)
- [并发下隔离每个 Sandbox 的状态](concurrency-isolate-hook-state.md)
- [`--max-concurrency`:本地资源耗尽或 provider 限流,收并发](concurrency-max-global.md)
- [只限制撞限额的 Experiment](concurrency-max-per-experiment.md)
- [快慢 Experiment 交给调度器混跑](concurrency-mix-fast-slow.md)
- [并行 Invocation 独立发布 Run](concurrency-parallel-invocations.md)
- [恢复中断运行留下的协调状态](concurrency-resume-interrupted-run.md)
- [串行保护共享状态](concurrency-serialize-shared-state.md)
- [让重复运行严格按顺序发生](concurrency-strict-retry-order.md)
- [`--early-exit`:只想知道能不能做到,不为通过率分布跑满](early-exit.md)
- [把重依赖烘进镜像](lifecycle-bake-dependencies.md)
- [配置 Sandbox 准备命令](lifecycle-configure-sandbox-prep.md)
- [用外部编排管理长生命周期资源](lifecycle-external-long-lived-resource.md)
- [启动实验级共享服务](lifecycle-shared-services.md)
- [准备任务 Fixture](lifecycle-task-fixture.md)
- [`--json`：让 coding agent 跑、查、改、复验](machine-output-ai-fix-loop.md)
- [CI 门禁:退出码、JUnit 与人读日志](machine-output-ci-gate.md)
- [用 flags 声明运行条件](observations-declare-flags.md)
- [用 labels 标注报告坐标](observations-label-report.md)
- [上报运行时观测](observations-report-runtime.md)
- [按角色区分条件与运行时观测](observations-separate-conditions.md)
- [外部条件变化后全量重验](rerun-all.md)
- [修复被测对象后只复验失败项](rerun-failures.md)
- [按路径前缀选择 Eval](selection-by-path-prefix.md)
- [按标签或运行时要求选择 Eval](selection-by-tags.md)
- [选择器 + `--dry`:几十个实验里只跑要跑的,先看清计划再花钱](selection-dry-preview.md)
- [列出已发现的 Eval](selection-list-evals.md)
- [先列出 Experiment，再选择运行范围](selection-list-experiments.md)
- [拆开通过制与计分制 Eval](selection-split-eval-kinds.md)
<!-- concord.use-case-index/v1:end -->
