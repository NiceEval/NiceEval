# Library 候选

本页只定义静态作者契约。
业务字段继续以 Eval、Experiment、Reports、Sandbox 和 Adapters 的 Feature 契约为单源，本候选只重构字段归属与类型关系。

## Definition 阶段分离

作者输入不携带路径、factory 或规划器生成的字段。
下列辅助形状中的 `EvalAuthorFields` 代表对应 Feature 已经定义的作者自有字段，但不包含 test。
`ExperimentAuthorFields` 代表 Experiment 的作者自有字段。

```ts
type EvalAuthorInput<Context> = EvalAuthorFields & {
  id?: never;
  scoring?: never;
  configHash?: never;
  test(t: Context): Promise<void> | void;
};

type EvalInput = EvalAuthorInput<TestContext>;
type ScoreEvalInput = EvalAuthorInput<ScoreTestContext>;

interface EvalDefinition<
  Scoring extends "pass" | "points",
  Context,
> extends EvalAuthorFields {
  readonly scoring: Scoring;
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
通过制与计分制在 factory 返回后仍保留精确的 `scoring` 与 test context，不退化成共同的可选字段。

Experiment 使用同一条阶段规则：

```ts
type ExperimentInput = ExperimentAuthorFields & {
  id?: never;
};

interface ExperimentDefinition extends ExperimentAuthorFields {}

interface DiscoveredExperiment extends ExperimentDefinition {
  readonly id: string;
}

function defineExperiment(input: ExperimentInput): ExperimentDefinition;
```

作者代码中的以下调用必须成为类型错误：

```ts
defineEval({ id: "weather", test: async () => {} });
defineEval({ scoring: "points", test: async () => {} });
defineExperiment({ id: "codex", agent });
```

运行时 factory 继续拒绝这些字段，覆盖 JavaScript 与显式绕过类型的调用。

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
运行时规范化仍检查动态导入对象，但 TypeScript 字面量不再等到装载期才发现缺字段。

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

因此 `{ name, command, url }` 在 agent factory 调用处失败。
`assertMcpServers()` 继续为无类型配置输出带 server 名的 setup 错误。

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

两个字段都缺或同时出现时不能编译。
`optionId` 是否属于该请求的动态 options，继续在 `respond()` 运行时校验。

## Aggregate 在输入处证明键空间

冲突关系属于 `aggregate()` 的 options，不属于返回行的事后描述：

```ts
type AggregateKeyConflict<Groups, Values> =
  | Extract<keyof Groups, keyof Values>
  | Extract<keyof Groups | keyof Values, "refs">;

declare const AGGREGATE_KEY_CONFLICT: unique symbol;

type AggregateKeyDiagnostic<Key extends PropertyKey> = {
  readonly [AGGREGATE_KEY_CONFLICT]:
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

`AggregateKeyDiagnostic` 是只服务错误展示的内部类型。
它让 TypeScript 的诊断包含冲突键名，不新增运行时字段，也不要求作者填写占位属性。

以下两类调用必须失败：

```ts
aggregate(sample, {
  by: { agent },
  values: { agent: passRate },
});

aggregate(sample, {
  by: { refs: agent },
  values: { passRate },
});
```

## EvidenceRow 证明至少一个读数字段

```ts
type KeysMatching<Row, Value> = {
  [Key in keyof Row]-?: Row[Key] extends Value ? Key : never;
}[keyof Row];

type MetricKeys<Row> = KeysMatching<Row, MetricValue>;

type WithMetricField<Fields extends object> =
  [MetricKeys<Fields>] extends [never] ? never : Fields;

function evidenceRow<const Fields extends object>(
  fields: WithMetricField<Fields>,
): Fields & EvidenceRow;
```

`evidenceRow({ agent: "codex" })` 因没有可证明的 MetricValue 字段而失败。
从 JSON 得到的宽对象先经过运行时解析和收窄，再进入该构造器；不通过宽 overload 绕开证明。

## 图表字段按值类别过滤

字段属性不能只用 `string`，也不能接受包含 `refs` 在内的任意 `keyof Row`。
候选按字段角色导出或内部复用以下键类型：

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
  series?: EvidenceDimensionKey<Row>;
  point?: EvidenceDimensionKey<Row>;
}
```

external 分支使用 `ExternalAxisKey<Row>`，并继续禁止 `pointTarget`。
`Bars.sort.field` 使用与该分支可排序值一致的过滤键，而非普通 `string`。

`Scatter`、`Line`、`Bars` 和 `Area` 保持泛型函数组件签名，让 JSX 从 `points` 推断 Row。
运行时仍验证 JSON 行、字段跨行一致性、有限数字和 MetricValue 结构。

## Custom Sandbox case 推导 group keep

`group-keep` 由 handlers 的存在推导，不进入作者可填写 capability 集合：

```ts
type DeclaredSandboxCapability = Exclude<
  SandboxCapability,
  "group-keep"
>;

interface CustomEnvironmentCaseInput {
  identity: JsonValue;
  capabilities?: readonly DeclaredSandboxCapability[];
  materialize(ctx: SandboxMaterializeContext):
    Promise<CustomMaterializeResult>;
  groupKeep?: GroupKeepHandlers;
}

type CustomEnvironmentCaseFor<
  Input extends CustomEnvironmentCaseInput,
> = Omit<Input, "capabilities"> & (
  Input extends { groupKeep: GroupKeepHandlers }
    ? {
        readonly capabilities: readonly (
          | DeclaredSandboxCapability
          | "group-keep"
        )[];
      }
    : {
        readonly capabilities?: readonly DeclaredSandboxCapability[];
      }
);

function defineSandboxCase<
  const Input extends CustomEnvironmentCaseInput,
>(input: Input): CustomEnvironmentCaseFor<Input>;
```

`CustomEnvironmentCaseFor<Input>` 在 `groupKeep` 存在时把 `"group-keep"` 加进规范化 capabilities。
作者仍显式声明 `services`，因为它是 provider 承诺，不由一次 materialize 返回值自动推断。

## Factory 产物使用私有品牌

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
运行时 `isThemeDefinition()` / `isReportDefinition()` 使用同一 symbol，继续拒绝无类型普通对象。

## Sandbox recipe 的局部类型与跨定义 link

PLAN-9 的 SandboxRecipe 同样使用模块私有 kind 品牌。
`defineSandboxRecipe()` 只能产生 command-only recipe。
`composeSandbox()`、`dockerImageSandbox()`、`e2bSandbox()` 等具体 factory 原子地产生 template-bearing recipe，并同时带出 Provider。四个 lifecycle 方法保留原 kind，公共调用面不提供 `.template()`、`.provider()` 或 recipe concat。

这让 TypeScript 能在单个声明内证明：作者不能用对象字面量伪造 recipe，command 链不能突然增加 template，template factory 的原生起点参数必填，Window command 也不能读取 Attempt context。

Eval 与 Experiment 的 `sandbox` 字段则故意接受同一个 branded SandboxRecipe union。两份定义位于独立模块，实际组合还取决于 selector，因此普通 `tsc` 不能证明 pair 上恰好一份 template。该 XOR 由 discovery 后的 `linkSandboxMatrix()` 证明，并由 `niceeval check`、`--dry` 与正常运行共同消费；它不是等到 Sandbox lifecycle 才执行的宽松后备。

精确 recipe、phase context 与 linker 形状见 [环境模型 PLAN-9](../../design/environment-model/PLAN-9/library.md)。
