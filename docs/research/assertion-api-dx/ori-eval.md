# OpenRouter Ori Eval：断言、Judge 与模型比较作者指南

本文研究 Ori Eval 怎样让作者运行 Agent、断言行为、调用 Judge、比较模型并进入 CI。
它只提供 2026-08-09 的外部产品事实与研究判断，不构成 NiceEval 目标契约。

## 1. 定位与真实边界

Ori Eval 是 Ori CLI 内的一套 Agent eval runner。
作者编写 `*.eval.ts`，从 `ori/eval` 导入运行与判定 API，再由 `ori eval` 交给 Bun test。

一条可运行路径包含四层：

| 层 | 公开责任 | 不应混入本层的能力 |
|---|---|---|
| `spawn-ori-eval` Skill | 安装、鉴权并把自然语言问题交给 Ori | 不是断言、Judge 或结果 API |
| `ori eval` | 发现文件、启动临时 runtime、运行 Bun、写报告与历史条目 | 不是通用测试框架 |
| `ori/eval` | 运行 Agent、读取 Run、执行 matcher、选择候选与调用 Judge | 不提供 Sandbox 或任意 Provider 抽象 |
| Bun test | `test`、`test.each`、`test.concurrent`、`expect`、`test.skip` 与进程退出 | 不理解 Ori 的模型、成本或 Judge 行 |

