# Library

本页只定义静态作者契约。
业务字段以 Eval、Experiment、Reports、Sandbox 和 Adapters 的功能契约为单源，本页只定义字段归属与类型关系。

## 三级反馈

同一条不变量在三个位置说同一句话，区别只是作者什么时候看到它。

| 级别 | 出现时机 | 产出者 | 形态 |
|---|---|---|---|
| 类型反馈 | 编辑器里写下这一行；`pnpm run typecheck` | TypeScript | tsc 诊断，光标停在出错属性上 |
| 装载期反馈 | 加载配置、Eval 与 Experiment 文件时 | `define*` 与 `assert*` 运行时守卫 | 抛出的错误消息，点名字段与下一步 |
| link 反馈 | discovery 与 selector 完成后，任何 Provider 动作之前 | 跨定义 linker | 按配对聚合的错误码与计数 |

每个契约族下面按同一顺序给三段：合法调用、被拒绝的调用连同它的 tsc 诊断、绕过类型后的运行时反馈。
诊断文本按 `tsc --noEmit --strict --pretty false` 的输出抄录。
运行时文本是同一条不变量在守卫处的消息。

## 禁止字段的两种写法

作者不该填写的字段有两种排除方式，按“这个字段会不会被读回”选：

| 场景 | 写法 | 得到的诊断 |
|---|---|---|
| 只作输入，字段不会从这个类型上被读回 | 模块私有诊断类型 | `Type 'string' is not assignable to type 'IdComesFromFilePath'.` |
| union 成员的负字段，消费侧要读同名字段 | `never` | `Type 'string' is not assignable to type 'undefined'.` |

诊断类型把原因写进类型名，读者不必回头查这个属性为什么必须是 `undefined`。
`never` 换来的是消费侧干净：`server.url` 在 union 上是 `string | undefined`，改用诊断类型会变成 `string | UrlBelongsToHttpTransport | undefined`，把作者面的措辞漏进读取侧。

诊断类型共用一个不导出的 symbol：

```ts
declare const CONTRACT_DIAGNOSTIC: unique symbol;

type IdComesFromFilePath = {
  readonly [CONTRACT_DIAGNOSTIC]: "id comes from the file path";
};

type EvaluationKindComesFromFactory = {
  readonly [CONTRACT_DIAGNOSTIC]: "evaluationKind comes from defineEval / defineScoreEval";
};

type ConfigHashComesFromPlanning = {
  readonly [CONTRACT_DIAGNOSTIC]: "configHash comes from run planning";
};
```

symbol 不从包入口导出，因此这些字段在包外没有任何可写入的值。
字符串字面量属性只服务于阅读类型定义时的解释，不产生运行时字段。

## Definition 阶段分离

作者输入不携带路径、factory 或规划器生成的字段。
下列辅助形状中的 `EvalAuthorFields` 代表对应 Feature 已经定义的作者自有字段，但不包含 test。
`ExperimentAuthorFields` 代表 Experiment 的作者自有字段。

```ts
type EvalAuthorInput<Context> = EvalAuthorFields & {
  id?: IdComesFromFilePath;
  evaluationKind?: EvaluationKindComesFromFactory;
  configHash?: ConfigHashComesFromPlanning;
  test(t: Context): Promise<void> | void;
};

type EvalInput = EvalAuthorInput<TestContext>;
type ScoreEvalInput = EvalAuthorInput<ScoreTestContext>;

type EvaluationKind = "pass" | "points";

interface EvalDefinition<
  Kind extends EvaluationKind,
  Context,
> extends EvalAuthorFields {
  readonly evaluationKind: Kind;
  test(t: Context): Promise<void> | void;
}

function defineEval(input: EvalInput): EvalDefinition<"pass", TestContext>;
function defineScoreEval(
  input: ScoreEvalInput,
): EvalDefinition<"points", ScoreTestContext>;

type AnyEvalDefinition =
  | EvalDefinition<"pass", TestContext>
  | EvalDefinition<"points", ScoreTestContext>;
```

