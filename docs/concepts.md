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

### 评估用例

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 评估用例 | Eval | 一个 Task 跑在一个 Agent 上，由已登记的 Assertion 评判；id 从文件路径推导 | [Eval](feature/eval/README.md) |
| 任务 | Task | 要让被测对象完成的"那件事",写成一串 `t.send(...)`;只描述意图,不描述判分 | [Eval](feature/eval/README.md) |
| Fixture | Fixture | 第一次 `send` 前通过普通 Sandbox API 写入的起始素材,加 Eval layer `prepare()` 准备的内容;算 eval 归因,不进 agent diff | [Eval](feature/eval/README.md#defineeval-的形状) |
| 本地传输清单 | transfer manifest | 普通本地上传实际读取的 source tree、内容摘要、Sandbox 目标与 send 区间;由 Runner 自动写入 | [本地测试文件](feature/eval/use-case/criteria-files.md) |
| send 区间 | send window | 一次逻辑 `t.send()` 从发出到最终 settle 的区间,包含全部物理重试与静止确认;Sandbox diff 只反映各 send 区间内改动的并集 | [Agent contract](feature/adapters/architecture/agent-contract.md) |
| 测试集 | Dataset | 共享同一 `test` 逻辑、只有输入不同的一组 case,`.map` 从输入数组生成多条 eval,id 零填充编号 | [Dataset fan-out](feature/eval/use-case/dataset-fanout.md) |
| 发现 | Discovery | 扫 `evals/` 找 `*.eval.ts` / `*.eval.tsx` 与目录入口 `eval.ts`,按路径推导 id;同 id 双入口报重名 | [Eval](feature/eval/README.md) |
| Attempt | Attempt | 一个 Run 中某个 Eval 的一次独立执行；拥有生命周期、Assertion 与按 Eval 类型产生的 Verdict 或 score，重复序号为 i | [Eval context](feature/eval/library/context.md) |
| Agent Session | Agent Session(`Session`) | Attempt 内的一条对话线;`t.newSession()` 创建独立 Agent Session | [Eval context](feature/eval/library/context.md) |
| Turn | Turn | `t.send()` 取得可信协议终态时的返回值；`failed` 是可评分领域失败，不表示进程异常 | [Eval context](feature/eval/library/context.md) |

### Assertion、Judge 与 Verdict

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 断言 | Assertion | 对结果、行为、证据或资源使用提出的一项可写入的检查;产出 0–1 分数或 `unavailable` | [Assertions](./feature/assertions/README.md) |
| 判定 | Verdict | Attempt-owned `niceeval.verdict` 文档中的四态值：`passed` / `failed` / `errored` / `skipped`；不是 Attempt lifecycle state | [Severity 与 Verdict](./feature/verdict/architecture.md) |
| 严重度 | Severity | gate 不过即 `failed`;soft 默认不改判定,`--strict` 下才计入 | [Severity 与 Verdict](./feature/verdict/architecture.md) |
| Judge 断言 | LLM-judged assertion | 把材料和 rubric 交给裁判模型求分的 Assertion;默认 soft、无阈值 | [LLM-as-a-judge](./feature/judge/library.md) |
| 断言范围 | Assertion scope | `t.*` 看 Attempt、`session.*` 看 Agent Session、`turn.*` 看 Turn 已发生的事件 | [Scopes](./feature/assertions/architecture/scopes.md) |
| 证据完整度 | Evidence completeness | Adapter 按 events、actions、messages、usage、status、data 六类声明采集完整性；落盘的 `collection` 表达 complete 或 partial，读取状态与 payload limitation 另由读取层表达 | [Adapter 证据](feature/adapters/architecture/evidence.md) 与 [Assertion 证据](feature/assertions/architecture/evidence.md) |

### Eval grading

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Pass Eval | Pass Eval (`defineEval`) | 以 Boolean condition 折叠 Attempt Verdict 的评测类型；measurement 用 `gate(n)` 才进入 failed | [Assertions](./feature/assertions/README.md#pass-eval) |
| Score Eval | Score Eval (`defineScoreEval`) | 以显式 score contribution 累计正式 score 的评测类型；没有 Attempt Verdict 或总分 | [Score Eval](./feature/assertions/library/score-points.md) |
| 单项贡献分数 | score contribution (`scoreContribution`) | 一个已登记 Assertion 或直接 `t.score(n)` 对 Score Eval 累计 score 的数值贡献 | [Score Eval](./feature/assertions/library/score-points.md#显式贡献) |
| threshold | threshold (`atLeast`) | 把 measurement 与有限 `[0,1]` 下限比较得到局部 Boolean condition；Pass Eval 必须配置它 | [Assertions](./feature/assertions/README.md#pass-eval) |
| authoring stop latch | authoring stop latch | `.orStop()` 触发后拒绝后续 NiceEval 作者 API 登记的 Attempt 内控制状态 | [Assertions](./feature/assertions/README.md#orstop) |

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
| Provider cache | Provider cache | Provider 为后续 Sandbox 保留的 Agent npm tarball、任务构建结果或原生 build cache；不属于结果携带或留存 Sandbox | [Provider Cache Roadmap](roadmap/README.md) |
| 受管 Cache Domain | Managed Cache Domain | 单一 cache backend 的所有权、命中、lease 与回收边界；identity 改变时形成新 Domain | [Provider Cache Architecture](roadmap/README.md) |
| GC 计划 | GcPlan | 对一个受管 Cache Domain 的不可变回收授权预览；apply 只能因事实漂移缩减候选，不能扩大候选 | [Provider Cache CLI](roadmap/README.md) |
| Sandbox 留存能力 | SandboxRetention | Provider 返回的独立能力句柄；主实例与伴随资源同时 suspend，跨进程由 detached provider inspect / wake / destroy | [Sandbox 实例与伴随资源](feature/sandbox/case.md#收尾留存与注册表) |
| Docker storage profile | Docker storage profile | raw DinD显式选择的宿主声明；只证明 Docker data allocation磁盘配额、跨进程准入与强杀恢复 | [Docker 执行配置](feature/sandbox/docker-profiles/README.md) |
| Docker data allocation | Docker data allocation | 每 Attempt独占、带 project quota hard limit的磁盘配额分配；固定挂到 inner `/var/lib/docker`，内部可由预建目录池兑现 | [Docker profile architecture](feature/sandbox/docker-profiles/architecture.md#单容器资源) |

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
| 实验组 | Experiment Group | Experiment 的比较准入边界；具名组由 `experimentId` 第一段形成，根级 Experiment 各自形成单成员组 | [Experiments](feature/experiments/README.md#实验组与可比边界) |
| 裁判执行配置 | JudgeConfig | 裁判 model、端点、凭据变量名与超时；可由 Experiment 做 A/B，不包含 rubric 或 severity | [Judge](feature/judge/library.md#模型与鉴权) |
| 实验 flags | Flags | A/B 条件键,经 `ctx.flags` 给 Adapter、`t.flags` 给 eval | [实验值归属](feature/experiments/use-case/实验值归属/) |
| 运行时观测 | Runtime observation | 运行时才知道、由 producer-owned typed RecordAttachment 保存的值；不自动进入 eligibility identity 或 Attempt Core | [实验值归属](feature/experiments/use-case/实验值归属/) |
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
| 完成状态 | CompletionStatus | Invocation 的 `completed` / `interrupted` / `failed` 完成态，独立于 Verdict；Run 的完成由 `complete` 完成标识决定 | [Runner](runner.md) |

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
| 结果沿用 | Result carry-forward (`carried`) | 合格的历史 Attempt 通过 reference Member 并入本次 Run、不重跑；`carried` 是 actions provenance，不是 Member 或结果状态 | [Cache](feature/experiments/cache.md) |
| 配置身份 | Config identity | 带 domain 的 opaque equality token；配方改变时更换 domain | [Cache](feature/experiments/cache.md) |

### Observability

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Transcript | Transcript | Adapter 的临时逐事件输入；归一后可供本次 Attempt 消费，但不是持久 Record 格式 | [Observability](observability.md) |
| 标准事件流 | StreamEvent / events | Transcript 或 `send` 返回归一化成的临时统一事件模型 | [Events](feature/adapters/architecture/events.md) |
| trace 瀑布图 | Trace waterfall | 从 owner-monotonic timing interval 投影的时间关系；OTLP 只可补充本次采集 | [Observability](observability.md) |
| 用量 | Usage | token bucket、单个 request 或 provider-observed cost 的原子 observation；不是 Attempt 总计 | [Observability](observability.md) |
| 成本 | Cost | provider-observed cost 是事实；价格表估算、FX 与跨币种汇总是 Calculation | [Observability](observability.md) |
| 采集状态 | Collection | 一个已写入 Attachment 的 complete 或 partial 完备度；不是 reader 的 unavailable 或 invalid 状态 | [Observability Attachments](feature/record/architecture/observability-attachments.md) |
| 采集限制 | limitation | partial collection 必有的 closed、非空原因；表达上限、截断、脱敏或采集不足 | [Observability Attachments](feature/record/architecture/observability-attachments.md) |
| owner-local identity | owner-local identity | producer 为 Attachment 内 turn、item、call、command、usage、interval 与 diagnostic mint 的稳定身份 | [Observability Attachments](feature/record/architecture/observability-attachments.md) |
| Source receipt | Source receipt | 一个 capture authority 在真实边界产生的已归一、脱敏且不可变事实 segment | [Observability Source receipts](feature/record/architecture/observability-attachments.md) |
| 报告器 | Reporter | 运行中流式消费结果的插件;与运行后的 Report 不同 | [Observability](observability.md) |

### 结果落盘

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Record | Record | `.niceeval/record/record.sqlite` 中只由 Record Host 解释的 operational facts；可搬运的 sealed facts 必须是 `RecordSnapshot` | [Record](feature/record/README.md) |
| Coordination SDK | Coordination SDK | execution claim、session 与 gate 位于项目 `.niceeval/`；Record 的 read / append / maintenance lease 位于 `.niceeval/coordination/records/<recordKey>/`（custom Record 位于其 parent 的同形目录），均不进入 portable Record | [三层总览](feature/record-report/README.md) |
| Record 宿主 SDK | `RecordHostSDK` | 由 `makeRecordHost({ records })` 冻结 contributions，并提供 `openRead()`、`createRun()`、`createReferenceRun()` 与 `maintenance()` 的窄宿主能力 | [Record Library](feature/record/library.md) |
| Record 读取会话 | `RecordReadSession` | Scope-bound 惰性 reader；先选择已封口 Run，再按需读取和验证 Run、Attempt、Attachment 或 blob | [Record Library](feature/record/library.md) |
| Record 选择 | `RecordSelection` | 一次扫描后固定的 Run、Slot、预期分母与问题；不含完整 payload，也不携带 reader | [Record Library](feature/record/library.md) |
| Run 写会话 | `RunWriteSession` | 只创建并封口一个新 RunId 的 Scope-bound 能力；Attempt / Run owner 通过窄 `record.write` 做 create-once staging mutation，不把 writer 暴露给普通 Eval `TestContext` | [Record Library](feature/record/library.md#owner-scoped-writer) |
| Attempt 写会话 | `AttemptWriteSession` | 由 Host 创建并交给 capture producer 的 Attempt-owned 能力；提供 rich `record.write` 与简单 collection 的 `record.start` / `record.append`，普通 Eval `TestContext`、Adapter 和 Plugin 不取得它 | [Record Library](feature/record/library.md#owner-scoped-writer) |
| Run | Run | 一个带完成标识的 immutable 运行单位；expected SlotId 定义分析分母 | [Record Architecture](feature/record/architecture.md) |
| 执行槽位 | Slot | Run 在调度前展开的一个预期位置；最多对应一个 Member，并作为分析分母。它不是并发位，默认 Human CLI 也不把它作为列名展示 | [Record Architecture](feature/record/architecture.md) |
| Run 完成标识 | Run completion marker | writer 在内容校验与刷盘后最后排他创建的 zero-byte `complete`，是 Run 对 reader 可见的发布点 | [Record Architecture](feature/record/architecture.md) |
| Seal manifest | Seal manifest | 与 `complete` 在同一次原子目录发布中出现、穷尽 Core、Attachment envelope 与 content object 的 canonical portable inventory | [Record Architecture](feature/record/architecture.md) |
| 未完成 Run | Incomplete Run | 缺少规范零字节普通文件 `complete` 的目录；不是已发布事实，只能由取得独占维护 lease 的 `niceeval clean` 删除 | [Record CLI](feature/record/cli.md) |
| Member | Member | 一个 Slot 对精确 Attempt 的引用；不复制 Attempt，也不保存采用原因 | [Record Architecture](feature/record/architecture.md) |
| Attempt | Attempt | 一次实际执行的稳定身份；只存放在 origin Run，后续 Run 可以精确引用 | [Record Architecture](feature/record/architecture.md) |
| Record 附件 | `RecordAttachment` | Run 或 Attempt owner 下由 branded family definition 解释的 immutable logical value 与 owner-local content closure | [Record Architecture](feature/record/architecture.md) |
| Record definition | callable nominal definition | `defineAttemptRecord` / `defineRunRecord` 返回的 rich logical value 定义；既构造惰性 write command，也是 reader selector、reference target 与 Host `RecordContribution` | [Record Library](feature/record/library.md#high-level-record-definition) |
| Attempt Record collection | Attempt Record collection (`defineAttemptRecordCollection`) | 一个 Attempt owner 下由 Host/capture producer 多次 append、并在 Attempt complete 时封成单一 RecordAttachment logical value 的简单 plain-data 集合 | [Record Library](feature/record/library.md#attempt-record-collection) |
| Record write command | Record write command | 交给 matching owner `record.write()` 的惰性 command；callback、Stream 与 I/O 只在 owner session 执行，成功 `void` 只表示 staging mutation | [Record Library](feature/record/library.md#owner-scoped-writer) |
| Record contribution | `RecordContribution` | `makeRecordHost({ records })` 的唯一成员形态；高层 definition 直接贡献，底层 persistence 经 adapter 贡献 | [Record Library](feature/record/library.md#catalog-与显式-composition) |
| Record 附件定义 | `RecordAttachmentDefinition` | 底层 SPI 中描述 owner/family current logical fact 的 nominal definition；包含 current Schema 与 named validate，不包含 revision 或 migration | [Record Library](feature/record/library.md#low-level-attachment-persistence-spi) |
| Attachment persistence | `RecordAttachmentPersistence` | 底层 SPI 中把 exact Record 附件定义绑定到 current revision 与严格相邻私有 migration 链的值；须经 adapter 才成为 Host contribution | [Record Library](feature/record/library.md#low-level-attachment-persistence-spi) |
| Attachment persistence revision | `RecordAttachmentPersistence.revision` | 同一 owner/family 持久化解释规则的正整数修订号；高层新 family 自动为 `1`，既不属于 Record root、logical definition 或 NiceEval 包版本，也没有高层 revise API | [Record Library](feature/record/library.md#low-level-attachment-persistence-spi) |
| Record migration plan | `RecordMigrationPlan` | 对格式、sealed Run inventory、session catalog 与可用相邻步骤做只读预检后形成的 opaque plan | [Record Library](feature/record/library.md) |
| 源码快照 | Sources snapshot | origin Run-owned `niceeval.sources` current logical fact；保存当时 source closure 的 logical tokens 与 own content | [Record Architecture](feature/record/architecture.md) |
| 源码项 | source item | Sources snapshot 中由 `SourceItemId`、canonical project-relative path、SHA-256 与 own content 标识的一项源码 | [Record Architecture](feature/record/architecture.md) |
| 未映射 | `unmapped` | 可读 Assertion 没有可用 source navigation；不改变 Assertion、Verdict 或 Score | [Source sites](feature/assertions/architecture/source-sites.md#局部-unmapped-与-assertion-隔离) |
| Invocation receipt | `InvocationReceipt` | 只含 Invocation 身份、Run IDs、时间和完成状态的进程返回值 | [Record Library](feature/record/library.md#write-session) |
| Attempt 定位符 | AttemptLocator | 完整 `attemptId` 的确定性人读别名：`@1` 加 SHA-256 前 60 bit 的 12 字符规范大写 Crockford 编码；碰撞时返回 `ambiguous` | [Record](feature/record/architecture.md) |

### Inspection 与执行沿用

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Inspection operation | Inspection operation | NiceEval 第一方维护的具名读取问题，拥有穷尽 request、result 与错误 union | [Inspection Architecture](feature/reports/architecture.md#operation-与选择) |
| Inspection result | Inspection result | 在 frozen Record view 上关闭 selection、分母、missing、issues 与 Evidence 的 plain-data 结果 | [Inspection Architecture](feature/reports/architecture.md#operation-与选择) |
| Sealed cutoff | sealed cutoff | 一次 operation 固定的已发布 Run 可见边界；Delivery 不得越过它补读事实 | [Inspection Architecture](feature/reports/architecture.md#operation-与选择) |
| Selection audit | selection audit | 结果随附的选择依据、成员与排除说明；不是数据库 cursor 或文件位置 | [Inspection CLI](feature/reports/cli.md#progressive-discovery-与有界结果) |
| Record snapshot | `RecordSnapshot` | Host 生成并验证的 sealed-only 可移植 Record；不同于 operational database 与 reader capability | [Record Architecture](feature/record/architecture.md#recordsnapshotcopy-与-hostile-input) |
| 执行沿用计划 | `ExecutionReusePlan` | reuse policy 把当前 `ExecutionTarget` 的每个 Slot 穷尽判为 reuse 或 gap | [Cache](feature/experiments/cache.md#公开形状) |
| 执行缺口 | Execution gap | 当前目标中没有可复用 Attempt、必须交给 planner/scheduler 执行的 slot；不是 Record 状态 | [Cache](feature/experiments/cache.md#错误与缺口作用域) |

### 结果交付（设计目标）

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| Insight | Insight | NiceEval 自己维护、供用户排查运行与证据的固定本地界面；不是网页作者平台 | [Inspection](feature/reports/README.md) |
| Insight revision | `InsightRevision` | 一个 Insight 进程的 active 数据版本；完整刷新成功后才原子切换 | [Inspection Architecture](feature/reports/architecture.md#insight-revision) |

### 配置与 CLI

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 预置准备 | —(用普通代码表达) | 跑 agent 前的准备逻辑,按职责分层:layer 的 `prepare()`、Agent Ensure、`test(t)` 普通代码与外部编排；`SandboxAgent.setup` 只连 runtime / 鉴权 | [Sandbox library](feature/sandbox/library.md) |
| CLI flag | CLI flag | 命令行开关（如 `--model`）；写作时一律带「CLI」限定或写字面 `--xxx`，不与实验 flags 混用 | [CLI](cli.md) |

## 候选术语

以下原语属于已经定稿、等待落地的 Roadmap 契约。

| 中文 | English | 含义 | 契约 |
|---|---|---|---|
| 可重评分 Eval | Replayable Eval | 用独立 execution 与 grading definition 保存完整多轮证据，并允许只对 sealed Execution graph 重新评分 | [可重评分 Eval](roadmap/replayable-grading/README.md) |
| Execution graph | Execution graph | 保存一次 replayable Agent 执行的 Session、Turn、Action、显式材料、provenance 与 ExecutionOutcome 的 sealed semantic source graph | [Replayable Architecture](roadmap/replayable-grading/architecture.md#execution-source) |
| Grading | Grading | 当前 GradingDefinition 对一份 sealed Execution graph 复用或产生 Judge Evaluation，再建立不可变 Grading Claim | [Replayable Architecture](roadmap/replayable-grading/architecture.md#judgeevaluation-与-gradingclaim) |
| GradingRun | GradingRun | 对一个 Experiment Run 已写入 Record 的 SampleManifest 执行或复用全部 Grading 的持久批次 | [Replayable Architecture](roadmap/replayable-grading/architecture.md#gradingrun-与-gradedsample) |
| GradingResult | GradingResult | 单项 Grading 按 pass 或 score evaluation kind 判别的终态，与 ExecutionOutcome 分开保存 | [Replayable Architecture](roadmap/replayable-grading/architecture.md#gradingrun-与-gradedsample) |
| SampleManifest | SampleManifest | 一个 Experiment Run 写入 Record 的候选分母、Execution graph 引用、carry provenance 与 coverage | [Replayable Architecture](roadmap/replayable-grading/architecture.md#gradingrun-与-gradedsample) |
| Judge Material View | Judge Material View | 从受管 Execution 或 Grading definition source 创建、只能绑定到 recipe slot 的私有品牌 Judge 输入句柄 | [Judge Material Library](roadmap/judge-runtimes/material/library.md) |
| Action Result Selector | `ActionResultSelector` | 按 occurrence 或封存动作元数据精确选择 Action result、且不能读取 output 的持久选择器 | [Judge Material Library](roadmap/judge-runtimes/material/library.md#action-result-selector) |
| 材料绑定清单 | `MaterialBindingManifest` | 穷尽保存一次 Judge Check 的 slot 声明、已定位 source、已交付 representation 与授权能力的 canonical manifest | [Judge Material Architecture](roadmap/judge-runtimes/material/architecture.md#materialbindingmanifest) |
| Judge Evaluation | `JudgeEvaluation` | 一次 evaluator occurrence 的 manifest、presentation 或 investigation closure 与 Decision；不拥有 threshold 或 score policy | [Judge Material Architecture](roadmap/judge-runtimes/material/architecture.md#实体与-owner) |
| Pilot 选择 | Pilot selection | 在 attempts 展开前按共同 Eval ID 总体执行 first 或固定 seed sample，并保留 non-final coverage | [Experiment Pilot 抽样](roadmap/experiment-pilot-sampling/README.md) |
| 具名 Experiment 族 | Experiment family (`defineExperiments`) | 用一个 keyed record 展开多个普通 Experiment；文件路径与 key 共同形成稳定 ID | [具名 Experiment 族](roadmap/experiment-authoring/families/README.md) |
| Fixture 内容命令 | Fixture content command (`putFixture`) | 把本地内容登记、digest-backed identity 与 `putContent` 组成一个普通 prepare command | [Fixture 内容命令](roadmap/sandbox-prepare/fixture-content/README.md) |
| Agent Judge | Agent Judge | 作为 Assertion evaluator 运行的独立 Agent；调查证据后返回 measurement、理由与引用，不拥有 Verdict 或 score policy | [Agent Judge](roadmap/judge-runtimes/agent/README.md) |
| Eval Group | Eval Group (`defineEvalGroup`) | 由无业务顺序的 Eval 闭集组成；Runner 按规范化 Eval ID 串行复用一台物理 Sandbox，不同 Group 可以并行 | [Eval Group](feature/eval-groups/README.md) |
| Plugin | Plugin | 挂在 Eval、Experiment 或 Eval Group 上的不可变条件蓝图；组合既有 owner contribution，不选择 Agent 或建立新运行时 | [Plugins](feature/plugins/README.md) |
| 准入健康 | Admission health | 每条 fresh slot 在 Agent 进入前，对 producer occurrence 做一次健康裁决；结果归 Run，不形成 Assertion | [准入健康](roadmap/admission-health/README.md) |
| 状态 Cohort | State cohort | State Provider 颁发身份的一条持久状态 lineage，约束 Checkpoint、Region 与 schema 的共同归属 | [持久状态](roadmap/state/README.md) |
| 状态 Checkpoint | State checkpoint | State cohort 内由 Provider 发布的 immutable exact 状态点；Comparable 状态必须带内容摘要 | [持久状态](roadmap/state/README.md) |
| Eval Trajectory | Eval trajectory | 由源码路径定身份、用显式依赖组成，并能从 exact Checkpoint 跨 immutable Run segment 恢复的 Eval DAG | [Eval Trajectory](roadmap/eval-trajectories/README.md) |
| Workspace 访问证据 | Workspace access evidence | 可信 Sandbox producer 归因给 Agent 进程树的逻辑文件操作集合 | [Workspace 访问证据](roadmap/workspace-access-evidence/README.md) |
| 发现边界 | Discovery boundary | 显式目录入口拥有的递归 Eval discovery 范围；父级扫描在入口处停止向内发现 | [发现边界](roadmap/discovery-boundaries/README.md) |
| 价格配置 | Pricing profile (`PricingProfile`) | 带内容身份与 coverage、只供 Analysis cost Measure 投影成本的价格规则集合 | [CLI / Insight 迁移门](design/cli-insight/DECISION.md#迁移门) |
| Experiment 展示名 | Experiment display name (`displayName`) | 与 description、Experiment identity 分离且不参与 reuse、选择或去重的人类可读标签 | [Experiment 展示名](roadmap/experiment-authoring/display-names/README.md) |
| Record 库存 | Record inventory | 在 frozen Record view 上按 canonical Run ID 枚举的只读库存；不构造 Sample 或推导最新结果 | [Record 库存](roadmap/record-inventory/README.md) |

## 禁用写法

已裁决不许出现在 `docs/` 正文里的写法登记在[`writing-rules.json`](writing-rules.json) 的 `bannedTerms` 里,不写成表格——这份清单的用途是被脚本读:一条条目带 `term` / `use` / `why` 三个字段,`pnpm lint:docs` 命中时原样打印 `use` 和 `why`,改的人不必回来翻文档。

裁决一个新术语时同批往那份 JSON 加一条:`why` 写清为什么这个词会误导读者,不写"统一一下"。
扫描规则与判定口径见 [`docs/README.md` · 校验与同步](README.md#校验与同步)。

## 相关阅读

- [Architecture](architecture.md) —— 这些名词在模块图里各自的位置。
- [Authoring](feature/eval/README.md) —— Eval / Task / Dataset 怎么写。
- [Assertions](./feature/assertions/README.md) —— Assertion、scope、计分与证据。
- [Judge](./feature/judge/README.md) —— 裁判模型调用与不可用语义。
- [Verdict](./feature/verdict/README.md) —— AssertionResult 与执行终态怎样折叠成四态。
