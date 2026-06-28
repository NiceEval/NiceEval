# Roadmap —— 路线图与 MVP

这一篇把前面的设计落成一个有先后的实现计划。原则:**先打通一条最薄的端到端竖切(tracer bullet),再往两侧加宽。** 不要先把三层适配器都铺满才第一次跑通。

## 设计不变量(任何阶段都不破)

无论做到哪一步,这几条是承重墙,见 [Vision](vision.md):

1. 核心永不按 agent / sandbox 名字做**行为**分支 —— 只按能力分发。
2. `defineEval`(会话型)与 `defineAgentEval`/fixture(沙箱型)共享同一套 Scorer / Verdict / Runner / Reporter。
3. 路径即身份;禁止手写 id。
4. 接新 agent = 一个 `Adapter` + 一个 transcript 解析器,核心零改动。
5. 接新 sandbox = 一个 `Sandbox` 实现,核心零改动。

## 阶段划分

### M0 —— 竖切:进程内函数 eval(最薄能跑)

目标:`npx fastevals` 能发现并跑一个进程内 agent 的会话型 eval,出控制台结果与 `summary.json`。

- `defineEval` + `defineConfig` + 路径推导 id + 数组扇出。
- `defineAgent`(进程内)+ `agents` 注册 + `defaultAgent`;`t.send` / `t.reply` / `t.check`。
- `expect`:`includes` / `equals` / `matches` / `satisfies`。
- 作用域断言最小集:`succeeded` / `messageIncludes`。
- `verdict.ts` 判决;有界并发 runner;`Console` reporter;工件落盘。
- CLI:默认运行、id 前缀过滤、`--list`、`--json`。

这一步**不碰沙箱、不碰外部 agent**。打通的是"发现 → 驱动 → 评分 → 判决 → 报告"这条主轴,后面所有东西都挂在它上。

### M1 —— 评分纵深

- `t.require`;`similarity`;`satisfies`。
- 工具观测:`calledTool` / `notCalledTool` / `toolOrder` / `usedNoTools` / `maxToolCalls`,配工具匹配小语言。
- LLM-as-judge:`closedQA` / `factuality` / `summarizes` / `score`,三级模型解析。
- gate/soft 链式改写;`--strict`。
- `JUnit` reporter;`--junit`、`--tag`、`--timeout`。

到这里,会话型评测(评你自己的函数 / 评 http 服务)已经完整可用。

### M2 —— 远程 agent

- 远程 `defineAgent`:用户在 `send` 里按**自己服务的协议**发请求、收响应(fastevals 不定协议;URL 等是 agent 私事)。
- `--agent` 覆盖默认连接;"同一批 eval 换着对象跑"成立。

### M3 —— 竖切:沙箱里的 coding agent(第二条主轴)

目标:`fastevals --agent claude-code --sandbox docker fixtures/x` 端到端跑通一个 fixture。

- `Sandbox` 接口 + **Docker 后端**(默认,零云依赖)。
- `Adapter` 接口 + **`claude-code` adapter**(先做直连 API 一个变体)。
- `adapters/shared.ts`:上传 / git 基线 / `collectGeneratedFiles` / `runValidation`(Vitest)。
- Fixture 发现(含 `PROMPT.md` 的目录);`splitTestFiles` 防作弊。
- transcript 归一化框架 + `o11y/parsers/claude-code.ts` + o11y 派生 + 注入 `__fastevals__/results.json`。
- 沙箱型作用域断言:`fileChanged` / `testsPassed` / `scriptPassed`。
- 工件:`events.ndjson`(标准事件流)/ `transcript-raw.jsonl` / `outputs/` / `project/`。

这是把第二种范式接进同一套下游 —— 复用 M0/M1 的 Scorer/Verdict/Runner/Reporter,只新增"如何产生结果"。

### M4 —— agent 评测的工程化

- 实验层:`defineExperiment` + `fastevals exp`,`agent × model × eval × runs` 矩阵展开。
- `--runs` 通过率 + `earlyExit` + 可疑快速失败重试。
- 指纹缓存(`--force`)。
- [生命周期钩子](lifecycle.md):`hooks.run` / `hooks.sandbox` 各 `setup` / `teardown`(`teardown` 必在 finally 跑);下游分析走 reporter,不设 `onRunComplete` 实验钩子(对照 [Experiments 砍字段](experiments.md))。
- 双层超时。
- `defineAgentEval` 程序化写法(fixture 的代码等价物)。
- **用量与成本**:`Turn.usage` 累加 + transcript 解析器抠 token + 价格表换算 `estimatedCostUSD`;`t.maxTokens()` / `t.maxCost()` 断言;`--budget` 预算护栏;报告里出每 eval / 整轮的 tokens + $,跨 agent 对比「质量 × 成本」。

### M5 —— 加宽适配器

- 更多 adapter:`bub`、`codex`,以及网关变体;各配 transcript 解析器。
- **Vercel Sandbox** 后端;`--sandbox` 显式选择 + `auto` 探测。
- 三方 sandbox 插件机制(`createSandbox` 的 default 分支)。
- AI 失败分类(model / infra / timeout)。
- 沙箱预热池 / 复用。

### M6 —— 生态与打磨

- 第三方实验跟踪 reporter(Braintrust 等),跨提交比较。
- `--watch`;本地查看器 `fastevals view`(读 `.fastevals/` 工件出图:质量×成本散点、跨 agent 对比、跨运行趋势、transcript 钻取)。
- 数据集 loader(`loadYaml` / `loadJson`)、`mockModel`。
- source-map 文档:把每条文档行为映射回实现文件(仿 crabbox)。

## 优先级理由

- **两条竖切(M0、M3)先于任何加宽。** 先证明"主轴成立",再让 adapter/sandbox/scorer 各自变多。避免先建一堆抽象却没跑通过一次。
- **Docker 先于云。** 默认零依赖能本地跑,是采用门槛最低的路径;云后端是并发扩展,不是首发必需。
- **claude-code 先于其它 agent。** 一个 adapter 跑通,接口才算被验证;之后接 bub/codex 是复制范式。
- **会话型先于沙箱型。** 会话型不需要沙箱,反馈最快,且它定义了所有下游(Scorer/Verdict/Runner/Reporter),沙箱型只是再接一种 Agent。

## 开放问题(实现前需定)

- 远程 agent 要不要提供一个**可选**的协议助手(对齐某个既有 agent 协议如 OpenAI messages),还是完全交给用户在 `send` 里自理?
- 会话型 `t.send` 的传输:进程内直调 vs 统一走一个内部消息总线(后者让 fn/http 同构,代价是开销)。
- 沙箱复用的默认值:默认全新(干净)还是默认复用(快)?倾向默认全新、显式开复用。
- judge 模型与被测 agent 的 key 共用还是强制分离配置?倾向分离,避免混淆账单与自评。
- monorepo 还是单包?倾向单包起步(`fastevals`),adapter/sandbox 作为子路径导出,三方后端用可选 peer 依赖。

## 相关阅读

- [Vision](vision.md) —— 不变量的由来。
- [Architecture](architecture.md) —— 各模块在树里的位置。
- [README](README.md) —— 全局导航。