`id` 只在发现阶段加入，`configHash` 只属于规划和 Run 身份。
通过制与计分制在 factory 返回后仍保留精确的 `evaluationKind` 与 test context，不退化成共同的可选字段。

Experiment 使用同一条阶段规则：

```ts
type ExperimentInput = ExperimentAuthorFields & {
  id?: IdComesFromFilePath;
};

interface ExperimentDefinition extends ExperimentAuthorFields {}

interface DiscoveredExperiment extends ExperimentDefinition {
  readonly id: string;
}

function defineExperiment(input: ExperimentInput): ExperimentDefinition;
```

合法调用：作者只写自己选择的行为，id 由 `evals/weather/eval.ts` 这样的路径给出。

```ts
// evals/weather/brooklyn.eval.ts → id: weather/brooklyn
export default defineEval({
  description: "布鲁克林天气查询",
  timeoutMs: 120_000,
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");
    t.succeeded();
    t.check(t.reply, includes("晴"));
  },
});
```

被拒绝的调用：

```ts
defineEval({ id: "weather", test: async () => {} });
defineEval({ evaluationKind: "points", test: async () => {} });
defineEval({ configHash: "8f21", test: async () => {} });
defineExperiment({ id: "codex", agent });
```

```text
eval.ts(1,14): error TS2322: Type 'string' is not assignable to type 'IdComesFromFilePath'.
eval.ts(2,14): error TS2322: Type 'string' is not assignable to type 'EvaluationKindComesFromFactory'.
eval.ts(3,14): error TS2322: Type 'string' is not assignable to type 'ConfigHashComesFromPlanning'.
eval.ts(4,20): error TS2322: Type 'string' is not assignable to type 'IdComesFromFilePath'.
```

同一批调用写在 `.js` 文件里或经过 `as` 断言时，装载期守卫给出同一判定：

```text
defineEval 不接受 id —— id 由文件路径推导。
defineEval 不接受 evaluationKind —— 恒定为 "pass"(通过制)。计分制请用 defineScoreEval。
defineExperiment 不接受 id —— id 由文件路径推导。
```

## PageDefinition 使用依赖字段联合

普通页可以选择自己的 load，也可以直接消费宿主 Sample。
参数化页必须提供 params、load，并明确退出无参数导航。

```ts
interface PageBase<Input> {
  id: string;
  title: LocalizedText;
  render: PageRender<Input>;
}

interface PlainPageDefinition<Input = Sample> extends PageBase<Input> {
  params?: never;
  navigation?: boolean;
  load?: PageLoad<void, Input>;
}

interface ParameterizedPageDefinition<Params, Input>
  extends PageBase<Input> {
  params: PageParams<Params>;
  navigation: false;
  load: PageLoad<Params, Input>;
}

type PageDefinition<Params = void, Input = Sample> =
  | PlainPageDefinition<Input>
  | ParameterizedPageDefinition<Params, Input>;
```

`defineReport()` 保持从 pages 元组推断每页 Params 与 Input。
这里用 `never` 而不是诊断类型：规范化代码要读 `page.params` 判断分支，负字段必须收窄成 `undefined`。

合法调用：

```ts
const overview: PageDefinition = {
  id: "overview",
  title: "总览",
  render: (sample) => <Scoreboard points={sample} />,
};

const evalDetail: PageDefinition<{ evalId: string }, EvalDetail> = {
  id: "eval-detail",
  title: "Eval 详情",
  params: evalDetailParams,
  navigation: false,
  load: async (base, params) => loadEvalDetail(base, params.evalId),
  render: (detail) => <EvalTimeline detail={detail} />,
};
```

被拒绝的调用：参数化页缺 load，以及参数化页留在导航里。

