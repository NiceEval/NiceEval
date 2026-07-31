# Record —— 架构

这是磁盘上的 Run / attempt 记录格式规范,也是 `niceeval view` 的离线输入契约;层的分工见 [README](README.md),TS 读写 API 见 [Library](library.md),格式选型的来源见 [参考方案](reference/README.md)。
实现入口是 `src/record/writer.ts`(`Artifacts()` reporter 是它的薄壳);核心持久化类型在 `src/record/`,运行时类型在 `src/types.ts` 的 `EvalResult`、`StreamEvent`、`TraceSpan`、`O11ySummary` 和 `DiffData`。

## 目录结构

默认输出根目录是 `.niceeval/`。
**落盘单位是 Run**(Run = 一个 Experiment 的一次执行水位):实验目录在外层,run 目录在实验目录下。
每个 Run 创建时生成一个 UUID v4 `runId`，它是移动、发布或重命名目录后仍不变的权威身份。
一次 CLI Invocation 可同时打开多个 Run，但 Invocation 不是持久化实体：格式不保存 `invocationId` 或跨实验成员关系。

```text
.niceeval/
  <experiment>/                      # 实验目录:experimentId 清洗后的名字
    <timestamp>-<suffix>/            # run 目录:人读定位名,权威身份在 run.json 的 runId
      run.json                  # Run 元数据(Run 开始时写入,收尾补 completedAt + Run 诊断)
      manifests.json                 # 逐 eval 的指纹输入清单(规划期与指纹同刻算出)
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

命名与编码规则:

- **实验目录名**：把完整 `experimentId` 的 UTF-8 字节做 percent-encoding。
  安全字符仅为 `A-Z a-z 0-9 . _ @ -`，`%` 与 `/` 一律编码，因此投影可逆且不同 id 不会撞目录名。
  权威值仍是 `run.json.experimentId`。
- **run 目录名**:`Date#toISOString()` 把 `:` 与 `.` 换成 `-`,再接 `-<4 位随机后缀>`(如 `2026-07-11T07-29-54-873Z-x1f2`)。
- **attempt 目录**：`evalId` 的 `/` 保留为层级，每个路径片段使用同一套可逆 percent-encoding；`.` / `..` 整段额外编码，不能取得路径语义。
  `a<attempt>` 是第几轮运行。
  agent、model、实验参数都由所属 Run 锁定，attempt 路径里不出现。

**唯一性由创建方式保证**:run 目录用独占 `mkdir` 创建(目录已存在即失败),撞名时换随机后缀重试。
多个 niceeval 进程同时开跑——哪怕同一毫秒、同一个实验——各自拿到各自的 run 目录,任何文件都不会被另一个进程触碰。

**每个文件都只有一个封口时点**:`run.json` 在 Run 开始时写入,收尾时由创建它的进程唯一一次补写 `completedAt` 与 Run 级 `diagnostics`;`result.json` 与各 artifact 文件在对应 attempt 完成时写入。
格式里不存在跨 Experiment 聚合文件,所以进程 crash / 被 kill 只丢正在飞的 attempt 与尚未封口的 Run 级诊断——已完成 attempt 的判定和 artifact 都在盘上。
某类数据为空就不生成对应 JSON 文件。

