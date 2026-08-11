# Eval —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。
共享同一套逻辑的测试集可以从同一文件默认导出数组或 keyed record；数组按位置生成 id（插删或重排会改 id），record 按稳定业务 key 生成 id。

## `defineEval` 的形状

```typescript
import { defineEval, type JsonValue } from "niceeval";

export default defineEval({
  description?: string;   // 人读的描述,出现在报告里;不参与任何判定
  tags?: string[];        // 供 --tag 与 ExperimentInput.evals 谓词过滤

  judge?: JudgeConfig;    // 这道题要多强的裁判
  timeoutMs?: number;     // 这道题跑得完要多久
  //  ↑ 这两个排在 niceeval.config.ts 之前:题目写了 35 分钟,项目 config 写 20 分钟,仍按 35 分钟跑
  //    timeout 要按次压过时用 --timeout 或 experiment 字段;judge 单条换模型用断言的 { model }

  sandbox?: SandboxLayer;   // 这道题的起点或准备:具体 Provider factory 的产物,或 sandboxLayer() 的命令链
  //  与 Experiment 的同名字段配对:每个实际配对恰好一方带 template
  //  省略 → 等价于空的 command-only layer,不提供隐式 template

  diff?: { include?: string[]; ignore?: string[] };
  //  只改变「哪些路径算进 agent 归因」,不改变沙箱里实际有什么;仅沙箱型有意义

  reporters?: Reporter[];               // 这个 eval 专用的报告器
  metadata?: Record<string, JsonValue>; // 纯 JSON 元数据,原样落进记录,给报告和事后分析读

  async test(t) { /* 按顺序写普通上传、交互、命令、读取与断言 */ },
});
```

`timeoutMs` 与 `judge` 是这条 eval 自己对运行条件的声明：装一套工具链的题需要 35 分钟、评开放式行文的题需要更强的裁判模型，这是题目本身的属性，不是这次跑法的偏好。
项目级配置是没写时的默认出处，压不掉 eval 写下的值。
`timeoutMs` 可由 experiment 或 `--timeout` 替换。`judge` 按单条断言 `{ model }` → experiment → eval → config 逐字段求值，没有 CLI 替换层。