```text
report.ts(3,14): error TS2322: Type '{ id: string; title: string; render: (detail: EvalDetail) => string; params: PageParams<{ evalId: string; }>; navigation: false; }' is not assignable to type 'PageDefinition<{ evalId: string; }, EvalDetail>'.
  Property 'load' is missing in type '{ id: string; title: string; render: (detail: EvalDetail) => string; params: PageParams<{ evalId: string; }>; navigation: false; }' but required in type 'ParameterizedPageDefinition<{ evalId: string; }, EvalDetail>'.
report.ts(11,14): error TS2322: Type '{ id: string; ... navigation: true; load: () => Promise<{ evalId: string; }>; }' is not assignable to type 'PageDefinition<{ evalId: string; }, EvalDetail>'.
  Types of property 'navigation' are incompatible.
    Type 'true' is not assignable to type 'false'.
```

装载期反馈保持不变，涵盖动态导入的页对象：

```text
Report page "eval-detail" declares params but no load — a parametrized page needs load to turn params into its render input. Add load: (base, params, ctx) => ...
Report page "eval-detail" declares params but not navigation: false — a parametrized page has no content without params, so it must not appear in navigation. Add navigation: false.
```

## McpServer 使用互斥结构联合

MCP transport 继续按形状判别，不新增重复的 `kind`。
每个分支明确禁止另一分支的字段：

```ts
interface McpStdioServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  url?: never;
  headers?: never;
}

interface McpHttpServer {
  name: string;
  url: string;
  headers?: Record<string, string>;
  command?: never;
  args?: never;
  env?: never;
}

type McpServer = McpStdioServer | McpHttpServer;
```

合法调用：两个分支各写各的字段。

```ts
const servers: McpServer[] = [
  { name: "memory", command: "npx", args: ["-y", "@mempal/mcp"] },
  { name: "search", url: "https://search.example.com/mcp/" },
];
```

被拒绝的调用：

```ts
const bad: McpServer = {
  name: "memory",
  command: "npx",
  url: "https://mem.example.com/mcp/",
};
```

```text
agent.ts(1,14): error TS2322: Type '{ name: string; command: string; url: string; }' is not assignable to type 'McpServer'.
  Types of property 'url' are incompatible.
    Type 'string' is not assignable to type 'undefined'.
```

`assertMcpServers()` 继续为无类型配置输出带 server 名的装载期错误：

```text
MCP server "memory" 同时给出了 command 和 url——二选一:本地 stdio 进程写 command,远程 Streamable HTTP 端点写 url。
```

## HITL answer 使用精确 XOR

请求引用与回答值分开建模，`RespondAnswer` 和 adapter `InputResponse` 复用同一个二选一关系：

```ts
type AnswerValue =
  | { readonly optionId: string; readonly text?: never }
  | { readonly text: string; readonly optionId?: never };

type RespondAnswer = {
  readonly request: InputRequest;
} & AnswerValue;

type InputResponse = {
  readonly requestId: string;
} & AnswerValue;
```

合法调用：

```ts
await t.respond({ request, optionId: "approve" });
await t.respond({ request, text: "改用 pnpm" });
```

被拒绝的调用：两个字段同时出现，以及两个都不写。

```text
eval.ts(1,14): error TS2322: Type '{ request: InputRequest; optionId: string; text: string; }' is not assignable to type 'RespondAnswer'.
  Types of property 'text' are incompatible.
    Type 'string' is not assignable to type 'undefined'.
eval.ts(7,14): error TS2322: Type '{ request: InputRequest; }' is not assignable to type 'RespondAnswer'.
  Type '{ request: InputRequest; }' is not assignable to type '{ readonly request: InputRequest; } & { readonly text: string; readonly optionId?: undefined; }'.
    Property 'text' is missing in type '{ request: InputRequest; }' but required in type '{ readonly text: string; readonly optionId?: undefined; }'.
```

`optionId` 是否属于该请求的动态 options，继续在 `respond()` 运行时校验；两个字段都缺同样保留运行时消息：

```text
t.respond 的对象形式需要 optionId 或 text 二选一(两者都没给)。
回答 "approve" 不是请求 req-3 的可选项(retry / abort)。
```

## Aggregate 在输入处证明键空间

冲突关系属于 `aggregate()` 的 options，不属于返回行的事后描述：

