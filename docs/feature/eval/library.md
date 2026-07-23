# Eval —— 库用法

写一个 eval 像写一个测试：一个文件、一个 `test(t)` 函数。`test(t)` 里只做三件事——**驱动**（`t.send(...)` 让 agent 干活）、**读取**（`t.reply` / `turn` / `t.sandbox` 拿到结果）、**断言**（把观察写成可评分的记录）。`defineEval` 各字段的契约见 [README](README.md)。

```typescript
// evals/weather/brooklyn.eval.ts → id: weather/brooklyn
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "布鲁克林天气查询",
  async test(t) {
    await t.send("布鲁克林今天天气怎么样?");         // 驱动
    t.succeeded();                                    // 断言:这次运行没失败
    t.calledTool("get_weather", { input: { city: "Brooklyn" }, count: 1 });
    t.check(t.reply, includes("晴"));                 // 读取 + 值断言
  },
});
```

## API 全景

每组 API 的**契约单源**只有一处；怎么组合成真实场景，进对应的[用例篇](use-case/README.md)。

| API 组 | 干什么 | 契约单源 | 用例篇 |
|---|---|---|---|
| `t.send` / `t.sendFile` / `t.newSession` | 驱动会话，返回不可变 Turn | [Context](library/context.md) | [单轮](use-case/first-single-turn.md) · [多轮与并行会话](use-case/multi-turn-sessions.md) |
| `t.reply` / `t.events` / `turn.message` / `turn.data` | 读取结果 | [Context · 读取结果](library/context.md#读取结果) | [单轮](use-case/first-single-turn.md) |
| `parked` / `requireInputRequest` / `respond` / `respondAll` | 停在人工输入上的 gate 与续接 | [Context · 驱动 API](library/context.md#驱动-api) | [HITL 审批](use-case/hitl-approval.md) |
| `succeeded` / `calledTool` / `toolOrder` / `event` / `maxTokens` … | 作用域断言：断 agent 做了什么、花了多少 | [Scoring · 作用域断言](../scoring/library/scoped-assertions.md) | [过程与成本](use-case/process-and-cost.md) · [calledTool 全参数](use-case/calledtool.md) |
| `t.group` | 分组断言：报告区块，组名同时是对比的得分点维度 | [Scoring · 值断言 · 分组](../scoring/library/value-assertions.md#分组) | [过程与成本](use-case/process-and-cost.md) |
| `.points(n)` / `t.score(label, n)` | 计分制给分（仅 `defineScoreEval` 的 `t`）：断言条件给分 / 直接累加给分 | [Experiments · 计分粒度](../experiments/score-points.md#计分制叠加给分没有上限声明) | [计分制](use-case/rubric-scoring.md) |
| `t.check` / `t.require` + `niceeval/expect` matcher | 值断言：断某个具体值（`t.require` 是通过制的前置词，计分制的 `t` 上没有） | [Scoring · 值断言](../scoring/library/value-assertions.md) | [单轮](use-case/first-single-turn.md) · [沙箱](use-case/sandbox-coding.md) |
| `.gate(x?)` / `.atLeast(x)` / `.soft()` / `.optional()` | 改一条断言的严重度 / 通过线 / 缺席策略；计分制的 `.gate(x?)` 是前置中止、`.atLeast(x)` 只设观测通过线 | [Scoring · Severity 与 Verdict](../scoring/architecture/severity-and-verdict.md) | [过程与成本](use-case/process-and-cost.md) · [裁判评质量](use-case/judge-quality.md) |
| `t.judge` / `session.judge` / `turn.judge` | LLM-as-judge 评开放式质量 | [Scoring · Judge](../scoring/library/judge.md) | [裁判评质量](use-case/judge-quality.md) |
| `t.sandbox.*` | 沙箱文件 IO、命令执行、agent diff 断言 | [Sandbox · 文件与命令](../sandbox/library/operations.md) · [断言结果](../sandbox/library/asserting-results.md) | [沙箱 coding 任务](use-case/sandbox-coding.md) |
| `setup` / `teardown` / `t.progress` / `t.diagnostic` / `t.skip` | 任务 Fixture 与运行反馈 | [README](README.md) · [Context · 反馈](library/context.md#向运行反馈长步骤) | [Fixture 与反馈](use-case/fixtures-lifecycle.md) |

## tags 与 environment：让 experiment 选择

`tags` 是分类标签，供 CLI `--tag` 与 experiment 谓词过滤，未声明时是空数组。`environment` 是 provider-neutral 的环境 profile id，experiment 只读取这个 id，具体 image / template 由 sandbox spec 的 `environments` 映射（完整语义见 [README](README.md#defineeval-的形状)）。eval 本身保持 agent-neutral，只描述「测什么」和「怎么算对」；对着哪个 agent 跑、跑几次，由 `experiments/` 里的 `defineExperiment` 决定（见 [Experiments](../experiments/README.md)）。

## 数据集扇出

共享同一套逻辑的一批 case，从同一文件默认导出**数组**或 **keyed record**，不复制薄 wrapper 文件：

- **数组**：位置就是身份。按位置生成零填充 4 位的稳定 id：`evals/sql.eval.ts` 导出数组 → `sql/0000`、`sql/0001`……
- **Keyed record**：业务 key 就是身份。`Record<string, EvalDef>` 的 key 原样接到文件 id 后：`swelancer.eval.ts` 的 key `15193` → `swelancer/15193`。key 必须是一个非空路径片段——不含 `/`、`\\`，不是 `.` / `..`，不含控制字符。发现结果按 key 字典序排列，数据源换行或构造顺序变化不影响运行与展示顺序。空 record 合法，表示这份数据集当前没有 case。

选择规则：位置本身有意义且稳定用数组；外部系统已给出稳定身份用 keyed record。两种形状共享同一份 eval 源码捕获，区别只在 id 的最后一段。数据加载（`loadYaml` / `loadJson`）与完整写法见[用例篇](use-case/dataset-fanout.md)。

## 命名与组织约定

- 文件名以 `.eval.ts` 或 `.eval.tsx` 结尾才会被发现（eval 里要写 JSX 时用 `.tsx`，发现规则与 id 推导相同）。
- 目录只形成 id 前缀：`evals/billing/refund.eval.ts` → `billing/refund`；运行选择仍由 experiment 的 `evals` 决定。
- 数据集放 `evals/data/`；沙箱型 eval 的起始文件素材可以放 `evals/fixtures/`（纯目录命名约定，运行器不扫描不自动加载，仍要在 `test()` 里显式写入沙箱）。
- `description` 写给人看，id 给机器引用。**禁止**手写 `id` / `name`——从文件路径推导，改名即改 id，不会腐烂。
- `t.group` 的组名是跨 eval 的对比维度，按字面对齐：同类检查抽成共享函数（如 `evals/*/share/`），组名在函数里写一次，跨 eval 天然一致（[计分粒度 · 组名对齐](../experiments/score-points.md#得分点-组对比读取的下钻粒度)）。

## 相关阅读

- [用例目录](use-case/README.md) —— 一篇一个真实场景，从问题到断言的全流程。
- [README](README.md) —— `defineEval` 的核心契约。
- [Eval Context](library/context.md) —— `t`、`session`、`turn` 的调用和结果字段。
- [Architecture](architecture.md) —— 接收者模型与两条设计原则。
- [Scoring](../scoring/README.md) —— 断言、judge、严重度与判定。
