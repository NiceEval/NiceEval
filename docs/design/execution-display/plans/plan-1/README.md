# 执行轨迹的应用展示 · plan-1：写入时展示

## Problem

一次 Attempt 的执行轨迹要让人读懂：Agent 说了什么、调了哪些工具、跑了哪些命令；游戏里 NPC 说了什么；HTTP 应用发出了哪些请求；生图应用画出了什么。
这些内容来自不同 Adapter，却要在同一个 `show --execution` 与 View 中呈现，并且在没有项目源码的机器上照样可读。

## Core Mental Model

人读展示是观测事实的一部分，由 Adapter 在写入时决定。

一次 Attempt 的 execution 由若干 source family 组成，每个 family 有自己的人读形式：

| section | source family | 写入者 | 人读形式 |
|---|---|---|---|
| Events | `niceeval.execution-traces` | 调用 `ctx.recordTrace()` 的 Adapter | 每个事件的 envelope 与展示块；没有该 family 时由 Conversation item 投影 |
| Conversation | `niceeval.agent-turns` 与 `niceeval.turn-contexts` | 写出 Turn 的 Adapter 与 SessionManager | 消息、thinking summary、tool call 与 result 配对、source 完整度 |
| Commands | `niceeval.sandbox-commands` | Sandbox command lifecycle | 命令、exit、duration、stdout / stderr |
| Diagnostics | `niceeval.runner-diagnostics` | Runner diagnostic sink | advisory 与 execution error |

Renderer 按 source family 选择 section，不按 Adapter 名分支。
任何 Adapter 写出 Turn 就得到 Conversation section；任何 Adapter 调用 `recordTrace` 就得到 Events section。

Events section 的人读形式是 **展示块**（display blocks）。Adapter 在 `recordTrace` 时为每个事件附加一组展示块，它们与事件一起封存。
展示块使用 NiceEval 定义的封闭词汇：

| kind | 用途 | 例子 |
|---|---|---|
| `text` | 一段话 | 游戏旁白、状态说明 |
| `message` | 某个说话者的一段话 | NPC 台词、聊天回复 |
| `fields` | 少量键值 | HTTP method / path / status / latency |
| `code` | 等宽文本 | SQL、日志片段 |
| `image` | 引用同 Attempt 的图片附件 | 生图结果、截图 |

Conversation 与 Commands section 承载展示块表达不了的语义：

- call 与 result 配对、source 完整度与跨 Turn 顺序；
- stdout / stderr 的保留字节与权威总量；
- `itemId`、`toolOccurrenceId`、`commandId` 稳定 selector。

四个 section 按上表顺序并列，各有独立预算；每个 section 都显示自己的状态，没有事实时为 `not-recorded`。

```text
Adapter.create(ctx)
  ├─ Turn                → niceeval.agent-turns
  └─ ctx.recordTrace({ events: [{ type, summary, payload, display }] })
                         → niceeval.execution-traces（展示块随事件封存）
Sandbox command          → niceeval.sandbox-commands
Runner diagnostic        → niceeval.runner-diagnostics

Inspection attempt.trace（固定 cutoff）
  ├─ Events section：envelope + 展示块有界预览
  ├─ Conversation section
  ├─ Commands section
  └─ Diagnostics section
show / View：按 section 与 kind 呈现
```

## Scope

