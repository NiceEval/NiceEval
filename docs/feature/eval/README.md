# Eval —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。共享同一套逻辑的测试集可以从同一文件默认导出数组或 keyed record；数组按位置生成 id（插删或重排会改 id），record 按稳定业务 key 生成 id。

## `defineEval` 的形状

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description?: string;   // 人读的描述,出现在报告里;不参与任何判定
  tags?: string[];        // 供 --tag 与 ExperimentDef.evals 谓词过滤

  judge?: JudgeConfig;    // 这道题要多强的裁判
  timeoutMs?: number;     // 这道题跑得完要多久
  //  ↑ 这两个排在 niceeval.config.ts 之前:题目写了 35 分钟,项目 config 写 20 分钟,仍按 35 分钟跑
  //    timeout 要按次压过时用 --timeout 或 experiment 字段;judge 单条换模型用断言的 { model }

  environment?: string;   // 这道题要哪种环境 profile,例如 "python-3.9-astropy-4.2"
  //  所用 sandbox spec 的 environments 表里没有这一项 → 启动期配置错误,一个沙箱都不创建
  //  省略 → 从 spec 的基础产物起步

  diff?: { include?: string[]; ignore?: string[] };
  //  只改变「哪些路径算进 agent 归因」,不改变沙箱里实际有什么;仅沙箱型有意义

  reporters?: Reporter[];               // 这个 eval 专用的报告器
  metadata?: Record<string, unknown>;   // 原样落进记录,给报告和事后分析读

  async setup(sandbox, ctx) { /* 这道题的任务素材 */ },
  //  拿到完整 Sandbox(不是 test 里那个受限的 t.sandbox 视图);写入算 eval 归因,永不进 agent diff
  //  ctx 是绑定到 eval.setup 的窄上下文:ctx.progress(...) 报短期 activity,ctx.diagnostic(...) 报永久 warning/error

  async teardown(sandbox, ctx) { /* 回收 setup 的 fixture */ },
  //  收尾链的第一段(eval.teardown → agent.teardown → sandbox.teardown)
  //  当且仅当 setup 的时点走到过才执行;setup 抛错、test 抛错都不豁免

  async test(t) { /* 交互 + 断言 */ },
  //  最后一次 t.send() 返回后、且不再发起 send 时写校验材料,agent 看不到,也进不了 agent diff
});
```

`timeoutMs` 与 `judge` 是这条 eval 自己对运行条件的声明：装一套工具链的题需要 35 分钟、评开放式行文的题需要更强的裁判模型，这是题目本身的属性，不是这次跑法的偏好。项目级配置是没写时的缺省底，压不掉 eval 写下的值。`timeoutMs` 可由 experiment 或 `--timeout` 覆盖；`judge` 没有 experiment / CLI 覆盖层，只有单条断言的 `{ model }` 出口，见 [LLM-as-judge](../judge/library.md#模型与鉴权)。完整解析链见 [Experiments · Resolved config](../experiments/architecture.md#resolved-config一次求值处处同源)。

`environment` 是非空、不透明的稳定 id：eval 不在这里选择 Docker image、E2B template 或 Vercel snapshot，也不因此绑定某个 provider。profile 到具体预制产物的翻译是一张纯数据表，写在 sandbox spec 工厂的 `environments` 参数上（一个 provider 一份，多个实验复用），见 [Sandbox · 按 environment 选预制产物](../sandbox/library/prebuilt-environments.md#按-environment-选预制产物)。测试集扇出（一个文件默认导出数组或 record）时整组条目共享同一声明。此字段以解析后的产物参数计入 eval fingerprint——它映射的产物变化会让该 eval 重跑；Direct Agent 不创建 Sandbox，此字段只参与指纹。

`diff` 调整变更归因的排除清单:`ignore` 在默认清单上追加排除,`include` 优先级最高,把匹配路径从默认清单与 `ignore` 中显式加回(要评分 `node_modules` 里被 agent patch 的文件就 include 它)。两个数组的 glob 语义、默认清单与合成顺序单源在 [Sandbox · 变更归因](../sandbox/architecture.md#变更归因send-窗口与分类账),那里把每一行写入落到哪本账上逐行标了出来。

`setup` 在环境层 Hook 与变更分类账锚点之后、`agent.setup` 与 `test(t)` 之前跑,用来准备这次任务的素材(例如 `npm install` 起始项目的依赖)。要把它的产物传给 `teardown`,以 `sandbox` 实例作键存取——并发 attempt 共享同一模块,普通模块变量会互相覆写(写法见[用例 · Fixture 与反馈](use-case/fixtures-lifecycle.md),四层统一成对语义见 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它))。它与另外两层 setup 分工不同:环境层的 `sandbox.setup`(不知道跑哪个 eval)、协议层的 `agent.setup`(装 CLI、写鉴权),见 [Sandbox](../sandbox/README.md)。

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
    await t.require(await t.sandbox.fileExists("db-gpt/README.md"), isTrue("cloned"));
    t.sandbox.fileChanged("db-gpt/.env").points(1);   // 检查点通过挣 1 分
    t.score("代码精简", 15);                           // 自己算好条件后直接累加
  },
});
```

计分制只多出分数面：`.points(n)` 是得分点，`t.score(label, n)` 直接给分。严重度与通过制完全相同：`.gate()` 是硬判定，`.atLeast(x)` 是带线 soft，`.soft()` 只记录。需要停止依赖失败结果的后续代码时链 `.stopOnFailure()`；值断言可直接用两种题型共用的 `t.require()`。

题型是定义期事实，进 `EvalDescriptor.scoring`(`"pass" | "points"`)供报告选择主读数。一个 Experiment 可以同时选择两种题型；通过率与总分分别聚合，不互相相加。计分语义的单源契约见[计分粒度](../assertions/library/score-points.md#计分制叠加给分没有上限声明)，完整写法见[计分制用例](use-case/rubric-scoring.md)。

API 全景与组织约定见 [Library](library.md);单轮、多轮、HITL、测试集扇出、沙箱型等真实场景一篇一个用例,见 [use-case/](use-case/README.md);API 取舍背后的设计依据见 [Architecture](architecture.md)。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Assertions](../assertions/README.md)。

## 相关阅读

- [Library](library.md) —— API 全景、测试集扇出契约与命名组织约定。
- [用例目录](use-case/README.md) —— 单轮、多轮、HITL、过程断言、judge、测试集、沙箱、 Fixture,一篇一个场景。
- [Eval Context](library/context.md) —— `t`、`session`、`turn` 怎样驱动会话和读取结果。
- [Architecture](architecture.md) —— 为什么作用域断言按接收者(`t` / `session` / `turn`)分层,对齐 eve 的设计依据。
- [Assertions](../assertions/README.md) —— 值断言、作用域断言、judge、严重度与判定规则。
- [Agents 与 Adapters](../adapters/README.md) —— agent 三类 transport 与 agent 适配。
- [Experiments](../experiments/README.md) —— eval 由谁跑、跑几次、对着哪个 agent。