Eval 的 `judge` 是这道题对裁判能力的默认要求。Experiment 可以签入另一组执行配置做 A/B；rubric、severity 与 threshold 仍只属于 Eval。见 [LLM-as-judge](../judge/library.md#模型与鉴权)。
完整求值链见 [Experiments · 配置求值链](../experiments/architecture.md#配置求值链一次求值处处同源)。

`sandbox` 放一个 `SandboxLayer`，两种形态（类型与 factory 契约单源在 [Sandbox Layer](../sandbox/layers.md)）：

- **template-bearing**：由 `dockerComposeSandbox` / `dockerSandbox` / `e2bSandbox` 等具体 Provider factory 构造，携带完整起点并同时选定 Provider。
- **command-only**：`sandboxLayer()` 的 `.prepare()` 命令链，只在已经启动的主 Sandbox 中执行题目准备。

每个实际选中的 `Eval × Experiment` 配对恰好一方 template-bearing：两方都带报 `sandbox.template-conflict`，两方都不带报 `sandbox.template-missing`，link 阶段全矩阵聚合、零 Provider I/O、零资源创建。
template factory、平台或 Agent capability requirement 不可用时，physical planning 聚合报错，零 build、零 Sandbox 创建（错误表见[三方准备时序](../sandbox/lifecycle.md#错误语义)）。

测试集从输入数组生成多条 eval（一个文件默认导出数组或 record）时整组条目共享同一 `sandbox` 声明。
template identity、CaseKey 与 command identity 计入 Attempt fingerprint（完整清单见[三方准备时序](../sandbox/lifecycle.md#身份与复用池)）。
Direct Agent 没有运行中的 Sandbox，为它声明 `sandbox` 报 `sandbox.unexpected-for-direct-agent`。

`diff` 调整变更归因的排除清单:`ignore` 在默认清单上追加排除,`include` 优先级最高,把匹配路径从默认清单与 `ignore` 中显式加回(要评分 `node_modules` 里被 agent patch 的文件就 include 它)。
两个数组的 glob 语义、默认清单与合成顺序单源在 [Sandbox · 变更归因](../sandbox/architecture.md#变更归因send-区间与分类账),那里把每一行写入落到哪本账上逐行标了出来。

`metadata` 只在 Experiment 谓词或 Reporter 确实消费某个结构化业务维度时使用。
能从 eval id、tags 或 description 推导出的值不重复写；没有消费者就省略，不能把它当任意杂物抽屉。

题目的机械准备只有两处:`sandbox` layer 的 `.prepare()` 命令与 `test(t)` 普通代码。
`prepare()` 每条 Attempt 都在 Agent 进场前执行,用来准备这次任务的素材(例如 `npm install` 起始项目的依赖);写入算 eval 归因,不进 agent diff。
命令取得沙箱外临时资源后用 `context.onCleanup()` 就地登记 cleanup(写法见[用例 · Fixture 与反馈](use-case/fixtures-lifecycle.md))。

收尾按全局准备顺序逆序：Agent teardown 之后，两层已登记 cleanup 逆序执行，复用周期关闭时 Provider Case finalizer 整组回收(时序单源见[三方准备时序](../sandbox/lifecycle.md#cleanup))。
准备时间线上的分工:template owner 的命令先执行,另一 owner 随后,Agent 安装(`agent.ensure`)收尾准备链,再进入 workspace baseline 与 Agent runtime setup(`agent.setup`)。需要恢复实际 Sandbox checkpoint 时，由 lifecycle `setup()` 在实例创建后完成。

文件传输不设 EvalInput field。
第一次 `send` 前需要 Agent 看见的文件直接通过 `t.sandbox.upload*()` 上传；测试文件在对应 `send` 返回后上传，再用普通命令和断言判分。

本地路径或 URL 进入普通上传 API 时，Runner 自动写入 transfer manifest。
文件身份、动态泄漏检查与携带规则见[本地测试文件](use-case/criteria-files.md)。

**禁止**提供 `id` / `name` —— 它们从文件路径推导:`evals/weather/brooklyn.eval.ts` → id `weather/brooklyn`。
改名即改 id,不会腐烂。

## 文件夹入口:一道题一个目录

发现器接受两种入口；同一 id 两种入口并存时启动期报重名，不按扫描顺序替换：

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
目录共址只解决组织问题，不把 environment 构建与运行期文件传输合并成一个哈希。

solution、生成器与参考答案不得进入任何 build context 或最终镜像。
它们若从未被 Eval 读取，就不需要为了 Runner 再声明一次；template 一侧的隔离规则见 [Sandbox 实例与伴随资源 · 动态泄漏检查](../sandbox/case.md#动态泄漏检查本地上传与-agent-可见-closure)。

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
    await t.require(await t.sandbox.pathExists("db-gpt/README.md"), isTrue("cloned"));
    t.sandbox.fileChanged("db-gpt/.env").points(1);   // 检查点通过挣 1 分
    t.score("代码精简", 15);                           // 自己算好条件后直接累加
  },
});
```

计分制只多出分数面：`.points(n)` 是得分点，`t.score(label, n)` 直接给分。
严重度与通过制完全相同：`.gate()` 是硬判定，`.atLeast(x)` 是带线 soft，`.soft()` 只写入。
需要停止依赖失败结果的后续代码时链 `.stopOnFailure()`；值断言可直接用两种题型共用的 `t.require()`。

题型是定义期事实，进 `EvalDescriptor.evaluationKind`(`"pass" | "points"`)供报告选择主读数。
一个 Experiment 可以同时选择两种题型；通过率与总分分别聚合，不互相相加。
计分语义的单源契约见[计分粒度](../assertions/library/score-points.md#计分制叠加给分没有上限声明)，完整写法见[计分制用例](use-case/rubric-points.md)。

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
- [Sandbox Layer](../sandbox/layers.md) —— `sandbox` 字段的类型、factory 与配对规则。
