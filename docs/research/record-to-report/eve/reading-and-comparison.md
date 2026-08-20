# Eve：历史 dump 怎样重新打开

> 观察日期：2026-08-14
>
> 核对源码：`vercel/eve` `a29cc8e0864348fb7b02c2e8be718b7edd056e65`，`packages/eve` 0.31.3
>
> 返回 [目录](README.md)

本页写历史运行怎样重新打开、筛选、比较和展示。
dump 里有什么见 [`.eve/evals` 信封](storage.md)。
作者过滤发生在跑之前，顺序见 [一次 `eve eval`](execution.md)。

官方入口：

- [Reporters](https://eve.dev/docs/evals/reporters)
- [Running Evals](https://eve.dev/docs/evals/running)
- [CLI](https://eve.dev/docs/reference/cli)

## Eval dump：没有产品入口

本次检查的一手公开面未提供 `eve eval ls`、`eve eval show` 或读取 `.eve/evals` 的 API。

用户入口只服务「这一次」：

| 入口 | 看见什么 | 针对哪一次 |
|---|---|---|
| 默认控制台 | 每条一行，失败 assertion，run 汇总 | 当前进程 |
| `eve eval --json` | 内存 `EveEvalRunSummary` | 当前进程 |
| `eve eval --junit <path>` | 每个 eval 一个 `<testcase>` | 当前进程 |
| `eve eval --list` | 将要跑的作者 eval，不是历史 | 不跑 |
| Braintrust experiment URL | 外部比较与分数 | 该 reporter 观察到的 eval |
| `.eve/evals/<timestamp>/` | 官方称为 ad-hoc inspection | 写完后的本地文件 |
| CI 上传 `.eve/evals/` | 失败时的事件流 | 该次 job |

`--tag`、`--exclude-tag` 与位置参数过滤的是作者树，不是历史 dump。
目录分组也是作者身份：`eve eval weather` 跑 `evals/weather/` 下现在的文件。

## 比较与对齐发生在 Braintrust，或不发生

`Braintrust({ projectName, experimentName, baseExperimentName, baseExperimentId, update })` 把一次 Eve run 建成一个 experiment。

同一 reporter 实例被多个 eval 共享时，结果进同一个 experiment。
config 级 reporter 观察整次 run。
gate 以 `gate:<name>` 作为二元 score 上传，便于和 soft score 一起 diff。
重复名字加 `#2`、`#3`。
失败细节放进 metadata `eveFailedAssertions`。

Eve 自己不对两次 `.eve/evals/*` 做 align、group 或 compare。
没有分母对象，也没有 missing / partial / unsupported 状态机。
未跑的 eval 根本不出现在 summary 里。

JUnit 把 `failed + scored` 都算进 `failures`。
它是 CI 注解，不是比较面。

Braintrust 服务端如何存 experiment，本次检查的一手公开面未提供。
只能看到 Eve reporter 调用的 `braintrust.init` / `log` / `summarize` / `close`。

## 另一条可重新打开的面：traces 与 logs

Agent 执行另有第一类查看命令。
它们读的不是 eval dump。

`eve traces` 读 `.eve/traces/v1/<traceId>/segments/`。
可以按 trace id 或 `agent.session.id` 打开 span 树。
有 `--json`、`--verbose` 与保留策略。

`eve logs` 读 `.eve/logs/`。
`--events` 在查询时从 `.eve/.workflow-data` 抽出 session 事件并交错进去。
日志文件本身不存这些事件。

这两条命令证明 Eve 愿意为本地执行事实做 list / show。
它没有把同一套入口接到 `.eve/evals/`。

文件族总表见 [channel、harness 与作者面](layers.md)。
