# 执行轨迹的应用展示 · plan-2：读取时 formatter

## Problem

一次 Attempt 的执行轨迹要让人读懂：Agent 说了什么、调了哪些工具、跑了哪些命令；游戏里 NPC 说了什么；HTTP 应用发出了哪些请求；生图应用画出了什么。
这些内容来自不同 Adapter，却要在同一个 `show --execution` 与 View 中呈现。

## Core Mental Model

Record 只保存领域事实；人读展示由 Adapter 的 formatter 在每次读取时计算。

一次 Attempt 的 execution 由若干 source family 组成，每个 family 有自己的人读形式：

| section | source family | 写入者 | 人读形式 |
|---|---|---|---|
| Events | `niceeval.execution-traces` | 调用 `ctx.recordTrace()` 的 Adapter | 每个事件的 envelope 与 formatter 输出；没有该 family 时由 Conversation item 投影 |
| Conversation | `niceeval.agent-turns` 与 `niceeval.turn-contexts` | 写出 Turn 的 Adapter 与 SessionManager | 消息、thinking summary、tool call 与 result 配对、source 完整度 |
| Commands | `niceeval.sandbox-commands` | Sandbox command lifecycle | 命令、exit、duration、stdout / stderr |
| Diagnostics | `niceeval.runner-diagnostics` | Runner diagnostic sink | advisory 与 execution error |

四个 section 按上表顺序并列，各有独立预算。
Renderer 按 source family 选择 section，不按 Adapter 名分支。

Adapter 定义时声明 `display`：一张从事件 `type` 到 formatter 函数的表。formatter 接收封存的事件，返回一组展示块。
展示块使用 NiceEval 定义的封闭词汇：

| kind | 用途 | 例子 |
|---|---|---|
| `text` | 一段话 | 游戏旁白、状态说明 |
| `message` | 某个说话者的一段话 | NPC 台词、聊天回复 |
| `fields` | 少量键值 | HTTP method / path / status / latency |
| `code` | 等宽文本 | SQL、日志片段 |
| `image` | 引用同 Attempt 的图片附件 | 生图结果、截图 |

`show --execution`、View 与 `query` 读取 Attempt 时，Host 求值当前项目，按 Attempt 的 Adapter identity 找到 Adapter 定义。
随后对 Events section 的每个事件执行一次 formatter。formatter 的输出不写入 Record。

```text
defineAdapter({ name, create, display: { "npc.said": e => [...] } })

Record
  ├─ niceeval.execution-traces（payload）   → Events section
  ├─ niceeval.agent-turns / turn-contexts   → Conversation section
  ├─ niceeval.sandbox-commands              → Commands section
  └─ niceeval.runner-diagnostics            → Diagnostics section

读取（固定 cutoff）
  └─ 求值项目 → 定位 Adapter → 对每个事件执行 formatter（同步、有时限）
       ├─ 成功：展示块
       └─ 项目缺失 / Adapter 缺失 / formatter 失败：envelope + summary + JSON
```

## Scope

- 本方案定义 `defineAdapter` 的 `display` 选项、读取时的项目求值流程、`attempt.trace` 的 Events 结果，以及 `show --execution` 与 View 的呈现。
- Record 持久形状只包含领域事实，`recordTrace` 输入只有 payload 与 envelope。
- 展示块只供人读，不进入 Verdict、Assertion、Judge、usage、diff、timing 或任何 identity。
- 取舍：展示跟随当前源码。Adapter 改进 formatter 后，所有已封存 Attempt 立即以新形式显示，包括本方案之前写入的事件；源码不在时只能看到 envelope、summary 与 JSON。
- 本方案与 [CLI Insight 裁决](../../../cli-insight/DECISION.md)中“不恢复 renderer 作者面”相冲突，采用它需要对该裁决翻案。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不恢复-renderer-作者面) | not-satisfied | formatter 是读取时执行的作者代码，属于 renderer 作者面；输出词汇封闭不改变这一点 | [Architecture · 数据流](architecture.md#数据流) |
| [L2](../../LIMITS.md#l2-历史-operation-不依赖项目) | not-satisfied | 展示依赖项目源码与可加载的 Adapter；项目缺失时读取仍成功，降级为 envelope、summary 与 JSON | [Architecture · 生命周期与错误](architecture.md#生命周期与错误) |
| [L3](../../LIMITS.md#l3-recordtrace-的现有契约) | satisfied | `recordTrace` 只接收 envelope 与 payload，规则与预算由该契约定义 | [Library · 调用形状](library.md#调用形状) |
| [L4](../../LIMITS.md#l4-record-内容边界) | satisfied | Record 只含领域事实；formatter 能读取全部 payload 并重新组合 | [Architecture · 不变量](architecture.md#不变量) |
| [L5](../../LIMITS.md#l5-文案语言边界) | satisfied | 展示文本由作者代码生成，原文显示 | [CLI · 输出](cli.md#输出) |
| [L6](../../LIMITS.md#l6-view-不提供作者组件层) | satisfied | View 只认 NiceEval 定义的 `kind`，不提供组件、主题或路由接口；执行作者代码的问题归 L1 | [Architecture · 数据流](architecture.md#数据流) |
| [L7](../../LIMITS.md#l7-agent-专用投影) | pending | 四个 section 独立预算，Conversation 投影保留 Events 分页，不经过 formatter。需按 C8 与大 outline 回归验证 | [Architecture · Section](architecture.md#section) |
| [L8](../../LIMITS.md#l8-版本兼容) | satisfied | Record 格式没有新字段；任何已封存 payload 都可读取，并可交给当前 formatter | [Architecture · 身份与复用](architecture.md#身份与复用) |
| [L9](../../LIMITS.md#l9-附件) | satisfied | `image` 块引用 payload 给出的 artifactId，读取时校验 | [Library · formatter](library.md#formatter) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-应用事件可读) | partial | 项目可加载时 C1–C3 与 C9 可读；项目缺失时只显示 summary 与 JSON | [CLI · 输出](cli.md#输出) |
| [G2](../../GOALS.md#g2-agent-体验不退化且按-source-中立) | pending | 设计保留 C8 断言依赖的标题、每行一个 identity 与 expand；section 按 source family 选择。运行时退化需回归验证 | [Architecture · Section](architecture.md#section) |
| [G3](../../GOALS.md#g3-历史确定可读) | not-satisfied | 展示随源码变化；源码缺失时 C4 失败 | [Architecture · 生命周期与错误](architecture.md#生命周期与错误) |
| [G4](../../GOALS.md#g4-cli-与-web-同源) | satisfied | Inspection 在同一 Host 调用 formatter 并生成同一 result，`query`、`show` 与 View 只呈现 | [CLI · 机器输出](cli.md#机器输出) |
| [G5](../../GOALS.md#g5-读取侧安全) | not-satisfied | 读取 Record 会执行项目代码；打开他人 Snapshot 时同样执行当前目录的代码 | [Architecture · 不变量](architecture.md#不变量) |
| [G6](../../GOALS.md#g6-有界) | not-satisfied | 输出有块数与字节上限；同步 formatter 无法被普通计时器中断，隔离与总请求预算未定义 | [Library · 限制与错误](library.md#限制与错误) |
| [G7](../../GOALS.md#g7-无展示的事件照常可读) | not-satisfied | 无 formatter 时照常可读；但有 formatter 时，本决策之前写入的事件也会生成展示，与 C6“不生成展示”冲突 | [CLI · 输出](cli.md#输出) |

## Entry Points

- [Library](library.md)
- [CLI](cli.md)
- [Architecture](architecture.md)
