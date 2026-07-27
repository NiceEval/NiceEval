# Record —— 架构

这是磁盘上的 Run / attempt 记录格式规范,也是 `niceeval view` 的离线输入契约;层的分工见
[README](README.md),TS 读写 API 见 [Library](library.md),格式选型的来源见
[参考方案](reference/README.md)。实现入口是 `src/record/writer.ts`(`Artifacts()` reporter 是它
的薄壳);核心持久化类型在 `src/record/`,运行时类型在 `src/types.ts` 的 `EvalResult`、
`StreamEvent`、`TraceSpan`、`O11ySummary` 和 `DiffData`。

## 目录结构

默认输出根目录是 `.niceeval/`。**落盘单位是 Run**(Run = 一个 Experiment 的一次执行水位):实验目录在外层,run 目录在实验目录下。一次 CLI Invocation 可同时打开多个 Run,但它不是持久化实体:格式不保存 `runId` / `invocationId` / Run Manifest,也不保存跨实验成员关系。

```text
.niceeval/
  <experiment>/                      # 实验目录:experimentId 清洗后的名字
    <timestamp>-<suffix>/            # run 目录:时间戳 + 随机后缀,独占创建
      run.json                  # Run 元数据(Run 开始时写入,收尾补 completedAt + Run 诊断)
      sources/                       # Run 级 eval 源码去重仓库,按内容 SHA-256 建档
        <sha256>.json                # { content }:一份源码文本,Run 内多少 attempt 引用它都只存一份
      <evalId>/a<attempt>/           # 单个 eval attempt 的目录
        result.json                  # 判定、断言、用量、locator —— attempt 完成时一次写成
        commands.json                # 非零 Sandbox 命令的 stdout/stderr 证据
        events.json
        sources.json                 # 引用 sources/ 里的条目,不内联源码内容(见下)
        trace.json
        o11y.json
        agent-setup.json              # Skill / Native Plugin / MCP / Python Plugin 安装清单
        diff.json
```

命名与清洗规则:

- **实验目录名**:`experimentId` 里的 `/` 与其它非 `[\w.@-]` 字符替换成 `_`(如 `dev-e2b/codex-e2b` → `dev-e2b_codex-e2b`)。目录名只表达身份与定位;权威的 experimentId 在 `run.json` 的 `experimentId` 字段里,两个不同 id 清洗后撞同一目录名也不影响解析(reader 按字段归组)。
- **run 目录名**:`Date#toISOString()` 把 `:` 与 `.` 换成 `-`,再接 `-<4 位随机后缀>`(如 `2026-07-11T07-29-54-873Z-x1f2`)。
- **attempt 目录**:`evalId` 里的 `/` 保留为目录层级,其它不适合路径的字符替换成 `_`;`a<attempt>` 是第几轮重试。agent、model、实验参数都由所属 Run 钉死,attempt 路径里不出现。

**唯一性由创建方式保证**:run 目录用独占 `mkdir` 创建(目录已存在即失败),撞名时换随机后缀重试。多个 niceeval 进程同时开跑——哪怕同一毫秒、同一个实验——各自拿到各自的 run 目录,任何文件都不会被另一个进程触碰。

**每个文件都只有一个封口时点**:`run.json` 在 Run 开始时写入,收尾时由创建它的进程唯一一次补写 `completedAt` 与 Run 级 `diagnostics`;`result.json` 与各 artifact 文件在对应 attempt 完成时写入。格式里不存在跨 Experiment 聚合文件,所以进程 crash / 被 kill 只丢正在飞的 attempt 与尚未封口的 Run 级诊断——已完成 attempt 的判定和 artifact 都在盘上。某类数据为空就不生成对应 JSON 文件。

## 版本与升级设计

`run.json` 顶层带最小的版本元数据(常量在 `src/record/format.ts` 的 `RECORD_FORMAT` / `RECORD_SCHEMA_VERSION`):

```json
{
  "format": "niceeval.results",
  "schemaVersion": 10,
  "producer": {
    "name": "niceeval",
    "version": "0.12.0"
  },
  "experimentId": "dev-e2b/codex-e2b",
  "agent": "codex",
  "startedAt": "2026-07-11T07:29:54.871Z"
}
```

当前 `schemaVersion` 是 `10`。历史各版本的字段差异与升版原因不在正文维护，记录在 memory 的
results-schema-version-history 条目。读取器不需要这份历史；版本不同一律按下节的不兼容路径处理。

设计原则是**不做兼容机制**。没有迁移函数,没有多版本 normalize loader,没有 per-artifact 版本号:整个 Run(run.json + 全部 attempt 文件)共用顶层这一个 `schemaVersion`。读取器只认与自己相同的版本;版本不同就是不兼容,唯一的处理是提示用写这份结果的 niceeval 版本查看:

```bash
npx niceeval@0.5.4 view .niceeval/2026-07-10T08-00-00-000Z
```

字段规则:

- `format` 必须等于 `"niceeval.results"`。它既避免把其它工具的 JSON 误读成 niceeval,也是版本不匹配时识别「这是一份 niceeval 结果」的依据。
- `schemaVersion` 用整数,只在**破坏兼容读取**时递增。新增可选字段、新增 artifact 文件、新增 `StreamEvent` variant 不递增;读取器必须忽略未知字段和未知 artifact 文件。
- `producer.version` 是写这份结果的 npm package 版本,唯一用途是拼 npx 提示;它不是 schema 判断依据。
- `format` / `schemaVersion` / `producer` 三个字段永久稳定:任何未来版本都不能移动、重命名或改变类型,否则版本不匹配时连 npx 提示都给不出来。历史版本(≤3)把这三个字段放在 run 级 `summary.json` 顶层,读取器据此识别旧落盘并按下节给出提示——这是版本识别,不是迁移。
- attempt 文件保持裸 JSON object/array。`result.json` 是裸对象,`events.json` 是 `StreamEvent[]`,不为塞版本号改成 `{ schemaVersion, data }` envelope;`jq`/`node` 直接读的体验不被打破。
- 不要用目录名表达 schema。实验目录、run 目录和 attempt 目录只表达身份与定位;版本全部在 `run.json` 里,复制、重命名、归档目录不影响解析。

### 版本不匹配时的读取行为

读取器不解析、不迁移、不降级渲染任何版本不同的 Run,行为只分三档:

- **`schemaVersion` 相同**:正常读取渲染。
- **`format === "niceeval.results"` 但 `schemaVersion` 不同**(不论新旧,含历史版本的 `summary.json`):整份落盘视为不兼容。目录扫描时在列表里留一个占位条目,标出目录和 `producer.version`,并提示:

  ```text
  ⚠ .niceeval/2026-07-10T08-00-00-000Z: written by niceeval 0.4.6 (schemaVersion 3);
    this CLI reads schemaVersion 4.
    Run `npx niceeval@0.4.6 view .niceeval/2026-07-10T08-00-00-000Z` to view it.
  ```

  单文件模式 `niceeval view <path>` 指向版本不同的元数据文件时输出同样的提示后退出,而不是报「不是 niceeval 结果」。
- **不能识别**(没有 `format`,也不满足 legacy 的 `results[]` + `startedAt` 启发式):当作无关 JSON 忽略。

实现入口:版本判定只有一份,在 `src/record/format.ts` 的 `classifyRun`(view 经 `openRecord` 消费);目录扫描的占位数据经 `viewData.unreadableRuns` 进前端,由 `src/view/app/App.tsx` 的 incompatible-banner 渲染(三种原因:incompatible-version / malformed / incomplete);单文件模式在 `src/view/data.ts` 抛 `IncompatibleRecordError`,`src/cli.ts` 的 `exitOnViewUserError` 打印提示退出;提示文案是 i18n key `cli.view.incompatible`(niceeval 落盘)与 `cli.view.incompatibleForeign`(第三方 harness,不拼 npx)。