```ts
type AggregateKeyConflict<Groups, Values> =
  | Extract<keyof Groups, keyof Values>
  | Extract<keyof Groups | keyof Values, "refs">;

type AggregateKeyDiagnostic<Key extends PropertyKey> = {
  readonly [CONTRACT_DIAGNOSTIC]:
    `aggregate key conflict: ${Extract<Key, string>}`;
};

type NoAggregateKeyConflict<Groups, Values> =
  [AggregateKeyConflict<Groups, Values>] extends [never]
    ? unknown
    : AggregateKeyDiagnostic<AggregateKeyConflict<Groups, Values>>;

function aggregate<
  const Groups extends GroupFunctions,
  const Values extends CalculationFunctions,
>(
  sample: Sample,
  options: {
    by: Groups;
    values: Values;
  } & NoAggregateKeyConflict<Groups, Values>,
): Promise<readonly AggregateRow<Groups, Values>[]>;
```

诊断类型的实例化参数就是冲突键，因此键名进入 tsc 输出。
它不新增运行时字段，也不要求作者填写占位属性。

合法调用：两侧键不相交。

```ts
const rows = await aggregate(sample, {
  by: { agent: byAgent },
  values: { passRate: passRateOf },
});
```

被拒绝的调用：重名键，以及任一侧使用保留键 `refs`。

```ts
aggregate(sample, { by: { agent }, values: { agent: passRate } });
aggregate(sample, { by: { refs: agent }, values: { passRate } });
```

```text
report.ts(1,26): error TS2345: Argument of type '{ by: { agent: GroupFn; }; values: { agent: CalcFn; }; }' is not assignable to parameter of type '{ by: { readonly agent: GroupFn; }; values: { readonly agent: CalcFn; }; } & AggregateKeyDiagnostic<"agent">'.
  Property '[CONTRACT_DIAGNOSTIC]' is missing in type '{ by: { agent: GroupFn; }; values: { agent: CalcFn; }; }' but required in type 'AggregateKeyDiagnostic<"agent">'.
report.ts(2,26): error TS2345: Argument of type '{ by: { refs: GroupFn; }; values: { passRate: CalcFn; }; }' is not assignable to parameter of type '{ by: { readonly refs: GroupFn; }; values: { readonly passRate: CalcFn; }; } & AggregateKeyDiagnostic<"refs">'.
  Property '[CONTRACT_DIAGNOSTIC]' is missing in type '{ by: { refs: GroupFn; }; values: { passRate: CalcFn; }; }' but required in type 'AggregateKeyDiagnostic<"refs">'.
```

对应的运行时消息保留键名：

```text
aggregate key "agent" appears in both by and values
aggregate by must not use reserved key "refs"
aggregate values must not use reserved key "refs"
```

## EvidenceRow 证明至少一个读数字段

```ts
type KeysMatching<Row, Value> = {
  [Key in keyof Row]-?: Row[Key] extends Value ? Key : never;
}[keyof Row];

type MetricKeys<Row> = KeysMatching<Row, MetricValue>;

type EvidenceNeedsMetric = {
  readonly [CONTRACT_DIAGNOSTIC]:
    "evidence row needs at least one MetricValue field";
};

type WithMetricField<Fields extends object> =
  [MetricKeys<Fields>] extends [never] ? EvidenceNeedsMetric : unknown;

function evidenceRow<const Fields extends object>(
  fields: Fields & WithMetricField<Fields>,
): Fields & EvidenceRow;
```

证明写成交叉项而不是替换整个参数类型。
参数保持 `Fields`，作者仍能得到字段级补全；缺读数时 tsc 报缺少诊断属性，而不是 `not assignable to parameter of type 'never'`。

合法调用：

```ts
const row = evidenceRow({
  agent: "codex",
  passRate: metricValue({
    value: 0.82,
    samples: 41,
    total: 50,
    basis: "attempt",
    evidence: attempts,
  }),
});
```

被拒绝的调用：只有维度字段。

```ts
evidenceRow({ agent: "codex" });
```

