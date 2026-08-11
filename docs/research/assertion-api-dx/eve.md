# Eve Eval 断言、Judge 与判定作者指南

本文观察 Eve 的 Eval 作者面，重点是断言、Judge、事件、判定与汇总。
它是带日期的外部产品研究，不构成 NiceEval 的目标契约。

## 1. 定位与真实边界

### 官方事实

Eve 是完整的 Agent 框架，`eve eval` 是其中的端到端 Eval runner。
它不是可脱离 Agent 运行的通用 scorer 包，也不是 Jest 或 Vitest 的 matcher 扩展。

Eval 文件位于应用根目录的 `evals/**/*.eval.ts`。
runner 会启动本地 Eve 服务，或连接 `--url` 指向的 Eve 服务。
测试体通过 HTTP session 驱动真实 Agent，再对捕获的事件和派生事实判分。

作者使用三条判分入口：

1. `t`、session、turn 上的 scoped assertions；
2. `t.check(value, assertion)` 与 `eve/evals/expect` builders；
3. `t.judge.autoevals.*` 下的四个 model-backed graders。

每条普通断言都登记为 `AssertionResult`。
默认行为是收集整组失败，而不是在首个失败处抛错。
只有 `require` 家族和 `expectOk()` 会影响测试体后续控制流。

### 研究判断

Eve 的核心取舍是“scope-first”。
常见 Agent 事实直接成为 receiver 方法，任意应用值才进入通用 builder。
这比先暴露事件数组、再要求作者手工筛选更容易上手。

它的真实边界也很窄：

| 能力 | Eve 提供 | 不应据此推定 |
|---|---|---|
| Run 行为 | tool、subagent、HITL、typed event、reply | Sandbox 文件差异或进程级行为 |
| 值判分 | exact、contains、schema、predicate、Levenshtein | 任意统计 metric catalog |
| Judge | 四个 Braintrust AutoEvals wrapper | 通用 Judge runtime 或自定义 prompt engine |
| 汇总 | Verdict 计数、soft score 均值、reporter | 加权总分、显著性检验或 N 选 M |
| 保存 | JSON、JSONL、NDJSON、JUnit、Braintrust | 从旧 Run 重新判分 |

Eve 整体处于 preview，版本号仍为 `0.x`。
本文固定观察点，不把这些 API 当成长期兼容承诺。

## 2. 观察版本和一手链接

观察日期是 **2026-08-09**。

本机官方仓库固定在 `bd93f55481b3048d0273dd041b423e73fb9248cf`。
`eve@0.31.3` tag 指向 `8e0bd60cd49246706a7ebdb8f7c84c3683048970`。
观察 revision 是该 tag 之后三个 commit。
`packages/eve/src/evals`、`docs/evals` 与 package metadata 在这三个 commit 中没有差异。

npm 在观察日把 `0.31.3` 标为 `latest`。
该版本发布于 2026-08-07 19:34:48 UTC。
固定仓库把 Braintrust AutoEvals `0.0.132` 写在 `devDependencies`，wrapper 源码直接导入它。
该版本对应官方 tag `js-0.0.132`，peeled commit 是 `93f22c16e13abb7800a022c8cf566e5957f36c41`。
npm package metadata 不把它列为外部 runtime dependency。