## `run.json`

Run 元数据的家:身份、Run 级字段与版本元数据,**不含任何逐 attempt 数据**。Run 开始时写入;收尾时补写 `completedAt`。

```typescript
interface RunMeta {
  format: "niceeval.results";
  schemaVersion: number;
  producer: { name: string; version?: string; commit?: string };
  /** 权威的实验身份;实验目录名是它的清洗投影。 */
  experimentId: string;
  /** 实验运行配置的可序列化投影,Run 内全部 attempt 共享;字段全集见下方 ExperimentRunInfo。 */
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
  startedAt: string;
  /**
   * 这次运行的配置身份 —— 跨 Run 可比性的唯一判据,输入清单单源在
   * [Experiments · 指纹](../experiments/cache.md#指纹两个哈希嵌套)的配置那一层
   * (读取面怎么用见 [Library · configHash](library.md#confighash配置身份只算一次))。缺失的 Run 只与自己
   * 可比:第三方转换器不声明它时,选择层不把它与别的 Run 拼在一起。
   */
  configHash?: string;
  /** Run 封口时补写;缺失 = Run 未收尾(进程中断),已落盘的 attempt 照常可读。 */
  completedAt?: string;
  /**
   * 属于整个 Experiment Run、无法诚实挂到单个 Attempt 的操作性诊断。
   * 与 completedAt 在同一次 Run 封口补写;例如 experiment-teardown-failed、
   * budget-unenforceable。不得放入跨 Experiment 的 Invocation 汇总。
   */
  diagnostics?: DiagnosticRecord[];
  /** experiment 作用域生命周期代码经 `ctx.fact()` 上报的运行事实;与 completedAt 同批在 Run 封口补写。字段契约见 result.json 的 facts 小节。 */
  facts?: Record<string, string | number | boolean>;
  /** 写入时刻该实验已知的 eval 并集 —— 残缺检测的分母随数据走(publish 自动补记,writer 可声明)。 */
  knownEvalIds?: string[];
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
}
```

`producer.name` 是任意字符串——第三方 harness 经 `niceeval/record` 写入面转换结果时如实署名,`"niceeval"` 只是官方 writer 的取值。

`format` 的取值恒为 `"niceeval.results"`。它是「这是一份 niceeval 落盘」的识别符,不是模块名的
投影:改动它会让所有历史版本连「这东西是谁写的」都认不出来,从而给不出版本提示——而那正是这个
字段永久稳定的全部意义。识别符与模块名各自稳定,互不跟随。

`ExperimentRunInfo` 是**解析后运行配置的穷尽可序列化投影**——记录这次运行实际生效的值,不是原始 `ExperimentDef`(函数与 hooks 本来就无法忠实落盘,存「原样」只能存谎):

```typescript
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface ExperimentRunInfo {
  description?: string;
  reasoningEffort?: string;
  flags?: Record<string, JsonValue>;
  /** 报告归类标注（ExperimentDef.labels 原样投影）；不透传运行时，不进 configHash。 */
  labels?: Record<string, string | number>;
  /** 每条 eval 计划尝试几次 —— 落盘目录 `a<n>` 与 AttemptHandle 的同一个词。 */
  attempts: number;
  earlyExit: boolean;
  timeoutMs?: number;
  budget?: number;
  maxConcurrency?: number;
  /** 是否允许多条 Attempt 共用 Sandbox；进 configHash，省略等价于 false。 */
  sandboxReuse?: boolean;
  /** 本次是否按 `--strict` 判定 soft 断言;进 configHash,因此必须落盘(省略等价于 false)。 */
  strict?: boolean;
  /**
   * Run 级缺省的裁判配置,进 configHash 因此必须落盘;eval 自己声明的那份在它的源码闭包里,不在这。
   * 只落这两个配置值,`apiKeyEnv` 指向的凭据不落。
   */
  judge?: { model?: string; baseUrl?: string };
  /** 本次运行解析后实际选中的 eval id 全集——evals 过滤器(含函数形式)的求值结果,不存过滤器本身。 */
  selectedEvalIds: string[];
  /** evals 过滤器的指纹(数组内容 / 函数体哈希),供「配置没变」判断;与 selectedEvalIds 一起取代原过滤器。 */
  evalFilterFingerprint?: string;
  /** provider 名、provider 的 publicConfig() 投影与配置 fingerprint。 */
  sandbox?: { provider: string; params?: Record<string, JsonValue>; fingerprint?: string };
  /** spec 携带 environments 表时：声明了 environment 的选中 eval 各自解析到的产物投影；键为 eval id。 */
  sandboxByEval?: Record<string, { provider: string; params?: Record<string, JsonValue>; fingerprint?: string }>;
}
```

几条纪律:

