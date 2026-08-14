# Eve：文件系统 Agent、Eval 与 `.eve/evals` 生成文件

> 观察日期：2026-08-14
>
> 观察对象：本机 checkout `/home/ctrdh/Code/eve`，`packages/eve` 0.31.3，commit `a29cc8e0864348fb7b02c2e8be718b7edd056e65`（2026-08-10）
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

Eve 是 filesystem-first 的 durable backend agent 框架。
作者把 agent 写成磁盘上的目录，再用 `eve eval` 对同一 HTTP 面做 scored check。
它不是实验跟踪平台，也不是 Dashboard 产品。

本目录只写 Eve 自己的名词与边界。
Eval 的作者断言面另见 [Eve 断言 DX](../../eve-assertion-dx.md)。
会话事件协议另见 [eve protocol](../../adapters/eve-protocol.md)。
Harbor 不在 Eve 仓库里，不是 Eve 内部模块。

## 导航

| 页 | 回答什么 |
|---|---|
| 本页 | 产品是什么、用户心智、原生对象总图，以及最后才写的 NiceEval 对照 |
| [channel、harness 与作者面](layers.md) | channel、harness、runtime、session / turn / step、Eval 作者面与 `.eve/` 文件族 |
| [一次 `eve eval`](execution.md) | 从发现到退出码的真实顺序 |
| [`.eve/evals` 信封](storage.md) | 落盘文件、写入 owner、原子性与 resume |
| [重新打开与比较](reading-and-comparison.md) | 历史 dump 怎样重新打开，比较发生在哪里 |
| [schema 与版本](schema-and-migration.md) | eval dump 有没有版本，其它 Eve 面怎样升版 |

## 产品身份

作者面是目录，不是控制台里的 Experiment 对象。

根目录约定：

```text
my-agent/
├── agent/                 能力与运行时配置
│   ├── agent.ts
│   ├── instructions.md
│   ├── tools/
│   ├── skills/
│   ├── channels/
│   ├── connections/
│   ├── sandbox/
│   ├── subagents/
│   └── schedules/
└── evals/                 scored check，与 agent/ 平级
    ├── evals.config.ts
    └── **/*.eval.ts
```

身份来自路径。
`defineEval` 禁止作者写 `id` 或 `name`。
`evals/weather/brooklyn-forecast.eval.ts` 的 id 是 `weather/brooklyn-forecast`。

公开作者符号、CLI 发起边界和 `.eve/` 文件族见 [channel、harness 与作者面](layers.md)。

## 用户心智

作者在仓库里写 `agent/` 与 `evals/`。
`eve eval` 是对本仓库当前文件跑一次检查。
完成标识是进程退出码。

用户看结果的官方入口是本次控制台、`--json`、JUnit，或 Braintrust experiment URL。
`.eve/evals/<timestamp>/` 是官方称为 ad-hoc inspection 的本地 dump，以及 CI 上传物。
它不是 list / show 产品面。

`--tag`、目录前缀过滤的是现在的作者树。
它们不选择历史 dump。

## 原生对象总图

| Eve 自己的对象 | 它是什么 | 细节 |
|---|---|---|
| `agent/` 目录 | 能力与运行时配置 | [channel、harness 与作者面](layers.md) |
| `evals/**/*.eval.ts` | 路径派生 id 的 scored check | [channel、harness 与作者面](layers.md) |
| `evals/evals.config.ts` | 整次 run 的 judge、timeout、reporter | [channel、harness 与作者面](layers.md) |
| channel / harness / runtime | inbound、一单位 AI 工作、持久化与 workflow | [channel、harness 与作者面](layers.md) |
| session / turn / step | durable conversation 的执行单位 | [channel、harness 与作者面](layers.md) |
| `/eve/v1` 与 `sessionId` | 公开 HTTP 身份 | [channel、harness 与作者面](layers.md) |
| `eve eval` 进程 | 发现、打 target、评分、写 dump、退出 | [一次 `eve eval`](execution.md) |
| `.eve/evals/<timestamp>/` | 一次 `eve eval` 的本地 dump | [`.eve/evals` 信封](storage.md) |
| `MessageStreamEvent` | 被测 agent 的权威事件 | [`.eve/evals` 信封](storage.md) |
| Braintrust / JUnit / Console | reporter 发货层 | [重新打开与比较](reading-and-comparison.md) |
| `.eve/traces/v1/` | 本地 OTLP span，`eve traces` 读取 | [重新打开与比较](reading-and-comparison.md) |
| `.eve/logs/` | 诊断日志，`eve logs` 读取 | [重新打开与比较](reading-and-comparison.md) |
| `.eve/.workflow-data` | durable session 状态 | [channel、harness 与作者面](layers.md) |

## NiceEval 摘要

以下是研究判断，不是 Eve 契约，也不是 NiceEval 契约。
NiceEval 的目标入口仍是 [Record](../../../feature/record/README.md) 与 [Reports CLI](../../../feature/reports/cli.md)。

### 相似点

两边都用路径或稳定身份标识一条检查，而不是让作者手写随便一个名字。
两边都把硬失败和可跟踪分数分开。
两边都把事件流当成断言的原料，而不是让作者再 log 一遍 tool call。
两边都把 judge 模型与被测模型分开。
两边都有 CLI 作为受支持的运行入口。

### 差异

Eve 的产品主线是 durable agent。
Eval 是对同一 HTTP 面的 CI 检查。
NiceEval 的产品主线是保存一次运行事实，再查询、比较、交付报告。

Eve 的 `.eve/evals/` 是 gitignored dump。
官方阅读入口是本次控制台、JUnit 和 Braintrust。
NiceEval 的 Record root 是可复制、交给 `show` / `view` 的 portable 事实集。

Eve 不对两次 dump 做 align、group、compare。
分母、coverage、missing、partial、unsupported 都不存在于 Eve eval 模型里。
比较如果发生，发生在 Braintrust experiment。

Eve 没有 eval dump 的 schemaVersion，也没有 `eve eval migrate`。
它靠 pre-1.0 直接拒绝旧作者键，以及「没有 reader 就不迁移文件」。

Harbor 不是这条链的一部分。
Eval target 永远是 HTTP URL。

### 可吸收约束

1. 本地 dump 若没有第一类 reader，就不要把它宣传成用户接口。
   Eve 把细节放进 artifact，把比较交给外部 experiment 或本次控制台。
2. 路径派生 id 加目录前缀过滤，足够做 suite 选择。
   不必再发明第二套 eval 注册表。
3. Reporter 是发货层，不是持久层。
   `EvalReporter` 的三个回调足够接控制台、JUnit 和远端 experiment。
4. 从事件流派生 tool / subagent / parked，再把派生值与原始事件一起保存。
   作者不必填写 checks 表。
5. 展示聚合留在读取侧。
   改平均分或改图标不应改 dump 形状。
6. 若产品以后要重开历史 run，Eve 已经用 `eve traces` / `eve logs` 证明 list/show 可以存在。
   缺的是把同一纪律接到 eval dump，而不是再复制一套 Braintrust。
7. 没有兼容 reader 时，不要静默改写用户目录。
   Eve 对旧 dump 的策略是不管；对旧作者 API 的策略是导入失败。
8. 完成标识用退出码，不要用半写目录当 committed 标记。
   半写目录在 Eve 里只是崩溃残留。

这些约束进入 Feature、Roadmap 或 Design 并完成裁决后，才成为 NiceEval 契约。
本页只提供决策输入。
