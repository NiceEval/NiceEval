# Results —— 架构

这是磁盘上的快照 / attempt 结果格式规范,也是 `niceeval view` 的离线输入契约;为什么格式与库合一见 [README](README.md),TS 读写 API 见 [Library](library.md)。实现入口是 `src/results/writer.ts`(`Artifacts()` reporter 是它的薄壳);核心持久化类型在 `src/results/`,运行时类型在 `src/types.ts` 的 `EvalResult`、`StreamEvent`、`TraceSpan`、`O11ySummary` 和 `DiffData`。

## 目录结构

默认输出根目录是 `.niceeval/`。**落盘单位是快照**(snapshot = 一个 experiment 的一次运行):实验目录在外层,快照目录在实验目录下:

```text
.niceeval/
  <experiment>/                      # 实验目录:experimentId 清洗后的名字
    <timestamp>-<suffix>/            # 快照目录:时间戳 + 随机后缀,独占创建
      snapshot.json                  # 快照元数据(快照开始时写入,收尾补 completedAt)
      sources/                       # 快照级 eval 源码去重仓库,按内容 SHA-256 建档
        <sha256>.json                # { content }:一份源码文本,快照内多少 attempt 引用它都只存一份
      <evalId>/a<attempt>/           # 单个 eval attempt 的目录
        result.json                  # 判决、断言、用量、locator —— attempt 完成时一次写成
        events.json
        sources.json                 # 引用 sources/ 里的条目,不内联源码内容(见下)
        trace.json
        o11y.json
        agent-setup.json              # Skill / Native Plugin / MCP / Python Plugin 安装清单
        diff.json
```

命名与清洗规则:

- **实验目录名**:`experimentId` 里的 `/` 与其它非 `[\w.@-]` 字符替换成 `_`(如 `dev-e2b/codex-e2b` → `dev-e2b_codex-e2b`)。目录名只表达身份与定位;权威的 experimentId 在 `snapshot.json` 的 `experimentId` 字段里,两个不同 id 清洗后撞同一目录名也不影响解析(reader 按字段归组)。
- **快照目录名**:`Date#toISOString()` 把 `:` 与 `.` 换成 `-`,再接 `-<4 位随机后缀>`(如 `2026-07-11T07-29-54-873Z-x1f2`)。
- **attempt 目录**:`evalId` 里的 `/` 保留为目录层级,其它不适合路径的字符替换成 `_`;`a<attempt>` 是第几轮重试。agent、model、实验参数都由所属快照钉死,attempt 路径里不出现。

**唯一性由创建方式保证**:快照目录用独占 `mkdir` 创建(目录已存在即失败),撞名时换随机后缀重试。多个 niceeval 进程同时开跑——哪怕同一毫秒、同一个实验——各自拿到各自的快照目录,任何文件都不会被另一个进程触碰。

**每个文件恰好写入一次**:`snapshot.json` 在快照开始时写入(收尾时补写 `completedAt` 是唯一的重写,且只有创建它的进程会做);`result.json` 与各 artifact 文件在对应 attempt 完成时写入。格式里不存在"跑完才聚合重写"的文件,所以进程 crash / 被 kill 只丢正在飞的 attempt——已完成 attempt 的判决和 artifact 都在盘上。某类数据为空就不生成对应 JSON 文件。

## 版本与升级设计

`snapshot.json` 顶层带最小的版本元数据(常量在 `src/runner/types.ts` 的 `RESULTS_FORMAT` / `RESULTS_SCHEMA_VERSION`):

```json
{
  "format": "niceeval.results",
  "schemaVersion": 8,
  "producer": {
    "name": "niceeval",
    "version": "0.12.0"
  },
  "experimentId": "dev-e2b/codex-e2b",
  "agent": "codex",
  "startedAt": "2026-07-11T07:29:54.871Z"
}
```

当前 `schemaVersion` 是 `8`。历史各版本的字段差异与升版原因不在正文维护,记录在 memory 的 results-schema-version-history 条目;读取器不需要这份历史——版本不同一律按下节的不兼容路径处理。

