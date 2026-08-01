# Eval —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。
共享同一套逻辑的测试集可以从同一文件默认导出数组或 keyed record；数组按位置生成 id（插删或重排会改 id），record 按稳定业务 key 生成 id。

## `defineEval` 的形状

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description?: string;   // 人读的描述,出现在报告里;不参与任何判定
  tags?: string[];        // 供 --tag 与 ExperimentInput.evals 谓词过滤

  judge?: JudgeConfig;    // 这道题要多强的裁判
  timeoutMs?: number;     // 这道题跑得完要多久
  //  ↑ 这两个排在 niceeval.config.ts 之前:题目写了 35 分钟,项目 config 写 20 分钟,仍按 35 分钟跑
  //    timeout 要按次压过时用 --timeout 或 experiment 字段;judge 单条换模型用断言的 { model }

  environment?: string | SandboxSource;   // 这道题要哪种环境:共享 profile id,或 folder-local sandbox source
  //  profile 任何表都查不到、又没有 folder-local source → 启动期配置错误,一个沙箱都不创建
  //  声明合法但当前 provider 缺对应 materializer 或能力位 → 计划期 skipped,写明缺项
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

  async test(t) { /* 按顺序写普通上传、交互、命令、读取与断言 */ },
});
```

`timeoutMs` 与 `judge` 是这条 eval 自己对运行条件的声明：装一套工具链的题需要 35 分钟、评开放式行文的题需要更强的裁判模型，这是题目本身的属性，不是这次跑法的偏好。
项目级配置是没写时的默认来源，压不掉 eval 写下的值。
`timeoutMs` 可由 experiment 或 `--timeout` 覆盖；`judge` 没有 experiment / CLI 覆盖层，只有单条断言的 `{ model }` 出口，见 [LLM-as-judge](../judge/library.md#模型与鉴权)。
完整解析链见 [Experiments · 配置解析链](../experiments/architecture.md#配置解析链一次求值处处同源)。

`environment` 有两种同等的写法：

- **共享 profile**：非空、不透明的稳定 id。
  eval 不在这里选择 Docker image、E2B template 或 Vercel snapshot，也不因此绑定某个 provider。
  profile 到完整 sandbox case 的翻译写在 sandbox spec 工厂的 `environments` 表上，一个 provider 一份、多个实验复用，见 [Sandbox Case](../sandbox/case.md)。
- **folder-local source**：folder eval 直接声明 sandbox source（如 `composeSandbox`），由当前 spec 按 source kind 注册的 materializer 转成 SandboxCase，目录路径就是默认 profile id。

测试集从输入数组生成多条 eval（一个文件默认导出数组或 record）时整组条目共享同一声明。
此字段以解析后的 sandbox case 身份（CaseKey）计入 eval fingerprint——环境定义的任何变化都让该 eval 重跑；Direct Agent 不创建 Sandbox，此字段只参与指纹。

`diff` 调整变更归因的排除清单:`ignore` 在默认清单上追加排除,`include` 优先级最高,把匹配路径从默认清单与 `ignore` 中显式加回(要评分 `node_modules` 里被 agent patch 的文件就 include 它)。
两个数组的 glob 语义、默认清单与合成顺序单源在 [Sandbox · 变更归因](../sandbox/architecture.md#变更归因send-窗口与分类账),那里把每一行写入落到哪本账上逐行标了出来。

`metadata` 只在 Experiment 谓词或 Reporter 确实消费某个结构化业务维度时使用。
能从 eval id、tags、description 或 Environment 推导出的值不重复写；没有消费者就省略，不能把它当任意杂物抽屉。

`setup` 在环境层 Hook 与变更分类账锚点之后、`agent.setup` 与 `test(t)` 之前跑,用来准备这次任务的素材(例如 `npm install` 起始项目的依赖)。
要把它的产物传给 `teardown`,以 `sandbox` 实例作键存取——并发 attempt 共享同一模块,普通模块变量会互相覆写(写法见[用例 · Fixture 与反馈](use-case/fixtures-lifecycle.md),四层统一成对语义见 [Runner · 环境预置](../../runner.md#环境预置不进运行器但按顺序调它))。
它与另外两层 setup 分工不同:环境层的 `sandbox.setup`(不知道跑哪个 eval)、协议层的 `agent.setup`(装 CLI、写鉴权),见 [Sandbox](../sandbox/README.md)。

文件传输不设 EvalInput field。
第一次 `send` 前需要 Agent 看见的文件直接通过 `t.sandbox.upload*()` 上传；测试文件在对应 `send` 返回后上传，再用普通命令和断言判分。

本地路径或 URL 进入普通上传 API 时，Runner 自动记录 transfer manifest。
文件身份、动态泄漏检查与携带规则见[本地测试文件](use-case/criteria-files.md)。

**禁止**提供 `id` / `name` —— 它们从文件路径推导:`evals/weather/brooklyn.eval.ts` → id `weather/brooklyn`。
改名即改 id,不会腐烂。

## 文件夹入口:一道题一个目录

发现器接受两种入口;同一 id 两种入口并存时启动期报重名,不按扫描顺序覆盖:

```text
evals/foo.eval.ts       → eval id "foo"
evals/foo/eval.ts       → eval id "foo"
```

`eval.ts` 只是文件夹入口约定,仍默认导出 `defineEval` / `defineScoreEval` 结果,不引入第二套评分或 Experiment 模型。
目录里可以平铺 Dockerfile、Compose、题面数据、起始文件与测试文件,也可以分子目录;没有入口的目录(如 `_lib/`)是普通共享代码,不会被发现成 eval。

共址不等于同一身份域或同一可见时点,三类文件各有归属:

| 文件 | 何时可见 | 身份 |
|---|---|---|
| Dockerfile、Compose、build context、相对 bind mount | provider 构建 image、启动 Compose 时使用;Agent 只看到最终主 Sandbox 视图 | BuildKey / CaseKey |
| 题面数据(经 `loadYaml` / `loadText` 读入) | 宿主发现期读取 | eval 数据指纹 |
| 普通本地上传 source | 调用发生时上传；相对 `send` 的位置决定 Agent 是否可见 | 首次执行写入 transfer manifest，后续用于携带 |

普通起始文件在 send 前上传，Agent 本来就应看见；测试文件在对应 send 返回后上传。
目录共址只解决组织问题，不把环境构建与运行期文件传输合并成一个哈希。

solution、生成器与参考答案不得进入任何 build context 或最终镜像。
它们若从未被 Eval 读取，就不需要为了 Runner 再声明一次；环境包的隔离规则见 [Sandbox Case · 动态泄漏检查](../sandbox/case.md#动态泄漏检查本地上传与-agent-可见-closure)。

## defineScoreEval：计分制题型

`defineScoreEval` 定义**计分制**题型:题内用给分词汇叠加挣分(五步走完三步挣 3 分、rubric 大题按分值给分),对比读总分而不是通过率。
字段与 `defineEval` 完全同形,区别只在 `test(t)` 的 `t` ——它是另一套类型,给分词汇 `.points(n)` / `t.score(label, n)` **只**存在于这里(在 `defineEval` 里写给分是类型错误):

```typescript
import { defineScoreEval } from "niceeval";
import { isTrue } from "niceeval/expect";

