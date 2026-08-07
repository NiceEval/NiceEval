# Agents 与 Adapters

Adapter 把一个被测对象接入 niceeval。
niceeval 不要求被测对象实现统一协议；每个 Adapter 负责驱动自己的对象，并把原始返回归一成统一的 `Turn` 与 `StreamEvent[]`。

- **Agent** 是 experiment 引用的被测对象。
- **Adapter** 是 Agent 的实现，知道怎样发送输入、续接会话以及转换原始事件。
- **Direct Agent** 通过 `defineAgent` 连接应用或 SDK 服务。
- **Sandbox Agent** 通过 `defineSandboxAgent` 在 Sandbox 中运行 coding-agent CLI。

两类 Agent 使用相同的 `send(input, ctx) → Turn` 契约。
区别只在 Adapter 内部怎样驱动被测对象；core 不按 Agent 名称或供应商分支。

## 核心边界

1. **Experiment 选择 Agent。**
   URL、鉴权、CLI 参数与原始协议属于 Adapter，不成为 niceeval 的通用 CLI 参数。
2. **Agent 与 Sandbox 正交。**
   Agent 决定测谁，Sandbox 决定 sandbox 型 Agent 在哪里运行；任意 sandbox Agent 可以与任意 Sandbox provider 组合。
3. **行为轨与时间轨分离。**
   `Turn.events` 是断言的唯一行为依据；OTel span 只进入 trace 瀑布图，不生成事件，也不参与断言。
4. **能力由构造证明。**
   Adapter 实际返回的状态、事件、usage 与会话行为决定哪些 eval 结论可信，不使用一张声明式 capability 问卷。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 从零编写 Adapter | [编写 Adapter](library/writing-an-adapter.md) |
| 编写 Direct / Sandbox Adapter | [Direct](library/direct-agent.md) / [Sandbox](library/sandbox-agent.md) |
| 理解边界、数据流与采集纪律 | [架构](architecture.md) |
| 接入某个 SDK 或 coding agent | [SDK 与 Agent 索引](sdk/README.md) |
| 查看 import、调用与组合示例 | [Library](library.md) |
| 查看数据结构、状态机和不变量 | [Architecture](architecture.md) |
| 配置 coding-agent Skills / Plugins | [Coding Agent 扩展](library/coding-agent-extensions.md) |
| 理解 Agent 怎样被 探测 与安装 | [Agent Ensure](architecture/agent-ensure.md) |
| 查看外部协议与生态调研 | [Reference](reference/README.md) |
| 查看已经定稿、等待外部接口满足准入条件的接入目标 | [Roadmap](../../roadmap/adapters/README.md) |

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
