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
  "schemaVersion": 6,
  "producer": {
    "name": "niceeval",
    "version": "0.12.0"
  },
  "experimentId": "dev-e2b/codex-e2b",
  "agent": "codex",
  "startedAt": "2026-07-11T07:29:54.871Z"
}
```

版本历史:`1` 初版;`2`(2026-07)= `ExperimentRunInfo.flags` 改名 `params`;`3`(2026-07-10)= 改回 `flags`(A/B feature flag 语义定稿,见 memory 的 experiment-flags-naming-reversal 条目);`4`(2026-07-11)= 落盘单位从 run 改为快照——实验目录在外层,快照元数据住 `snapshot.json`,判决住 attempt 级 `result.json`(裁决背景见 memory 的 results-per-snapshot 条目);`5` = `result.json` 新增 `locator`(不透明的 Attempt 定位符,见「`result.json`」),`sources.json` 从逐 attempt 内联全量源码改为「attempt 级引用 + 快照级 `sources/<sha256>.json` 去重仓库」;`6` = `error` 从自由字符串改为带 lifecycle operation/code/message 的结构化错误,并新增有界 `diagnostics`。

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
  /** 实验运行配置(flags / runs / earlyExit / sandbox / timeoutMs / budget),快照内全部 attempt 共享。 */
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
  durationMs: number;
  /** Runner 阶段计时，按执行顺序；只记录实际发生的阶段。 */
  phases?: PhaseTiming[];
  assertions: AssertionResult[];
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
   * 不透明的 Attempt 定位符:`@` + 1 位 scheme 字符 + 7 位 base36 body(如 `@1x7f3q9k`)。
   * 由 `{experimentId, 快照 startedAt, evalId, attempt}` 这个不可变身份元组确定性派生——
   * 不是数组下标、不是磁盘路径。非携带条目由 writer 落盘时算出;携带条目(见下)原样复制
   * 上一轮的值,从不重算(原快照的 startedAt 已经不在本轮快照里,重算会算出不同的字符串)。
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

type PhaseName =
  | "sandbox.queue"
  | "sandbox.create"
  | "sandbox.setup"
  | "baseline"
  | "eval.setup"
  | "agent.setup"
  | "agent.tracing"
  | "test"
  | "diff"
  | "score"
  | "trace";

interface PhaseTiming {
  name: PhaseName;
  /** 阶段耗时；失败阶段计到抛错或超时中断时。 */
  durationMs: number;
  /** 该阶段抛错或被超时中断；至多一条，且总在数组末尾。 */
  failed?: true;
}

type LifecycleOperationName =
  | "sandbox.provision" | "sandbox.setup" | "sandbox.teardown" | "sandbox.stop"
  | "workspace.prepare" | "workspace.diff"
  | "eval.setup" | "eval.run"
  | "agent.setup" | "agent.run" | "agent.teardown"
  | "telemetry.configure" | "telemetry.collect"
  | "scoring.evaluate";

interface AttemptError {
  /** 稳定、可供 CI/Agent 分支处理的机器码;未知异常使用 "unexpected-error"。 */
  code: string;
  /** 人可读的一层原因,不拼接整份 SDK response。 */
  message: string;
  /** runner 在错误发生时已经打开的 lifecycle operation。 */
  operation: LifecycleOperationName;
  /** 原异常有 stack 时保留,供 show 展开;终端即时反馈不整段打印。 */
  stack?: string;
  /** 下层 SDK/OS 错误的有限摘要。 */
  cause?: { name?: string; code?: string; message: string };
}

interface DiagnosticRecord {
  code: string;
  level: "warning" | "error";
  message: string;
  operation: LifecycleOperationName;
  data?: Readonly<Record<string, JsonValue>>;
  /** 相同 dedupeKey 折叠后的出现次数;省略等于 1。 */
  count?: number;
}
```

`phases` 缺失表示结果不是由带阶段计时的 runner 产出。数组顺序就是执行顺序；不适用、未定义或没有执行的阶段不写 0 值条目。阶段边界、失败封口、与 `durationMs` 的口径以及安装基准消费方式见 [Phase Timings 与安装基准](../../engineering/benchmark/README.md)。

`error` 与 `diagnostics` 都使用 runner 已绑定的 lifecycle operation,调用方不能自行填写 phase/scope。两者的区别是结果语义:`error` 是让 attempt 进入 `errored` 的致命原因,至多一个;`diagnostics` 是运行仍可继续或收尾时发现的问题,可以与 passed/failed/errored 任一 verdict 共存。`diagnostic.level` 表达消息严重度,不是 verdict 的别名。

`progress` 文本不写入任何 artifact。它是运行时可覆盖状态,保存每一帧既无法还原可靠因果,也会让高频 SDK/工具进度无限放大结果。事后回顾依靠 `phases`、`error`、`diagnostics` 与可选的 `events.json` / `trace.json`。trace 不是必需兜底:provision 发生在 telemetry 之前,teardown 发生在 trace collect 之后,没有 tracing 的 provider 也必须留下同样完整的错误摘要。

attempt 的结果封口发生在 cleanup、teardown 与 sandbox stop 之后;随后 `result.json` 与其它 attempt artifacts 原子写入。这样 teardown diagnostic 不会因为主 test 已经返回而丢失。进程在封口前被强杀时,该 attempt 仍属于未完成,不会留下一个伪装完整的 `result.json`。

