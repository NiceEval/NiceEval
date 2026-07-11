# Results Format —— 结果保存格式

这篇记录 `Artifacts()` 报告器写到本地磁盘的格式,也是 `niceeval view` 的离线输入契约。实现入口是 `src/runner/reporters/artifacts.ts`;核心类型在 `src/types.ts` 的 `RunSummary`、`EvalResult`、`StreamEvent`、`TraceSpan`、`O11ySummary` 和 `DiffData`。

## 目录结构

默认输出根目录是 `.niceeval/`。每次 run 一个时间戳目录,时间戳来自 `Date#toISOString()`,并把 `:` 与 `.` 替换成 `-`:

```text
.niceeval/
  2026-07-02T03-10-24-123Z/
    summary.json
    <evalId>/<agent>/<model>[/<experiment>]/a<attempt>/
      events.json
      sources.json
      trace.json
      o11y.json
      diff.json
```

`<evalId>/<agent>/<model>[/<experiment>]/a<attempt>/` 是单个 eval attempt 的工件目录。`evalId` 里的 `/` 会保留为目录层级,其它不适合路径的字符会替换成 `_`;`agent` 和 `model` 里的非 `[\w.@-]` 字符也会替换成 `_`。没有 model 时目录名是 `default`。带 experimentId 的结果多一段实验目录(`/` 压成 `_`,如 `compare-prompts_concise`)——两个实验可以同 agent 同 model、只差 flags,少了这一段工件会互相覆盖。

这些文件是按需写入的:某类数据为空就不生成对应 JSON 文件。`summary.json` 在 run 结束时写入;attempt 级重数据在每个 eval 完成时增量写入,所以长 run 中途失败时通常仍能留下已经完成的 attempt 工件。

## 版本与升级设计

`summary.json` 顶层带最小的版本元数据(writer 在 `src/results/writer.ts`,`Artifacts()` reporter(`src/runner/reporters/artifacts.ts`)是它的薄壳;常量在 `src/runner/types.ts` 的 `RESULTS_FORMAT` / `RESULTS_SCHEMA_VERSION`):

```json
{
  "format": "niceeval.results",
  "schemaVersion": 2,
  "producer": {
    "name": "niceeval",
    "version": "0.12.0"
  },
  "startedAt": "2026-07-02T03:10:24.123Z",
  "results": []
}
```

版本历史:`1` 初版;`2`(2026-07)= `ExperimentRunInfo.flags` 改名 `params`;`3`(2026-07-10)= 改回 `flags`(A/B feature flag 语义定稿,见 docs/reports.md 裁决记录)。持久化字段改名是破坏性变更,按下述规则递增,不做旧名读取别名。

设计原则是**不做兼容机制**。没有迁移函数,没有多版本 normalize loader,没有 per-artifact 版本号:整个 run(summary + 全部 attempt 工件)共用顶层这一个 `schemaVersion`。读取器只认与自己相同的版本;版本不同就是不兼容,唯一的处理是提示用写这份报告的 niceeval 版本查看:

```bash
npx niceeval@0.3.0 view .niceeval/2026-09-10T08-00-00-000Z
```

字段规则:

- `format` 必须等于 `"niceeval.results"`。它既避免把其它工具的 `summary.json` 误读成 niceeval,也是版本不匹配时识别「这是一份 niceeval 报告」的依据。
- `schemaVersion` 用整数,只在**破坏兼容读取**时递增。新增可选字段、新增 artifact 文件、新增 `StreamEvent` variant 不递增;读取器必须忽略未知字段和未知 artifact 文件。
- `producer.version` 是写这份报告的 npm package 版本,唯一用途是拼 npx 提示;它不是 schema 判断依据。
- `format` / `schemaVersion` / `producer` 三个字段永久稳定:任何未来版本都不能移动、重命名或改变类型,否则版本不匹配时连 npx 提示都给不出来。
- 缺版本字段的存量文件等价于 `schemaVersion: 1`(引入版本号不改变其余格式)。这批文件没有 `producer.version`,将来不兼容时提示只能是模糊的「用 0.1.x 旧版查看」——所以 writer 越早开始写版本元数据越好。
- attempt 文件保持裸 JSON array/object。`events.json` 继续是 `StreamEvent[]`,不为塞版本号改成 `{ schemaVersion, data }` envelope;`jq`/`node` 直接读数组的体验不被打破。
- 不要用目录名表达 schema。`.niceeval/<timestamp>/` 和 attempt 目录只表达身份与定位;版本全部在 `summary.json` 里,复制、重命名、归档目录不影响解析。

### 版本不匹配时的读取行为

读取器不解析、不迁移、不降级渲染任何版本不同的 run,行为只分三档:

- **`schemaVersion` 相同**(或缺失,按 1 处理):正常读取渲染。
- **`format === "niceeval.results"` 但 `schemaVersion` 不同**(不论新旧):整个 run 视为不兼容。目录扫描时在列表里留一个占位条目,标出 run 目录和 `producer.version`,并提示:

  ```text
  ⚠ .niceeval/2026-09-10T08-00-00-000Z: written by niceeval 0.4.6 (schemaVersion 1);
    this CLI reads schemaVersion 2.
    Run `npx niceeval@0.4.6 view .niceeval/2026-09-10T08-00-00-000Z` to view it.
  ```

  单文件模式 `niceeval view <run>/summary.json` 输出同样的提示后退出,而不是报「不是 niceeval summary」。
- **不能识别**(没有 `format`,也不满足 legacy 的 `results[]` + `startedAt` 启发式):当作无关 JSON 忽略。