export default defineScoreEval({
  description: "安装并启动 DB-GPT",
  async test(t) {
    await t.send("把 DB-GPT 装起来并通过健康检查。");
    // 前置:失败就地结束,后面的分自然挣不到
    await t.require(await t.sandbox.fileExists("db-gpt/README.md"), isTrue("cloned"));
    t.sandbox.fileChanged("db-gpt/.env").points(1);   // 检查点通过挣 1 分
    t.score("代码精简", 15);                           // 自己算好条件后直接累加
  },
});
```

计分制只多出分数面：`.points(n)` 是得分点，`t.score(label, n)` 直接给分。
严重度与通过制完全相同：`.gate()` 是硬判定，`.atLeast(x)` 是带线 soft，`.soft()` 只记录。
需要停止依赖失败结果的后续代码时链 `.stopOnFailure()`；值断言可直接用两种题型共用的 `t.require()`。

题型是定义期事实，进 `EvalDescriptor.scoring`(`"pass" | "points"`)供报告选择主读数。
一个 Experiment 可以同时选择两种题型；通过率与总分分别聚合，不互相相加。
计分语义的单源契约见[计分粒度](../assertions/library/score-points.md#计分制叠加给分没有上限声明)，完整写法见[计分制用例](use-case/rubric-scoring.md)。

API 全景与组织约定见 [Library](library.md);单轮、多轮、HITL、测试集从输入数组生成多条 eval、沙箱型等真实场景一篇一个用例,见 [use-case/](use-case/README.md);API 取舍背后的设计依据见 [Architecture](architecture.md)。
评分手段(judge、匹配器、gate/soft)单独成篇,见 [Assertions](../assertions/README.md)。

## 相关阅读

- [Library](library.md) —— API 全景、测试集从输入数组生成多条 eval契约与命名组织约定。
- [用例目录](use-case/README.md) —— 单轮、多轮、HITL、过程断言、judge、测试集、沙箱、 Fixture,一篇一个场景。
- [Eval Context](library/context.md) —— `t`、`session`、`turn` 怎样驱动会话和读取结果。
- [Architecture](architecture.md) —— 为什么作用域断言按接收者(`t` / `session` / `turn`)分层,对齐 eve 的设计依据。
- [Assertions](../assertions/README.md) —— 值断言、作用域断言、judge、严重度与判定规则。
- [Agents 与 Adapters](../adapters/README.md) —— agent 三类 transport 与 agent 适配。
- [Experiments](../experiments/README.md) —— eval 由谁跑、跑几次、对着哪个 agent。