设计原则是**不做兼容机制**。没有迁移函数,没有多版本 normalize loader,没有 per-artifact 版本号:整个快照(snapshot.json + 全部 attempt 文件)共用顶层这一个 `schemaVersion`。读取器只认与自己相同的版本;版本不同就是不兼容,唯一的处理是提示用写这份结果的 niceeval 版本查看:

```bash
npx niceeval@0.5.4 view .niceeval/2026-07-10T08-00-00-000Z
```

字段规则:

- `format` 必须等于 `"niceeval.results"`。它既避免把其它工具的 JSON 误读成 niceeval,也是版本不匹配时识别「这是一份 niceeval 结果」的依据。
- `schemaVersion` 用整数,只在**破坏兼容读取**时递增。新增可选字段、新增 artifact 文件、新增 `StreamEvent` variant 不递增;读取器必须忽略未知字段和未知 artifact 文件。
- `producer.version` 是写这份结果的 npm package 版本,唯一用途是拼 npx 提示;它不是 schema 判断依据。
- `format` / `schemaVersion` / `producer` 三个字段永久稳定:任何未来版本都不能移动、重命名或改变类型,否则版本不匹配时连 npx 提示都给不出来。历史版本(≤3)把这三个字段放在 run 级 `summary.json` 顶层,读取器据此识别旧落盘并按下节给出提示——这是版本识别,不是迁移。
- attempt 文件保持裸 JSON object/array。`result.json` 是裸对象,`events.json` 是 `StreamEvent[]`,不为塞版本号改成 `{ schemaVersion, data }` envelope;`jq`/`node` 直接读的体验不被打破。
- 不要用目录名表达 schema。实验目录、快照目录和 attempt 目录只表达身份与定位;版本全部在 `snapshot.json` 里,复制、重命名、归档目录不影响解析。

### 版本不匹配时的读取行为

读取器不解析、不迁移、不降级渲染任何版本不同的快照,行为只分三档:

- **`schemaVersion` 相同**:正常读取渲染。
- **`format === "niceeval.results"` 但 `schemaVersion` 不同**(不论新旧,含历史版本的 `summary.json`):整份落盘视为不兼容。目录扫描时在列表里留一个占位条目,标出目录和 `producer.version`,并提示:

  ```text
  ⚠ .niceeval/2026-07-10T08-00-00-000Z: written by niceeval 0.4.6 (schemaVersion 3);
    this CLI reads schemaVersion 4.
    Run `npx niceeval@0.4.6 view .niceeval/2026-07-10T08-00-00-000Z` to view it.
  ```

  单文件模式 `niceeval view <path>` 指向版本不同的元数据文件时输出同样的提示后退出,而不是报「不是 niceeval 结果」。
- **不能识别**(没有 `format`,也不满足 legacy 的 `results[]` + `startedAt` 启发式):当作无关 JSON 忽略。

实现入口:版本判定只有一份,在 `src/results/format.ts` 的 `classifySnapshot`(view 经 `openResults` 消费);目录扫描的占位数据经 `viewData.skippedRuns` 进前端,由 `src/view/app/App.tsx` 的 incompatible-banner 渲染(三种原因:incompatible-version / malformed / incomplete);单文件模式在 `src/view/data.ts` 抛 `IncompatibleResultsError`,`src/cli.ts` 的 `exitOnViewUserError` 打印提示退出;提示文案是 i18n key `cli.view.incompatible`(niceeval 落盘)与 `cli.view.incompatibleForeign`(第三方 harness,不拼 npx)。

## `snapshot.json`

快照元数据的家:身份、快照级字段与版本元数据,**不含任何逐 attempt 数据**。快照开始时写入;收尾时补写 `completedAt`。

```typescript
interface SnapshotMeta {
  format: "niceeval.results";
  schemaVersion: number;
  producer: { name: string; version?: string; commit?: string };
  /** 权威的实验身份;实验目录名是它的清洗投影。 */
  experimentId: string;
  /** 实验运行配置的可序列化投影,快照内全部 attempt 共享;字段全集见下方 ExperimentRunInfo。 */
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
  startedAt: string;
  /** 收尾时补写;缺失 = 快照未收尾(进程中断),已落盘的 attempt 照常可读。 */
  completedAt?: string;
  /** 写入时刻该实验已知的 eval 并集 —— 残缺检测的分母随数据走(copySnapshots 自动补记,writer 可声明)。 */
  knownEvalIds?: string[];
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
}
```