实现入口:版本判定只有一份,在 `src/results/format.ts` 的 `classifySummary`(view 经 `openResults` 消费);目录扫描的占位数据经 `viewData.skippedRuns` 进前端,由 `src/view/app/App.tsx` 的 incompatible-banner 渲染(三种原因:incompatible-version / malformed / incomplete);单文件模式在 `src/view/data.ts` 抛 `IncompatibleResultsError`,`src/cli.ts` 的 `exitOnIncompatibleResults` 打印提示退出;提示文案是 i18n key `cli.view.incompatible`(niceeval 落盘)与 `cli.view.incompatibleForeign`(第三方 harness,不拼 npx)。

报告里最小应新增的字段是:

```typescript
interface ResultFormatMeta {
  format: "niceeval.results";
  schemaVersion: number;
  producer?: {
    name: "niceeval";
    version?: string;
    commit?: string;
  };
}
```

这组字段应该放进 `RunSummary`,但 eval 作者的运行时 API 不需要看见它们;它们属于 reporter / view 的持久化契约。

## `summary.json`

`summary.json` 是瘦身后的 `RunSummary`,负责让控制台、`--resume` 和 `niceeval view` 先拿到榜单级信息。前三个字段(`format` / `schemaVersion` / `producer`)是上文的版本元数据:

```typescript
interface RunSummary {
  format?: "niceeval.results";
  schemaVersion?: number;
  producer?: { name: string; version?: string; commit?: string };
  name?: LocalizedText;
  agent: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  snapshots?: Record<string, { startedAt?: string; knownEvalIds?: string[] }>;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  durationMs: number;
  usage?: Usage;
  estimatedCostUSD?: number;
  results: EvalResult[];
  outputDir?: string;
}
```

两处顶层字段的语义:`producer.name` 是任意字符串——第三方 harness 经 `createRunWriter` 写结果时如实署名,`"niceeval"` 只是官方 writer 的取值;`snapshots` 是可选的快照级元数据(键 = experimentId):`startedAt` 让同一 run 里的多份快照各自保真开始时刻,`knownEvalIds` 是该实验已知的 eval 并集——残缺检测的分母随数据走(`copySnapshots` 发布时自动补记,writer 侧可声明),可选新增字段,不递增 schemaVersion。

`results[]` 里的每条 `EvalResult` 仍包含判定、断言、用量、成本、错误、fingerprint 和 experiment 元数据,但不会内联大字段:

- `events`
- `sources`
- `trace`
- `o11y`
- `diff`
- `rawTranscript`

这些字段被替换成 attempt 工件引用:

```typescript
{
  "artifactsDir": "weather/brooklyn/codex/gpt-5/a1",
  "hasEvents": true,
  "hasTrace": true,
  "hasSources": true
}
```

`artifactsDir` 是相对当前 run 目录的路径。`niceeval view` 读取 `summary.json` 后,会把它补成:

- `artifactBase`: 相对 view 输入根目录的路径,供前端请求 `/artifact?p=...`;
- `artifactAbsBase`: 本机绝对路径,供 UI 复制或展示。

注意:当前 summary 只有 `hasEvents`、`hasTrace`、`hasSources` 三个存在标记。`o11y.json` 和 `diff.json` 会写盘,但 summary 里还没有对应 `hasO11y` / `hasDiff` 标记;读取方需要按路径尝试读取或先检查文件存在。

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

类型是 `SourceArtifact[]`:

```typescript
interface SourceArtifact {
  path: string;
  content: string;
}
```

它只包含本次 test/断言通过 `loc` 引用到的 eval 源码片段。`niceeval view` 用它把 `t.send`、断言和运行结果叠回源码行。

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

这个文件面向人和调试脚本:当一个 attempt 失败时,先看 `summary.json` 的 `verdict` / `error`,再看 `events.json` 与 `o11y.json`,通常能分清是断言没过、agent runtime 错误,还是 adapter / provider / timeout 问题。

### `diff.json`

类型是 `DiffData`:

```typescript
interface DiffData {
  generatedFiles: Record<string, string>;
  deletedFiles: string[];
}
```

它只存在于有沙箱 workspace diff 的运行。coding-agent eval 常用它验证文件修改结果;remote / in-process agent 不一定有 diff。

## 读取规则

读取结果时优先从 `summary.json` 开始:

1. 读 `.niceeval/<run>/summary.json`,先用 `results[]` 判断 pass / fail / error / skip、耗时、成本和断言失败。
2. 对需要下钻的 result,用 `artifactsDir` 拼出 attempt 目录。
3. 按 `hasEvents` / `hasTrace` / `hasSources` 拉取 `events.json`、`trace.json`、`sources.json`。
4. 需要行为摘要或 workspace diff 时,尝试读取同目录的 `o11y.json` / `diff.json`。

`niceeval view` 的本地 server 只暴露 `.json` 工件,并把请求路径限制在 view 输入根目录内。`--out` 导出时 summary 聚合数据烘焙进 `index.html`,查看器要 fetch 的工件复制到 `artifact/` 下同布局路径。

## 与其它 reporter 的边界

这篇只描述默认 `Artifacts()` reporter 的本地目录格式。`Json(path)` reporter 写的是机器可读全量 JSON,用途不同;第三方实验平台 reporter 可以把同一批 `EvalResult` / `RunSummary` 转成自己的格式。

因此,不要在文档或工具里假设本地结果有 `results.jsonl`、transcript NDJSON 或固定测试输出文件。当前稳定契约是:

- run 级: `summary.json`;
- attempt 级: `events.json`、`sources.json`、`trace.json`、`o11y.json`、`diff.json`;
- 每个文件都是 JSON,不是 JSONL。
