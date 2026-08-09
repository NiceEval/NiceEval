# promptfoo 断言、计分与聚合作者指南

本文观察 promptfoo 怎样让评估作者定义成功条件、分数与批次指标。
官方事实均指向官方文档、官方仓库、npm 发布元数据或官方 API reference。
标成“研究判断”的内容是本文对这些事实的解释，不是 promptfoo 的兼容承诺。

## 1. 定位与真实边界

promptfoo 是一个 Node.js CLI 与库。
作者用 YAML、JSON、CSV、JavaScript 或 Python 配置 prompt、provider、测试数据和断言。
一次 eval 展开 prompt、provider 与 test 的组合，再为每个输出执行断言和聚合。

本文盘点与断言、scorer、grader、metric、判定和聚合直接有关的公开作者面：

- `assert`、`threshold`、`weight`、`metric`、`assert-set` 与 `derivedMetrics`；
- 字符串缩写、CSV 特殊列、Assertion Template 和外部文件引用；
- 确定性、模型辅助、工具调用、trajectory、trace 与自定义断言；
- 测试 provider 与 grader provider 的替换层级；
- 输出变换、结果对象、诊断文件、CI 与既有输出再次判分；
- CLI、Node API、JavaScript、Python、Ruby 和 webhook 扩展点。

本文不枚举与判分无关的 provider 参数、部署方式、观测 SDK 或红队插件。
类型系统允许开放的 `promptfoo:redteam:${string}` 断言族，但它不构成一个可固定枚举的通用断言 catalog。

promptfoo 的最小评分单位是一个 prompt-provider-test 组合产生的输出。
它不是按 Agent 运行 scope 提供 typed matcher 的行为断言库，也没有 NiceEval 式的证据完整度或 `unavailable`。
这条边界会影响跳过、缺失 trace 与 grader 故障的表达方式。

## 2. 观察版本和一手链接

观察日期是 2026-08-09。
npm 的 `latest` 是 `0.122.0`，其 `gitHead` 是 `7b898cbdb16205cb7f0e2994baa807d131eb2326`。
GitHub 当日 `HEAD` 是 `49c0f6d77496c022c6d32e362522993bb0d72d42`，因此本文以发布 commit 为实现证据。