`producer.name` 是任意字符串——第三方 harness 经 `niceeval/results` 写入面转换结果时如实署名,`"niceeval"` 只是官方 writer 的取值。

`ExperimentRunInfo` 是**解析后运行配置的穷尽可序列化投影**——记录这次运行实际生效的值,不是原始 `ExperimentDef`(函数与 hooks 本来就无法忠实落盘,存「原样」只能存谎):

```typescript
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface ExperimentRunInfo {
  description?: string;
  reasoningEffort?: string;
  flags?: Record<string, JsonValue>;
  runs: number;
  earlyExit: boolean;
  timeoutMs?: number;
  budget?: number;
  maxConcurrency?: number;
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

三条纪律:

- **`model` 与 `agent` 只在快照顶层存在**(`snapshot.model` / `snapshot.agent`),`ExperimentRunInfo` 不复制——同一事实两处落盘不是冗余就是漂移;报告的 `config()` 对 `model` / `agent` 两个键桥接到顶层字段,消费方无感(见 [Reports · 维度与 flags](../reports/library/metrics.md#维度与-flags))。
- **sandbox 参数只经 provider 的 `publicConfig()` 投影落盘**:每个内置 provider 显式实现「哪些参数可发布」的投影(镜像名、模板名、runtime 可以;token、凭据路径永远不可以),`defineSandbox` 自定义 provider 未实现投影时只落 provider 名。「params 不含 secret」由投影保证,不靠注释承诺。
- **按 eval 解析预制产物时保存逐 eval 结果。** 顶层 `sandbox` 始终是 spec 基础参数的投影；`sandboxByEval` 只记录本快照选中且声明了 `environment` 的 eval 各自解析到的产物投影，供审计与逐 eval fingerprint 对账。未声明 environment 的 eval 以顶层 `sandbox` 为准，未选中的 eval 不查表、不伪造映射项；spec 的 `environments` 表不整张落盘——落的是每条 eval 的解析结果。
- 新增公开运行配置字段时必须同步进这张投影,不允许「快照里有一半配置」。

通过数、失败数、总用量、总成本这类聚合**不落盘**:它们由 `result.json` 逐条推导,聚合永远发生在消费方(`openResults` 分层之上的计算函数或你的脚本)——这与读取面「忠实磁盘,不合并不聚合」是同一条铁律。

## `result.json`

单个 attempt 的**权威记录**:判决、断言、结构化执行错误与 diagnostics 只住在这里。attempt 的 cleanup/teardown/stop 完成后一次写成,之后没有任何环节会改写它。

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
  /** Runner 阶段计时，按执行顺序；只记录实际发生的阶段。 */
  phases?: PhaseTiming[];
  /** 记录态断言;元素字段契约单独定义在 [Scoring · 断言记录](../scoring/architecture.md#断言记录assertionresult)。 */
  assertions: AssertionResult[];
  /** 证据覆盖聚合:Agent 声明经各 turn 降级后的最差值,字段契约见 [Adapters · 证据与完整性](../adapters/architecture/evidence.md);省略 = 全通道 unknown(Adapter 未声明),消费侧按保守处理。 */
  coverage?: EvidenceCoverage;
  usage?: Usage;
  estimatedCostUSD?: number;
  /** 使 attempt 无法正常完成的唯一致命执行错误。 */
  error?: AttemptError;
  /** 不一定改变 verdict、但运行后仍需回顾的有界诊断。 */
  diagnostics?: DiagnosticRecord[];
  skipReason?: string;
  /** 本 attempt 开始的墙钟时刻;缺失时读取面回退快照的 startedAt。携带条目保留原条目的值,身份键与去重以它为锚。 */
  startedAt?: string;
  /**
   * 沙箱型 attempt 的执行环境标识:provider 名与实例 id(如 Docker 容器 ID 前缀),用于关联
   * provider 侧日志与[留存现场](../sandbox/cli.md);remote 型 agent 无此字段。`kept` 表示
   * 运行收尾时按 `--keep-sandbox` 留存了沙箱;之后的存活状态归 `niceeval sandbox list` 回答,
   * 本记录一次写成、不回写。
   */
  sandbox?: { provider: string; sandboxId: string; kept?: true };
  /**
   * 不透明的 Attempt 定位符:`@` + 1 位 scheme 字符 + 7 位 base36 body(如 `@1x7f3q9k`)。
   * 由 `{experimentId, 快照 startedAt, evalId, attempt}` 这个不可变身份元组确定性派生——
   * 不是数组下标、不是磁盘路径。fresh 条目在 attempt 调度前由 runner 算出并贯穿执行、留存登记与落盘;
   * 携带条目(见下)原样复制上一轮的值,从不重算(原快照的 startedAt 已经不在本轮快照里,
   * 重算会算出不同的字符串)。
   * `niceeval show @<locator>` 与报告 / view 的 attempt 深链都靠它寻址,详见
   * [Library · 按 locator 寻址一个 attempt](library.md#按-locator-寻址一个-attemptresolvelocator)。
   */
  locator?: string;
  /** 携带条目专用: artifact 目录(相对结果根目录),指向原快照里的落盘。 */
  artifactBase?: string;
  hasEvents?: boolean;
  hasTrace?: boolean;
  hasSources?: boolean;
}

/**
 * 生命周期词表——全仓唯一一套。
 * 计时(`phases[].name`)、错误归因(`error.phase`)、诊断归属(`diagnostics[].phase`)、
 * live 展示与 agent/ci envelope 的 `phase=` 都使用这同一个闭集,不存在第二套词表。
 * 实验级两员只用于归因(不属于任何单个 attempt,永不出现在 `phases[]` 计时里)。
 */
type LifecyclePhase =
  // 实验级(整场一次,宿主机侧;仅错误/诊断归因)
  | "experiment.setup"     // ExperimentDef.setup;setup 抛错时本实验所有 attempt 的 error.phase
  | "experiment.teardown"  // setup 返回的 cleanup;失败只产生运行级 diagnostic
  // 主链:从排队到 trace collect,覆盖到判定与主证据收集完成,按执行序
  | "sandbox.queue"        // 等待并发信号量(调度等待,唯一不属于某个 owner 的成员)
  | "sandbox.create"       // provider 起沙箱
  | "sandbox.setup"        // SandboxSpec.setup() 钩子链
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
  | "eval.teardown"        // EvalDef.setup 返回的 cleanup 函数
  | "agent.teardown"
  | "sandbox.teardown"     // SandboxSpec.teardown() 钩子链
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
   * 采集端写入的有界人读标签;hook 匿名时用 setup#<i>/teardown#<i>,turn 用 s<session>/t<turn>;
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

`sandbox` 是新增的可选字段(remote attempt 与旧 producer 都可以没有),老读取器按未知字段忽略,这类新增本身按本页版本规则不递增 `schemaVersion`。词表新增成员(如实验级两员)同理:消费方把 `phase` 当归因标签渲染,不得假设穷尽后拒绝未知成员,所以扩充词表不递增版本。

`phases` 缺失表示结果不是由带阶段计时的 runner 产出。数组顺序就是执行顺序；不适用、未定义或没有执行的阶段不写 0 值条目。`eval.teardown` / `agent.teardown` / `sandbox.teardown` / `sandbox.stop` 是收尾段：主链抛错后它们照常执行、照常计时，各自可独立标 `failed`（对应 teardown diagnostic，不改判定），且不计入 `durationMs` 口径——「结果早已确定、收尾还卡着」的耗时因此可归因。结果封口必须发生在 Effect Scope 的 release 完成之后：`sandbox.stop` 与 receiver close 这类 finalizer 也向 attempt 共用的 timing recorder 写入，再由 Scope 外层组装最终 `AttemptRecord`；不能在 body 返回时先封口、事后再尝试修改已写出的结果。

`children` 是 runner 直接观察到的时间树。`sandbox.setup` / `sandbox.teardown` 先按 hook 建节点，hook 内所有经 `Sandbox.runCommand()` / `runShell()` 发出的命令继续挂成 `command` 子节点；同一套包装覆盖 `workspace.baseline`、`eval.setup`、`agent.setup`、`telemetry.configure`、`eval.run` 中 eval 手工命令与 adapter 启动 CLI 的命令、`workspace.diff` 以及各收尾阶段。包装只记录最外层公开调用一次——provider 的 `runCommand` 内部转调 `runShell` 不得形成重复节点。命令摘要截断并脱敏，env 只允许保留 key，stdout/stderr 仍由原有事件或诊断证据承载。

`operation` 是采集端拥有的语义父节点，不是 artifact 携带的自定义 renderer。runner、Sandbox 或 provider 知道某段工作是一个逻辑整体时，在执行边界直接写下稳定语义与有界规模摘要，例如 `export workspace diff · 2 windows · 3,302 files`，并把实际公开 Sandbox command 或 provider step 挂在下面。批量算法必须先在执行层把 provider 往返约束到逻辑批次，再用 operation 表达；不能记录成逐对象远端调用后只在 Reports 折叠。消费方只按 `kind`、树关系、失败、耗时和时序通用渲染，不解析 shell 文本猜测 `git show ×N`，也不执行 artifact 提供的 callback。

`agent.run` 是唯一的嵌套生命周期成员：它在 `eval.run` 内随每次 send 打开，只作为 `error.phase` / `diagnostics[].phase` 的归因值出现，不在 `phases` 里单列。每次 send 由 runner 产生一个 `turn` child，保存本地单调时钟测得的端到端包络以及 session/turn 身份；OTel 接入时再保存 `traceId` 与归属方式。`trace.json` 中的 agent/model/tool spans 不复制进 `children`，消费方按 `traceId` 把它们临时挂到对应 turn 下。这样没有 OTel 时仍有可靠的轮次总耗时，有 OTel 时才展开轮内模型、工具与子 agent 细节。

`sandbox.create` 早于 Sandbox 对象存在，不能由 `runCommand` / `runShell` 包装捕获。内置 provider 可以把真实的 SDK 请求、宿主命令或创建步骤写成 `provider` children；第三方 provider 没有提供细分时只保留 `sandbox.create` 合计，不能把 API 调用伪装成 shell 命令。Agent CLI 内部执行的 shell 工具同样不经过 Sandbox 包装，它们来自 `events.json`，耗时只在 OTel span 能唯一关联时提供。

所有 runner duration 使用单调时钟；`startedAt` 单独保留 ISO 墙钟。`startOffsetMs` 只用于同一 attempt 内恢复顺序和重叠，不能拿远端 OTel 的绝对时间与 runner 墙钟硬对齐。父子节点允许嵌套与并发，子节点 duration 不可直接求和后与父节点比较。`result.json` 永远保存完整 runner 时间树；终端默认视图的节点预算只是读取投影，不得回写、裁剪或聚合 artifact。阶段边界、主链 / 收尾两段的 failed 语义、时间树以及安装基准消费方式见 [Phase Timings 与安装基准](../../engineering/benchmark/README.md)；终端的有界/full 两档见 [Show `--timing`](../reports/show/timing.md)，网页入口见 [View](../reports/view.md) 的 Attempt 详情。

`error` 与 `diagnostics` 的 `phase` 都由 runner 在错误 / 诊断发生时按已打开的生命周期阶段绑定,调用方不能自行填写。两者的区别是结果语义:`error` 是让 attempt 进入 `errored` 的致命原因,至多一个;`diagnostics` 是运行仍可继续或收尾时发现的问题,可以与 passed/failed/errored 任一 verdict 共存。`diagnostic.level` 表达消息严重度,不是 verdict 的别名。diagnostic 是 niceeval 的操作性反馈,`message` 与 `command` 遵循[错误与警告反馈](../../error-feedback.md)——message 以下一步收尾,单命令可推进时 `command` 携带该命令;`error` 是被测对象的失败事实,不受该契约约束。

`progress` 文本不写入任何 artifact。它是运行时可覆盖状态,保存每一帧既无法还原可靠因果,也会让高频 SDK/工具进度无限放大结果。事后回顾依靠 `phases`、`error`、`diagnostics` 与可选的 `events.json` / `trace.json`。trace 不是必需兜底:沙箱创建发生在 telemetry 之前,teardown 发生在 trace collect 之后,没有 tracing 的 provider 也必须留下同样完整的错误摘要。

attempt 的结果封口发生在 cleanup、teardown 与 sandbox stop 之后;随后 `result.json` 与其它 attempt artifacts 原子写入。这样 teardown diagnostic 不会因为主 test 已经返回而丢失。进程在封口前被强杀时,该 attempt 仍属于未完成,不会留下一个伪装完整的 `result.json`。

快照级字段(`experimentId` / `agent` / `model` / 实验运行配置)不在这里重复——reader 把 `snapshot.json` 的声明拼进每条读回的结果(`attempt.result`),拼合规则是「缺才补」:条目自带的值优先,`startedAt` 只在记录缺失时回退快照的值;`locator` 同理「缺才补」,niceeval 自己的 writer 恒会写这个字段,只有第三方 harness 没实现它时读取面才按当前身份兜底算一份。

两类条目:

- **本快照跑出的条目**:artifact 与 `result.json` 同目录,不需要任何路径引用字段。
- **携带条目**(运行器默认把上一轮 fingerprint 匹配、判定为终态——passed 或 failed——的结果自动携带合入本快照,让最新快照保持完整;`--force` 关闭携带全部重跑,语义见 [Runner · 缓存](../../runner.md#缓存指纹去重)):`startedAt` 保留原条目的时刻,另带 `artifactBase`(相对结果根,指向原快照的 attempt 目录),`has*` 真值原样携带。`artifactBase` 就是事实上的「携带」标记。清理历史快照前先用 `copySnapshots` 物化要保留的结果——原快照删除后,携带条目的 artifact 懒加载如实返回 `null`。

`o11y.json` 和 `diff.json` 没有对应的 `has*` 标记;读取面的懒加载语义(缺失返回 `null`)吸收了存在性判断,见 [Library](library.md)。

## Attempt 级文件

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
  type SourcesRef = { path: string; sha256: string }[];
  ```

  它只列出本次 test / 断言经 `loc` 引用到的文件(path)与其归一化后内容的 SHA-256。