```text
report.ts(1,14): error TS2345: Argument of type '{ agent: "codex"; }' is not assignable to parameter of type '{ readonly agent: "codex"; } & EvidenceNeedsMetric'.
  Property '[CONTRACT_DIAGNOSTIC]' is missing in type '{ agent: "codex"; }' but required in type 'EvidenceNeedsMetric'.
```

运行时守卫涵盖 JSON 与 JavaScript 调用：

```text
evidenceRow requires at least one MetricValue field
```

### 动态数据经过独立校验函数

从 JSON、数据库或外部 API 得到的对象是 `unknown`，静态上没有可证明的 MetricValue 字段。
这类值走一个显式校验入口，不给 `evidenceRow()` 保留接收宽对象的 overload：

```ts
function parseEvidenceRow(value: unknown): EvidenceRow;
function parseEvidenceRows(value: unknown): readonly EvidenceRow[];
```

`parseEvidenceRow()` 在运行时完成 `evidenceRow()` 的类型证明所做的同一件事：确认对象至少有一个 MetricValue 字段，确认其余字段是维度可用的标量，然后返回带品牌的行。
它的失败消息点名字段：

```text
parseEvidenceRow: field "passRate" must be a MetricValue ({ value, unit? }), got string
parseEvidenceRow: row needs at least one MetricValue field, got only dimensions (agent, model)
```

两个入口的分工是固定的：字面量写 `evidenceRow()`，得到编译期证明与精确的行类型；外部数据写 `parseEvidenceRow()`，得到运行时证明与统一的 `EvidenceRow`。
宽对象因此没有一条既跳过类型证明又跳过运行时证明的路径。

## 图表字段按值类别过滤

字段属性不能只用 `string`，也不能接受包含 `refs` 在内的任意 `keyof Row`。
按字段角色导出或内部复用以下键类型：

```ts
type EvidenceAxisKey<Row> = KeysMatching<
  Row,
  MetricValue | string | boolean
>;

type EvidenceDimensionKey<Row> = KeysMatching<
  Row,
  string | number | boolean
>;

type ExternalAxisKey<Row> = KeysMatching<Row, ExternalScalar>;

interface EvidenceMarkProps<Row extends EvidenceRow> {
  points: readonly Row[];
  x: EvidenceAxisKey<Row>;
  y: EvidenceAxisKey<Row>;
  color?: EvidenceDimensionKey<Row>;
  series?: EvidenceDimensionKey<Row>;
  point?: EvidenceDimensionKey<Row>;
}
```

external 分支使用 `ExternalAxisKey<Row>`，并继续禁止 `pointTarget`。
`Bars.sort.field` 使用与该分支可排序值一致的过滤键，而非普通 `string`。

`Scatter`、`Line`、`Bars` 和 `Area` 保持泛型函数组件签名，让 JSX 从 `points` 推断 Row。

合法调用：

```tsx
<Scatter points={rows} x="agent" y="passRate" />
```

被拒绝的调用：字段名写错，以及把 `refs` 当作可绘制字段。

```tsx
<Scatter points={rows} x="agent" y="passRat" />
<Scatter points={rows} x="refs" y="passRate" />
```

```text
report.tsx(1,25): error TS2820: Type '"passRat"' is not assignable to type 'EvidenceAxisKey<{ readonly agent: "codex"; readonly passRate: MetricValue; } & EvidenceRow>'. Did you mean '"passRate"'?
report.tsx(2,25): error TS2322: Type '"refs"' is not assignable to type 'EvidenceAxisKey<{ readonly agent: "codex"; readonly passRate: MetricValue; } & EvidenceRow>'.
```

拼错字段是这一族里最常见的作者错误，`TS2820` 直接给出正确拼写。
运行时仍验证 JSON 行、字段跨行一致性、有限数字和 MetricValue 结构，因为 `parseEvidenceRows()` 得到的行只带统一的 `EvidenceRow`。

## Agent evidence coverage 必须穷尽

`defineAgent()` 与 `defineSandboxAgent()` 都要求完整的 `EvidenceCoverage`。全通道完整时使用常量：

```ts
defineAgent({
  name: "support-bot",
  evidenceCoverage: completeEvidenceCoverage,
  send,
});
```