| 编号 | 一手材料 | 本文用途 |
|---|---|---|
| P0 | [npm 0.122.0](https://www.npmjs.com/package/promptfoo/v/0.122.0)、[registry metadata](https://registry.npmjs.org/promptfoo/0.122.0)、[发布 commit](https://github.com/promptfoo/promptfoo/tree/7b898cbdb16205cb7f0e2994baa807d131eb2326) | 版本、Node 要求、发布代码 |
| P1 | [Assertions & Metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/)、[配置 reference](https://www.promptfoo.dev/docs/configuration/reference/) | 公共配置形状、聚合、metric |
| P2 | [断言类型源码](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/types/index.ts#L521-L861) | `GradingResult`、66 个基础类型、`Assertion`、`AssertionSet`、`ScoringFunction` |
| P3 | [断言分派源码](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/assertions/index.ts#L122-L839) | handler、`not-*`、零权重、直接执行 API |
| P4 | [聚合源码](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/assertions/assertionsResult.ts) | 加权平均、门槛、具名分数、自定义 scorer |
| P5 | [确定性断言](https://www.promptfoo.dev/docs/configuration/expected-outputs/deterministic/)、[模型辅助断言](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/) | 各类型的参数、默认值与示例 |
| P6 | [字符串与 CSV 源码](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/csv.ts#L104-L386)、[测试数据文档](https://www.promptfoo.dev/docs/configuration/test-cases/) | 缩写 grammar 与 CSV 特殊列 |
| P7 | [Node API reference](https://www.promptfoo.dev/docs/usage/node-api-reference/)、[Node package](https://www.promptfoo.dev/docs/usage/node-package/) | `evaluate()`、`runAssertion()`、`runAssertions()`、函数签名 |
| P8 | [输出格式](https://www.promptfoo.dev/docs/configuration/outputs/)、[命令行](https://www.promptfoo.dev/docs/usage/command-line/)、[CLI 退出路径](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/node/doEval.ts#L1169-L1186) | JSON、JSONL、JUnit、退出码、重试 |
| P9 | [变换流程](https://www.promptfoo.dev/docs/configuration/reference/#transformation-pipeline)、[RAG 变换说明](https://www.promptfoo.dev/docs/guides/evaluate-rag/#transforming-rag-responses) | `transformResponse`、`transform`、`contextTransform` |
| P10 | [Trace 文档](https://www.promptfoo.dev/docs/tracing/)、[trajectory 与 trace 断言](https://www.promptfoo.dev/docs/configuration/expected-outputs/deterministic/#trajectorytool-used) | trace 输入与 Agent 轨迹 matcher |
| P11 | [JavaScript](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/)、[Python](https://www.promptfoo.dev/docs/configuration/expected-outputs/python/)、[Ruby](https://www.promptfoo.dev/docs/configuration/expected-outputs/ruby/) | 自定义断言协议 |
| P12 | [Echo provider](https://www.promptfoo.dev/docs/providers/echo/)、[直接检查既有输出](https://www.promptfoo.dev/docs/configuration/expected-outputs/#running-assertions-directly-on-outputs) | 无密钥入门、避免重新调用目标 provider |
| P13 | [CI 文档](https://www.promptfoo.dev/docs/integrations/ci-cd/)、[API reference](https://www.promptfoo.dev/docs/api-reference/)、[OpenAPI 1.0.0](https://api.promptfoo.app/static/openapi.json)、[release notes](https://www.promptfoo.dev/docs/releases/) | CI、企业版 re-evaluation 与 regrade |
| P14 | [transform contract](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/contracts/transform.ts)、[transform runner](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/util/transform.ts) | transform 签名、装载方式与失败语义 |
| P15 | [配置验证命令](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/commands/validate.ts#L461-L510)、[生成断言命令](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/commands/generate/assertions.ts#L133-L168)、[MCP `run_assertion`](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/commands/mcp/tools/runAssertion.ts) | 辅助生成、验证与单断言诊断 |

滚动文档在观察日已包含 2026-07 的更新。
若滚动页面与 `0.122.0` 源码冲突，本文分别写出文档说法与该发布版行为。

## 3. 安装、最小项目与首个可运行 eval

`0.122.0` 的 `package.json` 要求 Node `>=22.22.0`，官方 README 推荐 Node 24 LTS。
以下项目不用 API key，也不会发出模型请求；`echo` 把渲染后的 prompt 原样作为输出。
版本和安装方式见 [P0](#2-观察版本和一手链接)，`echo` 行为见 [P12](#2-观察版本和一手链接)。

```bash
mkdir promptfoo-assertions
cd promptfoo-assertions
npm init -y
npm install --save-dev promptfoo@0.122.0
```

新建 `promptfooconfig.yaml`：

```yaml
description: first assertion eval

prompts:
  - '{{answer}}'

providers:
  - echo

tests:
  - description: echo returns the rendered prompt
    vars:
      answer: Paris
    assert:
      - type: equals
        value: Paris
      - type: starts-with
        value: Par
```

执行并打开本地报告：

```bash
npx promptfoo eval -c promptfooconfig.yaml
npx promptfoo view
```

第一条断言比较完整字符串，第二条检查前缀。
两条都产生 `pass`、`score` 与 `reason`；外层分数是两个 `1` 的加权平均。
需要官方生成的起始项目时，也可以运行 `npx promptfoo init --example getting-started`。

## 4. 核心数据流与对象关系

### 4.1 从配置到判定

```text
test.vars -> test options.transformVars
prompt × provider × transformed test
  -> provider response
  -> provider-specific transformResponse（若该 provider 提供）
  -> ProviderOptions.transform
  -> test options.transform
  -> 每条 assertion.transform
  -> GradingResult(pass, score, reason, ...)
  -> assert-set / 测试级加权聚合
  -> assertScoringFunction 可替换该测试的最终结果
  -> eval 完成后按 prompt-provider 组合计算 derivedMetrics
```

`contextTransform` 是一条独立分支。
它与 `options.transform` 都接收 `ProviderOptions.transform` 之后的完整输出，不接收对方的结果。
普通断言接收 `options.transform` 的结果，断言自己的 `transform` 再在其上运行；详见 [P9](#2-观察版本和一手链接)。

### 4.2 公开对象关系

| 对象 | 拥有的直接判分字段 | 产出或作用范围 |
|---|---|---|
| `TestCase` | `assert[]`、`threshold`、`assertScoringFunction`、`options.provider`、`options.transform`、`providerOutput` | 一个 prompt-provider-test 输出 |
| `Assertion` | `type`、`value`、`threshold`、`weight`、`metric`、`provider`、`rubricPrompt`、`config`、两个 transform | 一个组件结果 |
| `AssertionSet` | `assert[]`、`threshold`、`weight`、`metric`、类型源码中的 `config` | 先聚合子断言，再作为外层一个组件 |
| `GradingResult` | `pass`、`score`、`reason` 及诊断字段 | 单断言、集合或整个测试的统一返回值 |
| `ScoringFunction` | 读具名分数与组件结果，返回完整 `GradingResult` | 替换一个测试的默认聚合结果 |
| `DerivedMetric` | `name`、表达式或函数 | eval 完成后，按 prompt-provider 组合计算展示指标 |
| `select-best` / `max-score` | 跨多个候选输出工作 | 延迟到其它断言完成后选择赢家 |

`AssertionSetSchema` 在 [P2](#2-观察版本和一手链接) 声明了 `config`。
但 [P1](#2-观察版本和一手链接) 的公开属性表没有该字段，`0.122.0` 的执行路径也未把它合入子断言。
本文不建议依赖这个字段。

## 5. 完整 API catalog

### 5.1 `Assertion`、`AssertionSet` 与测试级配置

以下 TypeScript 是 [P2](#2-观察版本和一手链接) 与 [P7](#2-观察版本和一手链接) 的紧缩写法：

```ts
type Assertion = {
  type: AssertionType;
  value?: string | string[] | number | object | AssertionValueFunction;
  config?: Record<string, unknown>;
  threshold?: number;
  weight?: number; // default 1
  provider?: GradingProvider;
  rubricPrompt?: string | string[] | ChatMessage[];
  metric?: string;
  transform?: string | TransformFunction;
  contextTransform?: string | TransformFunction;
};

type AssertionSet = {
  type: 'assert-set';
  assert: Assertion[];
  threshold?: number;
  weight?: number; // default 1 in outer aggregate
  metric?: string;
  config?: Record<string, unknown>; // declared, but see warning above
};

type FactualityWeights = {
  subset?: number;            // default 1
  superset?: number;          // default 1
  agree?: number;             // default 1
  disagree?: number;          // default 0
  differButFactual?: number;  // default 1
};

type TestCase = {
  assert?: Array<Assertion | AssertionSet>;
  threshold?: number;
  assertScoringFunction?: `file://${string}` | ScoringFunction;
  provider?: ProviderConfig;       // target provider for this test
  providers?: string[];            // filter target providers by ID/label/glob
  prompts?: string[];              // filter prompts by ID/label/glob
  providerOutput?: string | Record<string, unknown>;
  options?: {
    provider?: GradingProvider;    // grader provider
    rubricPrompt?: unknown;
    factuality?: FactualityWeights;
    transform?: string | TransformFunction;
    transformVars?: string | TransformFunction;
    postprocess?: unknown;         // deprecated; use transform
    disableDefaultAsserts?: boolean;
  };
};
```

`value`、`threshold` 和 `config` 的含义取决于 `type`。
Schema 不能在编辑期证明每一种组合有效；运行器的 handler 会做第二层检查。

`defaultTest.assert` 会排在测试自己的 `assert` 之前。
`options.disableDefaultAsserts: true` 只停用继承的断言，其它 defaultTest 字段仍会合入。
测试自己的 `threshold`、provider filter、prompt filter 与 scorer 优先；详见 [P1](#2-观察版本和一手链接)。

### 5.2 统一结果、失败、跳过与无分语义

```ts
interface GradingResult {
  pass: boolean;
  score: number;
  reason: string;
  namedScores?: Record<string, number>;
  namedScoreWeights?: Record<string, number>;
  tokensUsed?: TokenUsage;
  componentResults?: GradingResult[];
  assertion?: Assertion;
  comment?: string;
  suggestions?: ResultSuggestion[];
  metadata?: {
    context?: string | string[];
    graderOutputs?: Record<string, string>;
    renderedAssertionValue?: string;
    renderedGradingPrompt?: string;
    graderError?: true;
    [key: string]: unknown;
  };
}
```

`pass`、`score` 和 `reason` 在发布源码中都是必填字段。
Node API 页面把单断言 `score` 写成可选，与 [P2](#2-观察版本和一手链接) 的接口和运行器返回不一致。

promptfoo 没有断言级 `skip` 或“无分”返回态。
没有任何断言的测试返回 `pass: true`、`score: 1`、`reason: "No assertions"`。
这条早返回不会再比较测试级 `threshold`。
`providers: []` 或 filter 未命中会让测试没有结果行，而不是产生一个 skipped `GradingResult`。

provider 或 grader 出错时，eval 行可以是 ERROR；JSONL 中的 `gradingResult` 可为 `null`。
缺少 trace、logprobs 或必需 provider 能力时，具体 handler 可能抛错，也可能返回失败结果。
这不是统一的 `unavailable` 协议；见 [P3](#2-观察版本和一手链接) 与 [P8](#2-观察版本和一手链接)。

同一测试的普通断言默认最多并发执行 `3` 条，`PROMPTFOO_ASSERTIONS_MAX_CONCURRENCY` 可修改上限。
结果仍按原 assertion 索引归位；使用 provider 调用分组队列时，运行器会把该层串行化。

### 5.3 默认聚合规则

对组件 `i`，测试分数是：

```text
score = Σ(componentScore[i] × weight[i]) / Σ(weight[i])
```

`weight` 默认是 `1`。
该公式只在总权重大于 `0` 时计算；总权重为 `0` 或负数时，发布版把总分写成 `0`。
没有测试级 `threshold` 时，任一组件 `pass: false` 会使测试失败。
有数值门槛时，外层判定只看 `score >= threshold`，它会替换组件的布尔失败状态。
`threshold: 0` 因此始终通过，但仍保留组件结果。

基础 schema 只要求 `weight` 与 `threshold` 是 number，没有统一的 `0..1` 范围约束。
`GradingResult.score` 也只是“通常”位于该范围，自定义函数可返回其它数值。
具体断言会施加自己的方向和范围要求。
负权重会进入分子与总权重累计；总权重非正时按上段归零，因此它不是推荐的逻辑运算符。

`assert-set` 先用相同规则聚合子断言。
集合没有门槛时，任一子断言失败会使集合失败；有门槛时只比较集合分数。
集合结果再按自己的 `weight` 进入测试级聚合，详见 [P1](#2-观察版本和一手链接) 与 [P4](#2-观察版本和一手链接)。
`assert-set.assert` 只接受普通 `Assertion`，不能递归放入另一个 `assert-set`。

`weight: 0` 会强制该断言 `pass: true`，并把它排除在加权分母之外。
全部组件都是零权重时，测试在没有门槛时通过且得 `0` 分；有门槛时再用 `0` 比较门槛。
该版本还会把同一断言的具名分数权重加为 `0`，规范化结果因而是 `0`。
官方 derived metric 示例却用零权重断言采集计数；这是文档与运行器的冲突，不应作为可靠配方。

### 5.4 字符串缩写与 CSV

官方给出的通用 grammar 是 `type:value` 或 `type(threshold):value`；没有前缀时是 `equals`。
发布版 regex 能识别 66 个基础类型和它们的 `not-` 前缀。
阈值括号只接受非负十进制字面量，不接受负数或指数写法；详见 [P6](#2-观察版本和一手链接)。
这套紧缩写法用于 CSV、XLSX 与 Google Sheets 的 `__expected*` 单元格。
JSON 与 JSONL 测试文件应使用结构化 `assert` 对象。

| 写法 | 展开结果 | 备注 |
|---|---|---|
| `Paris` | `{type: 'equals', value: 'Paris'}` | 默认相等 |
| `contains:Paris` | `contains` | `icontains` 为大小写不敏感 |
| `contains-any:Paris,London` | `contains-any` + 字符串数组 | `contains-all` 与两个 `i*` 版本同理；含逗号的项须用 CSV 引号 |
| `similar(0.8):Hello` | `similar` + `threshold: 0.8` | CSV 字符串路径默认阈值为 `0.8`；结构化写法默认 `0.75` |
| `levenshtein(5):Hello` | `levenshtein` + `threshold: 5` | 数值是最大距离 |
| `llm-rubric:criterion` | `llm-rubric` | `grade:` 是同义别名 |
| `javascript:expr` | `javascript` | `fn:` 是别名；`eval:` 在源码注释中标成待删除 legacy |
| `python:expr` | `python` | `file://x.py[:export]` 也会成为 Python 断言 |
| `file://x.js[:export]` | `javascript` | 其它类型也可用 JS 文件生成比较值 |
| `not-contains:error` | `not-contains` | 类型可接受不等于运行器一定正确反转，见 5.8 |

`0.122.0` 的字符串求值并不把所有字段统一保留下来：

| 输入类别 | 发布版展开规则 |
|---|---|
| `contains-all`、`contains-any`、`icontains-all`、`icontains-any` | 按 CSV 规则切成字符串数组；引号可保留值内逗号 |
| `is-json`、`contains-json` | 保留冒号后的字符串，可继续指向 schema 文件 |
| `answer-relevance`、`classifier`、`context-faithfulness`、`context-recall`、`context-relevance`、`cost`、`latency`、`levenshtein`、`perplexity-score`、`perplexity`、`rouge-n`、`similar`、`starts-with` | 保存括号阈值；未写时，`similar` 补 `0.8`，其余补 `0.75` |
| `agent-rubric`、`bleu`、`contains`、`contains-html`、`contains-sql`、`contains-xml`、`conversation-relevance`、`equals`、`factuality`、`finish-reason`、`g-eval`、`gleu`、`guardrails`、`icontains`、`is-html`、`is-refusal`、`is-sql`、`is-valid-function-call`、`is-valid-openai-function-call`、`is-valid-openai-tools-call`、`is-xml`、`javascript`、`llm-rubric`、`pi`、`meteor`、`model-graded-closedqa`、`model-graded-factuality`、`moderation`、`python`、`regex`、`ruby`、`tool-call-f1`、`skill-used`、`trajectory:goal-success`、`trajectory:tool-args-match`、`trajectory:step-count`、`trajectory:tool-sequence`、`trajectory:tool-used`、`trace-error-spans`、`trace-span-count`、`trace-span-duration`、`search-rubric`、`webhook`、`word-count` | 保存字符串 value；即使括号被 regex 接受，也不把阈值放进 Assertion |
| `similar:cosine`、`similar:dot`、`similar:euclidean` | 因 `similar` 前缀先匹配，字符串写法不能可靠选中；使用结构化对象 |
| `grade:`、`llm-rubric:` | 都展开成 `llm-rubric` |
| `javascript:`、`fn:`、legacy `eval:`、不带 type 前缀的 `file://*.js[:export]` | 展开成 `javascript` |
| `python:`、不带 type 前缀的 `file://*.py[:export]` | 展开成 `python` |
| `ruby:` | 由通用 grammar 展开；Ruby 文件没有无前缀 alias |
| `assert-set`、`select-best`、`human`、`max-score`、`promptfoo:redteam:${string}` | 不属于字符串 parser 的基础枚举，必须用结构化对象 |

未知 type 前缀或不合 grammar 的字符串不会报配置错误，而会整体降级成 `equals` 的 value。
因此把 `contain:Paris` 拼错不会运行近似的断言，只会比较输出是否严格等于整段 `contain:Paris`。

这意味着 `bleu(0.7):reference` 会丢掉括号阈值，而结构化 `bleu` 会正确保留 `threshold: 0.7`。
`classifier:value` 又会得到 CSV 默认门槛 `0.75`，不同于结构化 handler 的默认 `1`。
需要门槛、provider、weight、transform 或对象 value 时，结构化对象是可核对的写法。

CSV 用 `__expected` 表示一条断言，`__expected1`、`__expected2` 依次表示第一条和第二条具名断言列。
`__metric` 给这些断言统一命名，`__threshold` 设置测试门槛。
`__config:__expected:threshold` 设置索引 `0` 的断言，`__config:__expectedN:threshold` 用从 `1` 开始的编号定位断言。

`0.122.0` 只接受 `threshold` 这个 config key，没有通过该列设置任意断言属性的协议。
空白 `__expectedN` 会被忽略；无效 `__threshold` 当成未设置，而无效的 `__config` 编号、key 或数值会使装载失败。

`assertionTemplates` 与 JSON Pointer `$ref` 可以复用结构化断言。
`value: file://x.txt|json|yaml` 会读入期望值；JS、Python 与 Ruby 文件还可以执行代码。

```yaml
assertionTemplates:
  noError:
    type: not-contains
    value: error

tests:
  - assert:
      - $ref: '#/assertionTemplates/noError'
```

配置装载器在验证前展开 `$ref`；引用不存在时，eval 在配置阶段失败，不产生断言分数。
设置 `PROMPTFOO_DISABLE_REF_PARSER=true` 会停用这一步；模板形状与开关见 [P1](#2-观察版本和一手链接) 与 [P8](#2-观察版本和一手链接)。

同一 grammar 把 `similar` 排在 `similar:cosine`、`similar:dot` 与 `similar:euclidean` 之前。
因此 `similar:dot:reference` 会先匹配成 `similar`，其 value 是 `dot:reference`。
三个显式距离类型应使用结构化对象；这是 [P6](#2-观察版本和一手链接) 可见的前缀歧义。

### 5.5 66 个基础 assertion type：确定性、结构与运行事实

表中的“同步”表示不调用外部 grader，但公开 API 仍返回 Promise。
“异步”表示会调用 provider、外部进程、网络服务或动态模块。
“反转异常”表示 `0.122.0` 的 handler 未完整处理 `inverse`，细节见 5.8。

| `type` | `value` / `config` | 默认值、分数与判定 | 执行与失败语义 | `not-*` | 材料 |
|---|---|---|---|---|---|
| `equals` | 字符串，或可解码为 JSON 的对象 | 严格字符串相等；对象走 deep strict equality；二元 `0/1` | 同步；非法期望形状报错 | 支持 | [P5](#2-观察版本和一手链接) |
| `contains` | 字符串或数字 | 输出含该文本；二元 `0/1` | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `icontains` | 字符串或数字 | `contains` 的大小写不敏感版 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `contains-any` | 字符串数组 | 至少一项出现；二元 `0/1` | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `icontains-any` | 字符串数组 | 大小写不敏感，至少一项出现 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `contains-all` | 字符串数组 | 每一项都出现；二元 `0/1` | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `icontains-all` | 字符串数组 | 大小写不敏感，每一项都出现 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `regex` | JavaScript 正则表达式字符串 | 匹配即 `1` | 同步；非法正则返回失败结果 | 支持 | [P5](#2-观察版本和一手链接) |
| `starts-with` | 字符串 | 前缀相等即 `1` | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `word-count` | 精确 number、数值字符串，或 `{min?, max?}` | 单词数满足范围即 `1`；没有隐含范围 | 同步；对象至少应给一个边界 | 支持 | [P5](#2-观察版本和一手链接) |
| `is-json` | 可选 JSON Schema 对象或文件 | 整个输出是 JSON，且可选 schema 有效；二元 `0/1` | 同步；无效 schema 或 JSON 给失败理由 | 支持 | [P5](#2-观察版本和一手链接) |
| `contains-json` | 可选 JSON Schema 对象或文件 | 输出中存在有效 JSON；二元 `0/1` | 同步；扫描嵌入的 JSON | 支持 | [P5](#2-观察版本和一手链接) |
| `is-html` | 无 | 整个输出是 HTML；二元 `0/1` | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `contains-html` | 无 | 输出含可识别的 HTML 内容；二元 `0/1` | 同步；检测规则不是浏览器渲染 | 支持 | [P5](#2-观察版本和一手链接) |
| `is-xml` | 可选 `{requiredElements?: string[]}` | 支持范围内的完整 XML，且 dotted path 存在 | 同步；拒绝不支持的 DTD 形状 | 支持 | [P5](#2-观察版本和一手链接) |
| `contains-xml` | 同 `is-xml` | 输出含有效 XML 片段 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `is-sql` | 可选 `{databaseType?, allowedTables?, allowedColumns?}` | 有效且非空；`databaseType` 默认 `MySQL` | 异步动态载入；缺少可选包 `node-sql-parser` 时抛错 | 支持 | [P5](#2-观察版本和一手链接) |
| `contains-sql` | 同 `is-sql` | 整段或 fenced code 中存在有效 SQL | 异步动态载入；缺依赖时抛错 | 支持 | [P5](#2-观察版本和一手链接) |
| `is-refusal` | 无 | 规范化输出被识别为拒绝；空输出也算拒绝 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `finish-reason` | provider 的结束原因字符串 | 与规范化结束原因相等；二元 `0/1` | 同步；缺少原因会失败 | 支持 | [P5](#2-观察版本和一手链接) |
| `cost` | 无；`threshold` 必填，单位美元 | `cost <= threshold`；二元 `0/1` | 同步；缺门槛或 provider 未给成本时抛错 | 支持 | [P5](#2-观察版本和一手链接) |
| `latency` | 无；`threshold` 必填，单位毫秒 | `latencyMs <= threshold`；二元 `0/1` | 同步；缺门槛或命中 cache 而没有延迟时抛错，须用 `--no-cache` | 支持 | [P5](#2-观察版本和一手链接) |
| `perplexity` | 无；`threshold` 可选 | 有门槛时越低越好；没门槛时通过；分数是二元值 | 同步；provider 必须返回 `logProbs`，否则抛错 | 只在有门槛时反转；无门槛时两向都通过 | [P3](#2-观察版本和一手链接) |
| `perplexity-score` | 无；`threshold` 可选 | `1/(1+perplexity)`，越高越好；没门槛时通过 | 同步；缺 `logProbs` 抛错 | 无门槛时不反转 `pass`，但仍反转分数 | [P3](#2-观察版本和一手链接) |
| `levenshtein` | 参考字符串 | 距离不大于门槛；默认 `5`；分数为二元值 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `rouge-n` | 参考字符串 | ROUGE-N 不小于门槛；默认 `0.75`；返回连续分数 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `bleu` | 参考字符串或数组 | BLEU 不小于门槛；默认 `0.5`；多参考取最佳分数 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `gleu` | 参考字符串或数组 | GLEU 不小于门槛；默认 `0.5`；多参考取最佳分数 | 同步 | 支持 | [P5](#2-观察版本和一手链接) |
| `meteor` | 参考字符串或数组 | METEOR 不小于门槛；默认 `0.5` | 异步动态载入；缺 `natural@^8.1.0` 时抛错 | 支持 | [P3](#2-观察版本和一手链接) |
| `is-valid-function-call` | 无 | 依据目标 provider 的 function schema 验证调用 | 同步 | 反转异常 | [P3](#2-观察版本和一手链接) |
| `is-valid-openai-function-call` | 无 | 与上一项共用 handler；官方文档标成 legacy | 同步 | 反转异常 | [P5](#2-观察版本和一手链接) |
| `is-valid-openai-tools-call` | 无；从目标 provider 的 `config.tools` 取 schema | 验证 OpenAI tools 调用；也识别输出中的 MCP Tool Result / Error 标记 | 异步，可装载外部 tools 文件；没有 tools 时返回失败 | 反转异常 | [P3](#2-观察版本和一手链接) |
| `tool-call-f1` | 工具名数组或逗号分隔字符串 | 无序工具名集合的 F1；门槛默认 `1` | 同步；返回原始 F1 | 只反转 `pass`，不反转分数 | [P5](#2-观察版本和一手链接) |
| `skill-used` | 单个名称、名称数组，或 `{name?/pattern?, min?, max?}` | 列表要求全部命中；对象默认最少 `1`，仅给 `max` 时最少 `0` | 同步；读 `providerResponse.metadata.skillCalls` | 支持；对象反转仅表达零次或 `max: 0` | [P5](#2-观察版本和一手链接) |
| `guardrails` | 无；可选 `config.purpose` | 读 `{flagged, flaggedInput, flaggedOutput, reason}`；内置支持 AWS Bedrock 与 Azure OpenAI | 同步读 provider response；文档说无 guardrail 时通过且零分，发布 handler 实际通过且记 `1` | 支持；`purpose: redteam` 另有外层规则 | [guardrails 文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/guardrails/) / [handler](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/assertions/guardrails.ts) |

`guardrails` 配成 `config.purpose: redteam` 且组件失败时，聚合器会把整个测试强制改成通过。
它还把理由改成 `Content failed guardrail safety checks`，并在测试门槛比较之后生效；见 [P4](#2-观察版本和一手链接)。

### 5.6 66 个基础 assertion type：trajectory 与 trace

这些断言读取 promptfoo trace。
官方 Node API 把 trace 数据结构列为 experimental，但 `runAssertion()` 本身列为 stable；见 [P7](#2-观察版本和一手链接) 与 [P10](#2-观察版本和一手链接)。

| `type` | `value` / `config` | 默认值、分数与判定 | 执行与失败语义 | `not-*` | 材料 |
|---|---|---|---|---|---|
| `trajectory:tool-used` | 单个名称、名称数组，或 `{name?/pattern?, min?, max?}` | 列表要求每个工具出现；对象 `min` 默认 `1`，`max` 可选 | 同步读 trace；缺 trace 抛错 | 支持 | [P10](#2-观察版本和一手链接) |
| `trajectory:tool-args-match` | `{name\|pattern, args\|arguments, mode?, defaults?, ignore?}` | `mode` 默认 `partial`；`exact` 拒绝额外键；数组要求同长度 | 同步；`defaults` 与 `ignore` 只处理顶层键 | 支持 | [P10](#2-观察版本和一手链接) |
| `trajectory:tool-sequence` | 字符串 step 数组，或 `{steps: Array<string\|matcher>, mode?}` | matcher 可含 `type`、`name`、`pattern`；`in_order` 默认允许插入步骤，`exact` 要求完整相等 | 同步读 trace | 支持 | [P10](#2-观察版本和一手链接) |
| `trajectory:step-count` | `{type?, name?/pattern?, min?, max?}` | `type` 可取 `tool`、`command`、`search`、`reasoning`、`message`、`span` 中一个或多个；再按次数边界判定 | 同步；至少要有一个次数边界 | 支持 | [P10](#2-观察版本和一手链接) |
| `trajectory:goal-success` | 目标字符串或 `{goal}` | Judge 根据规范化轨迹与最终输出给分；可设 `threshold`、`provider`、`rubricPrompt` | 异步调用 grader；缺 trace 抛错 | 支持 | [P5](#2-观察版本和一手链接) |
| `trace-span-count` | `{pattern, min?, max?}` | glob 匹配 span name；没有 `min` 与 `max` 时只计数并通过 | 同步；缺 trace 或 `pattern` 抛错 | 反转异常 | [P5](#2-观察版本和一手链接) |
| `trace-span-duration` | `{pattern?, max, percentile?}` | `pattern` 默认 `*`；不设 percentile 时每个 span 都须不超过 `max`；设值时比较该百分位 | 同步；没有匹配且有完整时长的 span 时通过；缺 trace 抛错 | 反转异常 | [P5](#2-观察版本和一手链接) |
| `trace-error-spans` | 数字，或 `{max_count?, max_percentage?, pattern?}` | 数字是 legacy `max_count`；`pattern` 默认 `*`；未给两个上限时要求零错误 | 同步；缺 trace 抛错 | 反转异常 | [P5](#2-观察版本和一手链接) |

trajectory matcher 的输入是 promptfoo 规范化 trace，不是任意应用事件数组。
`tool-args-match` 的 `partial` 对对象做递归子集匹配，但数组仍要求完整长度。
`defaults` 只在实际参数等于声明值时移除，`ignore` 则无条件忽略指定顶层键。
`ignore` 的普通名字区分大小写，含 `*` 或 `?` 时按 glob 匹配。

`trace-error-spans` 从 HTTP `>=400`、error/exception 属性、OTel error status 与错误文本识别失败 span。
`max_percentage` 使用 `0..100` 百分数，不是 `0..1` 比例。

### 5.7 66 个基础 assertion type：自定义、相似度与模型辅助

| `type` | `value` / `config` | 默认值、分数与判定 | 执行与失败语义 | `not-*` | 材料 |
|---|---|---|---|---|---|
| `javascript` | 内联表达式、函数、`file://x.js[:export]` 或 package path | 返回 boolean、number 或 `GradingResult`；number 有门槛时用 `>=`，否则正数通过 | 异步等待 Promise；内联/直接函数错误返回失败组件，文件装载或调用错误会抛到行级 ERROR | boolean 完整反转；number/object 只反转 `pass` | [P11](#2-观察版本和一手链接) |
| `python` | 内联表达式或 `file://x.py[:function]` | 返回 bool、float 或 JSON `GradingResult`；数值规则同 JS | 异步子进程；错误给 `pass: false, score: 0` | bool 完整反转；number/object 只反转 `pass` | [P11](#2-观察版本和一手链接) |
| `ruby` | 内联表达式或 `file://x.rb[:method]` | 返回 bool、number 或 `GradingResult` | 异步子进程；错误给失败结果 | bool 完整反转；number/object 只反转 `pass` | [P11](#2-观察版本和一手链接) |
| `webhook` | URL | POST 输出与 test context；响应 `{pass, score?, reason?}` | 异步网络请求；错误给失败结果 | 成功响应支持；网络或协议错误不反转 | [P5](#2-观察版本和一手链接) |
| `similar` | 参考字符串或数组 | cosine similarity 原值；门槛默认 `0.75`；页面所述默认 embedding 是 OpenAI `text-embedding-3-large` | 异步 embedding 调用；数组按正反语义选最佳 | 反向分数为 `1 - similarity`；阈值边界见 5.8 | [相似度文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/similar/) |
| `similar:cosine` | 同 `similar` | 显式 cosine 原值；越高越好，默认门槛 `0.75` | 异步 embedding 调用 | 同 `similar` | [P3](#2-观察版本和一手链接) |
| `similar:dot` | 同 `similar` | dot product 原值；越高越好，默认门槛 `0.75` | 异步 embedding 调用 | 反向分数是 `1 - dot`，不保证在 `0..1` | [P3](#2-观察版本和一手链接) |
| `similar:euclidean` | 同 `similar` | 距离越低越好，默认门槛 `0.75`；分数为 `1/(1+distance)` | 异步 embedding 调用 | 反向分数为 `1 - 1/(1+distance)` | [P3](#2-观察版本和一手链接) |
| `classifier` | 可选期望 class 字符串；须配置 classification provider | 返回指定 class 的分数；未指定时返回最高分类分数；门槛默认 `1` | 异步 classifier provider；没有内置 classification 默认项 | 支持，反向分数为 `1 - score` | [分类文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/classifier/) |
| `moderation` | 可选 category 字符串数组 | 没有命中类别时通过；provider 依凭据与配置选择 | 异步 moderation provider；grader 故障不能因反转而通过 | 支持 | [moderation 文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/moderation/) |
| `llm-rubric` | criterion 字符串或对象；也可由 `rubricPrompt` 给出 | 无门槛时看 grader `pass`，缺 `pass` 默认 true；有门槛还要求 `score >= threshold` | 异步 LLM grader；响应或传输错误给 `graderError` | 支持 | [P5](#2-观察版本和一手链接) |
| `agent-rubric` | criterion；可设 agent grader | 与 `llm-rubric` 同形；默认 `openai:codex-sdk`、临时目录、read-only、无审批 | 异步 Agent provider；普通文本 provider 会被拒绝 | 支持 | [agent-rubric 文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/agent-rubric/) |
| `g-eval` | criterion 字符串或数组 | 多项 criterion 分别评分后取平均；门槛默认 `0.7` | 异步 LLM grader；默认模型文档写 `gpt-4.1-2025-04-14` | 支持 | [G-Eval 文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/g-eval/) |
| `factuality` | reference 字符串 | Judge 分类 A/B/C/D/E；默认只有 D 计 `0`，其余计 `1` | 异步 LLM grader；映射可在 test options 调整 | 反转异常 | [factuality 文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/factuality/) |
| `model-graded-factuality` | 同 `factuality` | 注册到同一个 handler | 异步；公共 catalog 未单列，是未写入文档的 alias | 反转异常 | [P2](#2-观察版本和一手链接) |
| `model-graded-closedqa` | criterion 字符串 | Judge 输出 Y/N，转成二元结果 | 异步 LLM grader | 反转异常 | [ClosedQA 文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/model-graded-closedqa/) |
| `answer-relevance` | 无；从 `vars.query` 或 prompt 取问题 | 生成问题并用 embedding 比较；门槛默认 `0` | 异步多阶段 grader | 反转异常 | [answer relevance](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/answer-relevance/) |
| `context-faithfulness` | 无；需 context | 受支持 claim 比例；门槛默认 `0` | 异步 grader；无 context 抛错 | 反转异常 | [context faithfulness](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/context-faithfulness/) |
| `context-recall` | 期望答案或事实字符串；可给 context | 期望事实能从 context 归因的比例；门槛默认 `0` | 异步 grader；未给 context 时以 prompt 作为后备输入 | 反转异常 | [context recall](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/context-recall/) |
| `context-relevance` | 无；需 `vars.query` 与 context | context 中必要陈述的比例；门槛默认 `0` | 异步 grader；缺输入抛错 | 反转异常 | [context relevance](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/context-relevance/) |
| `conversation-relevance` | 无；可设 `config.windowSize` | 对连续对话片段判相关并取比例；门槛默认 `0.5`，`windowSize` 默认 `5` | 异步 LLM grader | 支持 | [conversation relevance](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/conversation-relevance/) |
| `search-rubric` | criterion 字符串 | web-capable grader 依 rubric 返回分数与判定 | 异步搜索 grader | 只反转 `pass`，不反转分数 | [search rubric](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/search-rubric/) |
| `pi` | criterion 字符串 | Pi scorer；门槛默认 `0.5` | 异步外部 scorer；需要 Pi 凭据 | 反转异常 | [Pi 文档](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/pi/) |

以上三张表恰好列出 [P2](#2-观察版本和一手链接) 的 66 个 `BaseAssertionTypesSchema` 成员。
红队开放族没有固定总数，不能用“其它类型”代替枚举；它属于独立的生成与安全测试产品面。

### 5.8 `not-*`、特殊类型与跨输出判定

[P1](#2-观察版本和一手链接) 说每种测试都可加 `not-`。
类型层也从全部 66 个基础类型构造 `not-${BaseAssertionType}`。
但发布版 handler 没有统一在分派层反转结果，而是要求每个 handler 自己处理 `inverse`。

研究核对发现，下列 handler 在 `0.122.0` 未读取 `inverse`：

- `answer-relevance`、三个 `context-*`、`factuality` 与它的 alias、`model-graded-closedqa`、`pi`；
- 三个 `is-valid-*` function/tool 类型；
- `trace-span-count`、`trace-span-duration` 与 `trace-error-spans`。

`search-rubric` 与 `tool-call-f1` 只反转 `pass`，保留原分数。
这会让加权聚合中的“通过反命题”仍贡献低分。
三个 similarity metric 在正向和反向比较中都包含阈值等号，并带 `Number.EPSILON` 容差。
阈值附近因此可能让正向与 `not-*` 同时通过，不是严格的布尔补集。
自定义 JS、Python 与 Ruby 返回 number 或对象时也只反转 `pass`；返回 boolean 时分数跟随反转后的判定。
两个 perplexity 类型没有门槛时都把 `pass` 固定为 true，`not-*` 不会改变这个布尔值。
作者不应只因 schema 接受 `not-*` 就假定语义完整；应先用目标版本做一个已知正例和反例。

三个特殊类型不属于 66 个基础类型：

| 类型 | 配置、默认值与返回 | 执行时点 | 材料 |
|---|---|---|---|
| `select-best` | `value` 是必填比较 criterion；可设 `provider`、`rubricPrompt`；赢家返回 true/1，其余返回 false/0；grader 错误或索引无效时全部失败 | 至少两个候选输出产生后，由模型比较 | [select-best](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/select-best/) |
| `max-score` | `value: {method?: 'average'\|'sum', weights?: Record<string, number>, threshold?: number}`；method 默认 `average`，每类权重默认 `1`；赢家返回 true/1，并附 `maxScore`、`assertionCount`、`totalWeight` | 至少两个候选和一条其它断言完成后，选择最高分；并列取先出现者 | [max-score](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/max-score/) |
| `human` | Web UI 加入的人工评分组件；可改 pass、score、comment | 人工操作，不是普通配置 handler | [P2](#2-观察版本和一手链接) |

`max-score` 的门槛位于 `value.threshold`，不是断言顶层 `threshold`。
所有候选原本都失败时，它仍可选最高者；低于 `value.threshold` 时没有赢家。
两个比较类型必须放在测试的顶层 `assert`。
放进 `assert-set` 时，单输出阶段会跳过它，跨输出阶段也不会发现它；执行路径见 [P3](#2-观察版本和一手链接)。

### 5.9 Node API

官方把以下三个调用列为 stable：

```ts
async function evaluate(
  testSuite: EvaluateTestSuite,
  options?: EvaluateOptions,
): Promise<Eval>;

async function assertions.runAssertion(params: {
  assertion: Assertion;
  test: AtomicTestCase;
  providerResponse: ProviderResponse;
  prompt?: string;
  provider?: ApiProvider;
  vars?: Record<string, VarValue>;
  latencyMs?: number;
  assertIndex?: number;
  traceId?: string;
  traceData?: TraceData | null;
}): Promise<GradingResult>;

async function assertions.runAssertions(params: {
  test: AtomicTestCase; // assertions live at test.assert
  providerResponse: ProviderResponse;
  assertScoringFunction?: ScoringFunction;
  prompt?: string;
  provider?: ApiProvider;
  vars?: Record<string, VarValue>;
  latencyMs?: number;
  traceId?: string;
}): Promise<GradingResult>;
```

Node API 页面另展示了把 `assertions` 数组直接传给 `runAssertions()` 的签名。
发布源码实际从 `test.assert` 读取，导出函数参数没有独立 `assertions` 字段。
调用 `0.122.0` 时应以发布类型与源码为准。

`evaluate()` 运行完整生成与变换流程。
两个直接断言函数不调用目标 provider，也不执行 provider 或 test transform；调用方要把准备好的值放进 `providerResponse.output`。
`runAssertion()` 仍会执行当前断言自己的 `transform`。

### 5.10 辅助作者的 CLI 与 MCP 面

这些入口不增加 assertion type，而是帮助作者生成、验证或单独调试配置。
命令形状见 [P8](#2-观察版本和一手链接)，发布实现见 [P15](#2-观察版本和一手链接)。

| 入口 | 参数与默认值 | 输出、异步与失败语义 |
|---|---|---|
| `promptfoo validate [-c <paths...>]` | 省略路径时读取 `promptfooconfig.yaml`；可同时给多个配置 | 装载并验证配置与 test suite，不运行 eval；成功退出 `0`，验证错误打印诊断并退出 `1` |
| `promptfoo generate assertions` | `--type` 只接受 `pi`、`g-eval`、`llm-rubric`，默认 `pi`；`--numAssertions` 默认 `5`；`--provider` 省略时用默认 grader；另有 `--instructions` 与 `--no-cache` | 异步调用生成 provider；客观项生成 Python，主观项使用所选类型；默认写 stdout，`--output` 写 YAML，`--write` 直接修改配置；生成或写入错误使命令失败 |
| MCP `run_assertion` | 必填 string `output` 与 `{type, value?, threshold?, weight?, metric?, provider?, transform?, config?}`；可选 `prompt`、`vars`、`latencyMs` | 异步调用 `runAssertions()`；返回 assertion、聚合结果、输入摘要与诊断摘要；执行异常返回失败的 MCP tool response |

`validate` 能发现 schema 与引用错误，但宽 `Assertion.value` union 仍会放过部分 handler 组合错误。
生成命令的结果仍是待审查配置，不是已验证的成功条件。
MCP 工具不能传 trace、logprobs 或真实 provider response metadata，因此不适合验证依赖这些字段的断言。

## 6. 可直接复制的完整场景

以下配置只组合 [P1](#2-观察版本和一手链接)、[P5](#2-观察版本和一手链接) 与 [P12](#2-观察版本和一手链接) 已公开的字段形状。
无密钥场景可原样运行；需要外部 grader 的场景会明确标出凭据。

### 6.1 确定性 JSON 合约，无模型与无密钥

这个例子用 `echo` 返回 JSON prompt，再分别检查 schema、字段值与禁用文本。
它也展示 assertion-level `transform`。

```yaml
# promptfooconfig.yaml
description: deterministic contract

prompts:
  - '{"city":"{{city}}","country":"France","status":"ok"}'

providers:
  - echo

tests:
  - vars:
      city: Paris
    threshold: 1
    assert:
      - type: is-json
        value:
          type: object
          required: [city, country, status]
          properties:
            city: { type: string }
            country: { const: France }
            status: { const: ok }
        metric: schema
      - type: equals
        transform: 'JSON.parse(output).city'
        value: Paris
        metric: city
      - type: not-contains
        value: error
        metric: no_error_text
```

```bash
npx promptfoo eval -c promptfooconfig.yaml -o results.json
```

三条都是二元分数，测试门槛 `1` 要求加权平均为 `1`。
这个场景只使用在发布版中确实处理反转的 `not-contains`。

### 6.2 开放答案 Judge，显式固定目标与 grader

这个例子会调用两个 provider，需要相应 API key。
目标模型负责回答，断言自己的 `provider` 负责判分；两者不是同一个替换点。

```yaml
# promptfooconfig.yaml
description: open answer with an explicit judge

prompts:
  - |
    Answer in two sentences.
    Question: {{question}}

providers:
  - id: openai:gpt-5-mini
    label: target

tests:
  - vars:
      question: Why does the sky look blue in daylight?
    assert:
      - type: llm-rubric
        value: >-
          The answer correctly connects Rayleigh scattering with shorter
          visible wavelengths and makes no claim that the sky emits blue light.
        threshold: 0.8
        provider:
          id: openai:gpt-5-mini
          config:
            temperature: 0
        metric: grounded_explanation
      - type: word-count
        value:
          max: 70
        metric: concise
```

```bash
OPENAI_API_KEY=... npx promptfoo eval -c promptfooconfig.yaml --no-cache
```

`llm-rubric` 没有门槛时主要看 grader 的 `pass` 字段。
显式门槛让通过同时要求 `pass === true` 和 `score >= 0.8`，减少“低分但通过”的意外。

### 6.3 `assert-set`、权重与测试级门槛

这个配置仍用 `echo`，可以直接运行。
内层集合允许三个质量条件通过两个，集合在外层权重为 `2`。

```yaml
# promptfooconfig.yaml
description: nested aggregation

prompts:
  - 'Paris is the capital of France.'

providers:
  - echo

tests:
  - threshold: 0.8
    assert:
      - type: assert-set
        metric: content_quality
        threshold: 0.66
        weight: 2
        assert:
          - type: contains
            value: Paris
          - type: contains
            value: France
          - type: word-count
            value:
              max: 8
      - type: not-contains
        value: London
        metric: no_wrong_city
        weight: 1
```

内层分数是 `1`，外层另一条也是 `1`，所以测试分数为 `1`。
若内层只有两条通过，它的分数约为 `0.667`，仍满足集合门槛。
外层再计算 `(0.667×2 + 1×1) / 3 ≈ 0.778`，会低于测试门槛 `0.8`。

### 6.4 具名 metric 与自定义 scorer

`assertScoringFunction` 用于单测试组合，不是 eval 完成后的 derived metric。
下面两个文件构成一个完整示例。

```yaml
# promptfooconfig.yaml
prompts:
  - '{{answer}}'
providers:
  - echo
defaultTest:
  assertScoringFunction: file://score.js
tests:
  - vars:
      answer: 'Paris, France'
    assert:
      - type: contains
        value: Paris
        metric: correctness
      - type: contains
        value: France
        metric: completeness
```

```js
// score.js
module.exports = async function score(namedScores, context) {
  const correctness = namedScores.correctness ?? 0;
  const completeness = namedScores.completeness ?? 0;
  const score = correctness * 0.7 + completeness * 0.3;

  return {
    pass: correctness === 1 && score >= 0.8,
    score,
    reason: `correctness=${correctness}, completeness=${completeness}`,
    metadata: {
      assertionCount: context.componentResults?.length ?? 0,
    },
  };
};
```

```bash
npx promptfoo eval -c promptfooconfig.yaml
```

函数可同步或返回 Promise，但必须返回完整 `GradingResult`。
抛错或返回形状无效时，最终结果会变成 `pass: false`、`score: 0`，理由以 `Scoring function error:` 开头。

### 6.5 既有输出直接再次判分

以下方式不调用目标模型。
它适合在 assertion 文件变化后检查已有文本，但不会读取本地数据库中的旧 eval。

```json
[
  {"output":"Paris is the capital of France.","tags":["capital"]},
  {"output":"Lyon is the capital of France.","tags":["wrong"]}
]
```

```yaml
# assertions.yaml
- type: contains
  value: France
- type: llm-rubric
  value: The output correctly names the capital of France.
  threshold: 0.8
  provider: openai:gpt-5-mini
```

```bash
OPENAI_API_KEY=... npx promptfoo eval \
  --model-outputs outputs.json \
  --assertions assertions.yaml \
  -o regraded.json
```

只需确定性检查时移除 `llm-rubric`，命令就不会调用任何模型。
测试配置里的 `providerOutput` 也会跳过目标 provider，再运行 `ProviderOptions.transform`、test transform、assertion transform 与断言。
发布版的 [providerOutput 分支](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/evaluator.ts#L880-L887) 使用 truthy 检查。
因此空字符串仍会调用目标 provider；对象与非空字符串才可靠。

## 7. 结果、诊断、artifact、CI 与再次判分

### 7.1 结果和诊断字段

eval 默认把历史写进 `PROMPTFOO_CONFIG_DIR`，默认目录是 `~/.promptfoo`。
`view`、`--resume`、`--retry-errors` 与按 eval ID 的命令依赖这份历史；`--no-write` 会停用持久化。
`-o` 另行生成适合 CI 保存或其它程序读取的导出文件，见 [P8](#2-观察版本和一手链接)。

```bash
npx promptfoo eval \
  -o results.json \
  -o results.jsonl \
  -o report.html \
  -o results.junit.xml

# Export an eval that is already in local history.
npx promptfoo export eval latest -o latest.json
```

`export eval <evalId|latest>` 默认把 JSON 写到 stdout，`-o` 改为文件。
它会删去 config secrets；`--include-media` 才嵌入 blob 字节，但 prompt、输出、vars、trace 与媒体仍可能含用户数据。

| 后缀 | 适用面与断言细节 |
|---|---|
| `.html` | 可分享的交互矩阵，含排序、filter、输出比较与判分统计 |
| `.json` | 完整结构化 eval，适合程序消费 |
| `.jsonl` | 每个结果一行，适合大型 eval；错误行可有 `gradingResult: null` |
| `.csv` | 扁平表格，含 vars、prompt、输出、判定、延迟与 token 用量 |
| `.yaml` / `.yml` / `.txt` | 便于人读的完整结构化导出 |
| `.xml` | Promptfoo 自有完整 XML，不兼容 JUnit |
| `.junit.xml` | CI 紧缩报告，省略原始输出和逐断言完整理由 |

JSON 与 JSONL 行的顶层 `success`、`score` 和 `gradingResult` 描述整个组合。
`gradingResult.componentResults[]` 保存每个断言的 `pass`、`score`、`reason` 和 assertion 配置。
具名分数位于 `namedScores`，其有效分母位于 `namedScoreWeights`。
`PROMPTFOO_STRIP_GRADING_RESULT=true` 可降低内存占用，但会移除这组逐断言诊断；默认是 `false`。

模型辅助断言还可写入 `renderedAssertionValue`、`renderedGradingPrompt`、`graderOutputs`、`context` 与 `graderError`。
这些字段适合定位模板替换、grader 提示词和传输错误；见 [P2](#2-观察版本和一手链接) 与 [P8](#2-观察版本和一手链接)。

JUnit 用 `<failure>` 表示断言失败，用 `<error>` 表示 provider 或运行错误。
它故意省略 prompt、vars、原始输出、完整理由和配置。
需要逐条证据时，应保存 JSON、HTML 或 Promptfoo XML，不要只保留 JUnit。

HTML、JSON、YAML、TXT 与完整 XML 会尽力删去常见敏感字段，但非敏感的 config 值仍可能存在。
把 eval 文件上传 CI artifact 前仍应按项目的数据规则检查内容。

### 7.2 本地诊断

```bash
npx promptfoo view
npx promptfoo show
npx promptfoo logs --type error
LOG_LEVEL=debug npx promptfoo eval
npx promptfoo eval --verbose
```

`view` 展示矩阵、具名 metric、组件理由和人工评分入口。
`show` 省略 ID 时打印最近 eval 的摘要；`logs` 可按类型、行数或 regex 查看本地日志。
derived metric 的求值错误只写 debug 日志；缺失 metric 默认 `0`，也没有循环依赖保护。
debug 与 error 日志默认写入 `~/.promptfoo/logs`，可用 `PROMPTFOO_LOG_DIR` 改位置。
`promptfoo export logs [-n <count>] [-o <path>]` 会把日志打成 `.gz` 诊断包，默认收集全部日志。

### 7.3 CI

`promptfoo eval` 在通过率低于 `PROMPTFOO_PASS_RATE_THRESHOLD` 时退出 `100`。
通过率门槛默认 `100`，所以默认配置下一个 FAIL 或 ERROR 就会触发；把门槛降到 `95` 才会容许少量失败。
`PROMPTFOO_FAILED_TEST_EXIT_CODE` 可替换该退出码。
其它执行错误退出 `1`，见 [P8](#2-观察版本和一手链接)。

```yaml
# GitHub Actions step
- name: Run promptfoo assertions
  run: npx promptfoo eval -o results.json -o results.junit.xml
  env:
    PROMPTFOO_PASS_RATE_THRESHOLD: '95'
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

CI 指南仍展示 `--fail-on-error`，但 `0.122.0` 的 `eval` 命令定义与命令行 reference 没有该选项。
固定版本的 pipeline 应依赖上述退出码，不应复制该过时参数。

### 7.4 再运行、重试与真正 regrade

这些命令会选择旧 eval 的行，再执行目标 provider；它们不是只对旧输出再次判分：

| 命令 | 作用 |
|---|---|
| `--filter-failing <path-or-id>` | 新建 eval，只运行旧结果中的断言失败与 ERROR 行 |
| `--filter-failing-only <path-or-id>` | 新建 eval，只运行断言失败，排除 ERROR |
| `--filter-errors-only <path-or-id>` | 新建 eval，只运行 ERROR 行 |
| `--retry-errors` | 对最新 eval 的 ERROR 行重试；成功后才替换旧错误 |
| `--resume [evalId]` | 在原 eval 中继续未完成的 prompt-test 索引 |
| `promptfoo retry <evalId>` | 对指定 eval 的 ERROR 行重试并原位更新；可用 `-c` 提供修改后的配置 |

无需目标模型调用的公开路径有三条：

- `--model-outputs` 与 `--assertions`，适用于单独的 JSON 输出文件；
- TestCase 的 `providerOutput`，适用于把预先计算输出写回测试数据；
- `echo` 配合 `{{logged_output}}`，适用于把历史文本当成 prompt 变量。

Web UI 可以加入 `human` 组件，并人工改 pass、score 与 comment。
这是人工修订单行判分，不会按新 rubric 自动处理整份旧 eval。

官方 API reference 明说整套 HTTP API 只面向 Enterprise。
与旧结果再次判分直接有关的公开端点如下；所有启动调用都返回 `202` job，再由状态端点轮询。

| 端点 | 输入与范围 | 保留或并发语义 |
|---|---|---|
| `POST /api/v1/reeval-jobs/{evalId}` | 无 body；可用 query `teamId`，或用 `pluginId` 限定一个红队插件 | 对整份 eval 再次判分；同一 eval 同时只允许一个判分 job |
| `GET /api/v1/reeval-jobs/{jobId}/status` | job ID | 返回进度、通过、失败与错误数 |
| `GET /api/v1/reeval-jobs/eval/{evalId}/active` | eval ID | 查该 eval 的活动 re-evaluation job |
| `POST /api/v1/results/{id}/results/bulk-llm-regrade` | `{resultIds: UUID[1..10000], supplementaryRubric?: string}`；rubric 最长 10000 字符 | 只处理指定结果；保留人工评分；状态仍走 reeval job 端点 |
| `POST /api/v1/regrade-jobs/{evalId}` | `{guidelineIds?: string[]}`；空数组也表示全部组织指南 | 只审查 FAIL 结果；需要红队 entitlement；同一 eval 同时只允许一个判分 job |
| `GET /api/v1/regrade-jobs/{jobId}/status` | job ID | 返回 guidance review 进度 |
| `GET /api/v1/regrade-jobs/eval/{evalId}/active` | eval ID | 查该 eval 的活动 guidance review job |

这些是云端旧结果操作，不是 `promptfoo eval` 的开源参数。
Release notes 的“Regrade Red Team Scans”也位于 Enterprise Features，不能类比成开源 CLI 的通用旧结果 regrade。

## 8. 自定义扩展

### 8.1 断言函数

JavaScript 函数签名为：

```ts
type AssertionValueFunction = (
  output: string,
  context: {
    prompt?: string;
    vars: Record<string, unknown>;
    test: AtomicTestCase;
    logProbs?: number[];
    config?: Record<string, unknown>;
    provider?: ApiProvider;
    providerResponse?: ProviderResponse;
    metadata?: ProviderResponse['metadata'];
    trace?: TraceData;
  },
) => boolean | number | GradingResult |
     Promise<boolean | number | GradingResult>;
```

boolean 映射到 `1/0`。
number 原样成为分数；没断言门槛时，大于 `0` 才通过，有门槛时比较 `>= threshold`。
返回对象时必须含 `pass`、`score` 和 `reason`，也可带嵌套 `componentResults` 与 `metadata`。
JS 对象的 `pass` 不会再按 assertion threshold 检查。
Python 与 Ruby 对象若 `score < threshold`，会先被强制改成失败，再处理 `not-*`。

发布的 TypeScript 函数签名把 output 写成 string。
`0.122.0` 只对直接传入的 Node function 使用 `outputString`；内联脚本与文件脚本可收到原始对象输出。
跨这几种装载方式复用函数时，应先自行规范化输入；差异可在 [P3](#2-观察版本和一手链接) 与 [P11](#2-观察版本和一手链接) 核对。

`config` 会以结构化 clone 传给断言，避免函数改写共享配置。
Python 与 Ruby 通过进程边界接收输出和 context，并返回 bool、number 或 JSON 结果对象。
Python 与 Ruby 文件未写 `:name` 时都调用 `get_assert`；JS 文件可用 module export、default export 或 `:name`。
Python/Ruby 结果的 `component_results`、`named_scores`、`tokens_used` 会映射到 camelCase；无效对象返回失败。

内联或直接 JS 函数的执行错误也返回失败组件。
但 JS 文件或 package path 在进入 handler 前装载和调用，其错误成为行级 ERROR；Python 与 Ruby 文件错误仍返回 false/0 组件。

`webhook` 向 URL 发送 `POST {output, context: {prompt, vars}}`。
响应必须含 boolean `pass`，可带 `score` 与 `reason`；缺 score 时按最终 pass 写成 `1/0`。
`WEBHOOK_TIMEOUT` 默认 `5000` 毫秒，网络错误、非 2xx 或无效 JSON 都返回失败和零分；见 [官方 handler](https://github.com/promptfoo/promptfoo/blob/7b898cbdb16205cb7f0e2994baa807d131eb2326/src/assertions/webhook.ts)。

### 8.2 自定义 scorer

```ts
type ScoringFunction = (
  namedScores: Record<string, number>,
  context?: {
    threshold?: number;
    parentAssertionSet?: { index: number; assertionSet: AssertionSet };
    componentResults?: GradingResult[];
    tokensUsed?: {
      total: number;
      prompt: number;
      completion: number;
      cached?: number;
      numRequests?: number;
    };
  },
) => GradingResult | Promise<GradingResult>;
```

每条参与的断言应先有 `metric`。
同名 metric 会按断言权重归一后传入函数。
测试级函数替换 `defaultTest.assertScoringFunction`；它不与默认结果再做第二次平均。
测试门槛只作为 `context.threshold` 传入，运行器不会用它再次改写 scorer 返回的 `pass`。

文件写法是 `file://score.js[:export]` 或 `file://score.py[:function]`。
没有名称时，JS 可用 default export 或名为 `func` 的 export，Python 默认调用 `func`。
Python named export 接收 `named_scores: Dict[str, float]` 与 context 字典，并返回含三项必填字段的字典。
[P0](#2-观察版本和一手链接) 发布 commit 中的 `examples/eval-assertion-scoring-override/override.py` 使用这一形状。

### 8.3 具名与派生 metric

`metric` 可以含 Nunjucks 变量，例如 `quality_{{language}}`。
同名组件先按 `namedScoreWeights` 聚合。

```ts
type DerivedMetric = {
  name: string;
  value:
    | string
    | ((namedScores: Record<string, number>, evalStep: RunEvalOptions) => number);
};
```

它位于配置顶层，例如为 6.4 的两个具名分数增加一个展示指标：

```yaml
derivedMetrics:
  - name: balanced_quality
    value: '(correctness + completeness) / 2'
```

字符串使用 mathjs 表达式。
函数收到具名分数副本与 eval step；同步返回 number，不接受 Promise。
派生项按声明顺序计算，后项可以引用前项；缺失输入默认 `0`，`__count` 是该 prompt-provider 组合的测试数。
`__count` 是保留名；同名 assertion metric 会触发警告，并在派生计算上下文中被真实测试数替换。

derived metric 只在 eval 完成后产生报告指标，没有自己的 `threshold` 或测试判定字段。
若它需要控制 CI，应在下游检查输出，或把相同规则移入 `assertScoringFunction`。

### 8.4 grader provider 与目标 provider

以下字段名字相近，角色不同：

| 位置 | 角色 | 优先级 |
|---|---|---|
| 顶层 `providers` | eval 的目标系统 | 展开测试矩阵 |
| `defaultTest.provider` | 默认替换每条测试调用的目标 provider | 低于 `test.provider` |
| `test.provider` | 只替换这条测试的目标 provider | 高于顶层矩阵的该测试选择 |
| `test.providers` | 按 ID、label 或 glob 过滤这条测试展开到哪些目标列 | 不创建 grader，也不改 provider 配置 |
| `defaultTest.options.provider` | 默认 grader | 最低 grader 层 |
| `test.options.provider` | 这条测试的 grader | 高于 defaultTest |
| `assertion.provider` | 这一条断言的 grader | 最高 grader 层 |
| CLI `--grader` | 把本次命令的 grader 写入 `defaultTest.options.provider` | 局部 test/assertion 仍更高；`--resume` 时不应用新值 |

没有显式 grader 时，普通模型辅助断言按可用凭据选择内置 provider，而不是承诺一个固定模型。
OpenAI 内置 grader 的 `temperature` 默认 `0`。
`g-eval`、`agent-rubric`、`similar`、`classifier` 与 `pi` 的特殊默认或必填项已在 5.7 逐项列出；见 [P5](#2-观察版本和一手链接)。

完整对象放在断言层时，不会自动继承全局 grader 对象中的 `config`。
需要共同参数时，应复用 YAML 节点或显式写全对象。

### 8.5 输出 transform

[P14](#2-观察版本和一手链接) 的公共函数类型是：

```ts
type TransformFunction<TIn = unknown, TOut = unknown> = (
  output: TIn,
  context: {
    vars?: Record<string, unknown>;
    prompt?: { label?: string; id?: string; raw?: string; display?: string };
    metadata?: Record<string, unknown>;
    uuid?: string;
    [key: string]: unknown;
  },
) => TOut | Promise<TOut>;
```

YAML 只接受一行 JavaScript 表达式、多行函数体或 `file://` 引用。
一行表达式自动加 `return`，多行内容必须自行返回值。
`transformVars` 的首个内联变量名是 `vars`，其它通用 transform 使用 `output`。
文件可为 `file://x.js[:export]` 或 `file://x.py[:function]`；Python 默认函数名是 `get_transform`。
直接传函数只适用于 Node package API，所有形状都可以同步返回或返回 Promise。

| 配置位置 | 输入、返回与默认行为 | 失败语义 |
|---|---|---|
| `test.options.transformVars` | 在 prompt 渲染前接收 vars，必须返回对象；返回键合入原 vars 并替换同名键；可从 `defaultTest` 继承 | 返回非对象或执行错误会中止测试准备，不产生 `GradingResult` |
| provider 的 `config.transformResponse` | 先把原始响应整理为 provider 输出；参数名和允许的返回形状由具体 provider 定义，没有跨 provider 的统一签名 | 作为 provider 调用错误处理；HTTP 等 provider 另有专页 |
| `ProviderOptions.transform` | 接收规范化的 `ProviderResponse.output`；返回任意非 `null` 值；省略时为恒等变换 | 抛错或返回 `null` / `undefined` 时进入 eval 的 ERROR 路径 |
| `test.options.transform` | 接收 provider transform 后的输出；其结果供普通断言使用；`postprocess` 是过时 alias | 同上 |
| `assertion.transform` | 接收测试变换后的输出；结果只供当前断言使用 | 抛错时该结果行进入 ERROR，而不是生成业务失败组件 |
| `assertion.contextTransform` | 三个 `context-*` 断言用它直接接收 provider transform 后的输出；必须返回非空 string 或非空 string 数组 | 形状无效、空内容或执行错误都会进入 ERROR 路径 |

transform 没有 `pass`、`score` 或跳过语义。
它只改变后续断言读取的值，错误也不会因 `not-*` 而变成通过。
直接调用 `runAssertion()` 且没有提供 `providerTransformedOutput` 时，`contextTransform` 会改用传入的 `output`。
`context.vars`、prompt 与 metadata 的实际可用字段取决于调用阶段；不应假定每个位置都提供 `uuid`。

## 9. 好在哪里

以下是研究判断。

第一，普通检查与 Judge 共用一个窄对象形状。
`{type, value, threshold, weight, metric}` 足以从 `contains` 平滑走到 `llm-rubric`，数据表也能携带同一语法。

第二，聚合写在使用点。
作者可用测试 `threshold`、嵌套 `assert-set` 和局部 `weight` 表达“多数通过”或重要性，不必先写自定义代码。

第三，诊断数据跟随统一结果。
`reason`、`componentResults`、具名分数、grader prompt 和 grader 输出同时服务终端、JSON 与 Web UI。

第四，已有输出有多条低成本入口。
`providerOutput`、standalone assertion 文件和 `echo` 让生成调用与判分调用分离，适合先固定昂贵输出再迭代 rubric。

第五，扩展梯度完整。
作者可以从字符串缩写，逐步进入结构化 YAML、JS 表达式、文件函数、Python/Ruby、webhook 或完整 Node API。

## 10. 不好的地方与不应类比 NiceEval 的边界

以下也是研究判断，并以观察版行为为依据。

第一，`Assertion` 是宽 union，不是按 `type` 收窄的 discriminated union。
`value`、`threshold` 与 `config` 的组合错误常到执行期才暴露，字符串 DSL 更难得到 IDE 帮助。

第二，否定不是中央语义。
schema 和文档给出“所有类型均可否定”的印象，handler 却各自决定是否反转 pass 与 score。
这已经造成 5.8 所列的可观察差异。

第三，零权重与具名 metric 在文档示例和聚合源码间不一致。
“自动通过且不进入分母”本身清楚，但同一项的 `namedScoreWeights` 为零，使 derived metric 示例里的计数变成零。

第四，错误、缺少能力与业务失败没有统一四态结果。
有的 handler 抛错，有的返回 `pass: false`；`guardrails` 的无信号分数甚至在文档与发布 handler 间相反。
这不能类比成 NiceEval 的 `unavailable` 或证据完整度。

第五，trajectory 是对 promptfoo trace schema 的 matcher，不是 scope-first 行为 API。
它适合已有 OTel trace 的应用，但不会自动表达 Sandbox diff、文件生命周期或执行事实所有权。

第六，跨输出 special assertion 与普通 assertion 共用 `type` 字段，却在不同阶段运行。
`select-best`、`max-score` 和 UI 注入的 `human` 不能当成普通单输出函数调用。

第七，公开材料存在漂移。
Node API 的 `runAssertions()` 参数、CI 的 `--fail-on-error`、`AssertionSet.config` 和 `GradingResult.score` 都有文档与发布源码差异。

## 11. NiceEval 可吸收与不应复制

### 可吸收

- 保留 `{pass, score, reason}` 之外的组件证据，并让同一结果进入终端、JSON 与报告。
- 在断言使用点提供 `weight`、具名 metric 与局部组合，让常见门槛不必写代码。
- 明确区分目标 Provider 和 Judge Provider，并让局部 Judge 配置拥有清楚的优先级。
- 支持对预先计算输出重新判分，把昂贵执行与 rubric 迭代分开。
- 为自定义 scorer 提供组件结果、token 用量和具名分数，而不是只给一个数字 map。
- 把 transform 顺序画成公开数据流，尤其说明上下文分支读哪个阶段的输出。

### 不应复制

- 不复制宽 `Assertion.value` union；NiceEval 应让 `type` 在 TypeScript 中收窄对应参数。
- 不把 `not-*` 交给各 handler 自行实现；否定若存在，应在中央定义 pass、points 与错误态怎样变化。
- 不用 `weight: 0` 同时承担“只收集 metric”和“强制通过”；这两种意图应有不同字段。
- 不把缺 trace、grader 错误、provider 不支持压成普通 false 或 pass-with-zero。
- 不让跨输出选择器、人工评分与单运行值断言伪装成同一种执行阶段。
- 不把 derived metric 当作 Verdict 门槛；报告派生值与判定规则应有不同类型和生命周期。

## 12. 无法核实项

- 企业 re-evaluation 的内部 grader 版本选择、计费规则与开源 CLI 对应关系无法从 OpenAPI 完整确认。
- Release notes 的“Regrade Red Team Scans”没有公开的开源 CLI 操作步骤；本文只把它归为企业能力。
- `AssertionSetSchema.config` 的注释说它供所有子断言使用，但 `0.122.0` 执行路径没有可见的合入动作；不能确认它是否只为其它封装层保留。
- `model-graded-factuality` 在类型与 handler registry 中存在，却没有独立官方文档；无法确认它是兼容别名、过渡名字还是待补文档功能。
- 滚动 Node API 页面展示的 `runAssertions({assertions, ...})` 与 `0.122.0` 导出签名不一致；无法确认页面针对哪个未发布 commit。
- 官方 derived metric 的零权重计数示例与发布版具名分数规范化冲突；无法从一手材料确认预期修复方向。
- `not-*` 的公开承诺与若干 handler 的行为冲突；本文只报告发布版核对结果，不推测维护者意图。
- `guardrails` 文档说未应用时通过且零分，发布 handler 的默认对象却产生通过且一分；无法确认预期语义。
