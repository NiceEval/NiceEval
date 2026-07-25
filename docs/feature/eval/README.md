# Eval —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。共享同一套逻辑的数据集可以从同一文件默认导出数组或 keyed record；数组按稳定序号生成 id，record 按稳定业务 key 生成 id。

## `defineEval` 的形状

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description?: string;            // 人读的描述,出现在报告里
  tags?: string[];                 // 供 --tag 与 ExperimentDef.evals 谓词过滤
  judge?: JudgeConfig;             // 覆盖默认裁判模型
  reporters?: Reporter[];          // 这个 eval 专用的报告器
  timeoutMs?: number;              // 这条 eval 需要多久才跑得完
  environment?: string;            // 这条 eval 需要的环境 profile id；也可由 ExperimentDef.evals 谓词读取
  diff?: { include?: string[]; ignore?: string[] };   // 调整 agent diff 的归因排除清单(仅沙箱型;见下)
  metadata?: Record<string, unknown>;
  async setup(sandbox, ctx) { /* 这条 eval 的沙箱预置;ctx 可报告 progress/diagnostic */ },
  async teardown(sandbox, ctx) { /* 回收 setup 的 fixture;setup 时点走到过才触发 */ },
  async test(t) { /* 交互 + 断言 */ },
});
```

`timeoutMs` 与 `judge` 是这条 eval 自己对运行条件的声明：装一套工具链的题需要 35 分钟、评开放式行文的题需要更强的裁判模型，这是题目本身的属性，不是这次跑法的偏好。两者都排在 `niceeval.config.ts` 之前——项目级配置是没写时的缺省底，压不掉 eval 写下的值；要按次覆盖，用运行侧的 `--timeout` 或 experiment 字段（`judge` 的模型另有单次 `{ model }` 出口，见 [LLM-as-judge](../scoring/library/judge.md#模型与鉴权)）。完整的四层链见 [Experiments · Resolved config](../experiments/architecture.md#resolved-config一次求值处处同源)。

`environment` 声明这条 eval 需要哪种**环境 profile**，例如 `"python-3.9-astropy-4.2"`。它是非空、不透明的稳定 id：eval 不在这里选择 Docker image、E2B template 或 Vercel snapshot，也不因此绑定某个 provider。profile 到具体预制产物的翻译是一张纯数据表，写在 sandbox spec 工厂的 `environments` 参数上（一个 provider 一份，多个实验复用），见 [Sandbox · 按 environment 选预制产物](../sandbox/library/prebuilt-environments.md#按-environment-选预制产物)。省略此字段的 eval 从 spec 的基础产物起步；数据集扇出（一个文件默认导出数组或 record）时整组条目共享同一声明。选中 eval 声明的 profile 在所用 spec 里缺表项是启动期配置错误。此字段以解析后的产物参数计入 eval fingerprint——它映射的产物变化会让该 eval 重跑；remote Agent 不创建沙箱，此字段只参与指纹。

`diff` 调整[变更归因](../sandbox/architecture.md#变更归因send-窗口与分类账)的排除清单,两个数组都是 **gitignore 风格 glob**(workdir 相对):默认排除 `.git/`、`node_modules/`、常见构建产物与包管理器缓存目录;`ignore` 在默认清单上追加排除;`include` 优先级最高,把匹配路径从默认清单与 `ignore` 中显式加回(要评分 `node_modules` 里被 agent patch 的文件就 include 它)。合成规则固定为「默认 ∪ ignore,再被 include 打洞」,清单在分类账锚点时冻结,运行中不可变。

`setup` 是**这条 eval 的任务层预置**:拿到的是完整 `Sandbox`(不是 `test` 里那个受限的 `t.sandbox` 视图),在环境层 Hook 与变更分类账锚点之后、`agent.setup` 与 `test(t)` 之前跑,用来准备这次任务的素材(例如 `npm install` 起始项目的依赖);它的写入是 eval 归因,不会进 agent diff。第二个参数是绑定到 `eval.setup` 的窄上下文,可用 `ctx.progress(...)` 报告短期 activity、用 `ctx.diagnostic(...)` 报告永久 warning/error。`teardown` 是它的成对收尾:attempt 收尾链的第一段(`eval.teardown` → `agent.teardown` → `sandbox.teardown`),当且仅当 `setup` 的时点走到过才执行(`setup` 抛错、`test` 抛错都不豁免);要把 `setup` 的产物传给 `teardown`,以 `sandbox` 实例作键存取——并发 attempt 共享同一模块,普通模块变量会互相覆写(写法见[用例 · Fixture 与反馈](use-case/fixtures-lifecycle.md),四层统一成对语义见 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它))。它与另外两层 setup 分工不同:环境层的 `sandbox.setup`(不知道跑哪个 eval)、协议层的 `agent.setup`(装 CLI、写鉴权),见 [Sandbox](../sandbox/README.md)。

**禁止**提供 `id` / `name` —— 它们从文件路径推导:`evals/weather/brooklyn.eval.ts` → id `weather/brooklyn`。改名即改 id,不会腐烂。

## defineScoreEval：计分制题型

`defineScoreEval` 定义**计分制**题型:题内用给分词汇叠加挣分(五步走完三步挣 3 分、rubric 大题按分值给分),对比读总分而不是通过率。字段与 `defineEval` 完全同形,区别只在 `test(t)` 的 `t` ——它是另一套类型,给分词汇 `.points(n)` / `t.score(label, n)` **只**存在于这里(在 `defineEval` 里写给分是类型错误):

```typescript
import { defineScoreEval } from "niceeval";
import { isTrue } from "niceeval/expect";