| 编号 | 一手材料 | 本文用它核对什么 |
|---|---|---|
| E1 | [固定 revision](https://github.com/vercel/eve/commit/bd93f55481b3048d0273dd041b423e73fb9248cf) | 观察点与 commit 时间 |
| E2 | [`eve@0.31.3` tag](https://github.com/vercel/eve/tree/eve%400.31.3) · [npm registry metadata](https://registry.npmjs.org/eve) · [package.json](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/package.json) · [Preview terms](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/README.md) | 发布版本、package metadata 与稳定性声明 |
| E3 | [安装](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/installation.mdx) · [Eval overview](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/evals/overview.mdx) | 安装、目录、首个 Eval、默认行为 |
| E4 | [Cases](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/evals/cases.mdx) · [Targets](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/evals/targets.mdx) | session、turn、dataset、live handle |
| E5 | [公开导出](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/index.ts) · [Eval types](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/types.ts) · [Client send contract](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/client/types.ts) · [HITL types](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/runtime/input/types.ts) | signature、输入、结果与 Verdict |
| E6 | [Scoped assertions](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/assertions/run.ts) · [matcher 规则](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/match.ts) | 每个 scoped method 的精确语义 |
| E7 | [Expect builders](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/expect/index.ts) · [Assertions 文档](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/evals/assertions.mdx) | 值断言、默认严重度与诊断 |
| E8 | [Collector](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/assertions/collector.ts) · [Context](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/context.ts) · [Session](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/session.ts) | handle、`require`、scope 时点、失败传播 |
| E9 | [Judge wrapper](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/judge.ts) · [Judge 文档](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/evals/judge.mdx) · [AutoEvals tag](https://github.com/braintrustdata/autoevals/tree/js-0.0.132) · [classifier](https://github.com/braintrustdata/autoevals/blob/js-0.0.132/js/llm.ts) · [grader templates](https://github.com/braintrustdata/autoevals/tree/js-0.0.132/templates) · [Levenshtein](https://github.com/braintrustdata/autoevals/blob/js-0.0.132/js/string.ts) | grader family、模型优先级、分数与诊断 |
| E10 | [事件联合](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/protocol/message.ts) | 可供 event assertions 使用的全部 event type |
| E11 | [CLI](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/cli/eval.ts) · [Running 文档](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/evals/running.mdx) · [Verdict](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/runner/verdict.ts) | flags、退出码、严格模式与汇总 |
| E12 | [Artifacts](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/runner/artifacts.ts) · [Reporter 文档](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/docs/evals/reporters.mdx) · [Reporter 源码](https://github.com/vercel/eve/tree/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/runner/reporters) | 文件内容、JUnit、Braintrust、自定义 reporter |
| E13 | [Loaders](https://github.com/vercel/eve/tree/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/loaders) · [`mockModel`](https://github.com/vercel/eve/blob/bd93f55481b3048d0273dd041b423e73fb9248cf/packages/eve/src/evals/mock-model.ts) | dataset 输入与确定性 fixture |

除非小节明确标为研究判断，后文 API 事实都以 E1–E13 为准。
Preview 警告适用于整个 framework；固定 Eval 导出没有更细的 experimental 标记。
第 5.1 节列出的旧字段会直接报错，不是仍可使用的兼容别名。

## 3. 安装、最小项目与首个可运行 Eval

### 前置条件

固定版本要求 Node.js 24 或更新版本。
新建项目还需要 npm，以及 Agent 模型对应的凭据。
使用 AI Gateway 时设置 `AI_GATEWAY_API_KEY`，或让 Vercel 项目提供 `VERCEL_OIDC_TOKEN`。

创建并进入项目：

```bash
npx eve@0.31.3 init my-agent
cd my-agent
```

`eve init` 会写入 Agent 文件、安装依赖并启动开发服务。
如果服务仍占用当前终端，先用 Ctrl+C 停止它。
`eve eval` 会自行启动本地服务。

最小 Eval 目录只有两个文件：

```text
my-agent/
├── agent/
├── evals/
│   ├── evals.config.ts
│   └── smoke.eval.ts
└── package.json
```

`evals/evals.config.ts`：

```ts
import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({});
```

`evals/smoke.eval.ts`：

```ts
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "The agent accepts a turn and returns the requested marker.",
  async test(t) {
    await t.send("Reply with the word READY.");
    t.succeeded();
    t.check(t.reply, includes("READY"));
  },
});
```

运行单个 Eval：

```bash
npx eve eval smoke
```

文件名产生 id `smoke`。
命令会连接 live Agent，因此回复检查仍受 Agent 模型影响。
第 6 节给出使用 `mockModel` 的完全确定性版本。

成功退出码是 `0`。
无论成功或失败，runner 都会在 `.eve/evals/<timestamp>/` 写入本次 `artifact`。

## 4. 核心数据流与对象关系

一次 Eval 的数据流如下：

```text
defineEval({ test })
        │
        ▼
     test(t) ── send/start/respond ──► Eve HTTP session ──► typed events
        │                                      │
        ├─ scoped method ── 延后读取 scope ────┤
        ├─ check(value, Assertion) ── 立即启动求值
        └─ judge.autoevals.* ──────── 立即启动 Judge
                                               │
                                               ▼
                                     AssertionResult[]
                                               │
                                               ▼
                       EveEvalResult.verdict + EveEvalRunSummary
                             │              │             │
                          console         reporter      artifact
```

### 五个作者对象

| 对象 | 生命周期 | 可见事实 | 断言时点 | E |
|---|---|---|---|---|
| `EveEvalContext`，即 `t` | 一个 Eval | 主 session getter；最终 scoped assertion 可见全部 session | scoped method 延后到测试体结束 | E5、E8 |
| `EveEvalSession` | 一个独立 session | 累积 events、pending input、state、最后 turn output | 调用 scoped method 时做 snapshot | E4、E8 |
| `EveEvalLiveTurn` | 正在流式执行的一次 turn | 已观察 events、session、session id | `waitForEvent` 在流中等待 | E4、E5 |
| `EveEvalTurn` | 已结束的一次 turn | message、data、events、tool calls、status | immutable snapshot | E4、E5 |
| `EveEvalTargetHandle` | 本地或 remote target | URL、能力、外部 session 接入 | 不直接判分；把事件并入 Eval | E4、E5 |

`t.newSession()` 创建额外 session。
这些 session 的事件会进入最终的 run-level scoped assertions 和 `artifact`。
测试体内直接读取 `t.events` 时，只读主 session 的当前事件。

### 三种求值时点

| 入口 | 捕获什么 | 何时开始 | 何时等待 |
|---|---|---|---|
| `t.succeeded()` 一类 run method | scope selector | 测试体结束后 | collector finalization |
| session 或 turn scoped method | 调用时的 snapshot | 测试体结束后 | collector finalization |
| `t.check(value, assertion)` | 调用时传入的 value | 调用时 | collector finalization |
| `t.judge.autoevals.*` | 当时的 context prompt slot、`on` 或 `t.reply`、模型配置 | 调用时 | collector finalization |
| `await t.require(...)` | 调用时 value | 立即 | 当前语句 |

因此，`t` 上的断言可以写在 `send` 之前，却仍读取最终 run。
这种写法虽可运行，但不利于阅读。
session assertion 则只看调用时已有的 session 历史。

## 5. 完整 API catalog

### 5.1 Eval 定义、配置与 dataset

#### `defineEval`

```ts
function defineEval(input: EveEvalInput): EveEvalDefinition;

interface EveEvalInput {
  description?: string;
  judge?: EveEvalJudgeConfig;
  timeoutMs?: number;
  tags?: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
  reporters?: readonly EvalReporter[];
  test(t: EveEvalContext): void | Promise<void>;
}
```

`test` 是唯一必填字段。
函数同步返回带 `_tag: "EveEval"` 的 definition。
id 由 `evals/<path>.eval.ts` 推导，作者不能传 `id` 或 `name`。

| 字段 | 默认值 | 作者可见行为 | E |
|---|---|---|---|
| `description` | `undefined` | `--list` 可显示说明 | E3、E5、E11 |
| `judge` | project config 或无 | 只给该 Eval 的 Judge 使用，不改变被测 Agent | E5、E9 |
| `timeoutMs` | config 或无超时 | per-eval timeout；CLI 可再覆写 | E5、E11 |
| `tags` | `[]` 的筛选效果 | 供 `--tag` 与 `--exclude-tag` 使用 | E5、E11 |
| `metadata` | `undefined` | 交给 reporter；不参与默认 Verdict | E5、E12 |
| `reporters` | `[]` | 只观察引用该 instance 的 Eval；共享 instance 会合组 | E5、E12 |
| `test` | 无 | sync 或 async；抛错成为 execution error | E5、E8 |

`timeoutMs` 默认未设置，可为零或任意非负有限数。
已移除的 `input`、`run`、`checks`、`scores`、`expected`、`thresholds`、`parseOutput`、`model`、`modelOptions`、`cases` 与 `requires` 会得到定向错误。

一个文件可默认导出 definition，也可导出 definition array。
array entry 的 id 是 `<file-id>/0000`、`0001`，index 至少四位并按数组顺序产生。
与另一文件推导出的 id 冲突时，discovery 报错。
Eval module 是 ESM，因此 dataset 可以用 top-level `await`。
证据是 E3–E5。

#### `defineEvalConfig`

```ts
function defineEvalConfig(input: EveEvalConfigInput): EveEvalConfig;

interface EveEvalConfigInput {
  judge?: EveEvalJudgeConfig;
  reporters?: readonly EvalReporter[];
  maxConcurrency?: number;
  timeoutMs?: number;
}
```

`evals/evals.config.ts` 必须存在且默认导出该函数的结果。
所有字段都可省略。
函数同步返回带 `_tag: "EveEvalConfig"` 的 config；校验失败时同步抛错。

| 配置 | 默认值 | 优先级与校验 | E |
|---|---|---|---|
| `judge` | 无 | per-call 高于 per-eval，per-eval 高于 config；config 中声明时必须有 `model` | E5、E9 |
| `reporters` | `[]` | 必须是 array；config reporter 看全部 Eval | E5、E12 |
| `maxConcurrency` | `8` | CLI 高于 config；必须为正整数 | E5、E11 |
| `timeoutMs` | 无超时 | CLI 高于 per-eval，per-eval 高于 config；必须为非负有限数 | E5、E11 |

#### Dataset loaders

| API | 参数与返回 | 同步性与失败 | E |
|---|---|---|---|
| `loadJson(filePath): Promise<unknown>` | 相对路径从 app root 起算；绝对路径直接读取 | async；文件或 JSON 无效时 reject | E13 |
| `loadYaml(filePath): Promise<Record<string, unknown>>` | 只返回顶层 mapping；带 frontmatter 时忽略正文 | async；文件或 YAML 无效时 reject | E13 |

loaders 从 `eve/evals/loaders` 导入，只面向 fixture。
它们不计算 metric，也不形成跨 case 汇总规则。

### 5.2 驱动证据的 Context、Session 与 Turn

#### Context 与 Session driver

以下方法存在于 `t` 和 `EveEvalSession`。
它们不直接产生分数，`requireInputRequest` 除外。

| API | 参数与默认值 | 返回与同步性 | 失败语义 | E |
|---|---|---|---|---|
| `send(message, options?)` | `message: string \| UserContent` | `Promise<EveEvalTurn>` | transport、超时或 stream 失败时 reject | E4、E5 |
| `start(message, options?)` | text message | `Promise<EveEvalLiveTurn>`；服务接受后返回 | 接受失败时 reject | E4、E5 |
| `cancel()` | 无 | `Promise<{status:"accepted";sessionId} \| {status:"no_active_turn"}>` | session 未开始时抛错 | E4、E8 |
| `sendFile(text, filePath, mediaType?)` | media type 默认按扩展名推导，未知为 `application/octet-stream` | `Promise<EveEvalTurn>` | 文件读取或 send 失败时 reject | E4、E8 |
| `respond(responses, options?)` | 至少一个 `InputResponse` | `Promise<EveEvalTurn>` | 空数组或 send 失败时 reject | E4、E8 |
| `respondAll(optionId)` | 所有 pending request 共用一个 option id | `Promise<EveEvalTurn>` | 没有 request，或任一 request 无该 option 时抛错 | E4、E8 |
| `requireInputRequest(filter?)` | filter 默认 `{}` | 同步返回唯一 `InputRequest` | 失败时登记 gate，并停止测试体；不增加 execution error | E7、E8 |

`send`、`start` 与 `respond` 的 `options` 可含 `clientContext`、`outputSchema`、`streamReconnectPolicy`、`signal` 与 `headers`。
全部字段默认省略。
这些字段来自公开 client send contract。

| Send option | 形状与行为 | E |
|---|---|---|
| `clientContext` | string、string array 或 JSON object；只进入下一次 model call，不写入 durable history | E5 |
| `outputSchema` | Standard Schema 或 JSON Schema object；让 server 约束 structured output | E5 |
| `streamReconnectPolicy` | 省略时使用 client 默认值；`{ reconnect: false }` 停用自动重连 | E5 |
| `signal` | 可选 `AbortSignal`；省略时 driver 注入 Eval timeout signal，显式传入时原样使用 | E5、E8 |
| `headers` | 单次请求的 string map；优先于同名 client header | E5 |

`InputResponse` 是 `{ requestId, optionId?, text? }`。
`respond` 不要求每个 response 都有 option id；freeform 回答可使用 `text`。

Context 另有：

| API 或字段 | 形状 | 语义 | E |
|---|---|---|---|
| `t.reply` | `string \| null` | 主 session 最后 assistant message；主 session 无 turn 时可取一个额外 session | E5、E8 |
| `t.events` | `readonly MessageStreamEvent[]` | 测试体内主 session 已捕获的事件 | E5、E8 |
| `t.pendingInputRequests` | `readonly InputRequest[]` | 主 session 最后一次 parked turn 的未答请求 | E5、E8 |
| `t.sessionId` | `string \| undefined` | 首次成功 send 后可用 | E5 |
| `t.state` | `ClientSessionState \| undefined` | 可序列化 session cursor | E5 |
| `t.target` | `EveEvalTargetHandle` | 当前 local 或 remote Eve 服务的 live handle | E4、E5 |
| `t.newSession()` | `EveEvalSession` | 同一 target 上的新独立 session | E4、E5 |
| `t.sleep(ms = 1000)` | `Promise<void>` | 服从 Eval timeout signal；负数或非有限数抛错 | E5、E8 |
| `t.log(message)` | `void` | 写入 Eval `artifact`；`--verbose` 同时输出 | E4、E5 |
| `t.signal` | `AbortSignal` | Eval timeout 时 abort | E4、E5 |
| `t.skip(reason)` | `never` | 文档要求作为首个操作；产生 `skipped`，且不影响退出码 | E5、E8 |

表中的 `events`、`pendingInputRequests`、`sessionId` 与 `state` 也存在于 `EveEvalSession`。
`t.skip` 要求非空 reason。
固定实现要求调用前没有 session activity，也没有已登记 assertion。
违反这项条件会成为 execution error，而不是 skip。

读取 `t.events`、`t.pendingInputRequests`、`t.state` 或 `t.sessionId` 会建立主 session。
`t.newSession()` 也会建立 session，因此这些操作都应放在 skip 判断之后。
固定实现允许先 `t.log` 或 `t.sleep`，但官方文档仍要求把 `t.skip` 写在最前面。

#### Target handle

`t.target` 让 Eval 接入 schedule、channel 或其它外部触发的 session。
它本身不计分；接入的事件会进入 run scope、结果与 `artifact`。

| API 或字段 | 参数、默认值与返回 | 同步性与失败 | E |
|---|---|---|---|---|
| `kind` | `"local" \| "remote"` | readonly；来自 runner 选定的 target | E4、E5 |
| `url` | target base URL | readonly | E4、E5 |
| `capabilities.devRoutes` | `boolean` | readonly；表示 target 是否开放开发路由 | E4、E5 |
| `fetch(path, init?)` | authenticated fetch，返回 `Promise<Response>` | async；网络失败 reject，非 2xx 仍作为 Response 返回 | E4、E5 |
| `dispatchSchedule(scheduleId)` | `Promise<{ scheduleId; sessionIds }>` | async；没有 dev routes、HTTP 失败或响应无效时 reject | E4、E5 |
| `attachSession(sessionId, { startIndex? })` | 默认从 index `0` 开始；返回 `Promise<EveEvalSession>` | async；消费到下一 turn boundary，并登记该 session 的事件 | E4、E5 |
| `watchTurn(sessionId, { startIndex? })` | 默认从 index `0` 开始；立即返回 `EveEvalLiveTurn` | sync handle；stream 已开始，失败由等待方法报告 | E4、E5 |

`attachSession` 适合已经由 schedule 或 channel 启动的 session。
若边界是 `session.waiting`，返回的 session 可继续 `send` 或 `respond`。

`watchTurn` 适合协调仍在运行的外部 turn。
调用者用 `waitForEvent` 观察中途事实，再用 `result()` 消费到边界并纳入 Eval。

#### Live turn

| API 或字段 | 返回 | 语义 | E |
|---|---|---|---|
| `live.events` | 当前事件的 readonly array | 调用时已经观察到的前缀 | E4、E5 |
| `live.session` | `EveEvalSession` | 启动或拥有该 turn 的 session | E4、E5 |
| `live.sessionId` | `string` | 服务接受后立即可用 | E4、E5 |
| `waitForEvent(type, options?)` | `Promise<EveEvalStreamEvent<TType>>` | 先查 buffer，再等匹配 event；`options` 只有 typed `data` matcher | E4、E5 |
| `cancel()` | `Promise<CancelSessionResult>` | 请求 cooperative cancellation | E4、E5 |
| `result()` | `Promise<EveEvalTurn>` | 等 turn boundary，并把同一 event buffer 纳入 Eval | E4、E5 |

`waitForEvent` 没有 `count`。
stream 失败，或先到 turn boundary 时，它会 reject。
一个 live turn 拥有唯一 stream consumer，协调结束后应调用 `result()`。

#### Immutable turn

| 字段或方法 | 形状 | 语义 | E |
|---|---|---|---|
| `message` | `string \| undefined` | 该 turn 的最后 assistant message | E5 |
| `data` | `unknown` | output schema 产生的 structured result | E5 |
| `events` | readonly event array | 只含该 turn | E5 |
| `inputRequests` | readonly request array | 该 turn 发出的 HITL 请求 | E5 |
| `toolCalls` | readonly `EveEvalToolCall[]` | 从该 turn event 推导 | E5 |
| `sessionId` | `string` | 拥有该 turn 的 session | E5 |
| `status` | `"completed" \| "failed" \| "waiting"` | `waiting` 也可以是健康的下一消息等待态 | E5 |
| `expectOk(): this` | 同步 | status 为 `failed` 时抛 `EveEvalTurnFailedError`；不登记 assertion | E5、E8 |
| `requireToolCall(name, options?)` | `EveEvalToolCall` | 要求该 turn 内恰好一笔匹配 call；默认 status 是 `completed` | E5、E8 |

`expectOk()` 抛出的错误会使 Eval 成为 `failed` execution error。
`requireToolCall` 失败则登记一条失败 gate，并停止测试体。

`EveEvalTurnFailedError` 也从 `eve/evals` 导出。
实例的 `turn` 指向失败的 immutable turn，`event` 是找到的 failure event 或 `undefined`。
作者可在上层捕获它做额外诊断；不捕获时，runner 按 execution error 处理。

### 5.3 Scoped assertions

所有 scoped methods 都同步返回 `AssertionHandle`，且默认是 gate。
普通失败产生 score `0`，成功产生 `1`。
方法调用本身不可 `await`，runner 在 finalization 阶段完成判分。

`t`、session 与 turn 共用下表方法。
`outputEquals` 与 `outputMatches` 只存在于 session 和 turn。

| API | 精确检查 | 参数、默认值与边界 | E |
|---|---|---|---|
| `succeeded()` | scope 无 failure，且没有未回答 HITL park | 健康 `waiting` 可通过；`step.failed`、`turn.failed` 或 failed status 不通过 | E6 |
| `parked()` | scope 干净地停在未回答 HITL | 失败事件不通过；普通 `waiting` 也不通过 | E6 |
| `messageIncludes(token)` | 全部 `message.completed` 的非 `null` 文本以换行连接后包含 token | token 是 string 或 `RegExp`；不是只看最后回复 | E6 |
| `calledTool(name, options?)` | 至少一笔命名 tool call 满足约束 | options 默认 `{}`；status 默认 `completed`；count 默认至少一笔 | E6 |
| `loadedSkill(skill, options?)` | `load_skill` input partial-match `{ skill }` | output、status、count 与 `calledTool` 相同 | E6 |
| `notCalledTool(name)` | 该名称没有任何 lifecycle state 的 call | 不接受 input 或 status filter | E6 |
| `toolOrder(names)` | tool request name 是指定数组的 subsequence | 无关 request 可穿插；只证明 request 顺序，不证明完成顺序 | E6 |
| `usedNoTools()` | tool call 总数为零 | pending、failed、rejected 都计入总数 | E6 |
| `maxToolCalls(max)` | tool call 总数不大于 max | max 必须是非负整数 | E6 |
| `noFailedActions()` | 没有失败 `action.result` | tool、subagent、skill 都在范围内；`status:"failed"` 或 `isError:true` 均失败 | E6 |
| `calledSubagent(name, options?)` | 至少一笔 delegation 满足约束 | status 默认 `completed`；count 默认至少一笔 | E6 |
| `event(type, options?)` | typed event 存在且 data、count 满足约束 | data 是 typed partial-deep matcher；count 默认至少一笔 | E6、E10 |
| `notEvent(type, options?)` | 没有 matching typed event | options 只有 data，没有 count | E6、E10 |
| `eventOrder(matchers)` | event groups 依次出现 | 无关 event 可穿插；后一组首项必须晚于前一组末项 | E6、E10 |
| `eventsSatisfy(label, predicate)` | predicate 对完整 typed event array 返回 true | predicate 是同步 escape hatch；label 进入 assertion name | E6 |
| `outputEquals(value)` | 最后 structured output 或 message 与 value exact deep-equal | object key 必须完全相同；只在 session、turn | E6 |
| `outputMatches(schema)` | output 通过 Standard Schema | schema validate 可异步；只在 session、turn | E6 |

`eventOrder` 对每个 matcher 先检查它在整个 scope 中的 count。
若两个 matching group 彼此交错，即使能找到一条简单 subsequence，也会失败。
每组还必须有第一笔 occurrence；`count: 0` 或接受零的 count predicate 仍不能形成 order group。

session scoped method 在调用点保存 snapshot。
turn 本身不可变。
`t` scoped method 最终读取所有 session 合并后的 task result。

`toolOrder([])` 与 `eventOrder([])` 都会直接通过。
空数组不证明发生过任何 tool 或 event。

### 5.4 Matcher mini-language

`calledTool`、`calledSubagent`、`event` 与 `requireInputRequest` 复用同一套 matcher 规则。

```ts
type EveEvalValueMatcher<T> =
  | RegExp
  | ((value: T) => boolean)
  | DeepPartialLiteral<T>;

type EveEvalCountMatcher =
  | number
  | ((count: number) => boolean);
```

| matcher | 语义 | 边界 | E |
|---|---|---|---|
| primitive literal | `Object.is` | `NaN` 可相等，`0` 与 `-0` 不相等 | E6 |
| object literal | recursive partial-deep match | observed object 可有额外 key | E6 |
| array literal | 按位置递归 match | 长度必须完全相同 | E6 |
| `RegExp` | string 直接 test；其它值先 `JSON.stringify` | `undefined` 不匹配；`g`、`y` 的 `lastIndex` 每次归零 | E6 |
| predicate | 传入 observed value，要求 boolean | 同步；作者负责异常和诊断质量 | E6 |
| numeric count | matching item 数必须完全相同 | 只能是非负整数 | E6 |
| count predicate | 传入 matching item 数 | 同步；默认规则仍由具体 API 说明 | E6 |

所有 `g` 或 `y` flag 的 `RegExp` 在每次 test 前把 `lastIndex` 归零。
这条行为也适用于 `messageIncludes` 与 expect builder `includes`。

scoped value/count predicate 在 finalization 时运行。
它抛出的异常会成为 execution error；expect builder `satisfies` 的异常则会被 collector 改成失败 gate。

Tool options：

```ts
interface EveEvalToolCallMatchOptions {
  input?: EveEvalValueMatcher<JsonObject>;
  output?: EveEvalValueMatcher<JsonValue | undefined>;
  status?: "pending" | "completed" | "failed" | "rejected";
  count?: EveEvalCountMatcher;
}
```

所有已提供字段必须同时满足。
`input` object 是 partial-deep match。
`status` 省略时固定为 `completed`。

Subagent options：

```ts
interface EveEvalSubagentCallMatchOptions {
  callId?: EveEvalValueMatcher<string | undefined>;
  childSessionId?: EveEvalValueMatcher<string | undefined>;
  remoteUrl?: EveEvalValueMatcher<string | undefined>;
  output?: EveEvalValueMatcher<JsonValue | undefined>;
  status?: "pending" | "completed" | "failed" | "rejected";
  count?: EveEvalCountMatcher;
}
```

HITL request filter：

```ts
interface EveEvalInputRequestMatchOptions {
  display?: EveEvalValueMatcher<InputRequest["display"]>;
  input?: EveEvalValueMatcher<JsonObject>;
  optionIds?: EveEvalValueMatcher<readonly string[]>;
  prompt?: EveEvalValueMatcher<string>;
  toolName?: string;
}
```

`optionIds` literal array要求完整、有序、等长。
`requireInputRequest` 不只是要求一笔 matching request。
它还要求 pending request 总数恰好为一。

### 5.5 `eve/evals/expect` builders

每个 builder 同步返回 `Assertion`。
`t.check` 同步返回 handle，但异步 builder 求值会在后台开始，并在 finalization 时等待。

| Builder signature | score 与默认严重度 | 输入转换和失败语义 | E |
|---|---|---|---|
| `includes(value: string \| RegExp)` | 0 或 1；gate | observed 值用 `String(value ?? "")`；string 做 substring，regex 做 test | E7 |
| `equals(expected: unknown)` | 0 或 1；gate | exact deep equality；array 等长，object key 集相同 | E7 |
| `matches(schema: StandardSchemaV1)` | 0 或 1；gate | async Standard Schema validation；issues 进入 message 与 metadata | E7 |
| `similarity(expected: string)` | 0–1；soft、无 threshold | observed 值转 string；使用 AutoEvals Levenshtein | E7、E9 |
| `satisfies<T>(fn, label)` | 0 或 1；gate | 同步 predicate；label 必须为非空字符串 | E7 |

`similarity` 的 `0` 表示完全不同，`1` 表示完全相同。
它不是 token、embedding 或语义相似度。
公式是 `1 - levenshtein(actual, expected) / max(actual.length, expected.length)`。
两边都是空字符串时分数是 `1`；Eve 会先把 observed `null` 或 `undefined` 转成空字符串。

`Assertion` 公开 contract 是：

```ts
interface Assertion {
  readonly name: string;
  readonly severity: "gate" | "soft";
  readonly threshold?: number;
  score(value: unknown): number | Promise<number>;
  evaluate?(
    value: unknown,
  ): AssertionEvaluation | Promise<AssertionEvaluation>;
  gate(threshold?: number): Assertion;
  soft(threshold?: number): Assertion;
  atLeast(threshold: number): Assertion;
}

interface AssertionEvaluation {
  score: number;
  message?: string;
  metadata?: Readonly<Record<string, unknown>>;
}
```

builder 上的 `gate`、`soft` 与 `atLeast` 返回新的 `Assertion`。
它们不会修改原 builder 结果。
`label` 只存在于登记后的 `AssertionHandle`。

`t.check` 与 `t.require` 优先调用 `evaluate`；缺少它时才调用 `score`。
公开 contract 要求自定义 `evaluate` 返回 `AssertionEvaluation`，不能只返回单独的 number。

### 5.6 Assertion handle、`require` 与控制流

```ts
interface AssertionHandle {
  gate(threshold?: number): this;
  soft(threshold?: number): this;
  atLeast(threshold: number): this;
  label(label: string): this;
}
```

handle 方法同步修改已经登记的条目，并返回同一个 handle。
handle 不实现 `PromiseLike`，因此不应 `await`。

```ts
function check(
  value: unknown,
  assertion: Assertion,
): AssertionHandle;
```

`t.check` 捕获调用时的 value，并立即开始 sync 或 async assertion 求值。
它不停止测试体；结果在 collector finalization 时统一等待。

| 调用 | 默认与结果 | 失败怎样影响 Verdict | E |
|---|---|---|---|
| `.gate()` | threshold 默认 `1` | score 低于门槛时 Eval 是 `failed` | E5、E8 |
| `.gate(n)` | hard threshold 为 n | 低于 n 时 `failed` | E5、E8 |
| `.soft()` | 没有 threshold，只采集分数 | 不会单独使 Eval 失败或成为 `scored` | E5、E8 |
| `.soft(n)` | soft threshold 为 n | 低于 n 时 Verdict 是 `scored` | E5、E8 |
| `.atLeast(n)` | 等价于 `.soft(n)` | 低于 n 时 `scored` | E5、E8 |
| `.label(name)` | assertion name 变为 `family [name]` | 空白 label 会抛错 | E8 |

threshold 的公开类型只是 `number`。
固定实现没有检查它是否有限、是否位于 0–1，也没有在 handle 层拒绝负数。
判定阶段直接执行 `score >= threshold`。

`t.require`：

```ts
async function require<T>(
  value: T,
  assertion: Assertion,
): Promise<T>;
```

它把 assertion 强制改成 gate，并保留已有 threshold。
通过时返回原始 value。
失败时登记一次失败 gate，停止测试体，而且不增加重复 execution error。
返回值不是 handle，因此 `t.require(...)` 之后不能再链 `.label(...)`。
需要专用名字时，自定义 `Assertion.name` 必须在调用前已经确定。

三条控制流 API 不可混为一类：

| API | 是否登记 assertion | 失败后的 Eval 事实 | 适用场景 | E |
|---|---|---|---|---|
| `await t.require(value, assertion)` | 是 | 失败 gate；测试体停止 | 后续代码依赖值检查 | E8 |
| `turn.requireToolCall(...)` / `session.requireInputRequest(...)` | 是 | 失败 gate；测试体停止 | 后续代码依赖协议对象 | E8 |
| `turn.expectOk()` | 否 | execution error；测试体停止 | 后续操作要求 turn 没失败 | E8 |

普通 `t.check`、scoped method 和 Judge 不会因不通过而停止测试体。
值断言或 Judge 求值抛错时，collector 会把它改为失败 gate。
这条规则不受原来的 soft 严重度影响。

### 5.7 Judge 与四个 graders

```ts
interface EveEvalJudgeConfig {
  model: LanguageModel;
  modelOptions?: AgentModelOptionsDefinition;
}

interface JudgeOpts {
  on?: unknown;
  model?: LanguageModel;
  modelOptions?: AgentModelOptionsDefinition;
}
```

`model` 可用 AI SDK `LanguageModel` 实例，也可用 Gateway model id string。
string 需要 `AI_GATEWAY_API_KEY` 或 `VERCEL_OIDC_TOKEN`。
`modelOptions.providerOptions` 传递 provider-specific 选项。

per-eval `judge` 会整体替换 config `judge`，不会字段级合并。
per-call 的 `model` 与 `modelOptions` 则各自独立回退到最终 per-eval/config 值。

| Grader | positional 参数 | `opts.on` 默认值 | 返回与同步性 | E |
|---|---|---|---|---|
| `factuality(expected, opts?)` | reference answer | 当前 `t.reply` | 立即返回 soft `AssertionHandle`；Judge async | E9 |
| `summarizes(expected, opts?)` | reference summary；原文来自 Judge `input` | 当前 `t.reply` | 同上 | E9 |
| `closedQA(criteria, opts?)` | free-form yes/no criterion | 当前 `t.reply` | 同上 | E9 |
| `sql(expected, opts?)` | reference SQL | 当前 `t.reply` | 同上 | E9 |

`factuality` 使用 AutoEvals A–E factual-consistency family。
`closedQA` 判断回答是否满足 criterion，不需要 reference answer。
`summarizes` 把 expected 作为 expert summary，并比较 output 与它谁更好地概括 Judge input。
`sql` 判断 output 与 reference SQL 的语义是否相同。

固定 AutoEvals template 的 score mapping 是：

| Grader | choice 与 score | E |
|---|---|---|
| `factuality` | subset `A = 0.4`；superset `B = 0.6`；same `C = 1`；conflict `D = 0`；无关差异 `E = 1` | E9 |
| `summarizes` | expert summary `A = 0`；submitted summary `B = 1` | E9 |
| `closedQA` | `Y = 1`；`N = 0` | E9 |
| `sql` | `Correct = 1`；`Incorrect = 0` | E9 |

成功解码时，`factuality` 只产生 `0`、`0.4`、`0.6`、`1`；其余三个 template 只产生 `0` 或 `1`。
AutoEvals classifier 默认启用 chain-of-thought tool response。
Eve 的 `JudgeOpts` 不开放 `useCoT`、temperature 或 max tokens，只开放 model 与 `modelOptions`。

四个 grader 都由 Eve wrapper 调用仓库固定的 AutoEvals `0.0.132`。
它们不是把 AutoEvals 的全部 scorer catalog 暴露到 `t.judge`。

Judge 调用时捕获以下值：

- 最近一次 context `t.send(string)`、`t.start(string)` 或 `t.sendFile(text, ...)` 的文本，作为 AutoEvals `input`；
- `opts.on`，省略时是当时的 `t.reply`；
- per-call、per-eval、config 三层中的最终模型；
- expected 或 criteria。

`t.send(UserContent)` 把 Judge input slot 设为空字符串。
`t.respond`、额外 session 与 target handle 的发送不会更新该 slot。
`on` 只能指定被判分 output，公开 `JudgeOpts` 没有 input override。
这类路径应改由 context text send 驱动，或确保 grader 不依赖该 prompt。

grader score 是数值。
AutoEvals 返回 `null` 或 `undefined` score 时，Eve 写成 `0`。
默认 soft 且无 threshold，因此 score 再低也只是 tracked-only。

推荐三种显式形状：

```ts
t.judge.autoevals.closedQA("cites a source");
t.judge.autoevals.closedQA("cites a source").atLeast(0.8);
t.judge.autoevals.factuality(reference).gate(0.8);
```

没有可用 Judge model 时，调用先返回 handle。
finalization 时该条目变成失败 gate，并给出配置提示。
Judge prompt、response、criteria 或 expected、模型 id、rationale 与 choice 会进入诊断 metadata。

### 5.8 Event assertions 的全部 event type

`event`、`notEvent`、`eventOrder`、`eventsSatisfy` 与 `waitForEvent` 使用同一公开 event union。
传入 string literal 后，TypeScript 会把 `data` matcher 收窄到对应事件 shape。

固定 revision 的完整 event type 与 `data` key 如下：

| 分类 | event type | `data` key | E |
|---|---|---|---|
| Session | `session.started` | `invocation?`、`runtime?` | E10 |
| Session | `session.waiting` | `continuationToken`、`wait` | E10 |
| Session | `session.failed` | `code`、`details?`、`message`、`sessionId` | E10 |
| Session | `session.completed` | 没有 `data` | E10 |
| Turn | `turn.started` | `sequence`、`turnId` | E10 |
| Turn | `turn.completed` | `sequence`、`turnId` | E10 |
| Turn | `turn.failed` | `code`、`details?`、`message`、`sequence`、`turnId` | E10 |
| Turn | `turn.cancelled` | `sequence`、`turnId` | E10 |
| Model step | `step.started` | `sequence`、`stepIndex`、`turnId` | E10 |
| Model step | `step.completed` | `finishReason`、`providerMetadata?`、`sequence`、`stepIndex`、`turnId`、`usage?` | E10 |
| Model step | `step.failed` | `code`、`details?`、`message`、`sequence`、`stepIndex`、`turnId` | E10 |
| Message | `message.received` | `message`、`parts?`、`sequence`、`turnId` | E10 |
| Message | `message.appended` | `messageDelta`、`messageSoFar`、`sequence`、`stepIndex`、`turnId` | E10 |
| Message | `message.completed` | `finishReason`、`message`、`sequence`、`stepIndex`、`turnId` | E10 |
| Reasoning | `reasoning.appended` | `reasoningDelta`、`reasoningSoFar`、`sequence`、`stepIndex`、`turnId` | E10 |
| Reasoning | `reasoning.completed` | `reasoning`、`sequence`、`stepIndex`、`turnId` | E10 |
| Structured result | `result.completed` | `result`、`sequence`、`stepIndex`、`turnId` | E10 |
| Action | `actions.requested` | `actions`、`sequence`、`stepIndex`、`turnId` | E10 |
| HITL | `input.requested` | `requests`、`sequence`、`stepIndex`、`turnId` | E10 |
| Action | `action.partial` | `result`、`sequence`、`stepIndex`、`turnId` | E10 |
| Action | `action.result` | `error?`、`result`、`sequence`、`stepIndex`、`status`、`turnId` | E10 |
| Subagent | `subagent.called` | `callId`、`childSessionId`、`sessionId`、`sequence`、`name`、`remote?`、`toolName`、`turnId`、`workflowId` | E10 |
| Subagent | `subagent.started` | `callId`、`subagentName` | E10 |
| Subagent | `subagent.event` | `callId`、`event`、`subagentName` | E10 |
| Subagent | `subagent.completed` | `callId`、`output`、`subagentName` | E10 |
| Authorization | `authorization.required` | `authorization?`、`description`、`name`、`sequence`、`stepIndex`、`turnId`、`webhookUrl?` | E10 |
| Authorization | `authorization.completed` | `authorization?`、`name`、`outcome`、`reason?`、`sequence`、`stepIndex`、`turnId` | E10 |
| Session context | `context.cleared` | `sequence`、`sessionId`、`turnId` | E10 |
| Session context | `compaction.requested` | `modelId`、`sequence`、`sessionId`、`turnId`、`usageInputTokens` | E10 |
| Session context | `compaction.completed` | `modelId`、`sequence`、`sessionId`、`turnId` | E10 |

顶层事件带 `meta.at` 与 `meta.id`。
重读 stream version 20 之前创建的旧 session 时，官方注释警告 `meta.id` 可能实际缺失。
`subagent.event` 的 child event 位于 `data.event`。
完整字段定义以 E10 的 discriminated union 为准。

`finishReason` 可为 `content-filter`、`error`、`length`、`other`、`stop` 或 `tool-calls`。
`action.result.status` 可为 `completed`、`failed` 或 `rejected`。
`authorization.completed.outcome` 可为 `authorized`、`declined`、`failed` 或 `timed-out`。
`step.completed.usage` 可含 `costUsd`、`inputTokens`、`outputTokens`、`cacheReadTokens` 与 `cacheWriteTokens`。

`eve/client` 的 `HandleMessageStreamEvent` 是 deprecated alias。
新代码使用 `MessageStreamEvent`，或使用 `eve/evals` 导出的 `EveEvalStreamEvent<TType>`。
`ConnectionAuthorizationOutcome` 也已 deprecated，替代类型是 `AuthorizationOutcome`。

事件断言示例：

```ts
turn.event("action.result", {
  data: {
    status: "completed",
    result: { kind: "tool-result", toolName: "get_weather" },
  },
  count: 1,
});

turn.notEvent("turn.failed");

turn.eventOrder([
  { type: "turn.started" },
  { type: "message.completed" },
  { type: "session.waiting" },
]);
```

`eventsSatisfy` 可表达跨 event correlation。
它也让作者直接依赖协议字段，因此应作为 escape hatch。
predicate 返回 false 时是普通 gate failure。
predicate 抛错时会升级为 execution error。

### 5.9 结果、Verdict 与汇总

单条断言结果：

```ts
interface AssertionResult {
  name: string;
  score: number;
  severity: "gate" | "soft";
  threshold?: number;
  passed: boolean;
  message?: string;
  metadata?: Readonly<Record<string, unknown>>;
}
```

`passed` 的规则是：

1. 求值抛错的条目永远不通过；
2. gate 省略 threshold 时使用 `1`；
3. soft 省略 threshold 时永远视为通过；
4. 其它条目比较 `score >= threshold`。

Eve 没有单条断言的 `unavailable`、`unscored` 或 `null` score。
整条 Eval 才能通过 `t.skip(reason)` 进入 `skipped`。

`EveEvalVerdict` 是四态：

| Verdict | 条件 | 默认 CLI 退出影响 | E |
|---|---|---|---|
| `passed` | 无 execution error，全部 gate 与 soft threshold 通过 | 无 | E5、E11 |
| `failed` | execution error，或至少一个 gate 不通过 | exit `1` | E5、E11 |
| `scored` | gate 全部通过，但至少一个 soft threshold 不通过 | 默认无；`--strict` 时 exit `1` | E5、E11 |
| `skipped` | 测试体在仍可 skip 时调用 `t.skip` | 无 | E5、E11 |

没有登记断言、也没有 execution error 的 Eval 会成为 `passed`。
固定实现没有“至少一条 assertion”检查。

单条与整次 run 的公开结果 shape 是：

```ts
interface EveEvalResult {
  readonly id: string;
  readonly result: EveEvalTaskResult;
  readonly assertions: readonly AssertionResult[];
  readonly verdict: EveEvalVerdict;
  readonly error?: string;
  readonly skipReason?: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

interface EveEvalRunSummary {
  readonly target: EveEvalTarget;
  readonly results: readonly EveEvalResult[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly passed: number;
  readonly failed: number;
  readonly scored: number;
  readonly skipped: number;
  readonly errored: number;
}
```

`errored` 只是 `failed` 中的 execution error 子集，不是第五种 Verdict。
时间字段是 ISO string。
`EveEvalRunSummary` type 是公开的，但 `runEvals` runner function 没有从 `eve/evals` 导出。
作者通过 CLI `--json` 或 reporter lifecycle 取得 summary。

`EveEvalTaskResult` 保存可供 reporter 与后续检查使用的执行事实：

```ts
interface EveEvalTaskResult {
  output: unknown;
  readonly finalMessage: string | null;
  readonly sessionId?: string;
  readonly status: "completed" | "failed" | "waiting";
  readonly events: readonly MessageStreamEvent[];
  readonly logs?: readonly string[];
  readonly derived: EveEvalDerivedFacts;
  readonly sessions?: readonly EveEvalSessionResult[];
  readonly runtimeIdentity?: RuntimeIdentity;
}
```

`output` 优先取最后 turn 的 structured data，否则取最后 assistant message。
每个 session snapshot 含 `derived`、`events`、`primary`、可选 `sessionId` 与 `state`。

派生事实是 scoped assertion 使用的公开只读数据：

| Shape | 完整字段 | E |
|---|---|---|
| `EveEvalToolCall` | `name`、`input`、`output`、`status`、`turnIndex`、可选 `sessionId` | E5 |
| `EveEvalSubagentCall` | 可选 `callId`、可选 `childSessionId`、`name`、可选 `remoteUrl`、可选 `output`、`status`、`turnIndex`、可选 `sessionId` | E5 |
| `EveEvalDerivedFacts` | `toolCalls`、`toolCallCount`、`subagentCalls`、`subagentCallCount`、`inputRequests`、`parked`、`messageCount`、`reasoningBlockCount`、可选 `failureCode` | E5 |

tool 与 subagent 的 `status` 都是 `pending`、`completed`、`failed` 或 `rejected`。
`turnIndex` 从零开始。

`EveEvalRunSummary` 含：

- target 与全部 `EveEvalResult`；
- `passed`、`failed`、`scored`、`skipped` 计数；
- execution error 子集 `errored`；
- run 起止时间。

Console reporter 会按相同 assertion name 对 soft scores 求算术平均。
该均值只用于展示，不会回写任何 Eval Verdict。
Eve 没有公开的 weight、公式、percentile 或 suite threshold API。

### 5.10 Reporter、`mockModel` 与公开扩展点

`eve/evals/reporters` 导出三个 built-ins 和 `EvalReporter`。

```ts
interface ConsoleReporterConfig {
  log?: (message: string) => void;
  color?: boolean;
}

interface JUnitReporterConfig {
  readonly filePath: string;
  readonly suiteName?: string;
}

interface BraintrustReporterConfig {
  readonly projectId?: string;
  readonly projectName?: string;
  readonly experimentName?: string;
  readonly baseExperimentName?: string;
  readonly baseExperimentId?: string;
  readonly update?: boolean;
}

function Console(config?: ConsoleReporterConfig): EvalReporter;
function JUnit(config: JUnitReporterConfig): EvalReporter;
function Braintrust(config?: BraintrustReporterConfig): EvalReporter;
```

三个 factory 都同步返回 reporter。
异步 I/O 发生在 lifecycle method 内。

| API | 配置与默认值 | 行为与失败 | E |
|---|---|---|---|
| `Console({ log?, color? } = {})` | log 默认 `console.log`；color 默认看 TTY | 同步输出进度、失败与 soft 均值 | E12 |
| `JUnit({ filePath, suiteName? })` | `filePath` 必填；suite 默认 `"eve evals"` | run 完成时异步写 XML；failed 与 scored 都成为 failure | E12 |
| `Braintrust(config = {})` | project id/name、experiment name、base experiment、update 都可选 | 需要 `braintrust` peer 与 `BRAINTRUST_API_KEY`；上传失败会使 run 报错 | E12 |

Braintrust 的 `projectName` 省略时使用第一条被观察 Eval 的 id；空集合再回退到 `"eve evals"`。
其它未提供字段以 `undefined` 交给 Braintrust SDK，不在 Eve 内另设默认值。

Braintrust 中，gate 的 key 是 `gate:<assertion-name>`，soft 使用原 assertion name。
固定源码对两者都写入原 score；确定性 gate 自然是 `0` 或 `1`，Judge gate 可保留小数。
重复名字追加 `#2`、`#3`，因此 `label` 对外部比较很重要。

Braintrust log 的 `input` 是 Eval description，`output` 是 task output。
tool、subagent、message 与 reasoning count 进入 metrics；Eval tags 也会发送。
完整失败 assertion 进入 `eveFailedAssertions`，通过 assertion 的 metadata 不由该 built-in 上传。

`--skip-report` 只停用 config 和 per-eval reporters。
CLI 自己添加的 Console 与 JUnit 不受它影响。

自定义 reporter contract：

```ts
interface EvalReporter {
  onRunStart(
    evaluations: readonly EveEval[],
    target: EveEvalTarget,
  ): void | Promise<void>;

  onEvalComplete(
    result: EveEvalResult,
  ): void | Promise<void>;

  onRunComplete(
    summary: EveEvalRunSummary,
  ): void | Promise<void>;
}
```

runner 会等待三个 lifecycle method。
任一 method reject 会使 `runEvals` reject，不会变成 assertion 或单条 Eval Verdict。

`mockModel` 从 `eve/evals` 导出：

```ts
function mockModel(
  input?: string | MockModelResponder | MockModelOptions,
): LanguageModel;
```

| 输入 | 默认与返回 | E |
|---|---|---|
| 无参数 | 返回固定文本 `"Mock response"` | E13 |
| string | 每次返回该文本 | E13 |
| responder | 收到 messages、user messages、tools、tool results，可同步或 async 返回 | E13 |
| options | `modelId` 默认 `"model"`；`provider` 默认 `"eve-mock"`；`respond` 同上 | E13 |

responder 可返回 string，或 `{ text?, toolCalls?, usage? }`。
`toolCalls[].input` 默认 `{}`，id 可省略。
若既没有 text，也没有 tool call，model 会抛错。

## 6. 四个可直接复制的场景

以下场景都放进 `eve@0.31.3` scaffold。
前三个共用一个确定性 fixture Agent。
Judge 场景另外需要 Judge model 凭据。

### 6.1 共同 fixture：确定性文本与 tool loop

`agent/tools/get_weather.ts`：

```ts
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({
    city: z.string(),
  }),
  async execute(input) {
    return {
      city: input.city,
      condition: "Sunny",
      temperatureF: 72,
    };
  },
});
```

`agent/agent.ts`：

```ts
import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

export default defineAgent({
  model: mockModel({
    modelId: "assertion-guide-fixture",
    respond: ({ lastUserMessage, toolResults }) => {
      const prompt = lastUserMessage ?? "";

      if (prompt === "What is the weather in Brooklyn?") {
        const weather = toolResults.find(
          (entry) => entry.name === "get_weather",
        );

        if (weather === undefined) {
          return {
            toolCalls: [
              {
                name: "get_weather",
                input: { city: "Brooklyn" },
              },
            ],
          };
        }

        return "Weather: " + JSON.stringify(weather.output);
      }

      if (prompt === "Explain recursion in one sentence.") {
        return "Recursion solves a problem by applying the same process to a smaller instance.";
      }

      return "Echo: " + prompt;
    },
  }),
});
```

`evals/evals.config.ts`：

```ts
import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({});
```

这套 fixture 不请求 Agent 模型 provider。
`mockModel` 仍经过 Eve 的 HTTP、session、tool 与 event runtime。

### 6.2 场景一：确定性 scoped assertion 与 expect builder

`evals/weather.eval.ts`：

```ts
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "The weather request calls the typed tool exactly once.",
  tags: ["deterministic", "tool"],
  async test(t) {
    await t.send("What is the weather in Brooklyn?");

    t.succeeded();
    t.calledTool("get_weather", {
      input: { city: "Brooklyn" },
      output: { condition: "Sunny" },
      count: 1,
    });
    t.check(t.reply, includes("Sunny")).label("forecast text");
  },
});
```

运行：

```bash
npx eve eval weather
```

这个场景同时证明 run 健康、tool input/output、精确 call count 与 reply token。
三个检查都是 gate。
任何一条失败都进入同一个结果，而不是隐藏后面的失败。

### 6.3 场景二：`require`、immutable turn 与 typed events

`evals/session-events.eval.ts`：

```ts
import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

export default defineEval({
  description: "Two messages stay on one session and expose ordered turn events.",
  tags: ["deterministic", "events"],
  async test(t) {
    const first = await t.send("Remember marigold.");
    first.expectOk();

    const second = await t.send("Say marigold.");
    second.expectOk();

    await t.require(second.sessionId, equals(first.sessionId));

    second.event("message.completed", {
      data: { message: /Echo: Say marigold/ },
      count: 1,
    });
    second.eventOrder([
      { type: "turn.started" },
      { type: "message.completed" },
      { type: "session.waiting" },
    ]);
    second.messageIncludes("marigold");
  },
});
```

`expectOk()` 保护后续代码免受 failed turn 影响。
session id 检查使用 `require`，因为后续事件判断依赖两个 turn 关系成立。
事件方法只看 `second`，不会误读第一个 turn。

### 6.4 场景三：开放 criterion 的 Judge

先让 config 提供独立 Judge model：

```ts
import { defineEvalConfig } from "eve/evals";

export default defineEvalConfig({
  judge: {
    model: "openai/gpt-5.4-mini",
  },
});
```

`evals/recursion-judge.eval.ts`：

```ts
import { defineEval } from "eve/evals";

export default defineEval({
  description: "A separate Judge checks an open quality criterion.",
  tags: ["judge"],
  async test(t) {
    const turn = await t.send("Explain recursion in one sentence.");
    turn.expectOk();

    t.judge.autoevals
      .closedQA(
        "The response accurately explains recursion in one concise sentence.",
        { on: turn.message },
      )
      .label("accurate concise explanation")
      .gate(0.8);
  },
});
```

运行：

```bash
AI_GATEWAY_API_KEY="<key>" npx eve eval recursion-judge
```

`closedQA` 的 criterion 是开放语言，而不是 string matcher。
`on` 固定了被判分值，不依赖之后是否还有 turn。
`gate(0.8)` 让 Judge 低分直接产生 `failed`。

若希望先观察分布，可删掉 `gate(0.8)`。
该条 Judge 就会变成 tracked-only soft score。

### 6.5 场景四：dataset fan-out、hard + soft 组合与严格 CI

`evals/echo.eval.ts`：

```ts
import { defineEval } from "eve/evals";
import { equals, similarity } from "eve/evals/expect";

const rows = [
  { prompt: "alpha", expected: "Echo: alpha" },
  { prompt: "beta", expected: "Echo: beta" },
] as const;

export default rows.map((row) =>
  defineEval({
    description: "Echoes " + row.prompt,
    tags: ["dataset", "deterministic"],
    async test(t) {
      await t.send(row.prompt);

      t.succeeded();
      t.check(t.reply, equals(row.expected)).label("exact reply");
      t.check(t.reply, similarity(row.expected))
        .label("reply similarity")
        .atLeast(0.95);
    },
  }),
);
```

运行：

```bash
npx eve eval echo --strict --junit .eve/junit.xml
```

两个 case 的 id 是 `echo/0000` 与 `echo/0001`。
每个 case 都有 hard exact gate 和 soft similarity threshold。
`--strict` 让任一 `scored` case 产生退出码 `1`。

Console 会显示同名 `similarity [reply similarity]` 的跨 case 均值。
这个均值不参与判定。
Eve 的 suite 组合规则仍是“任何 hard failure 失败；strict 下任何 soft miss 失败”。

## 7. 结果、诊断、artifact、CI 与 regrade

### 7.1 人读诊断

Console 一行显示 Eval id、gate 通过数与 soft scores。
每条失败随后显示 assertion name、label、score、threshold 和 message。

官方示例的 equality 失败形状是：

```text
✗ equals [status] (0% < 100%): expected {"status":"active"}; received {"status":"disabled"}
```

诊断分为两层：

- `message` 是短的人读说明；
- `metadata` 是结构化证据，供 `artifact` 与 reporter 使用。

`includes`、`equals`、`matches` 与 `satisfies` 都写入 actual 或 expected metadata。
Judge 另外写入 prompt、response、criterion 或 reference、模型 id、rationale 与 choice。
`calledTool` 和 `event` 成功时也会保留 matching count。

值诊断的显示文本通常限制到 160 个字符。
Console headline 最多显示 240 个字符，额外细节最多四行。
结构化 metadata 不受这些显示上限约束。

无 threshold 的 soft assertion 即使 score 为 `0`，其 `passed` 仍是 `true`。
Console 只显示分数，不把它展开为失败；`artifact` 仍保存 message 与 metadata。

### 7.2 `artifact` 文件

每次 run 固定写入：

```text
.eve/evals/<timestamp>/
├── summary.json
├── results.jsonl
└── evals/
    ├── smoke.json
    └── smoke.events.ndjson
```

嵌套 Eval id 会保留为嵌套目录。

| 文件 | 内容 | E |
|---|---|---|
| `summary.json` | target、四态计数、errored、每个 Eval 的 status、assertions、error 与 skip reason | E12 |
| `results.jsonl` | 每个 Eval 一行；含 id、Verdict、status、output、assertions 与错误字段 | E12 |
| `evals/<id>.json` | output、final message、session id、logs、派生事实、session snapshots、assertions | E12 |
| `evals/<id>.events.ndjson` | 该 Eval 所有 session 合并后的完整 event stream | E12 |

`t.log` 行进入 per-eval JSON。
`--verbose` 只改变实时输出，不改变保存内容。

event stream 可能含 prompt、reply 与 tool input/output。
Judge metadata 位于 assertion JSON，而不是 Judge event。
把目录上传 CI 或发给外部 reporter 前，应按数据要求检查内容。

### 7.3 CLI 完整表

命令 signature：

```text
eve eval [evalIds...] [options]
```

| 输入或 flag | 默认 | 行为 | E |
|---|---|---|---|
| `[evalIds...]` | 全部发现的 Eval | exact id 或目录 prefix；可传多个 | E11 |
| `--url <url>` | 启动本地 dev server | 连接已有 Eve server 或 deployment | E4、E11 |
| `--tag <tag...>` | 不做 include filter | 保留至少命中一个 tag 的 Eval | E11 |
| `--exclude-tag <tag...>` | 不排除 | 在 include filter 后移除任一命中项 | E11 |
| `--strict` | false | `scored > 0` 时退出码 `1` | E11 |
| `--list` | false | 只列发现结果，不运行 | E11 |
| `--timeout <ms>` | CLI 不设置 | 覆写每个 Eval timeout；必须是非负整数 | E11 |
| `--max-concurrency <n>` | config 或 `8` | 限制并发 Eval 数；必须是正整数 | E11 |
| `--json` | false | 不启用 Console，stdout 写完整 run summary JSON | E11 |
| `--junit <path>` | 不写 JUnit | 增加 JUnit reporter | E11、E12 |
| `--skip-report` | false | 不运行 config 和 per-eval reporters | E11、E12 |
| `--verbose` | false | 实时输出 `t.log` 行 | E11 |

include tag 一个都没命中时是配置错误。
exclude tag 移除全部已命中项时正常退出 `0`，表示此 suite 不适用。
`--list --json` 输出 `id`、`description` 与 `tags` array。

退出码：

| Code | 含义 |
|---|---|
| `0` | 所有非 skipped Eval 通过 gate；strict 下也通过全部 soft threshold |
| `1` | 至少一个 `failed`；strict 下至少一个 `scored`；或 target、artifact、reporter 出现未处理错误 |
| `2` | 发现、filter、config 或 CLI 参数错误 |

### 7.4 CI

官方推荐：

```bash
npx eve eval --strict --junit .eve/junit.xml
```

remote deployment：

```bash
npx eve eval \
  --strict \
  --url "$DEPLOY_URL" \
  --junit .eve/junit.xml
```

CI 应保存 `.eve/evals/`，至少在失败时上传。
JUnit 每个 Eval 对应一个 `<testcase>`。
`skipped` 对应 `<skipped>`。

一个细节来自固定源码：JUnit 会把 `failed + scored` 都计为 failure。
这项 XML 行为不读取 `--strict`。
因此单独使用 `--junit` 而不加 `--strict` 时，CLI 可退出 `0`，XML 却仍把 `scored` case 标成 failure。

### 7.5 Regrade

固定 CLI 没有读取旧 `artifact` 并只重新运行 assertions 或 Judge 的命令。
`eve eval` 会再次驱动 live Agent。

虽然 event NDJSON 和断言结果都被保存，公开 API 没有把它们变回 `EveEvalContext` 的 importer。
修改 criterion、threshold 或 builder 后，官方路径仍是重新运行 Eval。

这是研究判断所依赖的负面盘点。
本文检查了 E3、E4、E11 与 E12，没有找到 regrade、rescore 或 assertions-only 入口。

## 8. 自定义扩展

### 8.1 自定义 `Assertion`

`Assertion` 是公开导出，因此作者可以实现自己的值断言。
Eve 没有公开的 builder factory，扩展者需要完整实现严重度转换方法。

下面的例子是根据 E5、E7 的公开 contract 组合出的可编译形状：

```ts
import type {
  Assertion,
  AssertionEvaluation,
  AssertionSeverity,
} from "eve/evals/expect";

function under(
  limit: number,
  severity: AssertionSeverity = "gate",
  threshold?: number,
): Assertion {
  const evaluate = (value: unknown): AssertionEvaluation => {
    const actual = Number(value);
    const passed = Number.isFinite(actual) && actual < limit;

    return {
      score: passed ? 1 : 0,
      message: passed
        ? undefined
        : "expected a finite number below " + String(limit),
      metadata: { actual, limit },
    };
  };

  return {
    name: "under(" + String(limit) + ")",
    severity,
    threshold,
    evaluate,
    score: (value) => evaluate(value).score,
    gate: (next) => under(limit, "gate", next),
    soft: (next) => under(limit, "soft", next),
    atLeast: (next) => under(limit, "soft", next),
  };
}
```

使用：

```ts
t.check(latencyMs, under(1_000)).label("reply latency");
```

`evaluate` 比单独的 `score` 更适合扩展。
它让失败 message 与机器可读 metadata 留在同一条 assertion。

作者需要自己保证：

- score 的范围和方向稳定；
- sync 或 async 异常可诊断；
- metadata 可安全 JSON 化；
- 同名 assertion 在 dataset 中含义一致；
- predicate 不读取不稳定的外部状态。

### 8.2 复用 scoped 逻辑

Eve 没有公开 registry 用来给 `t`、session 或 turn 增加新方法。
可复用的 scoped 扩展通常是普通函数：

```ts
import type { EveEvalTurn } from "eve/evals";

export function assertSingleCompletedTool(
  turn: EveEvalTurn,
  name: string,
): void {
  turn.calledTool(name, {
    status: "completed",
    count: 1,
  });
  turn.noFailedActions();
}
```

这种函数登记多条标准 assertion。
它不产生新的 assertion family，也不能返回一个代表组合结果的 handle。

需要跨 event correlation 时可用 `eventsSatisfy`。
作者应把 label 写成可稳定比较的名字，并在 predicate 中保留清晰的事件边界。

### 8.3 自定义 reporter

自定义 reporter 直接实现 E12 的三个生命周期方法。
它适合把 `EveEvalResult` 写到内部服务、数据库或另一种 CI 格式。

reporter 在每个 Eval 完成后读取既有判分结果。
它不能向 `AssertionResult[]` 增加新 assertion，也没有公开入口改写 Verdict。
需要新的判分逻辑时，应实现 `Assertion` 或在测试体中调用已有 scoped method。

### 8.4 自定义 Judge 的边界

`t.judge` 只有 `autoevals` namespace，公开 API 没有注册 sibling Judge engine 的方法。
作者可以在自定义 `Assertion` 中调用模型，但要自行承担 prompt、输出解码、重试、费用与敏感数据处理。

这种扩展不会自动获得 Eve Judge 的 rationale、choice 与 model metadata 形状。
若团队需要统一 Judge contract，外层封装应主动返回 `AssertionEvaluation`。

## 9. 好在哪里

以下是研究判断。

### 9.1 Scope 写在 receiver 上

`t.calledTool`、`session.calledTool` 与 `turn.calledTool` 只靠 receiver 改变证据范围。
方法名和 matcher object 保持一致。
新手不必先学习 event filtering 才能写常见 Agent 检查。

### 9.2 常见关系很短，复杂关系仍有 escape hatch

`calledTool` 同时容纳 input、output、status 与 count。
`event` 保留 typed data matcher。
`eventsSatisfy` 则承接少数跨 event 关系。

这形成清楚的渐进路径：

1. 先用领域方法；
2. 需要值检查时用 `t.check`；
3. 需要协议细节时用 typed events；
4. 需要开放质量判断时用 Judge。

### 9.3 严重度与标签留在调用点

`.gate`、`.soft`、`.atLeast` 与 `.label` 直接跟在 assertion 后。
读者不必在另一份 thresholds map 中寻找门槛。

`label` 既改善 Console，也稳定 Braintrust score name。
这种局部语法对 dataset 特别有效。

### 9.4 控制流和判分分开

普通 assertion 收集全部失败。
只有后续代码确实依赖某个事实时，作者才改用 `require`。

`expectOk` 又单独表示“执行必须成功”。
它没有假装自己是一条可调 threshold 的 metric。

### 9.5 诊断同时服务人和机器

`message` 适合终端。
`metadata` 适合 JSON、Braintrust 与自定义 reporter。
full event stream 留在 `artifact`，Console 不需要打印所有细节。

### 9.6 确定性 fixture 仍经过真实 runtime

`mockModel` 支持 text、tool call、usage、sync 或 async responder。
它不是把断言系统复制成第二套 fake runner。
fixture 仍经过 Eve server、session、tool loop 与 event 生成。

## 10. 不好的地方与不应类比 NiceEval 的边界

以下也是研究判断。

### 10.1 没有 assertion-level “不可判分”

`AssertionResult.score` 必须是 number。
Judge 无 score 时写 `0`，求值异常时升级为失败 gate。
只有整条 Eval 能 `skipped`。

这会把“明确不匹配”“Judge 不可用”“证据不足”压到相近结果。
NiceEval 的 `unavailable` 不能据此删除。

### 10.2 Soft 同时承担 metric 和严格模式候选

soft 无 threshold 是 tracked-only。
soft 有 threshold 则产生 `scored`，再由 `--strict` 决定退出码。

这个模型很紧凑，却没有 points、optional、题内部分分或多级 Severity。
它适合 smoke Eval，不等于完整评估判定模型。

### 10.3 空 assertion Eval 会通过

只写 `await t.send(...)`，甚至空测试体，都可在没有 execution error 时成为 `passed`。
runner 不要求至少一条 gate 或 score。

因此 “Eval 文件存在” 不等于它证明了某项行为。
审查者仍要检查 assertion inventory。

### 10.4 `toolOrder` 只证明 request subsequence

它允许无关 call 穿插，也不检查前一笔完成后下一笔才开始。
不能用它证明因果、串行完成或输出被后续 call 消费。

NiceEval 若复用这个名字，必须保留相同窄语义，或明确另立时序 API。

### 10.5 Event escape hatch 泄漏 Eve 协议

typed union 和 partial matcher 的 TypeScript DX 很好。
但大量使用 `eventsSatisfy` 会让 Eval 直接依赖 event 字段、turn epilogue 与 action lifecycle。

NiceEval 需要跨 Adapter 的标准 observation。
它不应把某个 Agent 框架的 stream schema 当成 core Assertion API。

### 10.6 Judge catalog 很小

Eve 只包装 AutoEvals 的 factuality、summary、closed QA 与 SQL。
没有公开 prompt template、response schema、retry policy 或自定义 engine registry。

“使用了 AutoEvals”不表示 AutoEvals 全 catalog 都是 Eve 作者面。
也不表示 Eve 负责 AutoEvals grader 的长期语义稳定。

### 10.7 聚合是展示，不是判定语言

Console 对同名 soft score 求平均。
Braintrust 保存每条 score。
run summary 只有四态计数。

作者不能声明 weight、最低通过率、置信区间或跨 case formula。
NiceEval 的题内计分与实验比较不能直接类比这层均值。

### 10.8 生成与判分耦合在 `test(t)`

命令每次都驱动 live Agent。
`artifact` 虽保存 events 和 assertions，却没有官方 regrade importer。

修改 rubric 后必须再次执行 Agent，可能增加费用与随机性。
NiceEval 应保留生成事实与重新判分之间的独立边界。

### 10.9 JUnit 与 `--strict` 有一处可见差异

CLI 只有在 `--strict` 下才让 `scored` 影响退出码。
JUnit writer 却总把 `scored` 作为 failure。

官方 CI 命令同时使用两者，所以常见路径一致。
单独使用 JUnit 时，使用者需要知道这项差异。

### 10.10 Eve scope 没有 Sandbox evidence

Eve 能观察 Agent HTTP stream、tool 与 subagent lifecycle。
它没有 NiceEval 的文件差异、命令 observation、证据完整度或动态 locator。

`eventsSatisfy` 能写任意 predicate，不代表缺失的事实已经可靠可见。
predicate 只能判断被捕获的 event。

### 10.11 Judge input slot 不随所有 driver 更新

Judge 的 `input` 只跟随 context 上的三种 text send。
HITL response、额外 session、attached session 与 multimodal `UserContent` 不会得到对应 prompt。

`JudgeOpts.on` 只能修正 output，没有公开 input override。
多 session 或 HITL Eval 若忽略这项边界，grader 可能看到过时或空的 input。

## 11. 对 NiceEval 可吸收与不应复制

### 可吸收

| Eve 做法 | NiceEval 可吸收的设计原则 |
|---|---|
| receiver 决定 `t`、session、turn scope | 标准事实先从明确 scope 开始 |
| matcher object 内联 input、output、status、count | 常用关系保持一处可读，不拆成递归 matcher AST |
| handle 上的严重度、threshold 与 label | 判分意图靠近 assertion 调用点 |
| `require` 与普通 assertion 分离 | 控制流依赖不和最终 Verdict 混为一层 |
| typed `event` + `eventsSatisfy` | 提供强类型常用面和诚实的低层 escape hatch |
| `message + metadata` | 同一结果同时服务 Console 与机器消费 |
| `mockModel` 经过真实 runtime | fake 只替代外部 model 边界，不复制被测执行器 |
| path-derived id 与 dataset index | 默认身份稳定，作者少维护一套名字 |

### 不应复制

| Eve 边界 | NiceEval 应保留的差异 |
|---|---|
| score 强制为 number | 保留 `unavailable` 与证据完整度 |
| gate / soft 两级 | 保留 Severity、points、optional 与四态折叠 |
| soft average 只用于 Console | 题内计分和跨 Run 比较使用明确契约 |
| `toolOrder` 只看 request | 完成顺序、因果关系与 subsequence 分开命名 |
| event union 绑定 Eve protocol | Adapter 先归一为标准 observation |
| 无 Sandbox scope | 文件差异和 Sandbox 证据继续是一等 receiver |
| Judge error 变 hard gate | Provider 不可用与回答低分分开 |
| Judge input 来自隐式 context slot | Judge evidence 明确携带 input 与 output |
| 没有 regrade | Record 中的生成事实应允许独立重新判分 |
| 空 assertion 可通过 | 对“没有判分事实”给出明确反馈 |

NiceEval 最值得吸收的是语法层级，而不是 Eve 的判定状态集合。
scope-first、局部 handle 与 `require` 都能改善作者 DX。
`unavailable`、evidence coverage、Sandbox 与 points 则是 NiceEval 不能丢失的产品边界。

## 12. 无法核实项

### 12.1 缺少 Judge 凭据是否自动 skip

E9 的 Judge 文档声称：配置了 model 但没有凭据时，Judge-backed Eval 会明显地 skip。
固定源码中，唯一明确产生 `EvalSkipped` 的路径是测试体主动调用 `t.skip(reason)`。

Judge model 调用异常会被 collector 改成失败 gate。
本文没有找到把缺凭据异常转换为 `skipped` 的 Eval 代码或测试。
因此不把“自动 skip”当成已证实行为。

### 12.2 Regrade

固定文档、CLI 与公开导出没有 regrade 命令或 importer。
这只能证明本文检查的作者面没有该入口。
不能排除外部 Braintrust 工作流或未公开内部工具另有能力。

### 12.3 AutoEvals grader 的精确 prompt 稳定性

固定仓库使用 AutoEvals `0.0.132`，并明确把 grader 语义归于该实现。
本文确认了 Eve 传入的 input、output、expected、criteria、model 与 client。

本文没有把 AutoEvals 内部 prompt 文本复制为 Eve 契约。
未来依赖升级可能改变 prompt、choice 解码或 rationale。

### 12.4 Remote service 与本地 revision 是否完全同构

本文没有部署 `bd93f554` 后执行 remote `--url` 实验。
source 显示本地与 remote 共用 Eval 文件和 HTTP protocol client。
实际 deployment 仍可能受认证、dev route 与已部署 Eve 版本影响。

### 12.5 Threshold 合法范围

公开 score 说明集中在 0–1。
但 fixed implementation 对 `gate(n)`、`soft(n)` 与 `atLeast(n)` 没有 0–1 runtime validation。

本文能确认直接数值比较，不能确认超出范围的 threshold 被产品支持。
作者应把内置 scorer threshold 保持在 0–1。

### 12.6 Braintrust gate 是否必须二值化

E12 的 Reporter 文档和源码注释称 gate 会作为 binary score 写入 Braintrust。
固定实现只增加 `gate:` 前缀，然后原样写入 `assertion.score`。

确定性 gate 的 score 本来就是 `0` 或 `1`，两种说法在常见路径没有差别。
Judge 或自定义 fractional gate 会显出差异；本文按固定实现描述，不把二值化当成已证实契约。