- **`model` 与 `agent` 只在 Run 顶层存在**(`run.model` / `run.agent`),`ExperimentRunInfo` 不复制——同一事实两处落盘不是冗余就是漂移;报告的 `runConfig()` 对 `model` / `agent` 两个键桥接到顶层字段,消费方无感(见 [Reports · 维度与数值轴](../reports/library/measures.md#维度与数值轴))。
- **`labels` 是报告元数据**,不进 fingerprint,也不进 `configHash`。`selectedEvalIds` 是这次运行实际选择的 eval 集；报告直接读取它，不从 experiment 路径推断另一层集合。
- **sandbox 参数只经 provider 的 `publicConfig()` 投影落盘**:每个内置 provider 显式实现「哪些参数可发布」的投影(镜像名、模板名、runtime 可以;token、凭据路径永远不可以),`defineSandbox` 自定义 provider 没有提供投影时只落 provider 名。「params 不含 secret」由投影保证,不靠注释承诺。
- **按 eval 解析预制产物时保存逐 eval 结果。** 顶层 `sandbox` 始终是 spec 基础参数的投影；`sandboxByEval` 只记录本 Run 选中且声明了 `environment` 的 eval 各自解析到的产物投影，供审计与逐 eval fingerprint 对账。未声明 environment 的 eval 以顶层 `sandbox` 为准，未选中的 eval 不查表、不伪造映射项；spec 的 `environments` 表不整张落盘——落的是每条 eval 的解析结果。
- 新增公开运行配置字段时必须同步进这张投影,不允许「Run 里有一半配置」。**进
  [configHash](../experiments/cache.md#指纹两个哈希嵌套) 的字段这条是硬约束**:配置身份的每一个输入
  都要在 `run.json` 上找得到,顶层或本投影二选一。`agent` / `model` 住顶层,其余住这里。
  少落一个,就无法拿历史 Run 重算配置身份,搬迁出口那条路径直接失效。

通过数、失败数、总用量、总成本这类聚合**不落盘**:它们由 `result.json` 逐条推导,聚合永远发生在消费方(`openRecord` 分层之上的计算函数或你的脚本)——这与读取面「忠实磁盘,不合并不聚合」是同一条铁律。

## `result.json`

单个 attempt 的**权威记录**:判定、断言、结构化执行错误与 diagnostics 只住在这里。attempt 的 teardown 链与 sandbox stop 完成后一次写成,之后没有任何环节会改写它。

```typescript
interface AttemptRecord {
  /** eval id(attempt 目录路径是它的清洗投影;权威在字段)。 */
  id: string;
  description?: string;
  verdict: "passed" | "failed" | "skipped" | "errored";
  attempt: number;
  fingerprint?: string;
  /** 判定链耗时:从 sandbox.queue 到 telemetry.collect 的主链,不含收尾段(show 以 `teardown +N` 单列;全仓引用这个字段时用「判定链耗时」措辞,不叫墙钟)。 */
  durationMs: number;
  /**
   * 执行耗时:`durationMs` 减去 `sandbox.queue` 那一段,即从 sandbox.create 起算的主链耗时。
   * 与 attempt deadline 同起点、同不含收尾段(见 [Runner · 超时](../../runner.md#超时双层保护)),
   * 因此它是[携带资格判据](../experiments/cache.md#携带资格timeoutms-不进哈希)唯一能与
   * `timeoutMs` 直接比较的量——拿含排队的 `durationMs` 去比会把等过并发位的结果误判成撞过线。
   * 缺失时资格判据回落到 `durationMs`,方向是多跑,不会误采信。
   */
  executionMs?: number;
  /** Runner 阶段计时，按执行顺序；只记录实际发生的阶段。 */
  phases?: PhaseTiming[];
  /** 记录态断言;元素字段契约单独定义在 [Assertions · 断言记录](../assertions/architecture.md#断言记录assertionresult)。 */
  assertions: AssertionResult[];
  /** 题型:`defineEval` → `"pass"`,`defineScoreEval` → `"points"`,定义期事实,与 `EvalDescriptor.scoring` 同源(见 [Experiments](../experiments/README.md#defineexperiment-的形状))。省略等价于 `"pass"`——兼容此字段引入前写入的落盘与未声明它的第三方 harness。 */
  scoring?: "pass" | "points";
  /** `t.score(label, n)` 的直接给分记录;元素字段契约见 [Assertions · 断言记录](../assertions/architecture.md#断言记录assertionresult)。只在 `scoring: "points"` 时出现,省略等价于空数组。 */
  scoreEntries?: ScoreEntry[];
  /** 证据覆盖聚合:Agent 声明经各 turn 降级后的最差值,字段契约见 [Adapters · 证据与完整性](../adapters/architecture/evidence.md);省略 = 全通道 unknown(Adapter 未声明),消费侧按保守处理。 */
  coverage?: EvidenceCoverage;
  usage?: Usage;
  /** attempt 作用域生命周期代码经 `ctx.fact()` 上报的运行事实;字段契约见下方 facts 小节。 */
  facts?: Record<string, string | number | boolean>;
  estimatedCostUSD?: number;
  /** 使 attempt 无法正常完成的唯一致命执行错误。 */
  error?: AttemptError;
  /** 不一定改变 verdict、但运行后仍需回顾的有界诊断。 */
  diagnostics?: DiagnosticRecord[];
  skipReason?: string;
  /** 本 attempt 开始的墙钟时刻;缺失时读取面回退 Run 的 startedAt。携带条目保留原条目的值,身份键与去重以它为锚。 */
  startedAt?: string;
  /**
   * 沙箱型 attempt 的执行环境标识:provider 名与实例 id(如 Docker 容器 ID 前缀),用于关联
   * provider 侧日志与[留存现场](../sandbox/cli.md);Direct Agent 无此字段。`kept` 表示
   * 运行收尾时按 `--keep-sandbox` 留存了沙箱;之后的存活状态归 `niceeval sandbox list` 回答,
   * 本记录一次写成、不回写。`reused` 表示所属 Experiment 声明了 `sandboxReuse: true`，
   * 且这条 Attempt 跑在共用的 Sandbox 上；
   * `reuseSandbox` 是本次 Run 内从 1 开始的 Sandbox 编号，
   * `reuseOrdinal` 是该 Sandbox 承接的 Attempt 序号。
   * [出身门](../experiments/cache.md#携带要过的门)读取 `reused`，让复用产出永不成为后续命中。
   */
  sandbox?: {
    provider: string;
    sandboxId: string;
    kept?: true;
    reused?: true;
    reuseSandbox?: number;
    reuseOrdinal?: number;
  };
  /**
   * 不透明的 Attempt 定位符:`@` + 1 位 scheme 字符 + 7 位 base36 body(如 `@1x7f3q9k`)。
   * 由 `{experimentId, Run startedAt, evalId, attempt}` 这个不可变身份元组确定性派生——
   * 不是数组下标、不是磁盘路径。fresh 条目在 attempt 调度前由 runner 算出并贯穿执行、留存登记与落盘;
   * 携带条目(见下)原样复制上一轮的值,从不重算(原 Run 的 startedAt 已经不在本轮 Run 里,
   * 重算会算出不同的字符串)。
   * `niceeval show @<locator>` 与报告 / view 的 attempt 深链都靠它寻址,详见
   * [Library · 按 locator 寻址一个 attempt](library.md#按-locator-寻址一个-attemptresolvelocator)。
   */
  locator?: string;
  /** 携带条目专用: artifact 目录(相对记录根目录),指向原 Run 里的落盘。 */
  artifactBase?: string;
  /**
   * 携带条目专用:这条被携入时,携带判定抹掉了哪些 `flags` 键
   * (见 [Experiments · 搬迁出口](../experiments/cache.md#--carry-ignoring-flag搬迁用的一次性出口))。
   * 条目已按本 Run 口径重打指纹,这个字段是它与本 Run configHash 之间那点差异的唯一记录,
   * 跟着结果走而不是跟着 Run 走;省略等价于「按本 Run 的完整 `flags` 认账」。
   */
  carriedIgnoringFlags?: string[];
  /**
   * writer 实际写出的按需 artifact 词干列表(词表与全部横切属性单源在[证据 registry](#证据-registry),
   * 如 ["commands", "events", "sources"])。省略等价于空列表;携带条目原样携带。读取面的懒加载语义
   * (缺失返回 null)独立成立,本字段只服务「不 stat 磁盘就知道有什么」的消费方。
   */
  artifacts?: string[];
}

/**
 * 生命周期词表——全仓唯一一套。
 * 计时(`phases[].name`)、错误归因(`error.phase`)、诊断归属(`diagnostics[].phase`)、
 * live 展示与 `--json` 事件的 `phase` 字段都使用这同一个闭集,不存在第二套词表。
 * 实验级两员只用于归因(不属于任何单个 attempt,永不出现在 `phases[]` 计时里)。
 */
type LifecyclePhase =
  // 实验级(整场一次,宿主机侧;仅错误/诊断归因)
  | "experiment.setup"     // ExperimentDef.setup;setup 抛错时本实验所有 attempt 的 error.phase
  | "experiment.teardown"  // ExperimentDef.teardown;失败只产生运行级 diagnostic
  // 主链:从排队到 trace collect,覆盖到判定与主证据收集完成,按执行序
  | "sandbox.queue"        // 等待并发信号量(调度等待,唯一不属于某个 owner 的成员)
  | "sandbox.create"       // provider 起沙箱
  | "sandbox.setup"        // SandboxSpec.setup() 生命周期 Hook 链
  | "workspace.baseline"   // 变更分类账锚点(runner 私有 git ledger 首笔 commit)
  | "eval.setup"           // EvalDef.setup
  | "agent.setup"          // Agent.setup(装 CLI、写主配置)
  | "telemetry.configure"  // tracing 出口配置
  | "eval.run"             // 整段 test(t),含所有 send 与手工命令
  | "agent.run"            // 嵌套在 eval.run 内:adapter send 期间打开;只用于错误/诊断归因,不单列计时条目
  | "workspace.diff"       // 从分类账折叠 agent 归因增量
  | "scoring.evaluate"     // 断言 finalize + 判定,含 judge 调用
  | "telemetry.collect"    // OTLP receiver settle / collect
  // 收尾段:无论主链成败都执行,不计入 durationMs 口径,按执行序
  | "eval.teardown"        // EvalDef.teardown
  | "agent.teardown"
  | "sandbox.teardown"     // SandboxSpec.teardown() 生命周期 Hook 链
  | "sandbox.suspend"      // 留存提交后 provider 把现场转入休眠(docker stop / e2b pause);耗时可观(pause 随内存增长),必须可见
  | "sandbox.stop";        // provider 销毁沙箱;与 sandbox.suspend 同一 attempt 互斥

interface PhaseTiming {
  name: LifecyclePhase;
  /** 阶段耗时；失败阶段计到抛错或超时中断时。 */
  durationMs: number;
  /** 该阶段抛错或被超时中断。主链至多一条,其后无主链条目;收尾阶段各自独立标记,不改判定。 */
  failed?: true;
  /** Runner 直接观察到的阶段内时间树;只供单 attempt 诊断,不做跨实验聚合。 */
  children?: TimingNode[];
}

type TimingNodeKind = "hook" | "turn" | "command" | "provider" | "operation";

interface TimingNode {
  /** attempt 内唯一,供 children 与展示层稳定引用;不作为跨 attempt 身份。 */
  id: string;
  kind: TimingNodeKind;
  /**
   * 采集端写入的有界人读标签;hook 匿名时用 setup#<i>/teardown#<i>,turn 用轮标签
   * (主会话 turn<N>,t.newSession() 会话 session<K>/turn<N>,语法单点见 Assertions · Turn 的展示);
   * operation 写逻辑工作及可安全公开的规模摘要。展示层不解析 command 文本来重造 label。
   */
  label: string;
  /** 相对 attempt 单调时钟起点的偏移;并发 sibling 可据此还原重叠,不能只靠数组顺序相加。 */
  startOffsetMs: number;
  durationMs: number;
  failed?: true;
  children?: TimingNode[];

  /** kind=turn 时存在;把 runner 的 send 墙钟包络与 trace.json 中同一轮的 spans 显式关联。 */
  sessionIndex?: number;
  turnIndex?: number;
  turnId?: string;
  traceId?: string;
  traceAttribution?: "traceparent" | "window" | "none";
  /** kind=turn 时存在,该轮 `Turn.usage` 落盘原样(有记录才写),字段契约见上方 Usage 小节。 */
  usage?: Usage;

  /** kind=command 时的有界脱敏摘要;环境变量值与 stdout/stderr 不进入时间树。 */
  command?: {
    display: string;
    exitCode?: number;
  };
}

interface AttemptError {
  /** 稳定、可供 CI/Agent 分支处理的机器码;未知异常使用 "unexpected-error"。 */
  code: string;
  /** 人可读的一层原因,不拼接整份 SDK response。 */
  message: string;
  /** runner 在错误发生时已经打开的生命周期阶段。 */
  phase: LifecyclePhase;
  /** 原异常有 stack 时保留,供 show 展开;终端即时反馈不整段打印。 */
  stack?: string;
  /** 下层 SDK/OS 错误的有限摘要。 */
  cause?: { name?: string; code?: string; message: string };
}

interface DiagnosticRecord {
  code: string;
  level: "warning" | "error";
  /** 现象 + 依据 + 下一步,以下一步收尾;三段式契约见 docs/error-feedback.md。 */
  message: string;
  phase: LifecyclePhase;
  data?: Readonly<Record<string, JsonValue>>;
  /** 有单条能直接推进的命令时给出(已替换真实 id);web 渲染面呈现为可复制动作。 */
  command?: string;
  /** 相同 dedupeKey 折叠后的出现次数;省略等于 1。 */
  count?: number;
}
```

`sandbox` 是可选字段，Direct Attempt 与旧 producer 都可以没有。老读取器按未知字段忽略，
这类新增本身按本页版本规则不递增 `schemaVersion`。词表新增成员同理：消费方把 `phase`
当归因标签渲染，不得因未知成员拒绝记录。

`phases` 缺失表示结果不是由带阶段计时的 runner 产出。数组顺序就是执行顺序；不适用、未定义或没有执行的阶段不写 0 值条目。`eval.teardown` / `agent.teardown` / `sandbox.teardown` / `sandbox.stop` 是收尾段：主链抛错后它们照常执行、照常计时，各自可独立标 `failed`（对应 teardown diagnostic，不改判定），且不计入 `durationMs` 口径——「结果早已确定、收尾还卡着」的耗时因此可归因。结果封口必须发生在 Effect Scope 的 release 完成之后：`sandbox.stop` 与 receiver close 这类 finalizer 也向 attempt 共用的 timing recorder 写入，再由 Scope 外层组装最终 `AttemptRecord`；不能在 body 返回时先封口、事后再尝试修改已写出的结果。

`children` 是 runner 直接观察到的时间树。`sandbox.setup` / `sandbox.teardown` 先按 hook 建节点，hook 内所有经 `Sandbox.runCommand()` / `runShell()` 发出的命令继续挂成 `command` 子节点；同一套包装覆盖 `workspace.baseline`、`eval.setup`、`agent.setup`、`telemetry.configure`、`eval.run` 中 eval 手工命令与 adapter 启动 CLI 的命令、`workspace.diff` 以及各收尾阶段。包装只记录最外层公开调用一次——provider 的 `runCommand` 内部转调 `runShell` 不得形成重复节点。命令摘要截断并脱敏，env 只允许保留 key；非零退出命令的 stdout/stderr 由同一包装写进 `commands.json`，按 `timingNodeId` 与这里的 command 节点关联。成功命令不复制输出，Agent 内部工具命令仍由 `events.json` 承载。

`operation` 是采集端拥有的语义父节点，不是 artifact 携带的自定义 renderer。runner、Sandbox 或 provider 知道某段工作是一个逻辑整体时，在执行边界直接写下稳定语义与有界规模摘要，例如 `export workspace diff · 2 windows · 3,302 files`，并把实际公开 Sandbox command 或 provider step 挂在下面。批量算法必须先在执行层把 provider 往返约束到逻辑批次，再用 operation 表达；不能记录成逐对象远端调用后只在 Reports 折叠。消费方只按 `kind`、树关系、失败、耗时和时序通用渲染，不解析 shell 文本猜测 `git show ×N`，也不执行 artifact 提供的 callback。

`agent.run` 是唯一的嵌套生命周期成员：它在 `eval.run` 内随每次 send 打开，只作为 `error.phase` / `diagnostics[].phase` 的归因值出现，不在 `phases` 里单列。每次 send 由 runner 产生一个 `turn` child，保存本地单调时钟测得的端到端包络以及 session/turn 身份；OTel 接入时再保存 `traceId` 与归属方式。`trace.json` 中的 agent/model/tool spans 不复制进 `children`，消费方按 `traceId` 把它们临时挂到对应 turn 下。这样没有 OTel 时仍有可靠的轮次总耗时，有 OTel 时才展开轮内模型、工具与子 agent 细节。

Experiment `setup` / `teardown` 属于 Run 级生命周期，反馈 phase 可以使用 `experiment.setup` /
`experiment.teardown`，但它们不进入任何单条 Attempt 的 `phases[]`。Run 级 diagnostics 与 facts
在 `run.json` 封口时保存；Attempt timing 不借入整场只执行一次的耗时。

`sandbox.create` 早于 Sandbox 对象存在，不能由 `runCommand` / `runShell` 包装捕获。内置 provider 可以把真实的 SDK 请求、宿主命令或创建步骤写成 `provider` children；第三方 provider 没有提供细分时只保留 `sandbox.create` 合计，不能把 API 调用伪装成 shell 命令。Agent CLI 内部执行的 shell 工具同样不经过 Sandbox 包装，它们来自 `events.json`，耗时只在 OTel span 能唯一关联时提供。

所有 runner duration 使用单调时钟；`startedAt` 单独保留 ISO 墙钟。`startOffsetMs` 只用于同一 attempt 内恢复顺序和重叠，不能拿远端 OTel 的绝对时间与 runner 墙钟硬对齐。父子节点允许嵌套与并发，子节点 duration 不可直接求和后与父节点比较。`result.json` 永远保存完整 runner 时间树；终端默认视图的节点预算只是读取投影，不得回写、裁剪或聚合 artifact。阶段边界、主链 / 收尾两段的 failed 语义、时间树以及安装基准消费方式见 [Phase Timings 与安装基准](../../engineering/benchmark/README.md)；终端的有界/full 两档见 [Show `--timing`](../reports/show/timing.md)，网页入口见 [View](../reports/view.md) 的 Attempt 详情。

`error` 与 `diagnostics` 的 `phase` 都由 runner 在错误 / 诊断发生时按已打开的生命周期阶段绑定,调用方不能自行填写。两者的区别是结果语义:`error` 是让 attempt 进入 `errored` 的致命原因,至多一个;`diagnostics` 是运行仍可继续或收尾时发现的问题,可以与 passed/failed/errored 任一 verdict 共存。`diagnostic.level` 表达消息严重度,不是 verdict 的别名。diagnostic 是 niceeval 的操作性反馈,`message` 与 `command` 遵循[错误与警告反馈](../../error-feedback.md)——message 以下一步收尾,单命令可推进时 `command` 携带该命令;`error` 是被测对象的失败事实,不受该契约约束。

`progress` 文本不写入任何 artifact。它是运行时可覆盖状态,保存每一帧既无法还原可靠因果,也会让高频 SDK/工具进度无限放大结果。事后回顾依靠 `phases`、`error`、`diagnostics` 与可选的 `events.json` / `trace.json`。trace 不是必需兜底:沙箱创建发生在 telemetry 之前,teardown 发生在 trace collect 之后,没有 tracing 的 provider 也必须留下同样完整的错误摘要。

attempt 的结果封口发生在 Effect Scope release 完成之后：teardown 链与 `commitKeepOrStop()` 已结束，销毁路径完成 `sandbox.stop`，留存路径完成 `sandbox.suspend`。随后 `result.json` 与其它 attempt artifacts 原子写入。这样 teardown diagnostic 不会因为主 test 已经返回而丢失。进程在封口前被强杀时,该 attempt 仍属于未完成,不会留下一个伪装完整的 `result.json`。

Run 级字段(`experimentId` / `agent` / `model` / 实验运行配置)不在这里重复——reader 把 `run.json` 的声明拼进每条读回的结果(`attempt.result`),拼合规则是「缺才补」:条目自带的值优先,`startedAt` 只在记录缺失时回退 Run 的值;`locator` 同理「缺才补」,niceeval 自己的 writer 恒会写这个字段,只有第三方 harness 没实现它时读取面才按当前身份兜底算一份。

两类条目:

- **本 Run 跑出的条目**:artifact 与 `result.json` 同目录,不需要任何路径引用字段。
- **携带条目**(运行器默认把上一轮 fingerprint 匹配、判定为终态——passed 或 failed——的结果自动
  携带合入本 Run,让最新 Run 保持完整;`--rerun all` 关闭携带全部重跑,语义见
  [Experiments · 缓存与携带](../experiments/cache.md)):`startedAt` 保留原条目的时刻,另带
  `artifactBase`(相对记录根,指向原 Run 的 attempt 目录),`artifacts` 列表、`facts`、判定、
  `fingerprint` 与证据指向**一律原样携带,没有例外**——携带来的是那一轮真实发生过的事,不按本轮
  改写。一个被改写的历史字段没有任何读者能正确解释:它既不是当初发生的事,也不是本轮观察到的事。

  「条目与配置怎么对上号」不靠 fingerprint 承担:`attempt.run.configHash` 直接给出该条目所在 Run
  的配置身份,读取面不必翻更早的 Run,也不必从指纹反推。常规携带下条目的 `fingerprint` 本就等于
  本 Run 算出的指纹——相等正是携带判据;
  [`--carry-ignoring-flag`](../experiments/cache.md#--carry-ignoring-flag搬迁用的一次性出口)
  放宽判据时两者不等,那时如实保留原值,
  差异本身就是「这条是在别的 flags 下跑出来的」这个事实。

  `artifactBase` 是事实上的「携带」标记,读取面把它连同目标目录是否仍在一起投影成
  [`evidenceState`](library.md#携带条目与-evidencestate) 三态。清理历史 Run 前先用 `publish`
  物化要保留的结果——原 Run 删除后,该条目转为 `dangling`,artifact 懒加载返回 `null`,而
  `artifacts` 列表仍声明写过它们;两者的差值就是「证据丢了」,不与「没采集」混为一谈。
  记录格式版本变化时不携带,理由见 [Library · 跨 schemaVersion 不携带](library.md#携带条目与-evidencestate)。

### Usage

token 用量的落盘形状。每个字段只在协议真实提供该值时存在——与[标准事件模型](../adapters/architecture/events.md)「原始协议没有 usage 时省略,不编造数值」同一条纪律;不存在「默认 0」或「默认 1」的字段:

```typescript
interface Usage {
  /** 未命中缓存、按全价计费的输入 token;与两个 cache 桶互斥。 */
  inputTokens?: number;
  outputTokens?: number;
  /** 从提示缓存命中的输入 token。独立计价桶,不包含在 inputTokens 里。 */
  cacheReadTokens?: number;
  /** 写入提示缓存的输入 token。独立计价桶,不包含在 inputTokens 里。 */
  cacheCreationTokens?: number;
  /** 推理(thinking)token,outputTokens 的已含明细,单列展示用,不参与桶相加。 */
  reasoningTokens?: number;
  /** 真实发生的模型请求数。协议不提供请求计数就省略,绝不写 1 凑数——一个 20 轮 session 报 `requests: 1` 比缺失更有害。 */
  requests?: number;
  /** 网关/协议实测的计费金额(如实转发,不换算)。与顶层 `estimatedCostUSD`(价目表估算)是两个事实:实测存在时消费方优先它(口径见 [Reports 内置读数](../reports/library/measures.md#内置读数) costUSD 行)。 */
  costUSD?: number;
}
```

三个输入侧 token 桶**恒互斥**:`inputTokens + cacheReadTokens + cacheCreationTokens` 相加才是送进模型的完整上下文量。互斥是 adapter 的归一化义务,不是协议的自然属性——Anthropic 系协议原生按互斥计量,如实转发即可;OpenAI 系协议报的是「含缓存命中的输入总量 + 缓存命中子集」,adapter 落值前必须先从输入总量里扣掉子集,扣减结果不小于 0(各协议原生口径与扣减落点见各 adapter 的 cost 文档,索引在 [Adapters SDK](../adapters/sdk/README.md))。选恒互斥而不是「报什么记什么」,因为桶语义只有全局一致,逐桶乘单价相加的[成本估算](../../observability.md#换算成本价格表从哪来)、跨 agent 的用量对比、`t.maxTokens` 的上限判定才是同一个口径:coding agent 会话的缓存命中率常在九成以上,「含缓存总量」与「未缓存量」差一个数量级,两种口径混进同一个公式会把估算成本放大数倍。

「上下文总量」(三个输入桶相加)是消费端派生量,不落盘;`inputTokens` 本身就是未缓存输入。轮数与工具调用数不属于 `Usage`——它们是 `events.json` 的行为派生(与 `o11y.json` 同源),show 的 usage 展示从两处组装(口径单源见 [`UsageTable` 组装口径](../reports/components/attempt-detail/usage-table.md#组装口径单源))。

### facts：运行事实

`facts` 记录生命周期代码主动上报的**运行环境观测**:键值标量,回答「这次实际看到了什么」——记忆库起步有多少条笔记、恢复自哪份 checkpoint、远端服务返回了哪个版本。它是运行后的审计证据，不是配置入口，也不是缓存键。

- **上报通道**:各作用域上下文的 `fact(key, value)`,与 `progress` / `diagnostic` 并列的第三条反馈通道(声明见 [Sandbox hooks](../sandbox/library.md)、[Experiment hooks](../experiments/architecture.md)、[AgentContext](../adapters/architecture/agent-contract.md#agentcontext))。三条通道语义互斥:`progress` 是不落盘的短期状态,`diagnostic` 是需要回顾的异常,`fact` 是中性的环境事实。
- **归属跟随作用域**:sandbox hook、agent setup/teardown、adapter send 上报的进 `AttemptRecord.facts`;experiment setup/teardown 上报的进 `RunMeta.facts`。runner 自动归属,调用方不能指定层级。
- **形状**:key 匹配 `[a-z0-9._-]{1,64}`,value 是 `string | number | boolean` 标量。同一作用域内同 key 后写覆盖先写——fact 是现刻观测,不是追加日志;需要留痕迹的过程用 `diagnostic`。
- **不影响判定与复用**:facts 不参与 verdict、评分或指纹，也不能在携带决策前取得——experiment / sandbox setup 尚未运行时，runner 已经决定哪些 attempt 可以携带。计划内实验条件必须声明在 `flags`、model、agent、sandbox 配置或其它已有 fingerprint 输入中；依赖外部可变状态且无法配置化时用 `--rerun all` 重跑，再用 facts 审计实际状态。把「启用了哪个特性」只写成 fact 会让旧结果在条件变化后被错误携带。
- **运行时坐标的家就是这里**:隧道 / 反向代理 URL、服务端实例地址这类「每次跑都可能换、换了不改变 attempt 里发生什么」的连接坐标,是运行起来才存在的观测,报成 fact——写进 `flags` 会让每一次轮换作废全部已完成结果(整袋 `flags` 进指纹,没有逐键豁免)。与上一条不矛盾:**条件是你写下的,坐标是跑出来的**,判据与三个家的分工见 [Experiments · 运行时坐标不进配置](../experiments/library.md#运行时坐标不进配置三个家)。
- **要它跟着单条结果走就报在 attempt 作用域**:`AttemptRecord.facts` 随[携带条目](#resultjson)原样携带,携带来的那条读到的仍是产出它那一轮的观测,不被本轮的新值冒名顶替;`RunMeta.facts` 记的是本次运行整场的观测,携带条目不继承它。按 fact 分组的报告因此只读 attempt 级。
- **读取面原样转发**:facts 在 show 的 `facts:` 行、对照矩阵与 `--json` 中呈现，报告可按 [`fact()`](../reports/library/measures.md#维度与数值轴) 选轴分组；它能帮助确认两次执行实际处于什么环境，但不能反过来证明携带结果仍与当前外部状态相容。

## 证据 registry

artifact 的横切属性——存储形态、截断策略、`publish` 发布缺省、存在性声明——单源在下面这张 registry 表,不散布在各小节各自维护清单。writer(`run.writeAttempt`)的参数面、reader 的懒加载方法、`publish` 的 `artifacts` 词表与缺省携带、[大值截断](#大值截断)的适用范围全部由这张表驱动;新增一种证据 = 加一行并声明类型与懒加载方法,不逐处扩清单。`view --out` 的复制按「前端读什么带什么」判定,该名单跟随查看器的真实消费面、单源在 [View](../reports/view.md#静态导出),不是本表的一列。

| artifact | 词干 | 存储形态 | 类型 | 逐值截断 | `publish` 缺省 | 内容职责 |
|---|---|---|---|---|---|---|
| `result.json` | —(恒存在) | attempt 级 | `AttemptRecord` | 不适用(摘要文件) | 恒复制 | 判定、断言、错误与诊断的权威记录 |
| `commands.json` | `commands` | attempt 级,按需 | `FailedCommandEvidence[]` | 截 | 带 | 非零 Sandbox 命令的 stdout/stderr |
| `events.json` | `events` | attempt 级,按需 | `StreamEvent[]` | 截 | 带 | 归一化标准事件流 |
| `trace.json` | `trace` | attempt 级,按需 | `TraceSpan[]` | 截 | 带 | OTel span 树 |
| `o11y.json` | `o11y` | attempt 级,按需 | `O11ySummary` | 不适用(派生缓存) | 带 | 行为计数缓存(见其小节) |
| `agent-setup.json` | `agentSetup` | attempt 级,按需 | `AgentSetupManifest` | 不适用(摘要文件) | 带 | 扩展与原生配置安装清单 |
| `diff.json` | `diff` | attempt 级,按需 | `DiffWindow[]` | 不截(完整语义单位) | 不带 | agent 归因增量 |
| `sources.json` + `sources/<sha256>.json` | `sources` | attempt 级引用 + Run 级去重仓库 | `SourcesRef` / `SourceBlob` | 不截(断言定位锚) | 带(解引用后按内容重新去重) | attempt 引用的 eval 源码,按内容哈希去重存储 |

- **词干**是 artifact 在全部程序面共用的名字:`AttemptRecord.artifacts` 的取值、`publish` 的 `artifacts` 选项、reader 懒加载方法名(`attempt.events()` 等)都用同一枚词干,不另造别名。
- 按需 artifact 空数据不落文件;存在性由 `AttemptRecord.artifacts` 声明,读取面的懒加载(缺失返回 `null`)独立成立、不依赖该声明。
- 词表当前是封闭集:每一行在 core 内都有类型与消费方。第三方自带证据种类的开放注册不在本表范围——没有消费方的落盘只是死重量;该方向作为提案属 roadmap。

## Attempt 级文件

### `commands.json`

Runner 对公开 `Sandbox.runCommand()` / `runShell()` 的最外层调用自动记录**非零退出命令**。证据在
`CommandResult` 返回调用方之前写入内存，因此 Eval 后续即使只把 `.slice(-500)` 拼进异常，
NiceEval 仍保有调用边界看到的原始 stdout/stderr。文件形状：

```typescript
interface FailedCommandEvidence {
  /** 与 PhaseTiming.children 中 kind="command" 的节点 id 相同。 */
  timingNodeId: string;
  phase: LifecyclePhase;
  /** 与 TimingNode.command.display 同一份有界脱敏命令；不含 env value。 */
  display: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout / stderr 被落盘上限截断时逐字段声明。 */
  truncated?: Truncation[];
}

type CommandsArtifact = FailedCommandEvidence[];
```

- 只记录 `exitCode !== 0`；成功输出既可能巨大又通常没有诊断价值，不复制进第二份 artifact。
- 记录不改变 `runCommand` 的返回 / 抛错语义。调用方可以处理非零退出并继续，证据仍保留——
  「被处理」不等于「没发生」。
- provider 内部实现步骤、Agent 自己调用的 shell 不经过公开 Sandbox 包装，不伪装成这里的命令；
  前者只进 provider timing，后者来自 `events.json`。
- 携带条目按 `artifactBase` 读取原文件；发布携带与截断策略按[证据 registry](#证据-registry) 的
  `commands` 行处理。`AttemptRecord.artifacts` 含 `commands` 只表示 writer 确实写过该文件。

### `events.json`

类型是 `StreamEvent[]`。这是从 agent 原始 transcript 归一化后的标准事件流,也是作用域断言、transcript 展示、工具调用统计的主要来源。

常见事件包括:

- `message`: assistant / user 文本;
- `action.called` / `action.result`: 工具调用与结果;
- `skill.loaded`: Skill 加载;
- `subagent.called` / `subagent.completed`: 子 agent 调用;
- `input.requested`: HITL 输入请求;
- `thinking`: 思考块;
- `compaction`: 上下文压缩;
- `error`: 运行时或采集错误。

文件内容是一个 JSON array,不是 JSONL / NDJSON。

### `sources.json`

一个 attempt 引用到的 eval 源码在**两处**落盘,分工是「引用轻、内容重」:

- **attempt 级 `sources.json`**:一份引用列表,不内联源码内容——

  ```typescript
  type SourcesRef = {
    path: string;
    sha256: string;
    /** 恰好一项是 entry，其余是运行时引用到的项目文件。 */
    role: "entry" | "referenced";
  }[];
  ```

  入口文件在 discovery 时登记，始终存在且标为 `entry`。其它项目文件在断言、给分记录或 `t.send`
  的运行时帧首次引用时读取，标为 `referenced`。读取失败只在帧路径保留 unavailable 缺口，不制造
  没有正文的哈希引用。一个 attempt 恰好有一个 `entry`；读取面不按断言命中数猜主文件。
- **Run 级 `sources/<sha256>.json`**:去重仓库,内容按哈希建档——

  ```typescript
  interface SourceBlob {
    content: string;
  }
  ```

  同一 Run 内不管多少个 attempt 引用同一份源码(同一个 eval 文件被多个 attempt / 多个 eval
  共享是常态——重试、或数组默认导出的多个 eval),内容只在 `sources/` 下存一份,按内容哈希
  (不是按路径)去重;哈希撞见即复用,不重写。

`niceeval view` 与 `AttemptHandle.sources()`(见 [Library](library.md))把两者拼回
`SourceArtifact[]`(`{path, content, role}[]`)供上层消费——
消费方不需要知道落盘拆成了两层,只有直接读盘的脚本(`jq` / 手写工具)需要知道这个引用 + 仓库的
两步解析。`niceeval view` 用它把 `t.send`、断言和运行结果叠回源码行。

源码正文在每个 attempt 的 `SourceRegistry` 中按路径缓存。入口正文来自 discovery；其它文件在第一条
运行时帧引用它时同步读取一次。收尾只写缓存，不重新读文件，因此运行期间修改 eval helper 不会让
已记录行号对应到后来版本的正文。项目路径必须经过真实路径规范化并确认仍在 config 所在根目录内。

携带条目不在新 Run 里重写 `sources.json` 或 `sources/`——沿用其它 artifact
同样的 `artifactBase` 回退:读取面按 `artifactBase` 定位到原 Run,原 Run 的 `sources.json`
引用 + 原 Run 自己的 `sources/` 去重仓库依然完整,不需要复制。`publish` 发布时则相反——
产物必须自包含,不能带 `artifactBase` 回退指针,所以复制时把引用解引用出完整内容后,在目标
Run 里按内容重新去重落盘(见 [Library](library.md)「复制与瘦身」)。

### `trace.json`

类型是 `TraceSpan[]`。只有 agent 声明 tracing 能力、运行器收到 OTLP span 并成功归一化时才会生成。它回答「各步骤耗时多久、父子关系是什么」,与回答「做了什么」的 `events.json` 分开。

`TraceSpan.kind` 是 view 识别的核心字段,来自 canonical GenAI 语义角色:

- `turn`
- `model`
- `tool`
- `agent`
- `other`

原生 span 名和属性仍保留在 `name` / `attributes` 里,但 view 的分组与着色只应依赖 canonical 字段。

### `o11y.json`

类型是 `O11ySummary`:从 `events.json` 派生的**行为计数缓存**——工具调用计数、读写文件、shell 命令、web fetch、错误、思考块、压缩次数与轮数。

它是本格式中唯一的落盘派生物,定位是缓存而非权威:`events.json` 体积大,而行为计数被指标(如 `assistantTurns`)与 show 的 usage 行高频消费,逐次重扫不划算。缓存契约与报告派生数据一致——同一 niceeval 版本写读,删除后可从 `events.json` 重算;与 `events.json` 直接派生的结果不一致时,以 `events.json` 为准。token 用量、成本与耗时**不在**本文件:权威分别是 `result.json` 的 [`Usage`](#usage)、`estimatedCostUSD` 与 `durationMs` / `phases`,同一事实不落第二份;这也保证本文件严格满足「可从 `events.json` 重算」——runner 计时本就不是事件流的派生物。

诊断路线上它面向人和脚本:attempt 失败时先看 `result.json` 的 `verdict` / `error`,再看 `events.json` 与 `o11y.json`,通常能分清是断言没过、agent runtime 错误,还是 adapter / provider / timeout 问题。

### `agent-setup.json`

类型是 `AgentSetupManifest`。沙箱型 Coding Agent Adapter 用它记录该 Attempt 实际安装的 Skill、Agent Native Plugin、MCP Server、Python Plugin 与官方原生配置文件。Manifest 保存来源、固定 ref、Plugin / Skill 名和可公开的解析版本；原生配置文件只保存 Agent 名、项目相对路径与原始字节的 SHA-256，不保存文件正文，也不保存 API Key、Token 或其它环境变量值。

它不参与评分，只提供复现与诊断证据。没有安装扩展或原生配置文件的 Adapter 不生成该文件。完整边界见 [Coding Agent 扩展](../adapters/architecture/coding-agent-extensions.md#manifest)。

### `diff.json`

内容是 [agent 归因增量](../sandbox/architecture.md#变更归因send-窗口与分类账)——只含 agent 在 send 窗口内的改动,fixture 与校验材料不在其中,消费方不需要再过滤。**落盘的是逐窗口 delta 序列,不做跨窗口压缩**:窗口之间可能夹着 eval 侧写入,把同一文件压成一对 before/after 会把 eval 的修改夹带进 agent 的账里,「创建又删除」「改完又改回」这类净零变化也会被压没:

```typescript
/** diff.json 的落盘形状:按时序的窗口数组。 */
type DiffArtifact = DiffWindow[];

interface DiffWindow {
  /** send 窗口标签,与时间树 turn 节点、--execution 轮次同一枚轮标签(如 "turn2")。 */
  window: string;
  /** 该窗口内 agent 改动的文件;窗口内没有 workspace 变化时窗口仍落一条、changes 为空对象。 */
  changes: Record<string, WindowChange>;
}

interface WindowChange {
  status: "added" | "modified" | "deleted";
  /** 窗口开始时的内容;added 无此字段。 */
  before?: string;
  /** 窗口结束时的内容;deleted 无此字段。 */
  after?: string;
  /** 二进制文件不内联内容,只记字节数。 */
  binary?: { beforeBytes?: number; afterBytes?: number };
}
```

读取面(`AttemptHandle.diff()`)在窗口序列之上**派生**文件级视图——派生物可随时重算,不落盘,符合「聚合在消费方」铁律:

```typescript
interface DiffData {
  windows: DiffWindow[];                       // 落盘事实,原样
  files: Record<string, DiffFileSummary>;      // 派生:每个被 agent 触及的文件一条
  /** 该文件最后一个触及窗口结束时的内容;净删除或从未触及返回 undefined。t.sandbox.diff.get 同一语义。 */
  get(path: string): string | undefined;
}

interface DiffFileSummary {
  /** 净效果:首个触及窗口的起点 vs 最后触及窗口的终点;"none" = 动过但净无变化(创建又删除、改回原样)。 */
  net: "added" | "modified" | "deleted" | "none";
  /** 触及该文件的窗口标签,按时序。 */
  windows: string[];
  binary?: true;
}
```

断言语义按这两层各取所需：`fileChanged(path)` 断「任一窗口触及」，`net` 供只关心最终结果的
消费方；单文件 patch 按窗口逐段渲染。它只存在于 Sandbox Attempt；Direct Agent 没有由
NiceEval 管理的 workspace，因此没有 diff。

## 大值截断

Agent 的一次工具调用可以产出任意大的输出——一条递归 grep 撞进 minified bundle,单行就能有几 MB,`head -100` 这类行数护栏拦不住。OTLP instrumentation 又常把同一份工具结果原样挂进 span 属性。不设上限时,单个 attempt 的 `events.json` 与 `trace.json` 能一起长到上百 MB,远大于同一个 attempt 的 `diff.json`。所以写入面对**落盘的字符串值**统一设上限。

**运行时全量,落盘截断。** 截断只发生在 artifact 序列化的那一刻:断言、`t.*` 作用域查询与 `o11y.json` 的派生统计在内存里看到的始终是完整值。**截断永远不影响判定**——落盘是证据,不是评分输入。

契约:

- **落点唯一**:`run.writeAttempt()`(见 [Library](library.md))。不在 adapter、不在 OTLP 解析、不在事件归一化里做——任何 adapter、任何 sandbox 产出的 artifact 都被同一条规则约束,adapter 作者不需要记得截断。
- **适用范围**:逐 artifact 的截断策略位单源在[证据 registry](#证据-registry),本节维护规则与理由——命中「截」的是 `events.json` 的事件字段、`trace.json` 的 span 属性与 `commands.json` 的 stdout/stderr 里的**任意字符串值**。不只工具输出——`thinking` 文本、`error` 消息同样可能爆。registry 表「逐值截断」列标「不适用」的摘要/缓存类文件(`result.json` / `o11y.json` / `agent-setup.json` / `run.json`)不参与这条逐值截断。`sources.json` 与 `sources/` 不截断:源码是断言定位的锚,且已按内容去重。`diff.json` 不截断:它的每个文件是完整语义单位,截断后就不是一份能 apply 的证据。未被逐值截断的文件和累计后的 artifact 总量统一由 [`publish`](library.md#发布publish) 的发布预算兜底。
- **上限**:每个字符串值 256 KiB(UTF-8 字节),常量 `ARTIFACT_VALUE_MAX_BYTES`。截断按 UTF-8 字符边界回退,不切断多字节字符。
- **没有 flag、没有配置项。**「需要完整落盘」的场景不存在:评分看的是运行时全量,诊断一条失控命令 256 KiB 绰绰有余(足够看清它 grep 进了 `node_modules`)。给旋钮只会让某天有人把它调大、再把仓库塞爆。

被截断的值保留前 256 KiB,末尾追加一行人可读 marker:

```text
…(前 256 KiB 内容)
[niceeval] truncated 51467156 → 262144 bytes
```

marker 只服务直接 `cat` / `jq` 的人。程序判断走结构化字段——`StreamEvent` 与 `TraceSpan` 各多一个可选 `truncated`:

```typescript
interface Truncation {
  /** 被截断的位置:命令证据里是 "stdout"/"stderr"，事件里是字段名，span 里是 attribute key。 */
  path: string;
  /** 截断前的 UTF-8 字节数。 */
  originalBytes: number;
}
```

view 显示「输出过大,已截断(原始 51.5 MB)」靠的是它,不是正则匹配 marker:「只给文本等于逼消费方正则解析」与 [Scope 警告](library.md#警告-kind-全集) 是同一条原则。

两条明确不做:

- **不对 span 属性做去重。** 同一份工具结果被 instrumentation 同时挂在 `output.value`(OpenInference 约定)与 `gen_ai.tool.call.result`(GenAI semconv)下、两份字节完全相同,是现实中会遇到的写法。截断之后两份各 256 KiB,重复的代价可忽略;而去重要判定「哪个 key 是 canonical」,那是 agent 侧的属性约定,core 不猜——`tagSpan` 的「raw 属性只增不改」继续成立。
- **writer 不设单文件总量上限。** 逐值上限防的是一条失控命令在 events、span 属性和后续 LLM input 中反复膨胀,不承诺整个文件小于某个值。writer 不能在文件预算耗尽时猜该丢哪条事件、哪个 span 或哪份源码;本地结果仍忠实落盘。进入 Git / 静态托管前必须走 `publish`,由发布边界做整文件预检,不能把「每个值至多 256 KiB」误读成「整个文件发布安全」。

`truncated` 是新增可选字段,按[版本规则](#版本与升级设计)不递增 `schemaVersion`——老读取器读到的仍然是字符串。截断只对新写入生效:`publish` 不改 artifact 内容,历史上落下的超大文件不会被追溯截断;它会在发布预检中被明确拒绝,而不是原样进入一个注定无法 push 的目录。

这条规则只约束 niceeval 的**持久化边界**。Agent runtime 在把工具结果发给模型前仍需自己的字节预算:如果一个工具层先把 50 MB 输出完整送进模型请求并收到 413,`writeAttempt` 只能阻止这 50 MB 随后把 `events.json` / `trace.json` 撑爆,不能让已经失败的请求恢复成功。运行时 transport 限流与结果落盘截断是两个独立护栏,不能拿其中一个替代另一个。

## 读取规则

编程消费用 [`openRecord`](library.md)——布局知识全部被库消化。手工(`jq` / 脚本)读的路线:

1. 定位 Run:`.niceeval/<experiment>/` 下最新的时间戳目录,读 `run.json` 确认身份与版本。
2. 逐 attempt 读 `<evalId>/a<attempt>/result.json` 拿判定、断言、用量、成本、`locator`。
3. 需要证据时读同目录的 `commands.json`、`events.json`、`trace.json`、`sources.json`、`o11y.json`、`agent-setup.json`、`diff.json`;携带条目按 `artifactBase`(相对记录根)回原 Run 取。`sources.json` 只是引用,内容在 `<Run 根>/sources/<sha256>.json`——携带条目要去原 Run 的 `sources/`,不是当前 Run 的。

两种非正常落盘的判定:

- **未收尾 Run**:`run.json` 缺 `completedAt`——进程中断,已落盘的 attempt 全部可读,只是集合可能不完整;读取面如实读出并给出结构化警告。
- **incomplete 目录**：有 Attempt 落盘、没有 `run.json`。读取面把它投影成
  `skipped("incomplete")` 以便 Sample 与 Report 保守处理；这是 reader projection，
  不是运行器产出的第五种 Verdict。

`niceeval view` 的本地 server 只暴露 `.json` artifact,并把请求路径限制在 view 输入根目录内。`--out` 导出时 Run 聚合数据烘焙进 `index.html`,查看器要 fetch 的 artifact 复制到 `artifact/` 下同布局路径。

## 与其它 reporter 的边界

这篇只描述默认 `Artifacts()` reporter 的本地目录格式。`Json(path)` reporter 写的是机器可读的当次 Invocation 全量汇总(`InvocationSummary`,含跨实验聚合),用途不同;这是需要审计瞬时调用边界时的 opt-in 出口,不是 `.niceeval/` 持久化实体。第三方实验平台 reporter 可以把同一批 `EvalResult` 转成自己的格式。

因此,不要在文档或工具里假设本地结果有 `results.jsonl`、transcript NDJSON 或固定测试输出文件。当前稳定契约是:

- Run 级: `run.json`、`sources/<sha256>.json`(eval 源码去重仓库);
- attempt 级文件的全集、截断与发布属性单源在[证据 registry](#证据-registry);
- 每个文件都是 JSON,不是 JSONL。

## 相关阅读

- [README](README.md) —— 三层分工、库的边界、消费方。
- [Library](library.md) —— `niceeval/record` 的 TS 读写 API。
- [参考方案](reference/README.md) —— 格式与版本策略从哪些系统学来。
- [Sample](../sample/README.md) —— 从记录选出一份可比较的样本。
- [Reports](../reports/README.md) —— 建立在样本之上的积木。