手写声明必须列出六个通道；partial / unavailable 必须带原因，complete 不能带原因。字段形状与消费语义单源在 [Adapter evidence](../adapters/architecture/evidence.md)。

下面两种输入都在调用点失败：

```ts
defineAgent({
  name: "support-bot",
  evidenceCoverage: {
    events: { status: "partial" }, // 缺 reason
    // actions / messages / usage / status / data 也缺失
  },
  send,
});
```

```text
agent.ts(3,3): error TS2739: Type '{ events: { status: "partial"; }; }' is missing the following properties from type 'EvidenceCoverage': actions, messages, usage, status, data
```

JavaScript 或类型断言绕过静态入口时，Agent 构造器在 discovery 前检查同一形状；不把缺字段规范化成含糊的 unknown 状态。

## Custom Sandbox 的输出边界

自定义 case 不填写 capability 字符串；声明与创建结果都用闭合 ADT，伴随资源定位和运行事实也是必填纯数据：

```ts
import { Effect } from "effect";

type CustomCaseServices =
  | { readonly _tag: "Supported" }
  | { readonly _tag: "Unsupported" };

type CustomCaseMaterializedServices =
  | { readonly _tag: "None" }
  | { readonly _tag: "Available"; readonly value: ServiceController };

interface CustomMaterializeResult {
  readonly sandbox: Sandbox;
  readonly group: SandboxResourceGroup;
  readonly services: CustomCaseMaterializedServices;
  readonly facts: JsonValue;
  readonly retention?: never;
}

interface CustomSandboxCaseInput {
  readonly identity: JsonValue;
  readonly targetPlatform: SandboxTargetPlatform;
  readonly services: CustomCaseServices;
  materialize(
    ctx: SandboxMaterializeContext,
  ): Effect.Effect<CustomMaterializeResult, CustomSandboxMaterializationError>;
}

declare function defineSandboxCase(
  input: CustomSandboxCaseInput,
): SandboxLayer<"template-bearing">;
```

`sandbox`、`group`、`services` 与 `facts` 是每个 case 都必须兑现的完成态；`group.resources` 也是必填 `JsonValue`。
没有 services 返回 `{ _tag: "None" }`，有 services 返回 `{ _tag: "Available", value }`，并与声明侧的 `Supported` / `Unsupported` 一致。
跨进程留存需要可发现的 provider identity 与 detached 实现，不能由一次 callback 临时声明，因此输入与返回值都没有 `retention`、`wake` 或 capability 数组。

合法调用直接返回完整的主执行空间与伴随资源：

```ts
defineSandboxCase({
  identity: { provider: "kubernetes", manifestDigest: "sha256:..." },
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  services: { _tag: "Supported" },
  materialize: (ctx) => Effect.promise(async () => ({
    sandbox: await createMainPod(ctx),
    group: namespaceResourceGroup,
    services: { _tag: "Available", value: podServiceController },
    facts: { namespace: "eval-prod" },
  })),
});
```

被拒绝的调用是在 callback 上拼接留存能力：

```ts
defineSandboxCase({
  identity: { provider: "fly" },
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  services: { _tag: "Unsupported" },
  materialize: () => Effect.succeed({
    sandbox,
    group,
    services: { _tag: "None" },
    facts: {},
    retention,
  }),
});
```

```text
sandbox.ts(4,30): error TS2322: Type 'SandboxRetention' is not assignable to type 'undefined'.
```

运行时仍对 JavaScript 与类型断言绕过检查同一边界。
非法声明和 `--keep-sandbox` 在创建资源前报错。
callback 缺必填字段、返回未知能力字段或 services ADT 前后不一致时，结果不会进入完成态；系统会尽力整组回收已创建资源。

## Factory 定义使用私有品牌

Theme 与 Report 的公开定义包含各自模块私有的 symbol 属性。
symbol 不从包入口导出，因此普通对象无法构造出可赋值类型：