快照级字段(`experimentId` / `agent` / `model` / 实验运行配置)不在这里重复——reader 把 `snapshot.json` 的声明拼进每条读回的结果(`attempt.result`),拼合规则是「缺才补」:条目自带的值优先,`startedAt` 只在记录缺失时回退快照的值;`locator` 同理「缺才补」,niceeval 自己的 writer 恒会写这个字段,只有第三方 harness 没实现它时读取面才按当前身份兜底算一份。

两类条目:

- **本快照跑出的条目**:artifact 与 `result.json` 同目录,不需要任何路径引用字段。
- **携带条目**(`--resume` 把上一轮已通过、fingerprint 匹配的结果合入本快照,让最新快照保持完整):`startedAt` 保留原条目的时刻,另带 `artifactBase`(相对结果根,指向原快照的 attempt 目录),`has*` 真值原样携带。`artifactBase` 就是事实上的「携带」标记。

`o11y.json` 和 `diff.json` 没有对应的 `has*` 标记;读取面的懒加载语义(缺失返回 `null`)吸收了存在性判断,见 [Library](library.md)。

## Attempt 级文件

### `events.json`

类型是 `StreamEvent[]`。这是从 agent 原始 transcript 归一化后的标准事件流,也是作用域断言、transcript 展示、工具调用统计的主要来源。

常见事件包括:

- `message`: assistant / user 文本;
- `action.called` / `action.result`: 工具调用与结果;
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

携带条目(`--resume` 合入)不在新快照里重写 `sources.json` 或 `sources/`——沿用其它 artifact
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

类型是 `AgentSetupManifest`。沙箱型 Coding Agent Adapter 用它记录该 Attempt 实际安装的 Skill、Agent Native Plugin、MCP Server 与 Python Plugin。Manifest 保存来源、固定 ref、Plugin / Skill 名和可公开的解析版本，不保存 API Key、Token 或其它环境变量值。

它不参与评分，只提供复现与诊断证据。没有安装这些扩展的 Adapter 不生成该文件。完整边界见 [Coding Agent 扩展](../adapters/architecture/coding-agent-extensions.md#manifest)。

### `diff.json`

类型是 `DiffData`:

```typescript
interface DiffData {
  generatedFiles: Record<string, string>;
  deletedFiles: string[];
}
```

它只存在于有沙箱 workspace diff 的运行。coding-agent eval 常用它验证文件修改结果;remote / in-process agent 不一定有 diff。

## 大值截断

Agent 的一次工具调用可以产出任意大的输出——一条递归 grep 撞进 minified bundle,单行就能有几 MB,`head -100` 这类行数护栏拦不住。OTLP instrumentation 又常把同一份工具结果原样挂进 span 属性。不设上限时,单个 attempt 的 `events.json` 与 `trace.json` 能一起长到上百 MB,远大于同一个 attempt 的 `diff.json`。所以写入面对**落盘的字符串值**统一设上限。

**运行时全量,落盘截断。** 截断只发生在 artifact 序列化的那一刻:断言、`t.*` 作用域查询与 `o11y.json` 的派生统计在内存里看到的始终是完整值。**截断永远不影响判决**——落盘是证据,不是评分输入。

契约:

- **落点唯一**:`snap.writeAttempt()`(见 [Library](library.md))。不在 adapter、不在 OTLP 解析、不在事件归一化里做——任何 adapter、任何 sandbox 产出的 artifact 都被同一条规则约束,adapter 作者不需要记得截断。
- **适用范围**:`events.json` 的事件字段与 `trace.json` 的 span 属性里的**任意字符串值**。不只工具输出——`thinking` 文本、`error` 消息同样可能爆。`result.json` / `o11y.json` / `snapshot.json` 只有定长摘要,不涉及。`sources.json` 与 `sources/` 不截断:源码是断言定位的锚,且已按内容去重。`diff.json` 不截断:它的每个文件是完整语义单位,截断后不再是一份能 apply 的证据,体积由 [`copySnapshots`](library.md#复制与瘦身copysnapshots) 的 artifact 白名单管理。
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

view 显示「输出过大,已截断(原始 51.5 MB)」靠的是它,不是正则匹配 marker:「只给文本等于逼消费方正则解析」与 [Selection 警告](library.md#警告-kind-全集) 是同一条原则。

两条明确不做:

- **不对 span 属性做去重。** 同一份工具结果被 instrumentation 同时挂在 `output.value`(OpenInference 约定)与 `gen_ai.tool.call.result`(GenAI semconv)下、两份字节完全相同,是现实中会遇到的写法。截断之后两份各 256 KiB,重复的代价可忽略;而去重要判定「哪个 key 是 canonical」,那是 agent 侧的属性约定,core 不猜——`tagSpan` 的「raw 属性只增不改」继续成立。
- **不设单文件总量上限。** 现实中的爆炸是单值爆炸(一条失控命令),不是一万条正常 span 累加。加文件预算就要回答「超了丢哪一条」,那是有看法的取舍,不属于忠实落盘。

`truncated` 是新增可选字段,按[版本规则](#版本与升级设计)不递增 `schemaVersion`——老读取器读到的仍然是字符串。截断只对新写入生效:`copySnapshots` 不改 artifact 内容,历史上落下的超大文件不会被追溯截断。

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