官方指南把 Ori 称为稳定 harness。
一次 eval run 固定一个 harness 与一个模型，测试内的 prompt 不能改变这两项。
Ori 再通过 OpenRouter 调用不同厂商的模型。
[Eval 指南](https://openrouter.ai/docs/guides/ori/eval)

这项固定并不等于完全可复现。
0.5.1 的版本内置参考明确说，同一模型 slug 可能由不同 Provider endpoint 服务。
模型随机性、外部工具和实时数据也仍会变化。
[0.5.1 发布页](https://github.com/OpenRouterLabs/ori-releases/releases/tag/cli-0.5.1-efbb19e)

本文只盘点与断言、Judge、候选选择、判定、聚合、报告和 CI 直接相关的作者面。
无关的 Provider 部署、OpenRouter 通用 API、遥测 SDK 与 `spawn-ori-eval` 工作流不计入断言目录。

## 2. 观察版本和一手链接

观察日期是 2026-08-09。

| 代号 | 快照 | 本文怎样使用 |
|---|---|---|
| G | [滚动 Eval 指南](https://openrouter.ai/docs/guides/ori/eval) | 安装、首个文件、公开示例、CI 与高层语义 |
| A | [2026-08-03 发布文章](https://openrouter.ai/blog/announcements/ori-eval/) | 产品定位与公开承诺，不用来猜 API |
| M | [固定 commit 的 manifest](https://github.com/OpenRouterLabs/ori-releases/blob/408f21da9522cea16a49824f9a68475415667f4b/manifest.json) | 版本、构建 commit、构建时间与资产名 |
| R | [不可变发布 `cli-0.5.1-efbb19e`](https://github.com/OpenRouterLabs/ori-releases/releases/tag/cli-0.5.1-efbb19e) | CLI help、版本内置参考与实际发布包 |
| D | [固定 commit 的发布仓库说明](https://github.com/OpenRouterLabs/ori-releases/blob/408f21da9522cea16a49824f9a68475415667f4b/README.md) | 发布方式、校验和、独立二进制与许可 |
| O | [OpenRouter Models 参考](https://openrouter.ai/docs/guides/overview/models) | 模型目录字段与价格单位 |

manifest 给出的版本是 `0.5.1+efbb19e`。
`builtFrom` 是 `efbb19e8a293e967bd9eee26caeb684a684b8475`，构建时间是 `2026-08-08T18:04:59Z`。

manifest 穷尽列出这些发布资产：

| manifest key | 文件 |
|---|---|
| `darwinArm64` | `ori-darwin-arm64` |
| `darwinX64` | `ori-darwin-x64` |
| `linuxArm64` | `ori-linux-arm64` |
| `linuxX64` | `ori-linux-x64` |
| `linuxArm64Musl` | `ori-linux-arm64-musl` |
| `linuxX64Musl` | `ori-linux-x64-musl` |
| `checksums` | `SHA256SUMS` |
| `installer` | `install.sh` |
| `version` | `version` |

M 不声明 TypeScript API。
它的作用是把下文的 CLI help 与版本内置参考固定到一组不可变字节。

本研究核对了发布页的 `ori-linux-x64`。
SHA-256 是 `fa443f4727335b734558ed8d187be2e99feccac55b84d5122c33152d98a08084`。
执行 `ori --version` 返回 `0.5.1+efbb19e`。

0.5.1 把版本匹配的参考编进 CLI。
本文逐项读取了以下命令：

```sh
ori eval --help
ori eval docs sdk --human
ori eval docs catalog --human
ori eval docs providers --human
ori eval docs judging --human
ori eval docs results --human
ori eval docs running --human
ori eval docs lifecycle --human
```

本文把 R 中的版本内置参考作为 0.5.1 行为依据。
G 是滚动页面，可能先于或晚于固定发布包变化。
两者冲突时会在正文明确写出，不把差异静默合并。

发布包的临时 workspace 只带压缩后的 JavaScript SDK，没有 `.d.ts`。
下文的 TypeScript signature 是对 G 与 R 的等价整理，不冒充厂商发布的类型声明。

## 3. 安装、最小项目与首个可运行 eval

### 安装与鉴权

官方安装路径如下：

```sh
curl -fsSL https://openrouter.ai/labs/ori/install.sh | bash
ori --version
ori login
```

安装器选择当前平台的独立二进制，并用同一发布的 `SHA256SUMS` 校验。
Ori CLI 本身不依赖 Bun，但 `ori eval` 用 Bun 执行文件。
[发布仓库说明](https://github.com/OpenRouterLabs/ori-releases/blob/408f21da9522cea16a49824f9a68475415667f4b/README.md)

交互式终端缺少 Bun 时，`ori eval` 会先询问是否安装。
`CI=true` 或非交互运行不会询问，而是停止并给出安装提示。
项目本身不必是 TypeScript 项目，也不必单独安装 TypeScript。
[Eval 指南](https://openrouter.ai/docs/guides/ori/eval)

本地运行可用 `ori login` 保存的凭据。
CI 使用 `OPENROUTER_API_KEY`，无需浏览器登录。
一次真实 eval 会调用模型并产生费用。

### 让 Ori 生成文件

公开指南还提供自然语言 authoring 路径：

```sh
cd my-project
ori code -p "What is the best model for my support agent?"
ori code --prompt-file /tmp/ori-task.txt
```

`-p` 与 `--prompt-file` 互斥，也不能都省略。
这条命令不需要交互终端；它把最终输出写到 stdout，并在 prompt 完成后退出。

Ori 会查找 prompt、tool、数据文件、对话与已知答案。
它询问会改变 eval 的问题，写入 `evals/<feature>/<name>.eval.ts`，再从 live catalog 选候选并运行。
[Eval 指南](https://openrouter.ai/docs/guides/ori/eval)

`ori code` 和 `spawn-ori-eval` 都属于外层 authoring 工作流。
它们可以生成下文的 API 调用，但不是 `ori/eval` matcher、Judge 或 metric。

`spawn-ori-eval` 在临时目录工作，不把 eval 文件放进项目。
需要长期保留文件时，使用 `ori code` 的手动路径，或直接编写下面的最小项目。

### 最小目录

```text
my-project/
└── evals/
    └── quickstart.eval.ts
```

`evals/quickstart.eval.ts`：

```ts
import { test } from "bun:test";
import { setupAgent } from "ori/eval";

const agent = setupAgent();

test("answers and reaches a successful terminal state", async () => {
  const run = await agent.run("Reply with the word Lisbon.");

  run.toMention("Lisbon");
  run.toComplete();
});
```

先检查发现与 import，不运行 test body：

```sh
ori eval --dry-run evals/quickstart.eval.ts
```

再执行真实模型调用：

```sh
ori eval evals/quickstart.eval.ts --report eval-report.md
```

`setupAgent()` 使用 workspace 求得的 harness 与模型。
`agent.run()` 是异步调用；Run matcher 是同步方法，失败时抛异常。
`ori eval` 用 Bun 的测试失败建立非零进程退出。
[Eval 指南](https://openrouter.ai/docs/guides/ori/eval)

想先在仓库外试验，可以运行：

```sh
ori eval scratch
```

该命令建立自包含的临时 workspace，包含 starter、SDK entry 和 `data/`。
命令会打印真实路径；历史条目与 `baseline` 系列也只属于该目录。
[0.5.1 发布页](https://github.com/OpenRouterLabs/ori-releases/releases/tag/cli-0.5.1-efbb19e)

## 4. 核心数据流与对象关系

```text
OpenRouter live catalog ──> candidateModels / rankedModels ──> model slug
                                                               │
*.eval.ts ──> Bun test ──> setupAgent(...).run(prompt) ──> EvalRun
                                                               │
                         ┌─────────────────────────────────────┴──────────┐
                         │                                                │
                Run / tool matcher                               setupJudge
                         │                                                │
                         └──────────> booked pass / fail / score <────────┘
                                                │
                           test exit + human/JSON output + Markdown report
                                                │
                                  history + optional baseline comparison
```

`setupAgent` 产生 Agent handle。
`run` 发送一个 prompt，并返回文本、工具名、事件、墙钟时长与可选成本。

确定性关系直接在 Run 上检查。
开放答案交给独立 Judge；`autoEvals` 把 Judge Verdict 写到被评分的 Run，`evaluate` 只返回 Verdict。

多个 test 的进程门槛由 Bun 决定。
Ori 报告再按模型展示 Run outcome、Judge score、成本、耗时与失败详情。
0.5.1 没有公开的权重、公式或自定义 metric 聚合 DSL。

候选模型目录是运行前的独立步骤。
它筛选 live catalog，不执行候选模型。
一次比较常用 `test.concurrent.each` 让每个模型拥有独立 test。

## 5. 完整 API catalog

本节涵盖 0.5.1 的全部 `ori/eval` 导出，以及 `ori eval` 的 runner 面。
每个表均以 [0.5.1 不可变发布](https://github.com/OpenRouterLabs/ori-releases/releases/tag/cli-0.5.1-efbb19e) 为依据。

### 5.1 `ori/eval` 的 13 个导出

| 导出 | 同步性 | 返回 | 直接用途 |
|---|---|---|---|
| `setupAgent` | 同步构造 | Agent handle | 固定 harness、模型与运行参数 |
| `setupJudge` | 同步构造 | Judge handle | 建立开放答案 grader |
| `startingCriteria` | 常量 | 六个 rubric 字符串 | 快速组合 Judge 标准 |
| `candidateModels` | 异步 | 可变的 model slug 数组 | 供 `test.each` 使用 |
| `rankedModels` | 异步 | 只读 `CatalogModel` 数组 | 读取、筛选和自行排序 |
| `isModelLive` | 异步 | `boolean` | 探测一个 slug 是否仍在目录 |
| `assertModelIsLive` | 异步 | `void` | slug 不存在时让 eval 失败 |
| `candidateEfforts` | 异步 | effort 字符串数组 | 选择模型与 harness 都能表达的 effort |
| `modelEndpoints` | 异步 | endpoint 元数据数组 | 检查同一 slug 的服务差异 |
| `endpointProviders` | 异步 | 去重后的 Provider 名数组 | 快速盘点服务方 |
| `pilotCases` | 同步 | case 数组 | 配合 `--pilot N` 抽取分散样本 |
| `assistantText` | 同步 | `string` | 从事件数组拼接 assistant text delta |
| `toolCalls` | 同步 | `string[]` | 从事件数组提取 tool start 名称 |

### 5.2 `setupAgent` 与 `agent.run`

等价 signature：

```ts
type ModelSlug = `${string}/${string}`;
type ModelValue = ModelSlug | null;

type SetupAgentOptions = {
  env?: unknown;
  harness?: unknown;
  host?: string;
  model?: ModelValue;
  parameters?: unknown;
  port?: number;
  systemPrompt?: string;
};

type AgentRunInput =
  | string
  | {
      prompt: string;
      env?: unknown;
      model?: ModelValue;
      outputSchema?: unknown;
      parameters?: unknown;
      systemPrompt?: string;
    };

declare function setupAgent(
  options?: SetupAgentOptions,
): {
  run(input: AgentRunInput): Promise<EvalRun>;
};
```

R 公开确认的 option 如下：

| 位置 | 字段 | 默认与优先级 | 失败语义 |
|---|---|---|---|
| `setupAgent` | `model` | workspace 模型；Run 的 `model` 优先 | 未知 option 名立即抛错 |
| `setupAgent` | `systemPrompt` | workspace 设置；Run 字段优先 | 未知字段不会被静默丢弃 |
| `setupAgent` | `parameters` | 未提供 effort 时是 `high`；Run 字段优先 | 具体参数 schema 未公开 |
| `setupAgent` | `env` | 无公开默认值；Run 字段优先 | 值类型未公开 |
| `setupAgent` | `harness` | workspace 求值；可传自有 harness | harness interface 未公开 |
| `setupAgent` | `host` | option → `ORI_RUNTIME_HOST` → `127.0.0.1` | runtime 不可达时抛错 |
| `setupAgent` | `port` | option → `ORI_RUNTIME_PORT` → `3141` | 非正整数的变量值回到默认端口 |
| `run` | `prompt` | 字符串短写等同 `{ prompt }`；必需 | 空值约束未在文字参考说明 |
| `run` | `model`、`systemPrompt`、`parameters`、`env` | 高于 Agent 层设置 | 未知 Run 字段立即抛错 |
| `run` | `outputSchema` | 省略时无结构化输出要求 | schema 的公开类型未给出 |

`setupAgent` 本身不发模型请求。
`run` 返回 Promise，并在 runtime、harness 或模型调用失败时拒绝。

### 5.3 `EvalRun` 数据与 Run matcher

等价结果形状：

```ts
type EvalRun = {
  text: string;
  toolCalls: string[];
  events: readonly unknown[];
  durationMs: number;
  costUsd?: number;

  tool(name: string): ToolAssertions;
  toComplete(): void;
  toCostAtMost(maxUsd: number): void;
  toEmit(eventType: string): void;
  toFinishWithin(maxMs: number): void;
  toMention(text: string): void;
};
```

| 成员 | 判定 | 默认、返回与失败 |
|---|---|---|
| `text` | 拼接 assistant text delta | 始终是字符串；没有文本时为空串 |
| `toolCalls` | 所有 `tool.started` 的名称 | 没有调用时为空数组 |
| `events` | runtime 事件数组 | 完整 event union 未公开 |
| `durationMs` | 单次 `run` 的墙钟耗时 | 并发候选会互相争用资源 |
| `costUsd` | terminal usage 的美元成本 | harness 未报告时是 `undefined`，不是 `0` |
| `toComplete()` | 存在成功 terminal turn/session | 无 terminal 或失败 terminal 时抛错 |
| `toCostAtMost(n)` | `costUsd <= n` | 缺失成本也失败；不会把缺测当零 |
| `toFinishWithin(ms)` | `durationMs <= ms` | 超过上限时抛错 |
| `toMention(s)` | assistant 文本含该字面子串 | 0.5.1 先做大小写折叠；失败信息附输出摘要 |
| `toEmit(type)` | 至少一个 event 的 `type` 相等 | 这是发布包可调用但网页指南未展示的方法 |

这些 matcher 都是同步 `void` 方法。
成功时写入 passed outcome；失败时先写 failed outcome，再抛 `EvalAssertionError`。
它们没有 skip 或数值 score。

普通 `expect(run.text)` 仍能让 Bun test 通过或失败。
版本参考没有承诺普通 `expect` 会为 Ori Run 写 outcome；需要模型读数时应至少保留一个 Run matcher。

### 5.4 Tool matcher

```ts
type ToolAssertions = {
  toBeCalled(): void;
  toBeCalledTimes(count: number): void;
  toBeCalledWith(expectedInput: object): void;
  toNotBeCalled(): void;
};
```

| 方法 | 判定 | 边界 |
|---|---|---|
| `toBeCalled()` | 同名 tool 至少出现一次 | 只观察 `tool.started` |
| `toBeCalledTimes(n)` | 同名调用次数严格等于 `n` | 没有范围或 predicate 形式 |
| `toBeCalledWith(obj)` | 至少一次输入匹配所给对象 | 0.5.1 对顶层字段做子集匹配，所给嵌套值做深度相等 |
| `toNotBeCalled()` | 同名 tool 一次也未出现 | 不表达 tool 是否可用或被拒绝 |

这一组 API 没有公开的调用顺序、完成状态、返回值、跨事件因果或 tool duration matcher。
`toEmit` 可以检查 event type 存在，但不是时序断言。

### 5.5 Judge 与 grader

等价 signature：

```ts
type JudgeInput = {
  criteria: string;
  output?: string;
  prompt?: string;
  run?: EvalRun;
};

type JudgeVerdict = {
  pass: boolean;
  score: number;
  reason: string;
};

declare function setupJudge(options?: {
  agent?: ReturnType<typeof setupAgent>;
  minScore?: number;
  systemPrompt?: string;
}): {
  evaluate(input: JudgeInput): Promise<JudgeVerdict>;
  autoEvals(input: JudgeInput): Promise<JudgeVerdict>;
};
```

| 面 | 0.5.1 语义 |
|---|---|
| 默认 Judge | `~anthropic/claude-opus-latest` |
| `minScore` | 默认 `0`；接受需要 `verdict.pass === true` 且 `score >= minScore` |
| `agent` | 可传 `setupAgent({ model })` 的返回值，更换 Judge 模型 |
| `systemPrompt` | 替换内置严格 grader system prompt |
| `criteria` | 必填 rubric 字符串 |
| `prompt` | 可选原始问题，加入 Judge 材料 |
| `run` | 提供候选文本，并让 `autoEvals` 把 Verdict 写回该 Run |
| `output` | 可直接评分字符串；同时提供时，0.5.1 优先使用它 |
| `evaluate` | 只返回 Verdict，不写 Run outcome，也不按 `minScore` 建立门槛 |
| `autoEvals` | 写入 pass/fail 与 score；Judge 拒绝或低于门槛时抛错 |

Judge 必须返回可解码的 `{ pass, score, reason }`，且 score 位于 0 到 1。
空输出、结构错误或越界 score 属于 Judge/harness 失败。
这些情况不把候选判成失败，也不写 `0`；候选保持 `unknown`。

`startingCriteria` 是可编辑的六个字符串：

| key | 目标 |
|---|---|
| `accuracy` | 事实与逻辑正确 |
| `completeness` | 回答所需各部分 |
| `instructionFollowing` | 遵循显式指令 |
| `safety` | 可安全交给真实用户 |
| `structuredOutput` | 满足严格结构 |
| `toneAndVoice` | 符合指定语气 |

作者可以用 `join("\n\n")` 组合多个 rubric。
官方参考提醒组合处并不完全正交：`safety` 是整份输出判定，`instructionFollowing` 只明确排除 accuracy。
组合前仍要阅读全文。

Judge 与候选同属一个模型家族时，0.5.1 会警告潜在偏好。
默认 Judge 属于 Anthropic 家族，因此 Anthropic 候选会触发警告。
这是 warning，不会拒绝运行。

### 5.6 Live catalog 与候选模型

```ts
type ModelQuery = {
  limit?: number;
  maxPromptPrice?: number;
  maxCompletionPrice?: number;
  minContextLength?: number;
  minIntelligenceIndex?: number;
  minCodingIndex?: number;
  minAgenticIndex?: number;
  requiredParameters?: string[];
  requiredInputModalities?: string[];
  excludeExpiring?: boolean;
  slugs?: string[];
  include?: string[];
  exclude?: string[];
};

declare function candidateModels(query?: ModelQuery): Promise<string[]>;
declare function rankedModels(
  query?: ModelQuery,
): Promise<readonly CatalogModel[]>;
```

| query 字段 | 条件 | 未提供时 |
|---|---|---|
| `limit` | 最多返回前 `N` 项；`N <= 0` 返回空数组 | 不截断 |
| `maxPromptPrice` | input 单 token 美元价格不高于上限 | 不按此项过滤 |
| `maxCompletionPrice` | output 单 token 美元价格不高于上限 | 不按此项过滤 |
| `minContextLength` | context token 上限不低于该值 | 不按此项过滤 |
| `minIntelligenceIndex` | Intelligence Index 不低于该值 | 不按此项过滤 |
| `minCodingIndex` | Coding Index 不低于该值 | 不按此项过滤 |
| `minAgenticIndex` | Agentic Index 不低于该值 | 不按此项过滤 |
| `requiredParameters` | 模型必须含全部参数名，例如 `tools` | 不按参数过滤 |
| `requiredInputModalities` | 模型必须含全部输入模态 | 不按模态过滤 |
| `excludeExpiring` | `true` 排除带 expiration date 的模型 | 保留这些模型 |
| `slugs` | exact id 清单 | 不限定 exact id |
| `include` | slug 命中任一子串 | 不要求子串 |
| `exclude` | slug 命中任一子串即排除 | 不排除子串 |

OpenRouter 目录价格字段以美元/单 token 表达。
例如 `0.000005` 等于每百万 token 5 美元。
[Models 参考](https://openrouter.ai/docs/guides/overview/models)

目录缺少某个被限制字段时，该模型不能通过对应上限或下限。
Quality Index 数据稀疏；使用 index floor 会同时排除未评分模型。

未知 query 字段立即抛错。
`slugs` 中有不存在的 exact id 也会抛错。
`include` 只做子串命中，不适合代替 `slugs`。

`rankedModels` 名字容易误导。
0.5.1 按目录顺序过滤，没有 `sort` 参数；作者必须自行按返回字段排序。
`candidateModels` 只投影 slug，并故意返回可变数组，方便传给 Bun `test.each`。

`CatalogModel` 的完整公开运行时字段如下：

| 类别 | 字段 |
|---|---|
| 身份 | `slug`、`name`、`canonicalSlug?` |
| 时间信息 | `created?`、`expirationDate?`、`knowledgeCutoff?` |
| 能力 | `contextLength?`、`maxCompletionTokens?`、`supportedParameters?` |
| 模态 | `inputModalities?`、`outputModalities?`、`tokenizer?` |
| 策略 | `isModerated?` |
| 价格 | `promptPrice?`、`completionPrice?`、`cacheReadPrice?` |
| 指数 | `intelligenceIndex?`、`codingIndex?`、`agenticIndex?` |
| Arena | `designArena?`，元素含 `arena?`、`category?`、`elo?`、`rank?`、`winRate?` |
| effort | `reasoningEfforts?`、`reasoningMandatory?` |

问号表示目录可缺少该值。
缺失不是零，也不应进入数值排名。

### 5.7 Liveness、effort、endpoint 与路由

```ts
declare function isModelLive(slug: string): Promise<boolean>;
declare function assertModelIsLive(slug: string): Promise<void>;
declare function candidateEfforts(
  slug: string,
  harness?: string,
): Promise<string[]>;
declare function modelEndpoints(slug: string): Promise<ModelEndpoint[]>;
declare function endpointProviders(slug: string): Promise<string[]>;
```

| API | 语义 | 失败或空值 |
|---|---|---|
| `isModelLive` | exact id 存在，或 routing modifier 的 base slug 存在 | 返回 `false` |
| `assertModelIsLive` | 同一检查，但用 eval failure 提示 retirement 或 typo | 不存在时抛错 |
| `candidateEfforts` | 先按模型发布列表，再按 harness 词表去重 | 无 reasoning 返回空数组；未知 slug 抛错 |
| `modelEndpoints` | 返回该 slug 的全部 endpoint 元数据 | HTTP 或未知模型错误时拒绝 Promise |
| `endpointProviders` | 从 endpoint 列表提取去重 Provider 名 | 同上 |

`candidateEfforts` 的公开候选值是 `max`、`xhigh`、`high`、`medium`、`low`、`minimal`、`none`。
模型和 harness 会缩小这组值；例如 pi 把 `max` 与 `xhigh` 映射到同一配置并去重。

`ModelEndpoint` 完整字段：

| 类别 | 字段 |
|---|---|
| 身份 | `slug`、`name?`、`provider`、`tag?` |
| 服务形态 | `quantization?`、`status?`、`supportedParameters?` |
| 容量 | `contextLength?`、`maxCompletionTokens?` |
| 价格 | `promptPrice?`、`completionPrice?`、`cacheReadPrice?` |
| 可用性 | `uptimeLast30m?`、`uptimeLast1d?` |

同一 slug 的 Provider、量化、价格和可用性可能不同。
报告的 `Served by` 列会尽量写出实际服务方；只有 pi harness 能提供完成这项查找所需的 generation 信息。

路由比较没有独立函数。
作者把 `bare`、`:nitro`、`:floor`、`:exacto` 当作四个 model value 传给 `setupAgent({ model })`。
它们分别请求默认、吞吐优先、价格优先与 Exacto 排序。

modifier 是偏好，不是保证。
0.5.1 没有把 `provider.order` 传给 harness 的公开路径，因此不能固定一个 exact Provider endpoint。

### 5.8 `pilotCases` 与事件读取函数

```ts
declare function pilotCases<T>(cases: readonly T[]): T[];
declare function assistantText(events: readonly unknown[]): string;
declare function toolCalls(events: readonly unknown[]): string[];
```

普通运行时，`pilotCases` 返回输入的浅复制。
`ori eval --pilot N` 时，它从完整数组做分散抽样，最多返回 `N` 个 case。
纯 `bun test` 不设置 Ori 的 pilot 变量，因此仍得到全部 case。

`--pilot` 会报告候选与 Judge 的实测成本，并外推完整 case 数。
它跳过历史写入与 `baseline` 比较，避免抽样运行成为参照。
文件没有调用 `pilotCases` 时，runner 会拒绝把未采样的全量运行伪装成 pilot。

`assistantText` 只拼接 `assistant.text.delta`。
`toolCalls` 只读取 `tool.started` 的名称。
两者没有失败态；没有命中时分别返回空字符串与空数组。

### 5.9 Runner：参数、子命令与退出

`ori eval [target]` 接受目录或单个 `.eval.ts`。
省略 target 时，从当前目录递归查找，并跳过 `node_modules`、`.git` 与 `.ori`。

凭据优先级是 `OPENROUTER_API_KEY`、workspace `.ori/credentials.json`、全局 `~/.ori/credentials.json`、全局 `~/.openrouter/credentials.json`。
runner 把求得的 key 传给 Bun child。
没有凭据且不使用 `--dry-run`、`--list` 或 `--allow-no-key` 时，命令会在模型调用前失败。

| 参数或 flag | 默认值 | 行为 |
|---|---|---|
| `target` / `--path` | 当前目录 | 指定搜索目录或文件 |
| `--allow-no-key` | `false` | 无凭据也继续；常与 `--list` 使用 |
| `--baseline last\|best\|model:<slug>` | flag 可省略 | 只生成历史比较，不改变退出状态 |
| `--dry-run` | `false` | 加载文件但不执行 test body；top-level code 仍执行 |
| `--features <dir>` | target 下存在的 `features/` | 指定 Agent feature 目录 |
| `--host <host>` | `127.0.0.1` | 临时 runtime bind host |
| `--list` | `false` | 只列出发现的 eval |
| `--no-history` | `false` | 不追加 `.ori/eval/history.jsonl` |
| `--pilot <N>` | 无 | 每个 eval 抽取 `N >= 1` 个 case 并估算全量成本 |
| `--report <path>` | 无 | 写 Markdown；相对路径基于 eval 目录 |
| `--timeout <ms>` | `120000` | 每个 Bun test 的上限；test 自身 timeout 优先 |

子命令也属于公开 runner 面：

| 命令 | 返回 |
|---|---|
| `ori eval docs [sdk\|catalog\|providers\|judging\|results\|running\|lifecycle\|all]` | 版本匹配的参考 |
| `ori eval skill` | `create-eval` authoring Skill 文本，不是 matcher API |
| `ori eval scratch` | 自包含临时 workspace 的路径 |

`ori eval` 还继承全部通用 flag：

| flag | 行为 |
|---|---|
| `--help` / `-h` | 显示命令帮助 |
| `--version` / `-v` | 显示 CLI 版本 |
| `--wizard` | 为该命令启动 wizard mode |
| `--completions <bash\|zsh\|fish\|sh>` | 输出指定 shell 的 completion script |
| `--log-level <level>` | 接受 `all`、`trace`、`debug`、`info`、`warn`、`warning`、`error`、`fatal`、`none` |
| `--json` / `--agent` | 强制 stdout 只有一个 JSON 文档，诊断走 stderr |
| `--human` / `--tty` | 强制人读输出 |

重定向和 pipe 默认使用 JSON。
0.5.1 没有公开 JSON schema。

G 写道 `ori eval` 的退出码等于 Bun test 的退出码。
R 的版本参考更具体：0.5.1 把任意 eval failure 归一为进程退出 `1`，输出仍写出 Bun 原始 code。
CI 应依赖零与非零，不应依赖非零 code 的精确数字。

## 6. 三个可抄的完整场景

下面三份文件都沿用 G 与 R 的公开形状。
把 prompt、tool 名和 rubric 换成真实应用事实，再运行付费调用。

### 场景一：确定性行为、文本、成本与耗时

`evals/support/refund.eval.ts`：

```ts
import { test } from "bun:test";
import { setupAgent } from "ori/eval";

const agent = setupAgent();

test("checks the order before discussing a refund", async () => {
  const run = await agent.run(
    "A customer asks for a refund for order 1234. Handle the request.",
  );

  run.tool("lookup_order").toBeCalled();
  run.tool("lookup_order").toBeCalledTimes(1);
  run.tool("lookup_order").toBeCalledWith({ orderId: "1234" });
  run.tool("delete_order").toNotBeCalled();
  run.toMention("1234");
  run.toComplete();
  run.toCostAtMost(0.02);
  run.toFinishWithin(30_000);
});
```

```sh
ori eval --dry-run evals/support/refund.eval.ts
ori eval evals/support/refund.eval.ts --human
```

这份 test 没有 Judge，因此没有 score。
任一 matcher 抛错都会停止该 test 后续语句。
把最能解释核心失败的断言放前面。

### 场景二：开放答案 Judge

`evals/support/policy-quality.eval.ts`：

```ts
import { test } from "bun:test";
import {
  setupAgent,
  setupJudge,
  startingCriteria,
} from "ori/eval";

const agent = setupAgent();
const judge = setupJudge({ minScore: 0.8 });

const prompt = "Explain the refund policy for a digital purchase.";

test("gives a correct and complete policy answer", async () => {
  const run = await agent.run(prompt);

  run.toComplete();
  await judge.autoEvals({
    criteria: [
      startingCriteria.accuracy,
      startingCriteria.completeness,
    ].join("\n\n"),
    prompt,
    run,
  });
});
```

```sh
ori eval evals/support/policy-quality.eval.ts \
  --report policy-quality.md
```

`autoEvals` 只有在 Judge `pass` 为真且 score 至少是 `0.8` 时返回。
其它有效 Verdict 会先写入 reason 与 score，再让 test 失败。

### 场景三：候选、抽样、并发与批量门槛

`evals/support/model-comparison.eval.ts`：

```ts
import { expect, test } from "bun:test";
import {
  candidateModels,
  pilotCases,
  setupAgent,
  setupJudge,
  startingCriteria,
} from "ori/eval";

const cases = pilotCases([
  "Reply to a customer whose package arrived damaged.",
  "Explain how a customer can update a shipping address.",
  "Respond to a customer who cannot find an invoice.",
]);

const candidates = await candidateModels({
  limit: 5,
  maxPromptPrice: 0.000_005,
  minContextLength: 16_000,
});

const judge = setupJudge({ minScore: 0.7 });

test.concurrent.each(candidates)(
  "handles support prompts: %s",
  async (model) => {
    const agent = setupAgent({ model });
    const failures: Error[] = [];

    const settled = await Promise.allSettled(
      cases.map(async (prompt) => {
        const run = await agent.run(prompt);
        run.toComplete();
        await judge.autoEvals({
          criteria: startingCriteria.instructionFollowing,
          prompt,
          run,
        });
      }),
    );

    for (const item of settled) {
      if (item.status === "rejected") {
        failures.push(
          item.reason instanceof Error
            ? item.reason
            : new Error(String(item.reason)),
        );
      }
    }

    expect(failures).toEqual([]);
  },
);
```

先用一个 case 实测完整运行成本：

```sh
ori eval --pilot 1 evals/support/model-comparison.eval.ts --human
```

确认费用后运行全量，并写报告：

```sh
ori eval evals/support/model-comparison.eval.ts \
  --report model-comparison.md
```

有前次相同文件集合的历史条目后，可以追加比较：

```sh
ori eval evals/support/model-comparison.eval.ts \
  --baseline best \
  --report model-comparison.md
```

`Promise.allSettled` 让一个 case 失败后，其余已发出的调用继续完成。
最后的 `expect` 是每个候选的批量门槛。
case 更多时，R 建议分成每批三个，避免候选数乘 case 数造成过高并发。

## 7. 结果、诊断、artifact、CI 与 regrade

### 结果语义

人读输出按三层出现：

1. 每个 Bun test 的 `pass`、`FAIL` 或 `skip`。
2. 每个候选 Run 与 Judge Run 的模型、outcome、时长、工具数、score、token 和成本。
3. 候选/Judge 费用拆分，以及可选的 `baseline` 比较。

| 输出 | 含义 | 不能怎样解释 |
|---|---|---|
| `pass` | test 或 Run 判定通过 | 不等于存在 Judge score |
| `FAIL` | test 或 Run 判定失败 | 不等于模型没有产生回答 |
| `skip` | Bun test 被跳过 | 只出现在 test 行，不是 Run outcome |
| `outcome?` | Run 没有写入判定 | 不是通过，也不是零分 |
| `CUT OFF` | Run 没有形成完整测量 | 耗时、成本与 outcome 都应留空 |
| `unknown` | 模型或判定无法求得 | 不应折成 fail |
| `unmeasured` | 没有足够数据形成读数 | 不应写 `0` |
| 无 `score=` | 没有 Judge score | 不应写 `0.00` |

`Failed runs` 统计没有回答的调用，例如凭据、Provider、rate limit 或 timeout 失败。
`Correctness` 只计算实际被判定的 Run。
全部调用都失败的模型显示 `unmeasured`，而不是 `0/N`。

Judge 行以 `judge` 开头。
模型比较要先排除 Judge 行，并分别引用 `candidates` 与 `judge` 费用小计。
失败 Run 下方的缩进行给出详情；Markdown 报告还在 `## Failures` 汇集拒绝原因。

### artifact 与历史

| 文件或输出 | 责任 | 稳定性边界 |
|---|---|---|
| `*.eval.ts` | 可提交、可复跑的作者输入 | 普通项目代码 |
| `.ori/sdk` | runner 生成的本地 `ori/eval` package | 与安装版本匹配，不是作者契约 |
| `.ori/eval/history.jsonl` | workspace 内最多 200 次 run summary | git-ignored；公开 schema 未承诺稳定 |
| `--report <path>` | 可分享 Markdown，含读数、失败和比较 | 只有 Markdown flag 有公开说明 |
| stdout JSON | Agent 消费的单个 JSON 文档 | 0.5.1 未发布 schema |

`baseline` 只读同一 workspace 的历史，并要求两次 run 包含完全相同的 eval 文件集合。
`last`、`best` 与 `model:<slug>` 都只改变报告，不改变通过或失败。

0.5.1 没有公开 Judge-only regrade 命令。
修改 rubric 后再次运行 `ori eval` 会重新执行候选 Agent，也会再次付费。
因此 `baseline` 是历史比较，不是重新判分。

0.5.1 help 也没有 JUnit flag。
需要 CI artifact 时，公开路径是 Markdown 报告、job summary 或 stdout JSON。

### GitHub Actions

官方建议把付费 eval 放在独立、人工触发或定时的 job。
普通 unit-test job 只做无密钥发现检查。

```yaml
name: agent-eval

on:
  workflow_dispatch:
  schedule:
    - cron: "0 9 1 * *"

jobs:
  eval:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
      - uses: oven-sh/setup-bun@v2
      - name: Install Ori
        run: |
          curl -fsSL https://openrouter.ai/labs/ori/install.sh | bash
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - name: Discover evals without model calls
        run: ori eval --list --allow-no-key
      - name: Run evals
        run: ori eval --report eval-report.md
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      - name: Add report to job summary
        if: always()
        run: |
          if [ -f eval-report.md ]; then
            cat eval-report.md >> "$GITHUB_STEP_SUMMARY"
          fi
```

失败 eval 给 job 非零退出。
定时 job 会产生真实模型费用；是否阻止 release 由 workflow dependency 决定。
[Eval 指南](https://openrouter.ai/docs/guides/ori/eval)

## 8. 自定义扩展

### 普通 Bun 判定

Run 是普通数据对象。
作者可以用 `expect` 检查精确 JSON、label 或业务值：

```ts
const run = await agent.run("Return one label: refund or no_refund.");
expect(run.text.trim()).toBe("refund");
run.toComplete();
```

这适合确定性输出。
若报告需要 Ori outcome，保留一个 Run matcher；普通 `expect` 的报告写入规则没有公开保证。

### 自定义 Judge

更换 grader model：

```ts
const judge = setupJudge({
  agent: setupAgent({ model: "openai/gpt-5.6-terra" }),
  minScore: 0.75,
});
```

作者也可以传 `systemPrompt`，或完全自写 `criteria`。
官方没有公开 temperature、seed、重试、Provider 固定或多 Judge 聚合配置。

### 自有 harness 与结构化输出

`setupAgent({ harness })` 和 Run 的 `outputSchema` 是发布包接受的扩展点。
0.5.1 参考没有公开 harness interface、schema type 或兼容承诺。
它们适合已有 Ori 集成的作者，不足以让新手仅凭公共页面独立实现 adapter。

### 没有注册式 matcher 或 metric 插件

0.5.1 没有 `defineMatcher`、`defineScorer`、metric registry 或 reporter plugin。
作者可以写普通函数并调用 Run/`expect`，但不会自动获得内置 matcher 的诊断与 outcome 写入。

## 9. 好在哪里

### 语法靠近 Agent 事实

`run.tool("search").toBeCalled()` 把观察对象与关系分开。
完成、文本、成本和耗时都挂在同一 Run，短 test 可以同时表达功能与运行限制。

### 新手只需理解 Bun test

文件、`test.each`、`test.concurrent`、`expect` 与 CI 退出都沿用现成工具。
项目语言可以不是 TypeScript，作者也不必安装 TypeScript compiler。

### option typo 会立即失败

`setupAgent`、Run、Judge 与 catalog query 都拒绝未知字段。
价格 filter 拼错不会静默返回整个目录，模型 option 拼错也不会悄悄使用 workspace 默认值。

### 开放 Judge 与确定性 matcher 分层

简单事实不必付 Judge 费用。
开放答案获得 `pass`、0–1 score 与 reason，并能用 `minScore` 建立明确门槛。

### 候选选择进入作者 API

`candidateModels`、exact `slugs`、liveness、effort 与 endpoint 元数据属于同一 package。
作者能先免费查目录，再决定是否付费比较。

### Pilot 把费用确认放在全量运行前

`pilotCases` 与 `--pilot 1` 测的是完整 Agent turn 和 Judge，不是按 token 猜测。
报告还把候选费用与 Judge 费用分开。

### 缺测不会伪装成零

成本缺失会让成本断言失败。
Judge 没有有效 Verdict 时保持 `unknown`；全部 Run 失败时显示 `unmeasured`。
这比用零分或零美元掩盖缺失更诚实。

## 10. 不好的地方与不应类比 NiceEval 的边界

### 内置行为 matcher 很窄

工具面只有存在、次数、输入和不存在。
没有顺序、完成状态、返回值、跨 turn、trace、文件 diff、命令、Sandbox 或证据完整度断言。

### Run 不等于 NiceEval Run 或 Attempt

Ori Run 是一次 Agent 调用加 matcher 的对象。
它没有 NiceEval 的 Eval/Experiment 分离、Attempt 身份、标准证据 scope、AssertionResult 或四态 Verdict。

### `unknown` 不是一等 `unavailable`

Judge/harness 失败会留下 `unknown`，但作者不能返回带原因和证据 locator 的 `unavailable`。
Bun `test.skip` 又只作用于 test，不是判定结果。

### 聚合由 test 结构隐式承担

作者没有权重、points、N 选 M、derived metric 或统计显著性 API。
一个 test 内的 throw、`Promise.allSettled` 和最后一条 `expect` 决定是否继续与是否失败。

### 运行配置写进 eval 文件

`setupAgent({ model })`、候选 query、Judge 与 test 同住一份 `*.eval.ts`。
这对一次模型选型很直接，但不应类比 NiceEval 的 Eval 与 Experiment 长期边界。

### OpenRouter 与 Ori harness 绑定较深

候选目录、价格、routing modifier、endpoint 与 Judge 都走 OpenRouter。
这使同平台体验顺滑，却不适合直接复制到 Provider 中立 core。

### “固定 harness 与模型”不能证明只有模型变化

Provider endpoint 仍会变化，`bare`、`:nitro`、`:floor` 与 `:exacto` 都只是偏好。
外部工具、实时数据、随机采样与 Judge 都可能改变读数。
发布文章的因果表述适合作为目标，不足以当严格实验保证。

### 默认 Judge 与 effort 代价高

Judge 默认是 `~anthropic/claude-opus-latest`，未声明 effort 的候选默认 `high`。
作者若不读版本参考，可能在小候选上把大部分费用付给 Judge。

### 并发会污染 latency 比较

候选并发适合 correctness、score 与成本。
`durationMs` 是各 Run 的争用墙钟时间；接近的模型可能因并发交换顺序。
路由或 latency 判断应另做串行运行。

### 公共类型与持久协议不够完整

发布 workspace 没有 `.d.ts`。
事件 union、harness interface、JSON 输出、history 和 Markdown schema 都没有公开稳定契约。

## 11. 对 NiceEval 可吸收与不应复制

### 可吸收

- 保留 scope receiver 语法，让常用 Agent 事实从 `run.tool(...)` 一类领域入口开始。
- 对未知配置字段立即报错，避免 typo 静默回到默认行为。
- 把候选成本与 Judge 成本分开显示，并让缺测保持空值。
- 在昂贵矩阵前提供真实小样本 cost pilot，同时明确 pilot 不能成为正式参照。
- 给 Judge 返回统一的 `pass / score / reason`，并把 reason 放进失败诊断。
- 让一次性研究先住在仓库外，再由用户决定是否提升为长期 eval。
- 在 Provider 能力层提供 live candidate discovery、liveness 与 endpoint spread。

### 不应复制

- 不把模型矩阵、Judge 与题目长期揉进同一 Eval 文件。
- 不把 OpenRouter 目录或 routing modifier 写进 NiceEval core。
- 不用抛异常和 Bun test 退出代替完整 AssertionResult 与 Verdict。
- 不把 `unknown` 当作证据不足的完整表达；NiceEval 应保留具名 `unavailable` 原因。
- 不把本地 `history.jsonl` 当成可携带、可比较的 Record 契约。
- 不把一个默认高 effort 与昂贵 Judge 隐藏在最短调用路径。
- 不让普通 JavaScript 聚合承担 points、optional、gate 与统计口径。
- 不因模型 slug 固定就宣称 Provider、工具与运行输入都固定。

## 12. 无法核实项

以下项目不能从 G、R、M、D 与 O 得到稳定、公开的完整答案：

1. `SetupAgentOptions`、`parameters`、`env`、`harness`、`outputSchema` 与 event 的正式 TypeScript 类型。
2. runtime event 的穷尽 union、每种 payload 与版本兼容规则。
3. 多个 matcher 或多个 Judge Verdict 写到同一 Run 后，报告怎样折叠 score 与 outcome。
4. `--baseline best` 选择“best”的精确算法，以及没有传 flag 时是否自动比较 `last`。
5. `history.jsonl`、stdout JSON 与 Markdown report 的稳定 schema。
6. Judge 的 temperature、seed、重试、timeout、缓存和 endpoint 选择。
7. 候选模型与 Judge 的随机性控制，以及跨 Provider endpoint 的可复现保证。
8. Judge-only regrade、权重聚合、统计检验与自定义 reporter API。
9. Run 级 skip、证据不足、部分评分与带 locator 的 `unavailable` API。
10. `toMention("")`、非法 `toBeCalledTimes` 数值等边界输入的契约。
11. `ori/eval` 的 semver 承诺、弃用周期与哪些 API 被视为 experimental。
12. `builtFrom` commit 对应的公共源码位置。发布仓库明确说它是分发镜像，不是源码仓库。

0.5.1 的 stable 发布没有把上述 API 标成 experimental。
仓库另有 alpha channel，但本文没有用 alpha 行为补 stable 缺口。

`spawn-ori-eval` 仍然只是外层安装与访谈 Skill。
它的步骤、默认 authoring model 或临时目录行为都不应被算进断言 API。