```ts
declare const THEME_DEFINITION: unique symbol;
declare const REPORT_DEFINITION: unique symbol;

interface ThemeDefinition extends Readonly<ReportTheme> {
  readonly kind: "theme";
  readonly [THEME_DEFINITION]: true;
}

interface ReportDefinition {
  readonly kind: "report";
  readonly [REPORT_DEFINITION]: true;
  // 其余规范化字段保持 Reports Feature 的定义。
}
```

`defineTheme()` 与 `defineReport()` 是品牌的唯一构造点。

品牌承诺的范围要说清楚：它证明类型层面无法伪造，不承诺运行时无法伪造。
symbol 由 `Symbol.for()` 取得，任何代码都能拿到同一个全局 symbol 并写出结构相同的对象。
运行时 `isThemeDefinition()` / `isReportDefinition()` 因此只是判别器，用来拒绝普通对象与旧写法，不是安全边界。

被拒绝的调用：手写对象冒充 theme。

```ts
const theme: ThemeDefinition = {
  kind: "theme",
  colors: { accent: "#0f766e" },
};
```

```text
report.ts(1,7): error TS2741: Property '[THEME_DEFINITION]' is missing in type '{ kind: "theme"; colors: { accent: string; }; }' but required in type 'ThemeDefinition'.
```

合法调用走 factory，颜色的语法仍由运行时校验：

```ts
const theme = defineTheme({ colors: { accent: "#0f766e" } });
```

```text
defineTheme colors.accent must be an opaque six-digit sRGB hex (#RRGGBB), got "teal".
```

## Sandbox layer 的局部类型与跨定义 link

SandboxLayer 同样使用模块私有 kind 品牌。
`sandboxLayer()` 只能产生 command-only layer。
`dockerComposeSandbox()`、`dockerSandbox()`、`e2bSandbox()` 等具体 factory 原子地产生 template-bearing layer，并同时带出 Provider。`prepare()` 链保留原 kind，公共调用面不提供 `.template()`、`.provider()` 或 layer concat。

这让 TypeScript 能在单个声明内证明：作者不能用对象字面量伪造 layer，command 链不能突然增加 template，template factory 的原生起点参数必填。

被拒绝的调用：字面量伪造 layer，以及 factory 缺必填选项。

```ts
export default defineEval({
  sandbox: { kind: "template-bearing", prepare: (c) => c },
  test: async () => {},
});

dockerComposeSandbox({});
```

```text
eval.ts(2,3): error TS2322: Type '{ kind: "template-bearing"; prepare: (c: SandboxCommand) => SandboxCommand; }' is not assignable to type 'SandboxLayer | undefined'.
  Property '[SANDBOX_LAYER]' is missing in type '{ kind: "template-bearing"; prepare: ... }' but required in type 'TemplateBearingLayer'.
eval.ts(6,23): error TS2741: Property 'file' is missing in type '{}' but required in type 'DockerComposeSandboxOptions'.
```

Eval 与 Experiment 的 `sandbox` 字段则故意接受同一个 branded SandboxLayer union。
两份定义位于独立模块，实际组合还取决于 selector，因此普通 `tsc` 不能证明配对上恰好一份 template。

该 XOR 由 discovery 后的纯 link 步骤证明，并由 `niceeval check`、`--dry` 与正常运行共同消费；它不是等到 Sandbox lifecycle 才执行的宽松后备。
link 反馈按配对聚合，一次报全：

```text
sandbox.template-conflict: Experiment "memory/codex" and
Eval "terminal-bench/play-zork-easy" both declare a template

  eval:       dockerComposeSandbox(...) at evals/.../eval.ts
  experiment: e2bSandbox({ template: "mempal-codex-v3" }) at experiments/codex.ts

NiceEval starts one Sandbox Case and does not merge or prioritize templates.
Remove one template or split the Experiment's Eval selection.
17 conflicting pairs were found. No Sandbox was created.
```

精确 layer、command context 与配对检查表见 [Sandbox Layer](../sandbox/layers.md)。

## 作者视角的完整走查

按反馈级别看同一批错误怎么依次出现，见 [三级反馈走查](use-case/three-levels.md)。