`manifests.json` 与 `run.json` 同层,逐 eval 记本 Run 的指纹输入清单:配置面、源码面与数据面。
它在规划阶段与指纹同刻算出、一次写成,不随 attempt 完成回写。
清单的构成、新旧相减得出的具名差异,以及历史条目缺它时的 `opaque:no-manifest` 语义,单源在 [Experiments · manifest](../experiments/cache.md#manifest哈希做索引清单做解释)。

## 版本与升级设计

`run.json` 顶层带最小的版本元数据(常量在 `src/record/format.ts` 的 `RECORD_FORMAT` / `RECORD_SCHEMA_VERSION`):

```json
{
  "format": "niceeval.results",
  "schemaVersion": 11,
  "producer": {
    "name": "niceeval",
    "version": "0.12.0"
  },
  "runId": "9dcf6f83-4468-42f1-b0e1-a410f49cf58e",
  "experimentId": "dev-e2b/codex-e2b",
  "agent": "codex",
  "startedAt": "2026-07-11T07:29:54.871Z"
}
```

当前 `schemaVersion` 是 `13`。
历史各版本的字段差异与升版原因不在正文维护，记录在 memory 的 results-schema-version-history 条目。
读取器不需要这份历史；版本不同一律按下节的不兼容路径处理。

设计原则是**不做兼容机制**。
没有迁移函数,没有多版本 normalize loader,没有 per-artifact 版本号:整个 Run(run.json + 全部 attempt 文件)共用顶层这一个 `schemaVersion`。
读取器只认与自己相同的版本;版本不同就是不兼容,唯一的处理是提示用写这份结果的 niceeval 版本查看:

```bash
npx niceeval@0.5.4 view .niceeval/2026-07-10T08-00-00-000Z
```

字段规则:

- `format` 必须等于 `"niceeval.results"`。
  它既避免把其它工具的 JSON 误读成 niceeval,也是版本不匹配时识别「这是一份 niceeval 结果」的依据。
- `schemaVersion` 用整数,只在**破坏兼容读取**时递增。
  新增可选字段、新增 artifact 文件、新增 `StreamEvent` variant 不递增;读取器必须忽略未知字段和未知 artifact 文件。
- `producer.version` 是写这份结果的 npm package 版本,唯一用途是拼 npx 提示;它不是 schema 判断依据。
- `format` / `schemaVersion` / `producer` 三个字段永久稳定:任何未来版本都不能移动、重命名或改变类型,否则版本不匹配时连 npx 提示都给不出来。
  历史版本(≤3)把这三个字段放在 run 级 `summary.json` 顶层,读取器据此识别旧落盘并按下节给出提示——这是版本识别,不是迁移。
- attempt 文件保持原始 JSON object/array。
  `result.json` 是未包装对象,`events.json` 是 `StreamEvent[]`,不为塞版本号改成 `{ schemaVersion, data }` envelope;`jq`/`node` 直接读的体验不被打破。
- 不要用目录名表达 schema。
  实验目录、run 目录和 attempt 目录只表达身份与定位;版本全部在 `run.json` 里,复制、重命名、归档目录不影响解析。

### 版本不匹配时的读取行为

读取器不解析、不迁移、不降级渲染任何版本不同的 Run,行为只分三档:

- **`schemaVersion` 相同**:正常读取渲染。
- **`format === "niceeval.results"` 但 `schemaVersion` 不同**(不论新旧,含历史版本的 `summary.json`):整份落盘视为不兼容。
  目录扫描时在列表里留一个占位条目,标出目录和 `producer.version`,并提示:

  ```text
  ⚠ .niceeval/2026-07-10T08-00-00-000Z: written by niceeval 0.4.6 (schemaVersion 3);
    this CLI reads schemaVersion 4.
    Run `npx niceeval@0.4.6 view .niceeval/2026-07-10T08-00-00-000Z` to view it.
  ```

  单文件模式 `niceeval view <path>` 指向版本不同的元数据文件时输出同样的提示后退出,而不是报「不是 niceeval 结果」。
- **不能识别**(没有 `format`,也不满足 legacy 的 `results[]` + `startedAt` 启发式):当作无关 JSON 忽略。

实现入口:版本判定只有一份,在 `src/record/format.ts` 的 `classifyRun`(view 经 `openRecord` 消费);目录扫描把 incompatible-version / malformed / incomplete 投影为结构化 `unreadable-run` Issue。
view 与 CLI 各自的 Notice policy 再产生 banner 或终端错误,包括是否根据 producer 给出版本命令;读取分类层不写 i18n 文案或 action。

## `run.json`

Run 元数据的家:身份、Run 级字段与版本元数据,**不含任何逐 attempt 数据**。
Run 开始时写入;收尾时补写 `completedAt`。

```typescript
interface RunMeta {
  format: "niceeval.results";
  schemaVersion: number;
  producer: { name: string; version?: string; commit?: string };
  /**
   * Run 的权威身份;创建时生成 UUID v4。它在一份已持久化 Run 内恒定,复制、发布、目录改名与
   * 同毫秒并发创建都不改变它——但它**不可从业务身份重建**:同一个 experimentId + startedAt
   * 重跑一次得到的是另一个 runId,只有 `run.json` 里存着这一个权威值。
   */
  runId: string;
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
   * 属于整个 Experiment Run、无法诚实挂到单个 Attempt 的运行诊断 observation。
   * 与 completedAt 在同一次 Run 封口补写;例如 experiment-teardown-failed、
   * budget-unenforceable。不得放入跨 Experiment 的 Invocation 汇总。
   */
  diagnostics?: DiagnosticRecord[];
  /** experiment 作用域生命周期代码经 `ctx.fact()` 上报的运行事实;与 completedAt 同批在 Run 封口补写。字段契约见 result.json 的 facts 小节。 */
  facts?: Record<string, string | number | boolean>;
  /**
   * Run 级共享工作的时间树:共享构建(`sandbox.build`)、共享制品准备(`agent.artifact.prepare`)、
   * 实验级 Hook(`experiment.setup` / `experiment.teardown`)。offset 相对本 Run 的单调时钟起点;
   * 与 completedAt 同批在 Run 封口补写。形状与语义见[两层时间模型](#两层时间模型生命周期锚点与开放-activity)。
   */
  timings?: TimingActivity[];
  /**
   * 共享构建的 provenance,每个实际查询或构建过的 BuildKey 一条。
   * 时间只保存在 `timings`,本表经 `timingNodeId` 关联,不复制 duration。
   * 形状见[共享构建的 provenance](#共享构建的-provenancesandboxbuilds)。
   */
  sandboxBuilds?: SandboxBuildRecord[];
  /** 写入时刻该实验已知的 eval 并集 —— 残缺检测的分母随数据走(publish 自动补记,writer 可声明)。 */
  knownEvalIds?: string[];
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
}
```

`producer.name` 是任意字符串——第三方 harness 经 `niceeval/record` 写入面转换结果时如实署名,`"niceeval"` 只是官方 writer 的取值。

`format` 的取值恒为 `"niceeval.results"`。
它是「这是一份 niceeval 落盘」的识别符,不是模块名的投影:改动它会让所有历史版本连「这东西是谁写的」都认不出来,从而给不出版本提示——而那正是这个字段永久稳定的全部意义。
识别符与模块名各自稳定,互不跟随。

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
   * Run 级默认的裁判配置,进 configHash 因此必须落盘;eval 自己声明的那份在它的源码闭包里,不在这。
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
- **`labels` 是报告元数据**,不进 fingerprint,也不进 `configHash`。
  `selectedEvalIds` 是这次运行实际选择的 eval 集；报告直接读取它，不从 experiment 路径推断另一层集合。
- **sandbox 参数只经 provider 的 `publicConfig()` 投影落盘**:每个内置 provider 显式实现「哪些参数可发布」的投影(镜像名、模板名、runtime 可以;token、凭据路径永远不可以),`defineSandbox` 自定义 provider 没有提供投影时只落 provider 名。
  「params 不含 secret」由投影保证,不靠注释承诺。
- **按 eval 解析预制产物时保存逐 eval 结果。**
  顶层 `sandbox` 始终是 spec 基础参数的投影；`sandboxByEval` 只记录本 Run 选中且声明了 `environment` 的 eval 各自解析到的产物投影，供审计与逐 eval fingerprint 对账。
  未声明 environment 的 eval 以顶层 `sandbox` 为准，未选中的 eval 不查表、不伪造映射项；spec 的 `environments` 表不整张落盘——落的是每条 eval 的解析结果。
- 新增公开运行配置字段时必须同步进这张投影,不允许「Run 里有一半配置」。
  **进 [configHash](../experiments/cache.md#指纹两个哈希嵌套) 的字段这条是硬约束**:配置身份的每一个输入都要在 `run.json` 上找得到,顶层或本投影二选一。
  `agent` / `model` 住顶层,其余住这里。
  少落一个,就无法拿历史 Run 重算配置身份,[`--accept`](../experiments/cache.md#--accept授权跨过一条精确差异) 的差异解释与授权校验直接失效。

通过数、失败数、总用量、总成本这类聚合**不落盘**:它们由 `result.json` 逐条推导,聚合永远发生在消费方(`openRecord` 分层之上的计算函数或你的脚本)——这与读取面「忠实磁盘,不合并不聚合」是同一条铁律。

## 两层时间模型:生命周期锚点与开放 activity

时间与归属分两层记录,各自回答不同的问题:

- **生命周期锚点(`LifecyclePhase`)**:Runner 拥有的 attempt 生命周期闭集,不是扩展点。
  它决定主链与收尾段的边界、attempt deadline 的起点、错误归属和 `durationMs` / `executionMs` 口径。
- **timing activity(`TimingActivity`)**:开放的工作计时节点,Run 与 attempt 共用同一形状。
  provider、Adapter 与第三方 producer 用稳定机器 key 记录自己的工作;未知 key 可通用读取和展示,但不能改变 verdict、deadline、资源释放或主耗时口径。

两层的连接点有两处。
attempt 侧,`phases[]` 是锚点序列,每个锚点下挂 activity 子树(`PhaseTiming.children`)。
Run 侧,共享构建、共享 staged payload 准备与实验级 Hook 这类不属于任何单个 attempt 的工作记在 `RunMeta.timings`,一次工作只计时一次,被多少 attempt 依赖都不复制。

### `LifecyclePhase`:Runner 保留的锚点闭集

```typescript
/**
 * Runner 保留的 attempt 生命周期锚点——闭集,不是扩展点。
 * 成员资格只看一条:这个边界影响 attempt 的执行语义(主链 / 收尾段归属、deadline 起点、
 * `durationMs` / `executionMs` 的排除规则)。计时(`phases[].name`)、错误与诊断的 attempt
 * 锚点(见 TimingOrigin)、live 当前步骤都由 Runner 绑定这同一个闭集;author、Adapter 与
 * provider 不能新增成员,也不能冒充绑定。可扩展的工作计时走开放 activity key,不进本词表。
 * 运行级与实验级成员只用于归因,永不出现在任何 attempt 的 `phases[]` 计时里。
 */
type LifecyclePhase =
  // 运行级(派发前至多一次,宿主机侧;仅错误归因)
  | "judge.precheck"       // 判分预检;预检失败时是含 judge 断言的 eval 全部 attempt 的错误锚点
  // 实验级(整场一次,宿主机侧;仅错误/诊断归因)
  | "experiment.setup"     // ExperimentDef.setup;setup 抛错时是本实验所有 attempt 的错误锚点
  | "experiment.teardown"  // ExperimentDef.teardown;失败只产生运行级 diagnostic
  // 主链:从排队到 trace collect,覆盖到判定与主证据收集完成,按执行序
  | "sandbox.queue"        // 等待并发信号量(调度等待,唯一不属于某个 owner 的成员)
  | "sandbox.create"       // provider 从 image / template / snapshot 启动 Sandbox(共享构建不在这里,它在 Run 级 activity)
  | "sandbox.setup"        // SandboxSpec.setup() 生命周期 Hook 链
  | "workspace.baseline"   // 变更分类账锚点(runner 私有 git ledger 首笔 commit)
  | "eval.setup"           // EvalDef.setup
  | "agent.setup"          // Agent 的 Ensure:检查、缺失时安装、复检(见 Adapters · Agent Ensure)
  | "telemetry.configure"  // tracing 出口配置
  | "eval.run"             // 整段 test(t),含所有 send 与手工命令
  | "agent.run"            // 嵌套在 eval.run 内:adapter send 期间打开;只用于错误/诊断归因,不单列计时条目
  | "workspace.diff"       // 从分类账折叠 agent 归因增量
  | "eval.verify"          // 上传受管 verifier files、verify(v) 与 cleanup
  | "scoring.evaluate"     // 断言 finalize + 判定,含 judge 调用
  | "telemetry.collect"    // OTLP receiver settle / collect
  // 收尾段:无论主链成败都执行,不计入 durationMs 口径,按执行序
  | "eval.teardown"        // EvalDef.teardown
  | "agent.teardown"
  | "sandbox.teardown"     // SandboxSpec.teardown() 生命周期 Hook 链
  | "sandbox.suspend"      // 留存提交后 provider 把现场转入休眠(docker stop / e2b pause);耗时可观(pause 随内存增长),必须可见
  | "sandbox.stop";        // provider 销毁沙箱;与 sandbox.suspend 同一 attempt 互斥
```

生命周期语义是闭集,activity key 是开放集合——两层各自的演进规则见[未知 key 与版本](#未知-key-与版本)。

### `ActivityKey`:稳定机器 key

activity 的 `key` 是非空、以 `.` 分段、带命名空间的稳定字符串,例如 `sandbox.build`、`agent.artifact.prepare`、`provider.image.pull`。
key 只回答「这项工作是什么」,供程序分组与专用读取面按名识别;人读文字由 `label` 表达,消费者不得解析 label 重建语义。

NiceEval 保留 `sandbox`、`agent`、`eval`、`workspace`、`scoring`、`telemetry`、`experiment`、`judge`、`record` 九个顶级命名空间。
第三方 producer 使用自己的 provider、Adapter 或 package 命名空间,不需要任何注册或枚举放行。

### `TimingActivity`:Run 与 attempt 共用的计时节点

```typescript
interface TimingActivity {
  /** 所在时钟域(一份 RunMeta.timings 或一个 attempt)内唯一,供 origin、provenance 与展示层稳定引用;不作为跨 Run 身份。 */
  id: string;
  /** ActivityKey;见上节。 */
  key: string;
  /** 采集端写入的有界、脱敏人读标签;展示层不解析它重建语义。 */
  label: string;
  /** 相对所在时钟域单调时钟起点的偏移;并发 sibling 据此还原重叠,不能只靠数组顺序相加。 */
  startOffsetMs: number;
  durationMs: number;
  failed?: true;
  children?: TimingActivity[];

  /** key = "agent.turn" 时存在;把 runner 的 send 墙钟包络与 trace.json 中同一轮的 spans 显式关联。 */
  sessionIndex?: number;
  turnIndex?: number;
  turnId?: string;
  traceId?: string;
  traceAttribution?: "traceparent" | "window" | "none";
  /** key = "agent.turn" 时存在,该轮 `Turn.usage` 落盘原样(有记录才写),字段契约见 result.json 的 Usage 小节。 */
  usage?: Usage;

  /** key = "sandbox.command" 时的有界脱敏摘要;环境变量值与 stdout/stderr 不进入时间树。 */
  command?: {
    display: string;
    exitCode?: number;
  };
}
```

时钟域由容器字段决定,activity 自己不重复保存 scope:

- `RunMeta.timings` 的 offset 相对该 Run 的单调时钟起点;
- `PhaseTiming.children` 的 offset 相对该 attempt 的单调时钟起点。

两个域的 offset 不能混算,也不能拿远端 OTel 的绝对时间与 runner 墙钟硬对齐。
父子允许嵌套与并发,子节点 duration 不可求和后与父节点比较。

结构化字段归 key 所有:`agent.turn` 的 session/turn/trace/usage 字段组、`sandbox.command` 的 `command` 与 `commands.json` 关联,都由对应 key 的 producer 写入。
第三方新增工作种类起自己的 key,通用消费方按 label、树关系、失败、耗时与时序渲染,不认识 key 也不丢内容。

官方 writer 使用的 key:

| key | 时钟域 | 记什么 |
|---|---|---|
| `agent.turn` | attempt | 一次 send 的端到端包络;轮标签语法单点见 [Assertions · Turn 的展示](../assertions/architecture/scopes.md) |
| `sandbox.command` | attempt | 公开 `runCommand` / `runShell` 的最外层调用;非零退出经 `timingNodeId` 关联 [`commands.json`](#commandsjson) |
| `sandbox.hook` | attempt | SandboxSpec Hook 链的逐 Hook 节点;匿名 Hook 的 label 用 `setup#<i>` / `teardown#<i>` |
| `provider.*` | 两者皆可 | provider 内部步骤,如 `provider.image.pull`、`provider.build.execute` |
| `workspace.diff.export` | attempt | 变更分类账的批量导出;label 带有界规模摘要 |
| `sandbox.build` | Run | 一个 BuildKey 的查询与构建;经 [`sandboxBuilds`](#共享构建的-provenancesandboxbuilds) 关联 provenance |
| `agent.artifact.prepare` | Run | 内置 Agent staged payload 的题面外准备(见 [Adapters · Agent Ensure](../adapters/architecture/agent-ensure.md)) |
| `experiment.setup` / `experiment.teardown` | Run | 实验级 Hook 整场一次的执行 |

采集端知道某段工作是一个逻辑整体时,在执行边界直接起 key 写下稳定语义与有界规模摘要(如 `workspace.diff.export` 的 `export workspace diff · 2 windows · 3,302 files`),把实际公开命令或 provider 步骤挂在下面。
批量算法必须先在执行层把 provider 往返约束到逻辑批次再记录;不能落成逐对象远端调用后指望 Reports 折叠。

### 未知 key 与版本

- 未知 key 原样保留并通用渲染;读取器不得拒绝整份记录,官方 reader 不需要 registry 才能显示。
- 未知 key 对口径零影响:activity 不改变 verdict、deadline、资源释放,也不进 `durationMs` / `executionMs`——口径只由锚点层定义。
- 新增普通 activity key 不递增 `schemaVersion`;老读取器按未知 key 通用渲染。
- 改变已有 key 的结构化字段语义或时钟域属于破坏性格式变化,按[版本规则](#版本与升级设计)递增 `schemaVersion`。
- 生命周期锚点闭集的成员变化影响口径定义,同样按版本规则处理,不靠「未知 phase 也能渲染」豁免。

### `TimingOrigin`:错误与诊断的归属

```typescript
type TimingOrigin =
  | {
      scope: "attempt";
      /** runner 在错误 / 诊断发生时已打开的生命周期锚点;producer 不能自行指定。 */
      phase: LifecyclePhase;
      /** 可选细化:锚点下具体的 activity(如失败的那条 sandbox.command)。 */
      timingNodeId?: string;
    }
  | {
      scope: "run";
      /** 指向 RunMeta.timings 里的 activity(如失败的 sandbox.build)。 */
      timingNodeId: string;
    };
```

- attempt 内的致命错误与诊断保留 Runner 锚点,可进一步指向锚点下的 activity。
- attempt 开始前发生的共享构建失败引用 Run timing node,不伪造 `sandbox.create` 或其它 attempt 锚点;所有依赖该 BuildKey、本应 fresh 执行的 attempt 得到 `errored`,origin 指向同一个 node。
- Run 级 diagnostic 可以只引用 Run timing node,也可以带 `experiment.setup` 这类归因锚点的 attempt 形态——按事实选形态,不为凑字段编造。
- timing node 的 key 由 `timingNodeId` 关联记录得到;error / diagnostic 不复制 key,避免两处漂移。
- 没有 timing 记录的第三方 producer 允许只写 attempt 锚点,或写无 `origin` 的 Run diagnostic。

携带条目的 run scope `timingNodeId` 指向产出它那一轮的 Run:读取面经 `artifactBase` 回原 Run 的 `run.json` 解引用,不在本 Run 的 `timings` 里找。

### 共享构建的 provenance:`sandboxBuilds`

```typescript
interface SandboxBuildRecord {
  /** 构建产物身份;算法与输入清单单源在 [Sandbox Case · BuildKey](../sandbox/case.md#buildkey-与-casekey两个身份各管一件事)。 */
  buildKey: string;
  provider: string;
  /** hit = 查询命中已有产物;built = 本次真实构建;failed / cancelled 如实记录。 */
  status: "hit" | "built" | "failed" | "cancelled";
  /** 关联 RunMeta.timings 里对应的 sandbox.build activity;时间只保存在那棵树上,本表不复制 duration。 */
  timingNodeId: string;
  /** provider 原生产物定位,如 image digest、template id;失败或查询不到时省略。 */
  locator?: JsonValue;
  /** 解析后的构建输入投影(Dockerfile 路径、context 摘要、base digest 等);不含凭据值。 */
  inputs: JsonValue;
  /** status = "failed" 时的结构化错误;依赖该 key 的 attempt 的 error 经 origin 指向同一个 timing node。 */
  error?: {
    code: string;
    message: string;
    cause?: { name?: string; code?: string; message: string };
  };
}
```

- 每个实际查询或构建过的 BuildKey 一条;多个 attempt 引用同一条 provenance。
- cache hit 也留下有界的查询 activity 与 `status: "hit"` 记录;完全被携带、无需查询的 BuildKey 不制造假记录。
- 共享构建只属于 Run:不占 attempt 并发位,不进任何 attempt 的 `executionMs`。
  一次十分钟的冷构建在整份记录里只出现一次时间,预算与调度契约单源在 [Sandbox Case · Run 级构建协调](../sandbox/case.md#run-级构建协调共享准备的预算与调度)。
- Run 通用读取面按 `sandbox.build` key 展示时间;Sandbox 专用读取面再用本表展示 locator、输入与依赖它的 attempt,不解析 timing label。

### 携带、publish 与复制的忠实保留

- `RunMeta.timings` 与 `sandboxBuilds` 属于产出它们的 Run;携带条目不继承本 Run 的这两个字段,与 `RunMeta.facts` 同一条规则。
- attempt 的 `phases` 与 activity 子树随 `result.json` 原样携带、原样 publish;任何环节不得回写、裁剪或聚合。
- `publish` 恒复制 `run.json`,`timings`、`sandboxBuilds` 与 origin 引用随之完整保留。
  `timingNodeId` 可解引用是 writer 义务;reader 对解引用失败按数据缺失回退,不报格式错误。

## `result.json`

单个 attempt 的**权威记录**：判定、断言、结构化执行错误与 diagnostics 只住在这里。
attempt 的 teardown 链与 Scope release 完成后一次写成，之后没有任何环节会改写它。

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
  /** 自动重试吸收的物理 send 失败,按发生顺序完整保留；最终一次逻辑 Turn 不重复放这里。 */
  retryAttempts?: RetryAttemptRecord[];
  /** 全部物理 send（含 retryAttempts）与其它模型调用的聚合用量。 */
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
   * `provider` / `sandboxId` / `reused` / `reuseSandbox` / `reuseOrdinal` 是调度事实，
   * 在 Sandbox 租借给该 Attempt 时确定；Attempt 在任何阶段终结（含 setup 失败与超时）
   * 都必须带上它们，只有 `kept` 在收尾时点决定。
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
   * 不透明的 Attempt 定位符:`@` + 1 位 scheme 字符 + 12 位 Crockford base32 body(共 14 字符)。
   * 由 `{runId, evalId, attempt}` 的 SHA-256 前 60 bit 派生——不是数组下标、不是磁盘路径。
   * fresh 条目在 attempt 调度前由 runner 算出并贯穿执行、留存登记与落盘;
   * 携带条目(见下)原样复制上一轮的值，从不按承载它的新 Run 重算。
   * `niceeval show @<locator>` 与报告 / view 的 attempt 深链都靠它寻址,详见
   * [Library · 按 locator 寻址一个 attempt](library.md#按-locator-寻址一个-attemptresolvelocator)。
   * 唯一性作用域与碰撞语义见下方[locator 的唯一性](#locator-的唯一性)。
   */
  locator?: string;
  /** 携带条目专用: artifact 目录(相对记录根目录),指向原 Run 里的落盘。 */
  artifactBase?: string;
  /**
   * 携带条目专用:这条被携入时,[`--accept`](../experiments/cache.md#--accept授权跨过一条精确差异)
   * 授权它跨过了哪几条指纹差异,逐条记 selector 与旧值新值摘要。
   * 条目已按本 Run 口径重打指纹,这个字段是它与本 Run 指纹输入之间那点差异的唯一记录,
   * 跟着结果走而不是跟着 Run 走;省略等价于「本 Run 的指纹输入逐项相等」。
   */
  carriedAccepting?: AcceptedDifference[];
  /**
   * writer 实际写出的按需 artifact 词干列表(词表与全部横切属性单源在[证据 registry](#证据-registry),
   * 如 ["commands", "events", "sources"])。省略等价于空列表;携带条目原样携带。读取面的懒加载语义
   * (缺失返回 null)独立成立,本字段只服务「不 stat 磁盘就知道有什么」的消费方。
   */
  artifacts?: string[];
}

/** `--accept` 授权跨过的一条具名差异,写进被携入条目的 `carriedAccepting`。 */
interface AcceptedDifference {
  /** 与 `--accept` 同一词表:`config:<路径>` / `source:<路径>` / `data:<路径>` / `opaque:no-manifest`。 */
  selector: string;
  /** 旧值摘要:config 面写解析后的值,source / data 面写内容哈希;`opaque:no-manifest` 两侧都算不出,省略。 */
  from?: string;
  /** 新值摘要,口径同 `from`。 */
  to?: string;
}

/** `LifecyclePhase` 闭集、`TimingActivity` 与 `TimingOrigin` 的定义见[两层时间模型](#两层时间模型生命周期锚点与开放-activity)。 */
interface PhaseTiming {
  name: LifecyclePhase;
  /** 阶段耗时；失败阶段计到抛错或超时中断时。 */
  durationMs: number;
  /** 该阶段抛错或被超时中断。主链至多一条,其后无主链条目;收尾阶段各自独立标记,不改判定。 */
  failed?: true;
  /** 锚点内的 activity 子树,offset 相对本 attempt 的单调时钟起点;只供单 attempt 诊断,不做跨实验聚合。 */
  children?: TimingActivity[];
}

interface AttemptError {
  /** 稳定、可供 CI/Agent 分支处理的机器码;未知异常使用 "unexpected-error"。 */
  code: string;
  /** 人可读的一层原因,不拼接整份 SDK response。 */
  message: string;
  /**
   * 错误归属。attempt 内错误由 runner 绑定当时打开的生命周期锚点(attempt 形态);
   * attempt 开始前的共享构建失败引用 Run timing node(run 形态),不伪造 attempt 锚点。
   */
  origin: TimingOrigin;
  /** 原异常有 stack 时保留,供 show 展开;终端即时反馈不整段打印。 */
  stack?: string;
  /** 下层 SDK/OS 错误的有限摘要。 */
  cause?: { name?: string; code?: string; message: string };
  /**
   * 超时打断产生的 `errored` 专用:这次撞的是哪层时限、上限值多少、值从哪一层解析而来。
   * 三样一起落盘,报错行与 [`show --timing`](../reports/show/timing.md) 照实印这三样;
   * 归属规则单源在 [Sandbox · 时限归属](../sandbox/architecture.md#时限归属attempt-deadline-是唯一缺省)。
   */
  timeout?: TimeoutAttribution;
}

/** 一次超时的归属事实,由 runner 在把 attempt 转成 `errored` 时写下。 */
interface TimeoutAttribution {
  /**
   * 触发层:`attempt-deadline` 是 attempt 自己的上限,`command-timeout` 是用户给单条命令
   * 显式传的 `timeout`。provider 固有的会话上限在派发前按环境约束报出,不落 attempt
   * ([时限归属](../sandbox/architecture.md#时限归属attempt-deadline-是唯一默认))。
   */
  trigger: "attempt-deadline" | "command-timeout";
  /** 该层实际生效的上限,毫秒。 */
  limitMs: number;
  /**
   * 值来自哪一层:`attempt-deadline` 取 [`timeoutMs` 的解析链](../experiments/architecture.md#配置解析链一次求值处处同源)
   * 四层之一,`command-timeout` 只有命令显式声明一个来源。
   */
  source: "flag" | "experiment" | "eval" | "config" | "command";
}

interface RetryAttemptRecord {
  sessionIndex: number;
  turnIndex: number;
  /** 同一逻辑 send 内从 0 开始的物理尝试序号；0 是首次发送。 */
  sendAttempt: number;
  startedAt: string;
  durationMs: number;
  failure:
    | { type: "thrown"; error: AttemptError }
    | { type: "turn-failed"; message: string };
  classification: {
    retryable: true;
    scope: "attempt" | "eval" | "experiment";
    reason?: string;
  };
  events: StreamEvent[];
  usage?: Usage;
}

interface DiagnosticRecord {
  code: string;
  /** 写入方观察到的运行影响;不是最终 Notice 严重度。 */
  level: "warning" | "error";
  /**
   * 诊断归属。attempt 诊断由 runner 绑定当时打开的锚点;Run 诊断可引用 Run timing node,
   * 也可只带 `experiment.teardown` 这类归因锚点;没有 timing 记录的第三方 producer 可省略。
   */
  origin?: TimingOrigin;
  /** 写入时观察到的原始有界描述;不包含修复动作或呈现文案。 */
  detail: string;
  /** 支撑 code 的结构化原始上下文。 */
  context?: Readonly<Record<string, JsonValue>>;
  /** 相同 dedupeKey 折叠后的出现次数;省略等于 1。 */
  count?: number;
}
```

`sandbox` 是可选字段，Direct Attempt 与旧 producer 都可以没有。
老读取器按未知字段忽略，这类新增本身按本页版本规则不递增 `schemaVersion`。
消费方把 origin 的锚点当归因标签渲染，不得因不认识某个成员拒绝整份记录。

`phases` 缺失表示结果不是由带阶段计时的 runner 产出。
数组顺序就是执行顺序；不适用、未定义或没有执行的阶段不写 0 值条目。
`eval.teardown` / `agent.teardown` / `sandbox.teardown` 与互斥的 `sandbox.suspend` / `sandbox.stop` 是收尾段：主链抛错后它们照常执行、照常计时，各自可独立标 `failed`（对应 teardown diagnostic，不改判定），且不计入 `durationMs` 口径——「结果早已确定、收尾还卡着」的耗时因此可归因。
结果封口必须发生在 Effect Scope 的 release 完成之后：provider release 与 receiver close 这类 finalizer 也向 attempt 共用的 timing recorder 写入，再由 Scope 外层组装最终 `AttemptRecord`；不能在 body 返回时先封口、事后再尝试修改已写出的结果。

`children` 是 runner 直接观察到的 activity 树。
`sandbox.setup` / `sandbox.teardown` 先按 `sandbox.hook` 建节点，hook 内所有经 `Sandbox.runCommand()` / `runShell()` 发出的命令继续挂成 `sandbox.command` 子节点；同一套包装覆盖 `workspace.baseline`、`eval.setup`、`agent.setup`、`telemetry.configure`、`eval.run`、`workspace.diff`、`eval.verify` 以及各收尾阶段。
包装只记录最外层公开调用一次——provider 的 `runCommand` 内部转调 `runShell` 不得形成重复节点。
命令摘要截断并脱敏，env 只允许保留 key；非零退出命令的 stdout/stderr 由同一包装写进 `commands.json`，按 `timingNodeId` 与这里的 `sandbox.command` 节点关联。
成功命令不复制输出，Agent 内部工具命令仍由 `events.json` 承载。

`agent.run` 是唯一的嵌套生命周期成员：它在 `eval.run` 内随每次 send 打开，只作为错误 / 诊断 origin 的归因锚点出现，不在 `phases` 里单列。
每次 send 由 runner 产生一个 `agent.turn` child，保存本地单调时钟测得的端到端包络以及 session/turn 身份；OTel 接入时再保存 `traceId` 与归属方式。
`trace.json` 中的 agent/model/tool spans 不复制进 `children`，消费方按 `traceId` 把它们临时挂到对应 turn 下。
这样没有 OTel 时仍有可靠的轮次总耗时，有 OTel 时才展开轮内模型、工具与子 agent 细节。

Experiment `setup` / `teardown` 属于 Run 级生命周期：执行计时落 `RunMeta.timings` 的同名 activity，归因锚点可进入 origin，但它们不进入任何单条 Attempt 的 `phases[]`。
Run 级 diagnostics 与 facts 在 `run.json` 封口时保存；Attempt timing 不借入整场只执行一次的耗时。

`sandbox.create` 早于 Sandbox 对象存在，不能由 `runCommand` / `runShell` 包装捕获。
内置 provider 可以把真实的 SDK 请求、宿主命令或创建步骤写成 `provider.*` children；第三方 provider 没有提供细分时只保留 `sandbox.create` 合计，不能把 API 调用伪装成 shell 命令。
Agent CLI 内部执行的 shell 工具同样不经过 Sandbox 包装，它们来自 `events.json`，耗时只在 OTel span 能唯一关联时提供。

所有 runner duration 使用单调时钟；`startedAt` 单独保留 ISO 墙钟。
`result.json` 永远保存完整 runner activity 树；终端默认视图的节点预算只是读取投影，不得回写、裁剪或聚合 artifact。
阶段边界、主链 / 收尾两段的 failed 语义、activity 树以及安装基准消费方式见 [Phase Timings 与安装基准](../../engineering/benchmark/README.md)；终端的有界/full 两档见 [Show `--timing`](../reports/show/timing.md)，网页入口见 [View](../reports/view.md) 的 Attempt 详情。

`error` 与 `diagnostics` 的 attempt 锚点都由 runner 在错误 / 诊断发生时按已打开的生命周期锚点绑定,调用方不能自行填写。
两者的区别是结果语义:`error` 是让 attempt 进入 `errored` 的致命原因,至多一个;`diagnostics` 是运行仍可继续或收尾时发现的问题,可以与 passed/failed/errored 任一 verdict 共存。
`diagnostic.level` 表达写入方观察到的运行影响,不是 verdict 的别名,也不决定报告 Notice 的严重度。

`DiagnosticRecord` 是持久化 observation:只保存 code、origin、level、去重次数与当时观察到的 `detail` / `context`。
它不存本地化文案、修复建议或命令。
读取层把 observation 投影成结构化 Issue,Reports 的 Notice policy 再决定给当前读者显示什么、用什么严重度与提供什么动作。
`AttemptError.message` 例外地保留:它是被测对象的失败证据,不是 niceeval 的操作性文案。

`progress` 文本不写入任何 artifact。
它是运行时可覆盖状态,保存每一帧既无法还原可靠因果,也会让高频 SDK/工具进度无限放大结果。
事后回顾依靠 `phases`、`error`、`diagnostics` 与可选的 `events.json` / `trace.json`。
trace 不是必需回退:沙箱创建发生在 telemetry 之前,teardown 发生在 trace collect 之后,没有 tracing 的 provider 也必须留下同样完整的错误摘要。

attempt 的结果封口发生在 Effect Scope release 完成之后：teardown 链与 `commitKeepOrStop()` 已结束，销毁路径完成 `sandbox.stop`，留存路径完成 `sandbox.suspend`。
随后 `result.json` 与其它 attempt artifacts 原子写入。
这样 teardown diagnostic 不会因为主 test 已经返回而丢失。
进程在封口前被强杀时,该 attempt 仍属于未完成,不会留下一个伪装完整的 `result.json`。

Run 级字段(`experimentId` / `agent` / `model` / 实验运行配置)不在这里重复——reader 把 `run.json` 的声明拼进每条读回的结果(`attempt.result`),拼合规则是「缺才补」:条目自带的值优先,`startedAt` 只在记录缺失时回退 Run 的值;`locator` 同理「缺才补」,niceeval 自己的 writer 恒会写这个字段,只有第三方 harness 没实现它时读取面才按当前身份回退算一份。

两类条目:

- **本 Run 跑出的条目**:artifact 与 `result.json` 同目录,不需要任何路径引用字段。
- **携带条目**(运行器默认把上一轮 fingerprint 匹配、判定为终态——passed 或 failed——的结果自动携带合入本 Run,让最新 Run 保持完整;`--rerun all` 关闭携带全部重跑,语义见 [Experiments · 缓存与携带](../experiments/cache.md)):`startedAt` 保留原条目的时刻,另带 `artifactBase`(相对记录根,指向原 Run 的 attempt 目录),`artifacts` 列表、`facts`、`locator`、判定与证据指向**一律原样携带,没有例外**——携带来的是那一轮真实发生过的事,不按本轮改写。
  一个被改写的历史字段没有任何读者能正确解释:它既不是当初发生的事,也不是本轮观察到的事。

  合入只重打 `fingerprint` 一个字段,让[一份 Run 里的条目共享一个指纹口径](../experiments/cache.md#一份-run-里的条目共享一个指纹口径)。
  「条目与配置怎么对上号」因此不靠 fingerprint 承担:`attempt.run.configHash` 直接给出该条目所在 Run 的配置身份,读取面不必翻更早的 Run,也不必从指纹反推。
  常规携带下重打前后本就相等——相等正是携带判据;[`--accept`](../experiments/cache.md#--accept授权跨过一条精确差异) 授权跨过一条差异时两者不等,被跨过的那几条逐条记进 `carriedAccepting`,它是「这条采信了哪些差异」的唯一记录。

  `artifactBase` 是事实上的「携带」标记,读取面把它连同目标目录是否仍在一起投影成 [`evidenceState`](library.md#携带条目与-evidencestate) 三态。
  清理历史 Run 前先用 `publish` 解引用并复制要保留的结果——原 Run 删除后,该条目转为 `dangling`,artifact 懒加载返回 `null`,而 `artifacts` 列表仍声明写过它们;两者的差值就是「证据丢了」,不与「没采集」混为一谈。
  记录格式版本变化时不携带,理由见 [Library · 跨 schemaVersion 不携带](library.md#携带条目与-evidencestate)。

### Usage

token 用量的落盘形状。
每个字段只在协议真实提供该值时存在——与[标准事件模型](../adapters/architecture/events.md)「原始协议没有 usage 时省略,不编造数值」同一条纪律;不存在「默认 0」或「默认 1」的字段:

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

三个输入侧 token 桶**恒互斥**:`inputTokens + cacheReadTokens + cacheCreationTokens` 相加才是送进模型的完整上下文量。
互斥是 adapter 的归一化义务,不是协议的自然属性——Anthropic 系协议原生按互斥计量,如实转发即可;OpenAI 系协议报的是「含缓存命中的输入总量 + 缓存命中子集」,adapter 落值前必须先从输入总量里扣掉子集,扣减结果不小于 0(各协议原生口径与扣减落点见各 adapter 的 cost 文档,索引在 [Adapters SDK](../adapters/sdk/README.md))。
选恒互斥而不是「报什么记什么」,因为桶语义只有全局一致,逐桶乘单价相加的[成本估算](../../observability.md#换算成本价格表从哪来)、跨 agent 的用量对比、`t.maxTokens` 的上限判定才是同一个口径:coding agent 会话的缓存命中率常在九成以上,「含缓存总量」与「未缓存量」差一个数量级,两种口径混进同一个公式会把估算成本放大数倍。

「上下文总量」(三个输入桶相加)是消费端派生量,不落盘;`inputTokens` 本身就是未缓存输入。
轮数与工具调用数不属于 `Usage`——它们是 `events.json` 的行为派生(与 `o11y.json` 同源),show 的 usage 展示从两处组装(口径单源见 [`AttemptUsage` 组装口径](../reports/components/attempt-detail/attempt-usage.md#组装口径单源))。

### facts：运行事实

`facts` 记录生命周期代码主动上报的**运行环境观测**:键值标量,回答「这次实际看到了什么」——记忆库起步有多少条笔记、恢复自哪份 checkpoint、远端服务返回了哪个版本。
它是运行后的审计证据，不是配置入口，也不是缓存键。

- **上报通道**:各作用域上下文的 `fact(key, value)`,与 `progress` / `diagnostic` 并列的第三条观察通道(声明见 [Sandbox hooks](../sandbox/library.md)、[Experiment hooks](../experiments/architecture.md)、[AgentContext](../adapters/architecture/agent-contract.md#agentcontext))。
  三条通道语义互斥:`progress` 是不落盘的短期状态,`diagnostic` 是需要回顾的异常 observation,`fact` 是中性的环境事实。
- **归属跟随作用域**:sandbox hook、agent setup/teardown、adapter send 上报的进 `AttemptRecord.facts`;experiment setup/teardown 上报的进 `RunMeta.facts`。
  runner 自动归属,调用方不能指定层级。
- **形状**:key 匹配 `[a-z0-9._-]{1,64}`,value 是 `string | number | boolean` 标量。
  同一作用域内同 key 后写覆盖先写——fact 是现刻观测,不是追加日志;需要留痕迹的过程用 `diagnostic`。
- **不影响判定与复用**:facts 不参与 verdict、评分或指纹，也不能在携带决策前取得——experiment / sandbox setup 尚未运行时，runner 已经决定哪些 attempt 可以携带。
  计划内实验条件必须声明在 `flags`、model、agent、sandbox 配置或其它已有 fingerprint 输入中；依赖外部可变状态且无法配置化时用 `--rerun all` 重跑，再用 facts 审计实际状态。
  把「启用了哪个特性」只写成 fact 会让旧结果在条件变化后被错误携带。
- **运行时坐标的家就是这里**:隧道 / 反向代理 URL、服务端实例地址这类「每次跑都可能换、换了不改变 attempt 里发生什么」的连接坐标,是运行起来才存在的观测,报成 fact——写进 `flags` 会让每一次轮换作废全部已完成结果(整袋 `flags` 进指纹,没有逐键豁免)。
  与上一条不矛盾:**条件是你写下的,坐标是跑出来的**,判据与三个家的分工见 [Experiments · 运行时坐标不进配置](../experiments/library.md#运行时坐标不进配置三个家)。
- **要它跟着单条结果走就报在 attempt 作用域**:`AttemptRecord.facts` 随[携带条目](#resultjson)原样携带,携带来的那条读到的仍是产出它那一轮的观测,不被本轮的新值冒名顶替;`RunMeta.facts` 记的是本次运行整场的观测,携带条目不继承它。
  按 fact 分组的报告因此只读 attempt 级。
- **读取面原样转发**:facts 在 show 的 `facts:` 行、对照矩阵与 `--json` 中呈现，报告可按 [`fact()`](../reports/library/measures.md#维度与数值轴) 选轴分组；它能帮助确认两次执行实际处于什么环境，但不能反过来证明携带结果仍与当前外部状态相容。

## 证据 registry

artifact 的横切属性——存储形态、截断策略、`publish` 发布默认、存在性声明——单源在下面这张 registry 表,不散布在各小节各自维护清单。
writer(`run.writeAttempt`)的参数面、reader 的懒加载方法、`publish` 的 `artifacts` 词表与默认携带、[大值截断](#大值截断)的适用范围全部由这张表驱动;新增一种证据 = 加一行并声明类型与懒加载方法,不逐处扩清单。
`view --out` 的复制按「前端读什么带什么」判定,该名单跟随查看器的真实消费面、单源在 [View](../reports/view.md#静态导出),不是本表的一列。

| artifact | 词干 | 存储形态 | 类型 | 逐值截断 | `publish` 默认 | 内容职责 |
|---|---|---|---|---|---|---|
| `result.json` | —(恒存在) | attempt 级 | `AttemptRecord` | 不适用(摘要文件) | 恒复制 | 判定、断言、错误与诊断的权威记录 |
| `commands.json` | `commands` | attempt 级,按需 | `FailedCommandEvidence[]` | 不截(失败诊断的完整语义单位) | 带 | 非零 Sandbox 命令的 stdout/stderr |
| `events.json` | `events` | attempt 级,按需 | `StreamEvent[]` | 截 | 带 | 归一化标准事件流 |
| `trace.json` | `trace` | attempt 级,按需 | `TraceSpan[]` | 截 | 带 | OTel span 树 |
| `o11y.json` | `o11y` | attempt 级,按需 | `O11ySummary` | 不适用(派生缓存) | 带 | 行为计数缓存(见其小节) |
| `agent-setup.json` | `agentSetup` | attempt 级,按需 | `AgentSetupManifest` | 不适用(摘要文件) | 带 | 扩展与原生配置安装清单 |
| `diff.json` | `diff` | attempt 级,按需 | `DiffWindow[]` | 不截(完整语义单位) | 不带 | agent 归因增量 |
| `sources.json` + `sources/<sha256>.json` | `sources` | attempt 级引用 + Run 级去重仓库 | `SourcesRef` / `SourceBlob` | 不截(断言定位锚) | 带(解引用后按内容重新去重) | attempt 引用的 eval 源码,按内容哈希去重存储 |

- **词干**是 artifact 在全部程序面共用的名字:`AttemptRecord.artifacts` 的取值、`publish` 的 `artifacts` 选项、reader 懒加载方法名(`attempt.events()` 等)都用同一枚词干,不另造别名。
- 按需 artifact 空数据不落文件;存在性由 `AttemptRecord.artifacts` 声明,读取面的懒加载(缺失返回 `null`)独立成立、不依赖该声明。
- 词表当前是封闭集:每一行在 core 内都有类型与消费方。
  第三方自带证据种类的开放注册不在本表范围——没有消费方的落盘只是死重量;该方向作为提案属 roadmap。

## Attempt 级文件

### `commands.json`

Runner 对公开 `Sandbox.runCommand()` / `runShell()` 的最外层调用自动记录**非零退出命令**。
证据在 `CommandResult` 返回调用方之前写入内存，因此 Eval 后续即使只把 `.slice(-500)` 拼进异常，NiceEval 仍保有调用边界看到的原始 stdout/stderr。
文件形状：

```typescript
interface FailedCommandEvidence {
  /** 与 PhaseTiming.children 中 key="sandbox.command" 的节点 id 相同。 */
  timingNodeId: string;
  phase: LifecyclePhase;
  /** 与 TimingActivity.command.display 同一份有界脱敏命令；不含 env value。 */
  display: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

type CommandsArtifact = FailedCommandEvidence[];
```

- 只记录 `exitCode !== 0`；成功输出既可能巨大又通常没有诊断价值，不复制进第二份 artifact。
- stdout / stderr 原样全量落盘：失败输出的起因常在前段，测试 runner 的 summary 惯例在尾部，截哪一端都毁掉另一半诊断。
  只记非零退出已让体量天然有界，进入 Git / 静态托管前仍由 [`publish`](library.md#发布publish) 的整文件预检把守。
- 记录不改变 `runCommand` 的返回 / 抛错语义。
  调用方可以处理非零退出并继续，证据仍保留——「被处理」不等于「没发生」。
- provider 内部实现步骤、Agent 自己调用的 shell 不经过公开 Sandbox 包装，不伪装成这里的命令；前者只进 provider timing，后者来自 `events.json`。
- 携带条目按 `artifactBase` 读取原文件；发布携带与截断策略按[证据 registry](#证据-registry) 的 `commands` 行处理。
  `AttemptRecord.artifacts` 含 `commands` 只表示 writer 确实写过该文件。

### `events.json`

类型是 `StreamEvent[]`。
这是从 agent 原始 transcript 归一化后的标准事件流,也是作用域断言、transcript 展示、工具调用统计的主要来源。

常见事件包括:

- `message`: assistant / user 文本;
- `operation.started` / `operation.finished`: 工具或子 agent 操作的开始与结果,按 operation ID 配对;
- `skill.loaded`: Skill 加载;
- `input.requested`: HITL 输入请求;
- `thinking`: 思考块;
- `compaction`: 上下文压缩;
- `error`: 运行时或采集错误。

文件内容是一个 JSON array,不是 JSONL / NDJSON。
这里是最终逻辑会话的事件流；被自动重试吸收的物理失败事件保存在 `result.json` 的 `retryAttempts[].events`，不混进本数组。

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

  入口文件在 discovery 时登记，始终存在且标为 `entry`。
  其它项目文件在断言、给分记录或 `t.send` 的运行时帧首次引用时读取，标为 `referenced`。
  读取失败只在帧路径保留 unavailable 缺口，不制造没有正文的哈希引用。
  一个 attempt 恰好有一个 `entry`；读取面不按断言命中数猜主文件。
- **Run 级 `sources/<sha256>.json`**:去重仓库,内容按哈希建档——

  ```typescript
  interface SourceBlob {
    content: string;
  }
  ```

  同一 Run 内不管多少个 attempt 引用同一份源码(同一个 eval 文件被多个 attempt / 多个 eval 共享是常态——重试、或数组默认导出的多个 eval),内容只在 `sources/` 下存一份,按内容哈希(不是按路径)去重;哈希撞见即复用,不重写。

`niceeval view` 与 `AttemptHandle.sources()`(见 [Library](library.md))把两者拼回 `SourceArtifact[]`(`{path, content, role}[]`)供上层消费——消费方不需要知道落盘拆成了两层,只有直接读盘的脚本(`jq` / 手写工具)需要知道这个引用 + 仓库的两步解析。
`niceeval view` 用它把 `t.send`、断言和运行结果叠回源码行。

源码正文在每个 attempt 的 `SourceRegistry` 中按路径缓存。
入口正文来自 discovery；其它文件在第一条运行时帧引用它时同步读取一次。
收尾只写缓存，不重新读文件，因此运行期间修改 eval helper 不会让已记录行号对应到后来版本的正文。
项目路径必须经过真实路径规范化并确认仍在 config 所在根目录内。

携带条目不在新 Run 里重写 `sources.json` 或 `sources/`——沿用其它 artifact 同样的 `artifactBase` 回退:读取面按 `artifactBase` 定位到原 Run,原 Run 的 `sources.json` 引用 + 原 Run 自己的 `sources/` 去重仓库依然完整,不需要复制。
`publish` 发布时则相反——产物必须自包含,不能带 `artifactBase` 回退指针,所以复制时把引用解引用出完整内容后,在目标 Run 里按内容重新去重落盘(见 [Library](library.md)「复制与瘦身」)。

### `trace.json`

类型是 `TraceSpan[]`。
只有 agent 声明 tracing 能力、运行器收到 OTLP span 并成功归一化时才会生成。
它回答「各步骤耗时多久、父子关系是什么」,与回答「做了什么」的 `events.json` 分开。

`TraceSpan.kind` 是 view 识别的核心字段,来自 canonical GenAI 语义角色:

- `turn`
- `model`
- `tool`
- `agent`
- `other`

原生 span 名和属性仍保留在 `name` / `attributes` 里,但 view 的分组与着色只应依赖 canonical 字段。

### `o11y.json`

类型是 `O11ySummary`:从 `events.json` 派生的**行为计数缓存**——工具调用计数、读写文件、shell 命令、web fetch、错误、思考块、压缩次数与轮数。

它是本格式中唯一的落盘派生物,定位是缓存而非权威:`events.json` 体积大,而行为计数被指标(如 `assistantTurns`)与 show 的 usage 行高频消费,逐次重扫不划算。
缓存契约与报告派生数据一致——同一 niceeval 版本写读,删除后可从 `events.json` 重算;与 `events.json` 直接派生的结果不一致时,以 `events.json` 为准。
token 用量、成本与耗时**不在**本文件:权威分别是 `result.json` 的 [`Usage`](#usage)、`estimatedCostUSD` 与 `durationMs` / `phases`,同一事实不落第二份;这也保证本文件严格满足「可从 `events.json` 重算」——runner 计时本就不是事件流的派生物。

诊断路线上它面向人和脚本:attempt 失败时先看 `result.json` 的 `verdict` / `error`,再看 `events.json` 与 `o11y.json`,通常能分清是断言没过、agent runtime 错误,还是 adapter / provider / timeout 问题。

### `agent-setup.json`

类型是 `AgentSetupManifest`。
沙箱型 Coding Agent Adapter 用它记录该 Attempt 实际安装的 Skill、Agent Native Plugin、MCP Server、Python Plugin 与官方原生配置文件。
Manifest 保存来源、固定 ref、Plugin / Skill 名和可公开的解析版本；原生配置文件只保存 Agent 名、项目相对路径与原始字节的 SHA-256，不保存文件正文，也不保存 API Key、Token 或其它环境变量值。

它不参与评分，只提供复现与诊断证据。
没有安装扩展或原生配置文件的 Adapter 不生成该文件。
完整边界见 [Coding Agent 扩展](../adapters/architecture/coding-agent-extensions.md#manifest)。

### `diff.json`

内容是 [agent 归因增量](../sandbox/architecture.md#变更归因send-窗口与分类账)——只含 agent 在 send 窗口内的改动,fixture 与校验材料不在其中,消费方不需要再过滤。
**落盘的是逐窗口 delta 序列,不做跨窗口压缩**:窗口之间可能夹着 eval 侧写入,把同一文件压成一对 before/after 会把 eval 的修改夹带进 agent 的账里,「创建又删除」「改完又改回」这类净零变化也会被压没:

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
  /**
   * 内容不内联、只记字节数的文件:二进制,或超过单文件阈值(1 MiB)的文本。
   * 存在时 before / after 缺席;status 与变更事实照常记录。
   */
  elided?: { reason: "binary" | "oversized-text"; beforeBytes?: number; afterBytes?: number };
}
```

读取面(`AttemptHandle.diff()`)在窗口序列之上**派生**文件级视图——派生物可随时重算,不落盘,符合「聚合在消费方」铁律:

```typescript
interface DiffData {
  windows: DiffWindow[];                       // 落盘事实,原样
  files: Record<string, DiffFileSummary>;      // 派生:每个被 agent 触及的文件一条
  /**
   * 该文件最后一个触及窗口结束时的内容;净删除、从未触及或内容被省略(elided)返回 undefined,
   * 三者用 DiffFileSummary 区分。t.sandbox.diff.get 对内容被省略的文件改为报证据不可用错误
   * (含 reason 与字节数),语义见 Sandbox 契约——断言面要大声,渲染面要不崩。
   */
  get(path: string): string | undefined;
}

interface DiffFileSummary {
  /** 净效果:首个触及窗口的起点 vs 最后触及窗口的终点;"none" = 动过但净无变化(创建又删除、改回原样)。 */
  net: "added" | "modified" | "deleted" | "none";
  /** 触及该文件的窗口标签,按时序。 */
  windows: string[];
  /** 内容被省略的文件带省略原因;省略语义单源在 WindowChange.elided。 */
  elided?: "binary" | "oversized-text";
}
```

断言语义按这两层各取所需：`fileChanged(path)` 断「任一窗口触及」，`net` 供只关心最终结果的消费方；单文件 patch 按窗口逐段渲染。
它只存在于 Sandbox Attempt；Direct Agent 没有由 NiceEval 管理的 workspace，因此没有 diff。

## 大值截断

Agent 的一次工具调用可以产出任意大的输出——一条递归 grep 撞进 minified bundle,单行就能有几 MB,`head -100` 这类行数护栏拦不住。
OTLP instrumentation 又常把同一份工具结果原样挂进 span 属性。
不设上限时,单个 attempt 的 `events.json` 与 `trace.json` 能一起长到上百 MB,远大于同一个 attempt 的 `diff.json`。
所以写入面对**落盘的字符串值**统一设上限。

**运行时全量,落盘截断。**
截断只发生在 artifact 序列化的那一刻:断言、`t.*` 作用域查询与 `o11y.json` 的派生统计在内存里看到的始终是完整值。
**截断永远不影响判定**——落盘是证据,不是评分输入。

契约:

- **落点唯一**:`run.writeAttempt()`(见 [Library](library.md))。
  不在 adapter、不在 OTLP 解析、不在事件归一化里做——任何 adapter、任何 sandbox 产出的 artifact 都被同一条规则约束,adapter 作者不需要记得截断。
- **适用范围**:逐 artifact 的截断策略位单源在[证据 registry](#证据-registry),本节维护规则与理由——命中「截」的是 `events.json` 的事件字段与 `trace.json` 的 span 属性里的**任意字符串值**。
  不只工具输出——`thinking` 文本、`error` 消息同样可能爆。
  registry 表「逐值截断」列标「不适用」的摘要/缓存类文件(`result.json` / `o11y.json` / `agent-setup.json` / `run.json`)不参与这条逐值截断。
  `commands.json` 不截断:失败命令的起因常在输出前段、测试 runner 的 summary 惯例在尾部,截哪一端都毁掉另一半诊断,且它只收非零退出命令,体量天然有界。
  `sources.json` 与 `sources/` 不截断:源码是断言定位的锚,且已按内容去重。
  `diff.json` 不截断:它的每个文件是完整语义单位,截断后就不是一份能 apply 的证据。
  未被逐值截断的文件和累计后的 artifact 总量统一由 [`publish`](library.md#发布publish) 的发布预算回退。
- **上限**:每个字符串值 256 KiB(UTF-8 字节),常量 `ARTIFACT_VALUE_MAX_BYTES`。
  截断按 UTF-8 字符边界回退,不切断多字节字符。
- **没有 flag、没有配置项。**
  「需要完整落盘」的场景不存在:评分看的是运行时全量,诊断一条失控命令 256 KiB 绰绰有余(足够看清它 grep 进了 `node_modules`)。
  给旋钮只会让某天有人把它调大、再把仓库塞爆。

被截断的值保留前 256 KiB,末尾追加一行人可读 marker:

```text
…(前 256 KiB 内容)
[niceeval] truncated 51467156 → 262144 bytes
```

marker 只服务直接 `cat` / `jq` 的人。
程序判断走结构化字段——`StreamEvent` 与 `TraceSpan` 各多一个可选 `truncated`:

```typescript
interface Truncation {
  /** 被截断的位置:事件里是字段名，span 里是 attribute key。 */
  path: string;
  /** 截断前的 UTF-8 字节数。 */
  originalBytes: number;
}
```

view 显示「输出过大,已截断(原始 51.5 MB)」靠的是它,不是正则匹配 marker:「只给文本等于逼消费方正则解析」与 [Sample Issue](../sample/library.md#issue-code-全集) 是同一条原则。

两条明确不做:

- **不对 span 属性做去重。**
  同一份工具结果被 instrumentation 同时挂在 `output.value`(OpenInference 约定)与 `gen_ai.tool.call.result`(GenAI semconv)下、两份字节完全相同,是现实中会遇到的写法。
  截断之后两份各 256 KiB,重复的代价可忽略;而去重要判定「哪个 key 是 canonical」,那是 agent 侧的属性约定,core 不猜——`tagSpan` 的「raw 属性只增不改」继续成立。
- **writer 不设单文件总量上限。**
  逐值上限防的是一条失控命令在 events、span 属性和后续 LLM input 中反复膨胀,不承诺整个文件小于某个值。
  writer 不能在文件预算耗尽时猜该丢哪条事件、哪个 span 或哪份源码;本地结果仍忠实落盘。
  进入 Git / 静态托管前必须走 `publish`,由发布边界做整文件预检,不能把「每个值至多 256 KiB」误读成「整个文件发布安全」。

`truncated` 是新增可选字段,按[版本规则](#版本与升级设计)不递增 `schemaVersion`——老读取器读到的仍然是字符串。
截断只对新写入生效:`publish` 不改 artifact 内容,历史上落下的超大文件不会被追溯截断;它会在发布预检中被明确拒绝,而不是原样进入一个注定无法 push 的目录。

这条规则只约束 niceeval 的**持久化边界**。
Agent runtime 在把工具结果发给模型前仍需自己的字节预算:如果一个工具层先把 50 MB 输出完整送进模型请求并收到 413,`writeAttempt` 只能阻止这 50 MB 随后把 `events.json` / `trace.json` 撑爆,不能让已经失败的请求恢复成功。
运行时 transport 限流与结果落盘截断是两个独立护栏,不能拿其中一个替代另一个。

## locator 的唯一性

**作用域是一个记录根。**
`resolveLocator` 在一个打开的 Record 里寻址,所以「不能撞」的范围就是这个记录根扫到的全部 attempt——不是一个 Run,也不是全局。
60 bit 在 10⁶ 条 attempt 下的碰撞概率约 `4.3 × 10⁻⁷`,10⁵ 条约 `4.3 × 10⁻⁹`。

**locator 是派生值,撞了不能靠重算躲开。**
输入是 `{runId, evalId, attempt}` 这个不可变元组,同样的输入永远得到同样的 body。
所以碰撞不是「换个随机数再试」,而是必须有定义的两侧行为:

- **写入侧**:runner 在 attempt 登记时查当前记录根的 locator 索引。
  已存在且身份元组不同,抛 `LocatorCollisionError` 并中止该 attempt——不静默覆盖,也不悄悄换一个值,否则同一条 attempt 在不同进程里会有两个 locator。
- **读取侧**:`resolveLocator` 命中多于一条时抛 `AmbiguousLocatorError`,列出候选的 experimentId / evalId / attempt,不返回其中任意一条。
  返回一条会让用户看着别人的 attempt 却以为是自己那条,比报错严重。

三种失败因此各自可分辨:语法不合法是 `MalformedLocatorError`,索引里没有是 `LocatorNotFoundError`,索引里有多条是 `AmbiguousLocatorError`。

**位宽是可辨认性与手输成本的折中。**
locator 要被人从终端复制、粘进 URL、肉眼比对,所以它的长度是 DX 成本而不只是编码细节。
14 字符(`@` + scheme + 12 位 body)在上面的碰撞量级下已经远离危险区;继续加宽只是把一个已经可忽略的概率变得更小,代价是每次下钻都多打几个字符。

## 读取规则

编程消费用 [`openRecord`](library.md)——布局知识全部被库消化。
手工(`jq` / 脚本)读的路线:

1. 定位 Run:`.niceeval/<experiment>/` 下最新的时间戳目录,读 `run.json` 确认身份与版本。
2. 逐 attempt 读 `<evalId>/a<attempt>/result.json` 拿判定、断言、用量、成本、`locator`。
3. 需要证据时读同目录的 `commands.json`、`events.json`、`trace.json`、`sources.json`、`o11y.json`、`agent-setup.json`、`diff.json`;携带条目按 `artifactBase`(相对记录根)回原 Run 取。
   `sources.json` 只是引用,内容在 `<Run 根>/sources/<sha256>.json`——携带条目要去原 Run 的 `sources/`,不是当前 Run 的。

两种非正常落盘的判定:

- **未收尾 Run**:`run.json` 缺 `completedAt`——进程中断,已落盘的 attempt 全部可读,只是集合可能不完整;读取/选择面如实读出并产生结构化 `unfinished-run` Issue。
- **incomplete 目录**：有 Attempt 文件、没有 `run.json`。
  读取面不能证明这些文件属于哪次 Run，因而不合成 Attempt 或 Verdict；它把整目录列入 `record.unreadable`（reason `"incomplete"`），Sample 再投影成 `unreadable-run` Issue。
  原始文件留在盘上供修复与取证。

`niceeval view` 的本地 server 只暴露 `.json` artifact,并把请求路径限制在 view 输入根目录内。
`--out` 导出时 Run 聚合数据烘焙进 `index.html`,查看器要 fetch 的 artifact 复制到 `artifact/` 下同布局路径。

## 与其它 reporter 的边界

这篇只描述默认 `Artifacts()` reporter 的本地目录格式。
`Json(path)` reporter 写的是机器可读的当次 Invocation 全量汇总(`InvocationSummary`,含跨实验聚合),用途不同;这是需要审计瞬时调用边界时的 opt-in 出口,不是 `.niceeval/` 持久化实体。
第三方实验平台 reporter 可以把同一批 `EvalResult` 转成自己的格式。

因此,不要在文档或工具里假设本地结果有 `results.jsonl`、transcript NDJSON 或固定测试输出文件。
当前稳定契约是:

- Run 级: `run.json`、`sources/<sha256>.json`(eval 源码去重仓库);
- attempt 级文件的全集、截断与发布属性单源在[证据 registry](#证据-registry);
- 每个文件都是 JSON,不是 JSONL。

## 相关阅读

- [README](README.md) —— 三层分工、库的边界、消费方。
- [Library](library.md) —— `niceeval/record` 的 TS 读写 API。
- [参考方案](reference/README.md) —— 格式与版本策略从哪些系统学来。
- [Sample](../sample/README.md) —— 从记录选出一份可比较的样本。
- [Reports](../reports/README.md) —— 建立在样本之上的积木。
