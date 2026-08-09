# Concepts

什么时候读这一篇:

- 你碰到一个不认识的 niceeval 术语;
- 你在写文档 / 代码,想跟现有用法保持一致;
- 你需要一页纸把整套词汇过一遍。

这是一份按功能分组的术语表:每张表对齐中文写法、英文写法、一句话含义和唯一契约;完整语义只写在契约列所链文档,不在本页重复展开。
末尾的[禁用写法](#禁用写法)登记已裁决不许再出现的词。
两个同义词并存时,**首选写法**用粗体。

总表里的中文名和英文名都是正文首选写法。
代码标识与标准术语不同时,英文列把代码标识放在括号里,正文叙事使用标准术语,代码示例仍使用代码标识。

由具体功能产生的正式词条,契约列必须链接定义它的 Feature 契约。
Roadmap 提出的候选原语单列在「候选术语」,链接 Roadmap 入口;设计定稿后移入对应功能分组,设计否决时同批删除。

## 术语总表

「中文」列是中文正文里的写法——很多词的首选写法就是英文原词,此时两列相同;有中文同义词的一并列出。「含义」只压到一句话,完整契约只看「契约」列所链文档。

### 产品

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| NiceEval | NiceEval | 产品名。正文写 `NiceEval`;命令、包名、配置文件、代码标识写 `niceeval` | 本页 |

### 评测用例

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 评测用例 | Eval | 一个 Task 跑在一个 Agent 上,由若干 Assertion 评判;id 从文件路径推导 | [Eval](feature/eval/README.md) |
| 任务 | Task | 要让被测对象完成的"那件事",写成一串 `t.send(...)`;只描述意图,不描述判分 | [Eval](feature/eval/README.md) |
| Fixture | Fixture | 第一次 `send` 前通过普通 Sandbox API 写入的起始素材,加 Eval layer `prepare()` 准备的内容;算 eval 归因,不进 agent diff | [Eval](feature/eval/README.md#defineeval-的形状) |
| 本地传输清单 | transfer manifest | 普通本地上传实际读取的 source tree、内容摘要、Sandbox 目标与 send 区间;由 Runner 自动写入 | [本地测试文件](feature/eval/use-case/criteria-files.md) |
| send 区间 | send window | 一次逻辑 `t.send()` 从发出到最终 settle 的区间,包含全部物理重试与静止确认;Sandbox diff 只反映各 send 区间内改动的并集 | [Agent contract](feature/adapters/architecture/agent-contract.md) |
| 测试集 | Dataset | 共享同一 `test` 逻辑、只有输入不同的一组 case,`.map` 从输入数组生成多条 eval,id 零填充编号 | [Dataset fan-out](feature/eval/use-case/dataset-fanout.md) |
| 发现 | Discovery | 扫 `evals/` 找 `*.eval.ts` / `*.eval.tsx` 与目录入口 `eval.ts`,按路径推导 id;同 id 双入口报重名 | [Eval](feature/eval/README.md) |
| Attempt | Attempt | 一个 Run 中某个 Eval 的一次独立执行;拥有自己的生命周期、Assertion 与 Verdict,重复序号为 i | [Eval context](feature/eval/library/context.md) |
| Agent Session | Agent Session(`Session`) | Attempt 内的一条对话线;`t.newSession()` 创建独立 Agent Session | [Eval context](feature/eval/library/context.md) |
| Turn | Turn | `t.send()` 取得可信协议终态时的返回值；`failed` 是可评分领域失败，不表示进程异常 | [Eval context](feature/eval/library/context.md) |

### Assertions、Judge 与 Verdict

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 断言 | Assertion | 对结果、行为、证据或资源使用提出的一项可写入的检查;产出 0–1 分数或 `unavailable` | [Assertions](./feature/assertions/README.md) |
| 判定 | Verdict | Attempt-owned `niceeval.verdict` 文档中的四态值：`passed` / `failed` / `errored` / `skipped`；不是 Attempt lifecycle state | [Severity 与 Verdict](./feature/verdict/architecture.md) |
| 严重度 | Severity | gate 不过即 `failed`;soft 默认不改判定,`--strict` 下才计入 | [Severity 与 Verdict](./feature/verdict/architecture.md) |
| Judge 断言 | LLM-judged assertion | 把材料和 rubric 交给裁判模型求分的 Assertion;默认 soft、无阈值 | [LLM-as-a-judge](./feature/judge/library.md) |
| 判分预检 | Judge precheck | 派发前对判分端点的最小探测;失败只作废含 Judge 断言的 Eval,不拦整次运行 | [派发前预检](./feature/judge/library.md#派发前预检) |
| 断言范围 | Assertion scope | `t.*` 看 Attempt、`session.*` 看 Agent Session、`turn.*` 看 Turn 已发生的事件 | [Scopes](./feature/assertions/architecture/scopes.md) |
| 证据完整度 | Channel coverage | 每个通道 descriptor 声明 complete、partial 或 unavailable；reader 另行报告本次 decoding 完整度 | [Record 通道](feature/record/architecture.md#通道目录与文件归属) |

### 计分粒度

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 计分方式 | Evaluation mode | `defineEval` 把整题折叠成一分;`defineScoreEval` 在题内叠加计分项、不声明满分 | [计分粒度](./feature/assertions/library/score-points.md) |
| 计分项 | — | `.points(n)` 让断言贡献分数;`t.score(label, n)` 是直接计分出口 | [计分粒度](./feature/assertions/library/score-points.md) |

### Agent 与 Adapter

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Agent | Agent | 「一条连到 AI 的连接」的抽象；`kind` 只有 `"direct"` 和 `"sandbox"` | [Adapters](feature/adapters/README.md) |
| Direct Agent | Direct Agent (`defineAgent`) | runner 直接调用函数、SDK 或服务端点；不创建也不伪造 Sandbox | [Direct Agent](feature/adapters/library/direct-agent.md) |
| Sandbox Agent | Sandbox Agent | runner 创建 Sandbox，并把真实 Sandbox 交给 Adapter 驱动 CLI | [Sandbox Agent](feature/adapters/library/sandbox-agent.md) |
| 适配器 | Adapter | Agent 的具体实现;拥有协议、认证、CLI 参数与 transcript 位置等特殊性 | [Adapters](feature/adapters/README.md) |
| `send` | `send` | 运行器认得的统一动词;协议、事件映射与会话续接都由 Adapter 实现 | [Agent contract](feature/adapters/architecture/agent-contract.md) |
| send 执行失败 | SendFailure | Adapter 无法返回可信 Turn 时 reject 的结构化 envelope；携带 `acceptance`，最终落 `agent-send-failed` | [Error classification](feature/error-classification/architecture.md) |
| 能力 | Capability | `t` 暴露哪些动作由 `send` 的构造证据决定,不是声明式能力位 | [Agent contract](feature/adapters/architecture/agent-contract.md) |
| 接入等级 | Integration tier | Tier 1 只接 `send`,Tier 2 再接 OTel,Tier 3 再暴露实验 flags | [Adapters](feature/adapters/README.md) |
| 无侵入 | Non-intrusive | Tier 1 / Tier 2 不由 eval spawn 应用进程或另开端口;不写 `黑盒` | [Adapters](feature/adapters/README.md) |
| 人工介入 | HITL(human-in-the-loop) | agent 等待人工输入;`waiting` + `input.requested` 构成能力证据 | [Sessions 与 HITL](feature/adapters/library/sessions-and-hitl.md) |
| Agent Ensure | Agent Ensure | Runner 在 `agent.ensure` 相位执行的 ensure 循环:Adapter 的 探测 未命中时由 Agent 安装层 install,装后复检 | [Agent Ensure](feature/adapters/architecture/agent-ensure.md) |
| Adapter 的 ensure 声明(`AgentEnsure`) | AgentEnsure | Adapter 对自己 CLI 的目标 identity 与只读 探测;纯适配器在 Sandbox 内只保留这一份声明 | [Agent Ensure](feature/adapters/architecture/agent-ensure.md) |
| Agent 安装层(`AgentInstaller`) | AgentInstaller | 官方按 ensure identity 配对的安装实现;拥有 staged payload、平台探测与安装模式 | [Agent Ensure](feature/adapters/architecture/agent-ensure.md) |
| staged payload | staged payload | 题面网络之外准备、经主 Sandbox 文件 API 送入的一组版本锁定安装文件;归 Agent 安装层 | [Agent Ensure](feature/adapters/architecture/agent-ensure.md) |

### Sandbox

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Sandbox | Sandbox | Agent 与测试实际执行命令、读写文件的隔离运行空间及其操作句柄 | [Sandbox](feature/sandbox/README.md) |
| Sandbox layer | SandboxLayer | Eval 或 Experiment 对同一主 Sandbox 的作者声明,分 template-bearing 与 command-only 两种形态 | [Sandbox Layer](feature/sandbox/layers.md) |
| Provider | Provider | Sandbox 的具体实现选择,由内置或自定义工厂显式构造 | [Sandbox library](feature/sandbox/library.md) |
| 工作目录 | workdir | Sandbox 内 agent 的默认工作目录,也是变更分类账与 agent diff 的参照点 | [Sandbox library](feature/sandbox/library.md) |
| Sandbox 操作协议 | SandboxOperations | `Sandbox`、`EvalSandbox` 与 `SandboxCommandTarget` 共用的命令、文本与字节操作；同名方法同语义 | [Sandbox operations](feature/sandbox/library/operations.md) |
| `t.sandbox` | EvalSandbox (`t.sandbox`) | 沙箱型 eval 的文件 IO、宿主传输、命令执行、断言与 diff 接口 | [Sandbox operations](feature/sandbox/library/operations.md) |
| 变更分类账 | Change ledger | runner 私有的 git 分类账;只把参照点之后的改动放进 agent 归因视图 | [Sandbox architecture](feature/sandbox/architecture.md) |
| Sandbox template | SandboxTemplate | 同时选择 Provider 并由其启动完整 Sandbox 实例的唯一起点；可以是 Compose、Dockerfile、image、E2B template 或 snapshot | [Sandbox Layer](feature/sandbox/layers.md#template-bearing-factory) |
| Sandbox 实例 | Sandbox instance | Provider 启动的主 Sandbox；存在 sidecar、网络或服务时，同时点名这些伴随资源 | [Sandbox 实例与伴随资源](feature/sandbox/case.md) |
| 主 Sandbox | —(`workspaceService` 对应实例) | Provider 启动的唯一执行空间;Agent、Eval、文件 API、workdir 与 diff 都锚定它 | [Sandbox 实例与伴随资源](feature/sandbox/case.md#主-sandbox-不变量) |
| BuildKey | BuildKey | 一次 Provider 构建的输入身份,用于复用 Docker image 或 E2B template 构建结果 | [Sandbox 实例与伴随资源](feature/sandbox/case.md#buildkey-与-casekey两个身份各管一件事) |
| CaseKey | CaseKey | 完整 attempt 运行条件身份,携带门的判据 | [Sandbox 实例与伴随资源](feature/sandbox/case.md#buildkey-与-casekey两个身份各管一件事) |
| Sandbox 留存能力 | SandboxRetention | Provider 返回的独立能力句柄；主实例与伴随资源同时 suspend，跨进程由 detached provider inspect / wake / destroy | [Sandbox 实例与伴随资源](feature/sandbox/case.md#收尾留存与注册表) |

### Sandbox stack

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| template owner | template owner | 为当前配对提供 template 的 Eval 或 Experiment owner;它的 layer 命令先执行 | [Sandbox Layer](feature/sandbox/layers.md#顺序与依赖方向) |
| owner stack | owner stack | template owner、另一 owner 与 Agent 在同一主 Sandbox 上的固定准备顺序 | [三方准备时序](feature/sandbox/lifecycle.md) |
| Sandbox command | SandboxCommand | Eval 与 Experiment layer 共用的顺序执行单元；对 Sandbox 的效果只通过命令与文件 API 产生 | [Sandbox Layer](feature/sandbox/layers.md#command-形状与-identity) |
| 探测 | 探测 | 只读探测命令,零副作用;退出码零为命中,非零是未命中而不是失败 | [内置 prepare 命令](feature/sandbox/prepare-commands.md) |
| ensure | ensure | 「探测 → 缺失才 install → 复检」的循环语义;`installTool` 是工具版,`agent.ensure` 相位是 Agent 版 | [内置 prepare 命令](feature/sandbox/prepare-commands.md) |
| 内置 prepare 命令 | —(`checkout` / `installTool`) | 官方提供、自带 探测、缓存与稳定 identity 的 prepare 命令 | [内置 prepare 命令](feature/sandbox/prepare-commands.md) |

### Sandbox 复用

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Prebuilt environment | Prebuilt environment | 预装稳定依赖的 Docker image、E2B template 或 Vercel snapshot,供全新 Sandbox 直接使用 | [Prebuilt environments](feature/sandbox/library/prebuilt-environments.md) |
| Sandbox 预热 | Sandbox prewarming | 计划确定后提前创建即将使用的全新 Sandbox，不改变每 Attempt 的生命周期 | [Runner](runner.md) |
| Sandbox 复用 | Sandbox reuse | Experiment 用 `sandboxReuse: true` 声明多条 Attempt 可以共用 Sandbox | [Sandbox reuse](feature/sandbox/reuse.md) |
| 复用 Sandbox 的题间重置点 | Between-eval reset point for Sandbox reuse | Sandbox 实例就绪后落下的 commit；共用同一 Sandbox 的 Attempt 之间重置回这里,再执行两层 prepare | [Sandbox reuse](feature/sandbox/reuse.md) |
| Sandbox 复用寿命 | Sandbox reuse lifetime | Provider 能保证一个 Sandbox 继续运行的剩余时间，由 `ensureLifetime` 确认或续期 | [Sandbox reuse](feature/sandbox/reuse.md) |
| 收尾预留时间 | Cleanup reserve | 在 Attempt deadline 之外为 Hook 收尾与 Sandbox 销毁保留的内部安全时间 | [Sandbox reuse](feature/sandbox/reuse.md) |

### 实验配置

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 实验 | Experiment | 可签入的运行配置:Agent、model、judge 执行配置、flags、运行次数与预算；不定义 rubric、阈值或其它评分规则 | [Experiments](feature/experiments/README.md) |
| 裁判执行配置 | JudgeConfig | 裁判 model、端点、凭据变量名与超时；可由 Experiment 做 A/B，不包含 rubric 或 severity | [Judge](feature/judge/library.md#模型与鉴权) |
| 实验 flags | Flags | A/B 条件键,经 `ctx.flags` 给 Adapter、`t.flags` 给 eval | [Flags、labels 与 facts](feature/experiments/use-case/实验值归属/) |
| 运行时事实 | Runtime fact | 运行时才知道、由 `ctx.fact()` 写入 owner-local 自定义 JSON document 的值；不进入 eligibility identity 或 Attempt 核心 | [Flags、labels 与 facts](feature/experiments/use-case/实验值归属/) |
| 模型(`model` 字段) | Model | Experiment 为 agent 指定的模型标识;省略则用 agent 原生默认 | [Experiments](feature/experiments/library.md) |
| 推理强度 | Reasoning effort (`reasoningEffort`) | 独立于 `model` 的推理强度档位;归属与 `model` 一致 | [Experiments](feature/experiments/library.md) |
| 首过即停 | EarlyExit | 一个 eval 先过一次即中止其余 Attempt 的策略;配置名 `earlyExit` | [Early exit](feature/experiments/use-case/首过即停.md) |

### 预算护栏

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 实验预算上限 | Per-experiment budget limit | 每个 Experiment 独立计账和封顶,不是 Invocation 的共享总预算 | [Budget](feature/experiments/use-case/预算上限.md) |

### Runner 调度

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 运行器 | Runner | 负责发现、有界并发、重试、缓存与结果交付的调度引擎 | [Runner](runner.md) |
| 生命周期 Hook | Hook | Experiment 与 Agent 层的成对 `setup` / `teardown` 回调;Sandbox 与 Eval 的准备走 layer 的 `prepare()` | [Runner](runner.md) |
| Invocation | Invocation | 一次 CLI 调用的瞬时编排与 live 聚合边界;可打开多个 Run,不进入 Record | [Runner](runner.md) |
| 派发 | Dispatch | 把一个 Attempt 交出去开始执行;排队等待不算派发,停止派发不抢占在飞项 | [Runner](runner.md) |
| 并发位 | Concurrency slot | 全局 `maxConcurrency` 的一个名额,只在 Attempt 真正执行时占用 | [Runner](runner.md) |
| 实验并发限制 | Experiment concurrency limit | `ExperimentDefinition.maxConcurrency` 对本 Invocation 内一个实验的 Attempt 并发限制 | [Max concurrency](feature/experiments/use-case/并发/限制全局并发.md) |
| 有效宽度 | Effective width | 全局并发位和实验并发限制共同允许的同时执行数 | [Runner](runner.md) |
| 调度波次 | Scheduling waves | `ceil(Attempt 数 / 有效宽度)`;波次多的 Run 优先拿并发位 | [Runner](runner.md) |
| 完成状态 | CompletionStatus | 独立于 Verdict 的 `complete` / `incomplete` / `interrupted` 三态 | [Runner](runner.md) |

### 执行失败分类

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| fail-fast | fail-fast | 无声明时按同一 error code 连续复现的 streak 保守停止派发 | [Runner](runner.md) |
| 受理状态 | Send acceptance | `rejected` / `started` / `unknown`；只有可证明的 `rejected` 允许整段重发输入 | [Error classification](feature/error-classification/architecture.md#分类链) |

### 超时与耗时读数

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 超时 | Timeout | Adapter 内层超时加 Runner 外层 Attempt deadline;排队不计入 | [Runner](runner.md) |
| 总耗时 | Elapsed time | 一次 Invocation 从开始到结束经过的时间，包含并行重叠和排队 | [Runner](runner.md) |
| 阶段耗时 | Phase duration | 一个生命周期阶段实际经过的时间，由 Attempt 时间树写入 | [Benchmark](engineering/benchmark/README.md) |

### 缓存与结果沿用

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 输入身份 | Input identity | 带 domain 的 opaque equality token；只有 domain 相同且 value 相等才允许沿用 | [Cache](feature/experiments/cache.md) |
| 结果沿用 | Result carry-forward (`carried`) | 合格的历史 Attempt 直接并入本次 Run、不重跑；`carried` 只写入出处，不是结果状态 | [Cache](feature/experiments/cache.md) |
| 配置身份 | Config identity | 带 domain 的 opaque equality token；配方改变时更换 domain | [Cache](feature/experiments/cache.md) |

### Observability

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Transcript | Transcript | Agent 一次运行的逐事件原始事实,归一化后供消费 | [Events](feature/adapters/architecture/events.md) |
| 标准事件流 | StreamEvent / events | Transcript 或 `send` 返回归一化成的统一事件模型 | [Events](feature/adapters/architecture/events.md) |
| o11y 摘要 | o11y summary | 从标准事件流可重算的行为计数,注入 Sandbox 供行为断言 | [Observability](observability.md) |
| trace 瀑布图 | Trace waterfall | OTLP span 画出的统一时间轨 | [Observability](observability.md) |
| 用量 | Usage | 一次运行的 token 计数 | [Observability](observability.md) |
| 成本 | Cost | 用量经价格表换算的估算金额 `estimatedCostUSD` | [Observability](observability.md) |
| 报告器 | Reporter | 运行中流式消费结果的插件;与运行后的 Report 不同 | [Observability](observability.md) |

### 结果落盘

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Record | Record | `.niceeval/record/` 中可人工编辑的当前数据集；只支持停稳时读写 | [Record](feature/record/README.md) |
| Run | Run | 一个已求值 Experiment 的持久化批次；expected slots 定义分母 | [Record](feature/record/architecture.md) |
| Member | Member | 一个 Run slot 采用 Attempt 的引用；只有 executed、carried、accepted | [Record](feature/record/architecture.md) |
| Attempt | Attempt | 一次实际执行的稳定身份和自己的通道；永远保留 origin | [Record](feature/record/architecture.md) |
| 通道 | Channel | Run 或 Attempt 拥有的一组具名业务数据；领域演进的局部边界 | [Record](feature/record/architecture.md#通道语义与兼容性) |
| 采集完整度 | Collection coverage | producer 对通道实际采集范围的声明：complete、partial 或 unavailable | [Record](feature/record/architecture.md) |
| 解码完整度 | Decode coverage | reader 对已采集通道内容的解码状态；与采集完整度分开 | [Record library](feature/record/library.md#channelread) |
| 通道读取 | `ChannelRead<T>` | read、unavailable、unsupported、invalid 的穷尽联合 | [Record library](feature/record/library.md#channelread) |
| Invocation receipt | `InvocationReceipt` | 只含 Invocation 身份、Run IDs、时间和完成状态的返回值；不落成目录 | [Record library](feature/record/library.md#writer) |
| Attempt 定位符 | AttemptLocator | 完整 128-bit `attemptId` 的 26 字符规范大写 Crockford 编码；CLI 写 `@` 加 26 字符 | [Record](feature/record/architecture.md) |

### 样本选择

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Sample(样本) | Sample | 从明确 Run 或 latest policy 形成的内存选择，保留完整 expected-slot 分母 | [Sample](feature/sample/README.md) |
| 样本状态 | Sample slot state | included、not-recorded、invalid、excluded；四者不能折成空值 | [Sample](feature/sample/library.md#sample-形状) |
| 收窄 | Narrowing | 在既有 Sample 上显式排除范围，不重新读取 Record | [Sample](feature/sample/library.md#构造入口) |

### 报告

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| ReportInput | ReportInput | reader/normalizer 按 ReportPlan 准备的进程内普通值；不落盘、不含 reader | [Reports library](feature/reports/README.md#report-scope-与-reportinput) |
| 报告 | Report | `defineReport` 返回的定义值；只消费 ReportInput | [Reports](feature/reports/README.md) |
| 报告计划 | ReportPlan | 纯函数预先穷举 Calculation、页面、下载及各自 inputs | [Reports library](feature/reports/library.md#reportdefinition-与-reportplan) |
| 计算函数 | Calculation | 声明 required facts、完整度 policy 与分母后，从 ReportInput 产生读数 | [Calculations](feature/reports/README.md) |
| Calculation 完整度 | MetricCompleteness | 读数的 complete/partial、observed、denominator 与 issues | [Reports library](feature/reports/README.md#calculation) |
| 页 | ReportPage | 报告计划中已穷举 route 和输入的呈现单位 | [Reports library](feature/reports/README.md#页面与宿主数据) |
| 静态资产清单 | StaticAssetManifest | 穷举静态站页面、精确 runtime、脚本、样式、字体、worker、WASM、数据和下载 | [Reports library](feature/reports/README.md#staticassetmanifest-与-export) |
| 静态报告 | Static report | 无网络、无源 Record、带精确 runtime 的自包含目录 | [Reports architecture](feature/reports/README.md#自包含静态-export) |
| 有效选择 | Effective selection | 明确 Run 或 latest policy 形成的 Sample，再经 selector 收窄出的成员 | [Sample](feature/sample/README.md) |

### 配置与 CLI

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 严格模式 | Strict mode | `--strict` 下 soft 断言低于阈值改判 `failed`,用于 CI 把质量回归当红灯 | [Verdict CLI](./feature/verdict/cli.md) |
| 预置准备 | —(用普通代码表达) | 跑 agent 前的准备逻辑,按职责分层:layer 的 `prepare()`、Agent Ensure、`test(t)` 普通代码与外部编排；`SandboxAgent.setup` 只连 runtime / 鉴权 | [Sandbox library](feature/sandbox/library.md) |
| CLI flag | CLI flag | 命令行开关(`--strict`、`--report`…);写作时一律带「CLI」限定或写字面 `--xxx`,不与实验 flags 混用 | [CLI](cli.md) |

## 候选术语

以下原语属于已经定稿、等待落地的 Roadmap 契约。

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Agent Judge | Agent Judge | 作为 Assertion evaluator 运行的独立 Agent；调查证据后返回分数、理由与引用，不拥有 Verdict | [Agent-as-Judge](roadmap/agent-as-judge/README.md) |
| Eval 序列 | Sequence (`defineSequence`) | 引用现有 Eval ID，并要求从第一步开始按声明顺序真实执行的文件派生定义 | [有序 Eval 序列](roadmap/ordered-sequences/README.md) |
| Sandbox 复用组 | Sandbox reuse group | `evals/` 中显式声明必须共用一台活跃 Sandbox 的 Eval 集合；选中即生效，组外 Attempt 保持 fresh | [分组 Sandbox 复用](roadmap/sandbox-reuse-groups/README.md) |

## 禁用写法

已裁决不许出现在 `docs/` 正文里的写法登记在[`writing-rules.json`](writing-rules.json) 的 `bannedTerms` 里,不写成表格——这份清单的用途是被脚本读:一条条目带 `term` / `use` / `why` 三个字段,`pnpm lint:docs` 命中时原样打印 `use` 和 `why`,改的人不必回来翻文档。

裁决一个新术语时同批往那份 JSON 加一条:`why` 写清为什么这个词会误导读者,不写"统一一下"。
扫描规则与判定口径见 [`docs/README.md` · 校验与同步](README.md#校验与同步)。

## 相关阅读

- [Architecture](architecture.md) —— 这些名词在模块图里各自的位置。
- [Authoring](feature/eval/README.md) —— Eval / Task / Dataset 怎么写。
- [Assertions](./feature/assertions/README.md) —— 检查、作用域与证据。
- [Judge](./feature/judge/README.md) —— 裁判模型调用与不可用语义。
- [Verdict](./feature/verdict/README.md) —— Severity、严格模式与四态折叠。
