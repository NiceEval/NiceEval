# Eve：channel、harness、runtime 与 Eval 作者面

> 观察日期：2026-08-14
>
> 核对源码：`vercel/eve` `a29cc8e0864348fb7b02c2e8be718b7edd056e65`，`packages/eve` 0.31.3
>
> 返回 [目录](README.md)

本页写 Eve 自己的 layer、作者对象与 `.eve/` 文件族。
一次 `eve eval` 的顺序见 [一次 `eve eval`](execution.md)。
dump 信封见 [`.eve/evals` 信封](storage.md)。

官方入口：

- [eve 仓库 README](https://github.com/vercel/eve)
- [Project Layout](https://eve.dev/docs/reference/project-layout)
- [TypeScript API](https://eve.dev/docs/reference/typescript-api)
- [Sessions, Runs & Streaming](https://eve.dev/docs/concepts/sessions-runs-and-streaming)
- [Execution Model and Durability](https://eve.dev/docs/concepts/execution-model-and-durability)
- [Evals Overview](https://eve.dev/docs/evals/overview)

官方文档站是滚动文档，本次检查无法打开 `eve.dev` 的实时 HTML。
页面事实因此同时核对上述官方 URL 与 checkout 内对应的 `docs/` 源文件。
这些文档也随 `eve` 包进入 `node_modules/eve/docs`。

源码事实来自 `packages/eve/src/evals/**`，以及 CLI、client、protocol 中被 eval runner 调用的符号。
所有源码链接都钉在 `a29cc8e`；公开面没有写出的能力不从服务端实现反推。

## 运行时三层

内部运行时拆成三层，见 `packages/eve/README.md`：

| 层 | Eve 自己的职责 |
|---|---|
| channel | 归一 inbound transport，执行 auth 与投递策略 |
| harness | 做一单位 AI 工作，返回 `{ session, next }` |
| runtime | 持久化状态、跟随 `next`、流式事件，拥有 workflow 原语 |

执行工作再拆成 session、turn、step。
session 是 durable conversation。
turn 是一条用户消息及其引发的工作。
step 是 turn 内的 durable checkpoint。

公开 HTTP 身份是不可变的 `sessionId`。
路由前缀是 `/eve/v1`。
见 `EVE_ROUTE_PREFIX`（[`packages/eve/src/protocol/routes.ts`](https://github.com/vercel/eve/blob/a29cc8e0864348fb7b02c2e8be718b7edd056e65/packages/eve/src/protocol/routes.ts)）。

## Eval 在产品里的位置

Eval runner 是命令侧的 scored-check consumer。
它用 TypeScript client 请求真实 agent 的 HTTP 面，然后对返回的 session 打分。

公开作者面：

| 符号 | 包入口 | 作者放哪里 |
|---|---|---|
| `defineEval` | `eve/evals` | `evals/*.eval.ts` |
| `defineEvalConfig` | `eve/evals` | `evals/evals.config.ts` |
| `mockModel` | `eve/evals` | fixture agent 的 `agent.ts` |
| `includes` / `equals` / `matches` / `similarity` / `satisfies` | `eve/evals/expect` | `t.check` |
| `loadJson` / `loadYaml` | `eve/evals/loaders` | dataset fixture |
| `Braintrust` / `JUnit` / `EvalReporter` | `eve/evals/reporters` | config 或单条 eval |

`runEvals`、`executeEval`、`writeArtifacts` 不在 `eve/evals` 的公开导出里。
受支持的发起入口是 CLI `eve eval`。

`t` 同时是 driver 和 assertion surface。
没有单独的 `input`、`run`、`checks`、`scores` 字段。
旧作者键的拒绝边界见 [schema 与版本](schema-and-migration.md)。

官方入口：

- [Cases](https://eve.dev/docs/evals/cases)
- [Assertions](https://eve.dev/docs/evals/assertions)
- [Judge](https://eve.dev/docs/evals/judge)
- [Targets](https://eve.dev/docs/evals/targets)
- [Reporters](https://eve.dev/docs/evals/reporters)

作者断言面的 DX 另见 [Eve 断言 DX](../../eve-assertion-dx.md)。

## 三条 assertion 面

| 面 | 做什么 |
|---|---|
| scoped methods | `t.succeeded()`、`t.calledTool()` 等，读整次 run、一个 session 或一个 turn |
| `t.check(value, assertion)` | 对作者交出的值做确定性评分 |
| `t.judge.autoevals.*` | 用独立 judge model 评分，不替换被测 agent |

严重度挂在 assertion 上：

- gate 默认硬失败
- soft 写入报告；带 threshold 时低于阈值得到 `scored`
- `--strict` 再把 `scored` 变成退出码 1

退出码表见 [一次 `eve eval`](execution.md)。

## `.eve/` 下的文件族

`.eve/` 是 inspectable compiled / runtime 树，不是单一「结果库」。
脚手架和仓库 `.gitignore` 忽略整个 `.eve/`。

| 目录或文件 | 谁写 | 谁读 | 产品用途 |
|---|---|---|---|
| `.eve/evals/<timestamp>/` | `writeArtifacts` | 官方只写 ad-hoc inspection 与 CI 上传 | 一次 `eve eval` 的 dump |
| `.eve/discovery/`、`.eve/compile/` | compiler | runtime / `eve info` | 已编译 agent |
| `.eve/traces/v1/` | local span processor | `eve traces` | 本地 OTLP span |
| `.eve/logs/` | `eve dev` | `eve logs` | 诊断日志 |
| `.eve/.workflow-data` | 本地 Workflow world | runtime，以及 `eve logs --events` | durable session 状态 |
| `.eve/dev-server-state.v1.json` | `eve dev` | 下一次 `eve dev` | 重连本地 server |
| `.eve/junit.xml` | `JUnit` reporter，路径由 `--junit` 决定 | CI | 本次 run 的 XML |

这几族不能互相替代。
Eval dump 不进入 `eve traces`。
Session 的 durable 状态也不等于一次 eval 的 verdict。

dump 里有哪些 JSON 见 [`.eve/evals` 信封](storage.md)。
`eve traces` / `eve logs` 怎样重新打开见 [重新打开与比较](reading-and-comparison.md)。
