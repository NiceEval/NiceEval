# Vision

fastevals 应该让人感觉是**一个评测工具**,而不是"一堆按被测对象形状各写一遍的脚本"。无论你评的是进程内的一个函数、一个远程 HTTP agent,还是一个塞进 Docker 里跑编码任务的 Claude Code,写法和读法都应该是同一套。

为了在差异巨大的被测对象之间维持这种一致体验,代码库守一条规则:

> **核心(core)拥有通用的"评测控制面";"连到哪个 AI"由 `Agent`(自实现的 `Adapter`)拥有,"在哪里跑"由 `Sandbox` 拥有。**

这条规则是从 crabbox(一个面向 ~27 个云 provider 的远程执行层)学来的同一种纪律:核心永远不按名字分支,它对着能力(capability)分发。

## 三种"快"

fastevals 这个名字是一份承诺。把它拆开,就是三条要落到设计上的约束。

### 写得快

写一个 eval 的成本必须趋近于"写一句断言"。为此:

- **路径即身份。** `evals/weather/brooklyn.eval.ts` 的 id 自动是 `weather/brooklyn`,禁止手写 id/name。改名即改路径,不会有"id 和文件名对不上"的腐烂。
- **一文件一 eval,数组即扇出。** 默认导出一个 eval;默认导出一个数组就扇出成 `weather/0000`、`weather/0001`…… 数据集就是 `rows.map(row => defineEval(...))`。
- **线性书写,就地断言。** `async test(t)` 里顺着写 `t.send` / `t.check`,把中间结果赋给局部变量再断言。没有回调金字塔。
- **gate 与 soft 两档。** 硬性要求用 gate(不过即 fail),带阈值的质量分用 soft(只在 `--strict` 下才 fail)。作者不必为"这条算不算致命"反复纠结。

### 跑得快

评测天然是 I/O 密集且昂贵(每个 case 可能是一次 LLM 调用、一次沙箱启动、一次完整测试套件)。运行器必须把这份昂贵摊薄:

- **有界并发。** 可配置的最大并发,池满则等任一完成再补位。
- **指纹缓存。** 用 `(fixture 内容 + 配置)` 的指纹标识一次运行;已通过且指纹未变的,默认跳过。重跑只重算改动过的。
- **沙箱复用与预热。** 沙箱启动是大头;支持预热池、跨 case 复用,把冷启动从关键路径上挪走。
- **早停(earlyExit)。** 一个任务跑 N 次取通过率时,一旦先过了一次,就中止该任务剩余的重试(可关)。

### 看得快

评测的产出不只是"过/挂",而是"为什么"。失败必须能被快速归因:

- **流式控制台。** 每个 case 完成即出一行,失败的断言内联展开,不用等全部跑完。
- **结构化工件。** 事件流、transcript、文件 diff、断言结果都落盘成机器可读格式,可回放、可二次分析。
- **统一 trace。** 不同 agent 的原始 transcript 被归一化成同一套事件模型(工具调用、文件读写、shell 命令、思考块),"agent 到底干了什么"一眼可见。详见 [Observability](observability.md)。

## 两个正交概念,一条承重墙

被测对象的差异被收进两个互相正交的轴。理解它们的边界,就理解了整个库。

### `Agent` —— 连到哪个 AI(以及谁来定协议)

`Agent` 回答"我把任务发给谁、怎么收结果"。这里有一个**关键的、区别于 eve 的前提**:

> **fastevals 不定义任何 agent 协议。** 每一条连到 AI 的连接 —— 你自己的 agent、你的后端服务、Claude Code / Codex —— 都是自己实现的 **Adapter**。你按名字选一个 agent(`--agent <name>`),而不是给一个 url。

eve 能用一个 url 当 target,是因为它定义了一套协议、被测 agent 恰好会说。fastevals 没有这个假设,所以**没有 `--url`、没有通用的 http target**:连你自己的服务也是你写一个 agent,URL 是它的内部配置。

- **Agent** 是抽象(fastevals 眼里"一条连到 AI 的连接"),带能力位。
- **Adapter** 是它的实现,由用户编写;按 transport 分三类:进程内(调你的函数)、远程(按你服务的协议)、沙箱(在 `Sandbox` 里 spawn coding agent 的 CLI)。

核心通过 agent 的能力位决定 `t` 暴露哪些动作:会话型暴露 `t.send` / `t.calledTool`;沙箱型额外暴露 `t.sandbox` / `t.diff` / `t.transcript`。接一个新 agent(无论是你的 agent 还是 bub)= 实现一个 Adapter,**不动核心一行**。详见 [Agents 与 Adapters](agents-and-adapters.md)。

### `Sandbox` —— 沙箱型 agent 在哪里跑

一个 `Sandbox` 把"隔离环境"的全部特殊性关进一个盒子:跑命令、读写文件、上传/下载、设工作目录、起停。Docker 是一个实现,Vercel Sandbox 是一个实现,其它三方各是一个实现。后端按环境自动选择(有云 token 用云,否则用 Docker),也可显式指定。它与 Agent 正交:任意沙箱型 agent × 任意 sandbox 后端自由组合。详见 [Sandbox](sandbox.md)。

## 边界画在"行为"上

哪些地方允许出现 agent 名字 / sandbox 名字?**路由可以,行为不行。**

- **允许:** 配置 schema、CLI 标志、注册表、`--agent claude-code` 这种选择。这是路由,路由是核心的活。
- **不允许:** 一旦代码要决定"CLI 参数怎么拼""transcript 在哪""命令怎么在容器里多路复用",这个决定就属于对应的 Adapter / Sandbox,**绝不**以 `if (name === ...)` 的形式穿过运行器、评分、报告这些核心路径。

健康的形状是这样:

- **核心** 发现 eval、收集断言、计算判决、调度并发、做缓存、写报告与工件。它对每个被测对象一视同仁。
- **Agent(Adapter) / Sandbox** 各自解决自己那一层的特殊性,通过接口把能力交还核心。

当一个修复看起来"需要在核心里加一个 agent-specific 分支"时,先去对应适配器加或复用一个 hook。一个中性的小 hook,几乎总比把 `name == ...` 的分支线穿过核心要干净。

## 与参考项目的关系

- **eve evals** 给了我们 DX 形状:`defineEval`、路径即身份、gate/soft 断言、LLM-as-judge、reporter 插件、有界并发运行器。fastevals 的会话型 eval 基本是这套模型的再实现。
- **Vercel agent-eval** 给了我们 agent 评测的工程形状:`Adapter` 接口、`Sandbox` 抽象与多后端、fixture(PROMPT + EVAL 测试)、transcript 归一化与注入、失败分类、指纹缓存。
- **crabbox** 给了我们这条"核心 vs 适配器"的纪律,以及"文档是用户面真相、source-map 把行为映射回代码"的文档观。

fastevals 的新意不在任何单一机制,而在于**把这两种本来分裂的评测范式(会话型 / 沙箱型)收敛进同一套 `defineEval` + 评分器 + 运行器 + 报告器**,让"评我自己的函数"和"评一个塞进容器的 Claude Code"读起来是同一种东西。

## 相关阅读

- [Architecture](architecture.md) —— 模块分层与数据流。
- [Concepts](concepts.md) —— 术语表。
- [Agents 与 Adapters](agents-and-adapters.md)、[Sandbox](sandbox.md) —— 连接与沙箱契约。
- [Roadmap](roadmap.md) —— 先做什么、后做什么。
