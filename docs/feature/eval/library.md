# Eval ——库用法

写一个 eval 像写一个测试：一个文件、一个 `test(t)` 函数。
`test(t)` 里只做三件事——**驱动**（`t.send(...)` 让 agent 干活）、**读取**（`t.reply` / `turn` / `t.sandbox` 拿到结果）、**断言**（把观察写成可评分的条目）。
`defineEval` 各字段的契约见 [README](README.md)。

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
| `succeeded` / `calledTool` / `toolOrder` / `event` / `maxTokens` … | 作用域断言：断 agent 做了什么、花了多少 | [Assertions · 作用域断言](../assertions/library/scoped-assertions.md) | [过程与成本](use-case/process-and-cost.md) · [calledTool 全参数](use-case/calledtool.md) |
| `t.group` | 分组断言：报告区块，组名同时是对比的得分点维度 | [Assertions · 值断言 · 分组](../assertions/library/value-assertions.md#分组) | [过程与成本](use-case/process-and-cost.md) |
| `t.score(label, fact, { max })` / `t.score(label, { earned })` | 计分制给分（仅 `defineScoreEval` 的 `t`）：将 Fact 映射为分数，或直接登记已算分数 | [Assertions · 计分](../assertions/library/score-points.md) | [计分制](use-case/rubric-points.md) |
| `t.check` / `t.require` + `niceeval/expect` matcher | 原子创建值 Fact 并登记 verdict use；`require` 立即求值并停止依赖路径 | [Assertions · 值断言](../assertions/library/value-assertions.md) | [单轮](use-case/first-single-turn.md) · [沙箱](use-case/sandbox-coding.md) |
| `t.check(scoreFact.atLeast(n))` / `await t.require(scoreFact.atLeast(n))` | ScoreFact 的阈值与控制流；不存在链式 severity 或缺席策略 | [Verdict](../verdict/architecture.md) | [过程与成本](use-case/process-and-cost.md) · [裁判评质量](use-case/judge-quality.md) |
| `t.judge` / `turn.judge` | LLM-as-judge：根级显式材料或 immutable Turn 材料，均返回 ScoreFact | [Judge](../judge/library.md) | [裁判评质量](use-case/judge-quality.md) |
| `t.sandbox.*` | 沙箱文件 IO、命令执行、agent diff 断言 | [Sandbox · 文件与命令](../sandbox/library/operations.md) · [断言结果](../sandbox/library/asserting-results.md) | [沙箱 coding 任务](use-case/sandbox-coding.md) |
| `sandbox` + `.prepare(command)` | 题目起点与逐 Attempt 准备命令 | [Sandbox Layer](../sandbox/layers.md) | [Fixture 与反馈](use-case/fixtures-lifecycle.md) |
| 普通 `t.sandbox.upload*()` | 按源码顺序传入起始文件或测试文件 | [Sandbox 文件操作](../sandbox/library/operations.md) | [本地测试文件](use-case/criteria-files.md) |
| `t.progress` / `t.diagnostic` / `t.skip` | 运行反馈与明确跳过 | [Context · 反馈](library/context.md#向运行反馈长步骤) | [Fixture 与反馈](use-case/fixtures-lifecycle.md) |

## Eval 文件就是普通 Sandbox 输入

本地文件不在 EvalInput 中重复登记。
`uploadFile` 接受 `Buffer | URL`，`uploadDirectory` 接受相对路径或 URL；Runner 在实际读取本地 source 时写入 transfer manifest。

上传发生在第一个 `send` 前，文件就对 Agent 可见；发生在某个 `send` 返回后，过去的 turn 看不见；随后再 `send` 时下一轮正常可见。
完整规则见[本地测试文件](use-case/criteria-files.md)。

`loadText` / `loadYaml` / `loadJson` 继续服务发现期需要读进定义值的数据，不承担文件传输登记。

## tags 与 sandbox：让 experiment 选择

`tags` 是分类标签，供 CLI `--tag` 与 experiment 谓词过滤，未声明时是空数组。
`sandbox` 让 Eval 自带起点：题目运行条件归题目时，Eval 用 `dockerComposeSandbox()` 这类 template-bearing factory 声明完整起点。
选中它的 Experiment 保持 command-only，按 id 前缀或 tags 选题，不感知题目用哪个 Provider；配对规则见 [Sandbox Layer](../sandbox/layers.md#每个配对的-link-约束)。
eval 本身保持 agent-neutral，只描述「测什么」和「怎么算对」；对着哪个 agent 跑、跑几次，由 `experiments/` 里的 `defineExperiment` 决定（见 [Experiments](../experiments/README.md)）。

## 测试集从输入数组生成多条 eval

共享同一套逻辑的一批 case，从同一文件默认导出**数组**或 **keyed record**，不复制薄 wrapper 文件：

- **数组**：位置就是身份。
  按位置生成零填充 4 位的 id：`evals/sql.eval.ts` 导出数组 → `sql/0000`、`sql/0001`……；在中间插入、删除或重排会改变后续 id，并使对应缓存失效。
- **Keyed record**：业务 key 就是身份。
  `Record<string, EvalDefinition>` 的 key 原样接到文件 id 后：`swelancer.eval.ts` 的 key `15193` → `swelancer/15193`。
  key 必须是一个非空路径片段——不含 `/`、`\\`，不是 `.` / `..`，不含控制字符。
  发现结果按 key 字典序排列，数据源换行或构造顺序变化不影响运行与展示顺序。
  空 record 合法，表示这份测试集当前没有 case。

选择规则：固定、只追加且位置本身有意义的数据才用数组；会插入、删除、重排，或已有业务身份的数据默认用 keyed record。
两种形状共享同一份 eval 源码捕获，区别只在 id 的最后一段。
数据加载（`loadYaml` / `loadJson`）与完整写法见[用例篇](use-case/dataset-fanout.md)。

## 命名与组织约定

- 文件名以 `.eval.ts` 或 `.eval.tsx` 结尾才会被发现（eval 里要写 JSX 时用 `.tsx`，发现规则与 id 推导相同）。
- 目录只形成 id 前缀：`evals/billing/refund.eval.ts` → `billing/refund`；运行选择仍由 experiment 的 `evals` 决定。
- 测试集放 `evals/data/`；沙箱型 eval 的起始文件素材可以放 `evals/fixtures/`（纯目录命名约定，运行器不扫描不自动加载，仍要在 `test()` 里显式写入沙箱）。
- `description` 写给人看，id 给机器引用。
  **禁止**手写 `id` / `name`——从文件路径推导，改名即改 id，不会腐烂。
- `t.group` 的组名是跨 eval 的对比维度，按字面对齐：同类检查抽成共享函数（如 `evals/*/share/`），组名在函数里写一次，跨 eval 天然一致（[计分粒度 · 组名对齐](../assertions/library/score-points.md#得分点-组对比读取的下钻粒度)）。

## 相关阅读

- [用例目录](use-case/README.md) ——一篇一个真实场景，从问题到断言的全流程。
- [README](README.md) —— `defineEval` 的核心契约。
- [Eval Context](library/context.md) —— `t`、`session`、`turn` 的调用和结果字段。
- [Architecture](architecture.md) ——接收者模型与两条设计原则。
- [Assertions](../assertions/README.md) ——Fact、Judge 与判定。
