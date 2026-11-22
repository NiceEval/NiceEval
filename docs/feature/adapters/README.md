# Agents 与 Adapters

Adapter 把一个被测对象接入 niceeval。
NiceEval 不要求被测对象实现统一协议。`defineAdapter` 提供原生方法；Agent Adapter 才把会话返回归一成 `Turn` 与 `StreamEvent[]`。

- **Adapter** 是 Experiment 选择的接入定义，知道怎样连接系统、调用原生接口和释放资源。
- **Agent** 是会话适配器，知道怎样发送输入、续接会话以及转换原始事件。
- **Direct Agent** 通过 `defineAgent` 连接应用或 SDK 服务。
- **Sandbox Agent** 通过 `defineSandboxAgent` 在 Sandbox 中运行 coding-agent CLI。

两类 Agent 使用相同的 `send(input, ctx) → Turn` 契约；普通 Adapter 不需要实现 `send`。
区别只在 Adapter 内部怎样驱动被测对象；core 不按 Agent 名称或供应商分支。

## 核心边界

1. **Experiment 选择 Adapter。**
   URL、鉴权、CLI 参数与原始协议属于 Adapter，不成为 niceeval 的通用 CLI 参数。
2. **Agent 与 Sandbox 正交。**
   Agent 决定测谁，Sandbox 决定 sandbox 型 Agent 在哪里运行；任意 sandbox Agent 可以与任意 Sandbox provider 组合。
3. **行为轨与时间轨协同。**
   Agent 会话中 `Turn.events` 是工具调用的行为依据；链路追踪提供统一树形 Span（llm、retriever、tool、chain），供瀑布图呈现与 `t.trace` 细粒度断言。
4. **能力由构造证明。**
   Adapter 实际返回的状态、事件、usage 与会话行为决定哪些 eval 判定可信，不使用一张声明式 capability 问卷。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 从零编写 Adapter | [编写 Adapter](library/writing-an-adapter.md) |
| 编写 Direct / Sandbox Adapter | [Direct](library/direct-agent.md) / [Sandbox](library/sandbox-agent.md) |
| 理解边界、数据流与采集纪律 | [架构](architecture/README.md) |
| 接入某个 SDK 或 coding agent | [SDK 与 Agent 索引](library/sdk/README.md) |
| 查看 import、调用与组合示例 | [Library](library/README.md) |
| 查看数据结构、状态机和不变量 | [Architecture](architecture/README.md) |
| 配置 coding-agent Skills / Plugins | [Coding Agent 扩展](library/coding-agent-extensions.md) |
| 理解 Agent 怎样被 探测 与安装 | [Agent Install](architecture/agent-install.md) |
| 查看外部协议与生态调研 | [Research](../../research/adapters/README.md) |
| 查看已经定稿、等待外部接口满足准入条件的接入目标 | [Roadmap](../../roadmap/README.md#adapter-准入目标) |

## 用户路径

- 接入被测对象：[用原生操作评估订单应用](use-case/native-operations.md)、[连接保留会话历史的服务](use-case/direct-conversation.md)、[在 Sandbox 中运行 coding-agent CLI](use-case/sandbox-cli.md)。
- 驱动交互：[回答审批并继续同一会话](use-case/resume-approval.md)。

按公开 API 选择篇目，见 [用户路径索引](use-case/README.md)。

## 目录索引

```text
adapters/
├── README.md          本入口：心智模型与全目录索引
├── library.md         用户怎样 import、调用和组合
├── architecture.md    数据结构、数据流、模块边界与不变量
├── library/           按用户任务拆分的调用指南
├── architecture/      按设计主题拆分的内部契约
├── sdk/               每个 SDK / coding agent 的专属用法与边界
└── reference/         外部协议与生态调研
```

## 相关阅读

- [Experiments](../experiments/README.md) —— Agent、model 与 flags 怎样进入一次运行。
- [Sandbox](../sandbox/README.md) —— sandbox provider 与生命周期。
- [Assertions](../assertions/README.md) —— 标准事件流之上的断言与 judge。
- [Observability](../../observability.md) —— 事件归一与 OTLP trace。

## 性质

### 协议归一 {#protocol-normalization}

观察公开 converter 的 Turn、事件、工具、HITL、coverage 和 usage。总是保存协议提供的证据并明确标出缺失通道。动作包括生成各协议的增量、并发工具、拒绝、错误、完成、用量和会话序列。

### 传输与审批 {#transport-and-approval}

观察公开身份、游标、进度、HITL 与终态。分帧与重连保持会话和游标，回复只交给对应请求。动作包括拆分帧、重开流、变换状态码、断连、超时及批准拒绝。

### 安装与隔离 {#install-isolation}

观察探测和安装效果、工作环境和失败诊断。命中时不安装，缺失时安装后复查，profile 之间隔离且断网题网络不变。动作包括切换预装状态、环境、网络与复查结果。

### 真实兼容性 {#live-compatibility}

观察官方 Adapter 的 Turn、会话、工具、计量、原生副作用和清理。各入口准确反映其协议所提供的能力。动作包括运行真实 CLI、SDK 或 HTTP 入口的有界回合，调用工具并续接会话。

### 原始投影与隐私 {#tool-projection-and-privacy}

观察工具分类、原始名称、诊断和命令证据。已知敏感值不出现在公开读面，原始名称仍可读。动作包括改变工具标签、凭据、额外变量，生成故障与输出。

### Coding CLI 兼容性 {#coding-cli-compatibility}

观察 Sandbox 内原生文件、工具调用、会话和公开 Turn。安装后执行的真实工具操作可核对原生副作用，续轮仍归原会话。动作包括 Claude Code、Codex、OpenCode、OpenClaw、Bub 和 Hermes 的安装、任务与续轮。

### SDK 与 HTTP 兼容性 {#sdk-and-http-compatibility}

观察 SDK 或 HTTP 原始事件与公开 Turn。公开转换器保留已观察到的文本、工具、终态与用量，不补造协议缺席的事实。动作包括用 Claude Agent SDK、Codex SDK 与 OpenAI 两个 API 发出真实请求，以及用 AI SDK 分别驱动进程内和 HTTP 入口。

### 安装扩展与会话 {#install-extensions-and-session}

观察安装 hook、真实 Agent 行为及回读会话。声明的插件和 Skill 在适用 Agent 中可观察，续轮仍能读取首轮证据。动作包括变换插件与 Skill 输入、执行 `before` hook、跨 Sandbox 复用并续轮。

### 展示块校验 {#display-block-validation}

观察 trace 写入结果与错误码。非法的展示块在写入时被拒绝并给出明确错误码，不写入部分数据，合法展示块原样可读。动作包括生成各种合法与非法的展示块形态。

### 用量计量 {#usage-accounting}

观察 `attempt.usage` 的缓存读取率、封存结果与诊断。缓存读取率按契约计算，缺失调用、零输入或越界样本给出不可用原因而不补零；非规范的封存 reason 在调用时立即拒绝。动作包括生成各类用量样本与封存参数。

### 用量与成本投影 {#usage-and-cost-projection}

观察作者侧用量快照与估算成本。Token 按独立总计或互斥桶聚合且不重复计入推理，缺失、部分或进行中记为下界，溢出或负值标为不可用；金额按高精度十进制归一求和，内建模型表按精确名、去前缀名与去日期名顺序匹配。动作包括组合各类覆盖率、多币种、价格覆盖与模型标识。