- 本方案定义 `recordTrace` 事件的 `display` 字段、`niceeval.execution-traces` revision 1 中 `display` 的持久形状、`attempt.trace` 的 section 结果，以及 `show --execution` 与 View 的呈现。
- 展示块只供人读，不进入 Verdict、Assertion、Judge、usage、diff、timing 或执行资格身份；它属于内容完整性身份。
- 展示词汇由 NiceEval 定义。作者不提供 Markdown、HTML、颜色、布局、主题或组件；新的 `kind` 是 NiceEval 版本变化。
- 取舍：展示在写入那一刻定型。Adapter 改进展示后，只有之后的 Attempt 获得新展示，已封存的 Attempt 保持封存时的展示。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-不恢复-renderer-作者面) | satisfied | 读取侧只有 NiceEval 的 renderer；作者交付数据，不交付代码；展示形状是穷尽 `kind` union | [Architecture · 不变量](architecture.md#不变量) |
| [L2](../../LIMITS.md#l2-历史-operation-不依赖项目) | satisfied | 展示块随事件封存，读取不加载项目或 Adapter | [Architecture · 数据流](architecture.md#数据流) |
| [L3](../../LIMITS.md#l3-recordtrace-的现有契约) | satisfied | 展示块计入每 Attempt 64 MiB 预算与每事件 8 KiB；非法展示拒绝整份快照；参与幂等比较；图片读取共享 `attempt.artifact` 预算 | [Library · 限制与错误](library.md#限制与错误) |
| [L4](../../LIMITS.md#l4-record-内容边界) | satisfied | 展示块与 payload 同样只能放已脱敏、可公开的内容 | [Library · 限制与错误](library.md#限制与错误) |
| [L5](../../LIMITS.md#l5-文案语言边界) | satisfied | 展示文本与 `fields` label 是 Adapter 写入的数据，原文显示，不翻译 | [CLI](cli.md) |
| [L6](../../LIMITS.md#l6-view-不提供作者组件层) | satisfied | View 只认 NiceEval 定义的 `kind`，不加载组件 | [Architecture · 不变量](architecture.md#不变量) |
| [L7](../../LIMITS.md#l7-agent-专用投影) | satisfied | 四个 section 独立预算与状态；Conversation 投影保留 Events 分页；identity 每行一个；五种稳定 ID 均可展开。运行时验收见 G2 | [Architecture · Section](architecture.md#section)、[CLI · outline](cli.md#outline) |
| [L8](../../LIMITS.md#l8-版本兼容) | satisfied | `display` 是 revision 1 的可选字段；既有事件读取为 `display: absent`，历史 Record 不需要迁移 | [Architecture · 身份与复用](architecture.md#身份与复用) |
| [L9](../../LIMITS.md#l9-附件) | satisfied | `image` 固定附件 descriptor 与 sha256；不符时返回 `inspection-record-integrity-failure`；bytes 经 `attempt.artifact` 读取 | [Library · 展示块](library.md#展示块) |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-应用事件可读) | satisfied | `message`、`fields`、`image` 分别兑现 C1、C2、C3；图片展开给出 `attempt.artifact` 读取命令；`text` 加 `code` 兑现 C9，展开后命令完整可复制 | [CLI](cli.md)、[Library](library.md) |
| [G2](../../GOALS.md#g2-agent-体验不退化且按-source-中立) | pending | 设计保留 C8 断言依赖的标题、每行一个 identity 与 expand；section 按 source family 选择。运行时退化需回归验证 | [Architecture · Section](architecture.md#section) |
| [G3](../../GOALS.md#g3-历史确定可读) | satisfied | 展示是封存事实；同版本 renderer 对同一 Record 输出相同 | [Architecture · 不变量](architecture.md#不变量) |
| [G4](../../GOALS.md#g4-cli-与-web-同源) | satisfied | 展示块由 Inspection result 交付，consumer 只呈现 | [Architecture · 数据流](architecture.md#数据流) |
| [G5](../../GOALS.md#g5-读取侧安全) | satisfied | 写入拒绝控制字符；终端按码点处理 Events 全部人读字符串；View 只以文本节点插入，图片只用已验证附件 bytes | [Library · 限制与错误](library.md#限制与错误)、[CLI · 安全呈现](cli.md#安全呈现) |
| [G6](../../GOALS.md#g6-有界) | satisfied | 每事件 4 块、8 KiB；文本与 `fields` 字符串预览 1 KiB 并给出省略字节数；Events 页按序列化投影计 64 KiB，且每页至少一个事件 | [Library · 限制与错误](library.md#限制与错误) |
| [G7](../../GOALS.md#g7-无展示的事件照常可读) | satisfied | `display` 可选；缺席时以 envelope 与 summary 呈现 | [CLI · 没有展示块的事件](cli.md#没有展示块的事件) |

## Entry Points

- [Library](library.md)
- [CLI](cli.md)
- [Architecture](architecture.md)