- **快照级 `sources/<sha256>.json`**:去重仓库,内容按哈希建档——

  ```typescript
  interface SourceBlob {
    content: string;
  }
  ```

  同一快照内不管多少个 attempt 引用同一份源码(同一个 eval 文件被多个 attempt / 多个 eval
  共享是常态——重试、或数组默认导出的多个 eval),内容只在 `sources/` 下存一份,按内容哈希
  (不是按路径)去重;哈希撞见即复用,不重写。

`niceeval view` 与 `AttemptHandle.sources()`(见 [Library](library.md))把两者拼回
`SourceArtifact[]`(`{path, content}[]`,与 schemaVersion 4 及更早版本的语义一致)供上层消费——
消费方不需要知道落盘拆成了两层,只有直接读盘的脚本(`jq` / 手写工具)需要知道这个引用 + 仓库的
两步解析。`niceeval view` 用它把 `t.send`、断言和运行结果叠回源码行。

携带条目不在新快照里重写 `sources.json` 或 `sources/`——沿用其它 artifact
同样的 `artifactBase` 回退:读取面按 `artifactBase` 定位到原快照,原快照的 `sources.json`
引用 + 原快照自己的 `sources/` 去重仓库依然完整,不需要复制。`copySnapshots` 发布时则相反——
产物必须自包含,不能带 `artifactBase` 回退指针,所以复制时把引用解引用出完整内容后,在目标
快照里按内容重新去重落盘(见 [Library](library.md)「复制与瘦身」)。

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