export default defineScoreEval({
  description: "安装并启动 DB-GPT",
  async test(t) {
    await t.send("把 DB-GPT 装起来并通过健康检查。");
    // 前置:挂了就地结束,后面的分自然挣不到
    await t.check(await t.sandbox.fileExists("db-gpt/README.md"), isTrue("cloned")).gate();
    t.sandbox.fileChanged("db-gpt/.env").points(1);   // 检查点通过挣 1 分
    t.score("代码精简", 15);                           // 自己算好条件后直接累加
  },
});
```

计分制的 `t` 上一条断言只扮演一个角色:`.points(n)` 得分点、`.gate(x?)` 前置(挂了就地结束 `test()`)、什么都不链或 `.soft()` 观测(进质量分)。链过 `.points()` 的句柄上只剩 `.gate()` 与 `.optional()`;`.atLeast(x)` 在计分制只是观测的通过线(低于线记 failed、永不影响判定),`t.require` 在这套 `t` 上不存在——前置只有 `.gate()` 一种写法。

题型是定义期事实,进 `EvalDescriptor.scoring`(`"pass" | "points"`)供 experiment 的 `evals` 谓词过滤;一个 experiment 选中的 eval 必须同型,混型是启动期配置错误。计分语义(叠加不扣分、无满分声明、中止挣 0 与 errored 得 null 的分界、丢分不产生 failed)的单源契约见[计分粒度](../experiments/score-points.md#计分制叠加给分没有上限声明),完整写法见[计分制用例](use-case/rubric-scoring.md)。

API 全景与组织约定见 [Library](library.md);单轮、多轮、HITL、数据集扇出、沙箱型等真实场景一篇一个用例,见 [use-case/](use-case/README.md);API 取舍背后的设计依据见 [Architecture](architecture.md)。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Scoring](../scoring/README.md)。

## 相关阅读

- [Library](library.md) —— API 全景、数据集扇出契约与命名组织约定。
- [用例目录](use-case/README.md) —— 单轮、多轮、HITL、过程断言、judge、数据集、沙箱、 Fixture,一篇一个场景。
- [Eval Context](library/context.md) —— `t`、`session`、`turn` 怎样驱动会话和读取结果。
- [Architecture](architecture.md) —— 为什么作用域断言按接收者(`t` / `session` / `turn`)分层,对齐 eve 的设计依据。
- [Scoring](../scoring/README.md) —— 值断言、作用域断言、judge、严重度与判定规则。
- [Agents 与 Adapters](../adapters/README.md) —— agent 三类 transport 与 agent 适配。
- [Experiments](../experiments/README.md) —— eval 由谁跑、跑几次、对着哪个 agent。