类型是 `O11ySummary`。这是从标准事件流派生的行为摘要,包括工具调用计数、读写文件、shell 命令、web fetch、错误、思考块、压缩次数、耗时、usage 和估算成本。

这个文件面向人和调试脚本:当一个 attempt 失败时,先看 `result.json` 的 `verdict` / `error`,再看 `events.json` 与 `o11y.json`,通常能分清是断言没过、agent runtime 错误,还是 adapter / provider / timeout 问题。

### `agent-setup.json`

类型是 `AgentSetupManifest`。沙箱型 Coding Agent Adapter 用它记录该 Attempt 实际安装的 Skill、Agent Native Plugin、MCP Server、Python Plugin 与官方原生配置文件。Manifest 保存来源、固定 ref、Plugin / Skill 名和可公开的解析版本；原生配置文件只保存 Agent 名、项目相对路径与原始字节的 SHA-256，不保存文件正文，也不保存 API Key、Token 或其它环境变量值。

它不参与评分，只提供复现与诊断证据。没有安装扩展或原生配置文件的 Adapter 不生成该文件。完整边界见 [Coding Agent 扩展](../adapters/architecture/coding-agent-extensions.md#manifest)。

### `diff.json`

内容是 [agent 归因增量](../sandbox/architecture.md#变更归因send-窗口与分类账)——只含 agent 在 send 窗口内的改动,fixture 与校验材料不在其中,消费方不需要再过滤。**落盘的是逐窗口 delta 序列,不做跨窗口压缩**:窗口之间可能夹着 eval 侧写入,把同一文件压成一对 before/after 会把 eval 的修改夹带进 agent 的账里,「创建又删除」「改完又改回」这类净零变化也会被压没:

```typescript
/** diff.json 的落盘形状:按时序的窗口数组。 */
type DiffArtifact = DiffWindow[];

interface DiffWindow {
  /** send 窗口标签,与时间树 turn 节点、--execution 轮次同源(如 "s1/t2")。 */
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

断言语义按这两层各取所需:`fileChanged(path)` 断「任一窗口触及」(行为证据,净效果为 none 也算发生过);`net` 供只关心最终结果的消费方;单文件 patch(`show --diff=<path>`)按窗口逐段渲染,不产出跨窗口合成 patch。它只存在于沙箱型运行;remote / in-process agent 没有 workspace,没有 diff。

## 大值截断

Agent 的一次工具调用可以产出任意大的输出——一条递归 grep 撞进 minified bundle,单行就能有几 MB,`head -100` 这类行数护栏拦不住。OTLP instrumentation 又常把同一份工具结果原样挂进 span 属性。不设上限时,单个 attempt 的 `events.json` 与 `trace.json` 能一起长到上百 MB,远大于同一个 attempt 的 `diff.json`。所以写入面对**落盘的字符串值**统一设上限。

**运行时全量,落盘截断。** 截断只发生在 artifact 序列化的那一刻:断言、`t.*` 作用域查询与 `o11y.json` 的派生统计在内存里看到的始终是完整值。**截断永远不影响判决**——落盘是证据,不是评分输入。

契约:

- **落点唯一**:`snap.writeAttempt()`(见 [Library](library.md))。不在 adapter、不在 OTLP 解析、不在事件归一化里做——任何 adapter、任何 sandbox 产出的 artifact 都被同一条规则约束,adapter 作者不需要记得截断。
- **适用范围**:`events.json` 的事件字段与 `trace.json` 的 span 属性里的**任意字符串值**。不只工具输出——`thinking` 文本、`error` 消息同样可能爆。`result.json` / `o11y.json` / `snapshot.json` 保存摘要,不参与这条逐值截断。`sources.json` 与 `sources/` 不截断:源码是断言定位的锚,且已按内容去重。`diff.json` 不截断:它的每个文件是完整语义单位,截断后不再是一份能 apply 的证据。未被逐值截断的文件和累计后的 artifact 总量统一由 [`copySnapshots`](library.md#复制与瘦身copysnapshots) 的发布预算兜底。
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
  /** 被截断的位置:事件里是字段名(如 "output"),span 里是 attribute key(如 "output.value")。 */
  path: string;
  /** 截断前的 UTF-8 字节数。 */
  originalBytes: number;
}
```

view 显示「输出过大,已截断(原始 51.5 MB)」靠的是它,不是正则匹配 marker:「只给文本等于逼消费方正则解析」与 [Scope 警告](library.md#警告-kind-全集) 是同一条原则。

两条明确不做:

- **不对 span 属性做去重。** 同一份工具结果被 instrumentation 同时挂在 `output.value`(OpenInference 约定)与 `gen_ai.tool.call.result`(GenAI semconv)下、两份字节完全相同,是现实中会遇到的写法。截断之后两份各 256 KiB,重复的代价可忽略;而去重要判定「哪个 key 是 canonical」,那是 agent 侧的属性约定,core 不猜——`tagSpan` 的「raw 属性只增不改」继续成立。
- **writer 不设单文件总量上限。** 逐值上限防的是一条失控命令在 events、span 属性和后续 LLM input 中反复膨胀,不承诺整个文件小于某个值。writer 不能在文件预算耗尽时猜该丢哪条事件、哪个 span 或哪份源码;本地结果仍忠实落盘。进入 Git / 静态托管前必须走 `copySnapshots`,由发布边界做整文件预检,不能把「每个值至多 256 KiB」误读成「整个文件发布安全」。

`truncated` 是新增可选字段,按[版本规则](#版本与升级设计)不递增 `schemaVersion`——老读取器读到的仍然是字符串。截断只对新写入生效:`copySnapshots` 不改 artifact 内容,历史上落下的超大文件不会被追溯截断;它会在发布预检中被明确拒绝,而不是原样进入一个注定无法 push 的目录。

这条规则只约束 niceeval 的**持久化边界**。Agent runtime 在把工具结果发给模型前仍需自己的字节预算:如果一个工具层先把 50 MB 输出完整送进模型请求并收到 413,`writeAttempt` 只能阻止这 50 MB 随后把 `events.json` / `trace.json` 撑爆,不能让已经失败的请求恢复成功。运行时 transport 限流与结果落盘截断是两个独立护栏,不能拿其中一个替代另一个。

## 读取规则

编程消费用 [`openResults`](library.md)——布局知识全部被库消化。手工(`jq` / 脚本)读的路线:

1. 定位快照:`.niceeval/<experiment>/` 下最新的时间戳目录,读 `snapshot.json` 确认身份与版本。
2. 逐 attempt 读 `<evalId>/a<attempt>/result.json` 拿判决、断言、用量、成本、`locator`。
3. 需要证据时读同目录的 `events.json`、`trace.json`、`sources.json`、`o11y.json`、`agent-setup.json`、`diff.json`;携带条目按 `artifactBase`(相对结果根)回原快照取。`sources.json` 只是引用,内容在 `<快照根>/sources/<sha256>.json`——携带条目要去原快照的 `sources/`,不是当前快照的。

两种非正常落盘的判定:

- **未收尾快照**:`snapshot.json` 缺 `completedAt`——进程中断,已落盘的 attempt 全部可读,只是集合可能不完整;读取面如实读出并给出结构化警告。
- **incomplete 目录**:有 attempt 落盘、没有 `snapshot.json`——只可能出现在「目录建好、元数据还没写完」的极小窗口里进程死亡,或人为删文件;读取面归入 `skipped("incomplete")`。

`niceeval view` 的本地 server 只暴露 `.json` artifact,并把请求路径限制在 view 输入根目录内。`--out` 导出时快照聚合数据烘焙进 `index.html`,查看器要 fetch 的 artifact 复制到 `artifact/` 下同布局路径。

## 与其它 reporter 的边界

这篇只描述默认 `Artifacts()` reporter 的本地目录格式。`Json(path)` reporter 写的是机器可读的全量运行汇总(`RunSummary`,含跨实验聚合),用途不同;第三方实验平台 reporter 可以把同一批 `EvalResult` 转成自己的格式。

因此,不要在文档或工具里假设本地结果有 `results.jsonl`、transcript NDJSON 或固定测试输出文件。当前稳定契约是:

- 快照级: `snapshot.json`、`sources/<sha256>.json`(eval 源码去重仓库);
- attempt 级: `result.json`、`events.json`、`sources.json`(引用,不内联内容)、`trace.json`、`o11y.json`、`agent-setup.json`、`diff.json`;
- `events.json` 与 `trace.json` 里的字符串值有 256 KiB 上限,超出的带 `truncated` 标记(见[大值截断](#大值截断));
- 每个文件都是 JSON,不是 JSONL。

## 相关阅读

- [README](README.md) —— 为什么格式与库合一、库的边界、四个消费方。
- [Library](library.md) —— `niceeval/results` 的 TS 读写 API。
- [Reports](../reports/README.md) —— 建立在本库读取面之上的积木。
