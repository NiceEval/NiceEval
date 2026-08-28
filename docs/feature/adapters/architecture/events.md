# 标准事件模型

`Turn.events` 是断言的唯一行为数据源。
`Turn.data` 是独立的长期结构化输出域，值域固定为 `JsonValue`；动态 SDK/schema 值必须在 adapter 边界正规化，不能把 `unknown` 或原始响应对象挂进 Turn。
Adapter 将 SDK 事件、结构化响应或 transcript 归一成中性事件，core 再从中派生工具、subagent、HITL 和消息事实。

## 数据结构

```ts
type StreamEvent =
  | { type: "message"; role: "assistant"; text: string; loc?: SourceLoc }
  | { type: "message"; role: "user"; text: string; loc?: SourceLoc; sourceOrder?: number }
  | { type: "operation.started"; operationId: string; operation:
      | { kind: "tool"; name: string; input: JsonValue; tool?: ToolName }
      | { kind: "subagent"; name: string; remoteUrl?: string } }
  | { type: "operation.finished"; operationId: string; kind: "tool";
      output?: JsonValue; status: "completed" | "failed" | "rejected" }
  | { type: "operation.finished"; operationId: string; kind: "subagent";
      output?: JsonValue; status: "completed" | "failed" }
  | { type: "skill.loaded"; skill: string; operationId?: string }
  | { type: "input.requested"; request: InputRequest }
  | { type: "thinking"; text: string }
  | { type: "context.injected"; text: string; source?: string }
  | { type: "compaction"; reason?: string }
  | { type: "error"; message: string };
```

## 不变量

1. 保持原始发生顺序，不按事件类型重排。
2. tool 与 subagent 共用 `operation.started` / `operation.finished`，用稳定 operation ID 配对。
   ID 只需在**一次 started→finished 配对内**稳定,不要求跨轮唯一。
   同一个 ID 在 finished 后再次 started 是新操作,core 新建条目而非覆写。
3. tool operation 的 `name` 保留上游原始工具名；可选的 `tool` 保存跨 Agent 的闭集规范分类。
   进入规范化流程后仍无法识别时，`tool` 写 `unknown`；不承诺分类任意应用工具的协议也可以省略 `tool`。
   两种情况都不能丢掉或改写 `name`，读者始终能看到真实协议值。
   `operation.finished.kind` 必须与对应 started 的 `operation.kind` 相同。
4. 人工拒绝是 `rejected`，执行故障是 `failed`。
5. Skill 加载只产 `skill.loaded`，不重复计入工具调用。
6. 原始协议没有 usage 时省略，不编造数值。
7. **Adapter 不截断。
   ** 工具输出再大也原样交出来——断言跑在完整值上，落盘时才由写入面统一削到 256 KiB 并打 `truncated` 标记（见 [Record · 大值截断](../../run/architecture.md)）。
   Adapter 自己先削一刀会让断言看到不完整的输出，是 bug，不是保护。
8. **`loc` 只属于 eval 侧注入的 user message。
   **    `t.send` 由 core 留存、携带 send 语句的源码位置；adapter 从 SDK 事件或 transcript 归一出的任何消息都不携带 `loc`。
   消费方以「user message 是否带 `loc`」区分 eval 发出的 send 与被测系统内部注入的 user 消息（agent 自身的续跑提示、对输入的重新包装）——内部注入保留在流里如实呈现，但不是新的一轮。
9. **`sourceOrder` 只属于 eval 侧注入的 user message。** 它由 core 与断言、直接给分共用的
   attempt 级序列分配；历史事件可省略，当前 `t.send` 的输出必写。adapter 不生成也不改写它。
10. **`context.injected` 是被测系统内部注入的第二种形态：不披着 `message` 外衣的上下文文本。**
    - 不变量 8 的内部注入仍然是一条 `role:"user"` 的 `message`（只是没有 `loc`）。
    - 有些被测系统的注入根本不构成一条消息：例如 Claude Code 的 SessionStart / UserPromptSubmit hook 在下一轮开始前把额外文本前置进模型上下文。
      这段文本既不是 assistant 说的也不是 user 说的，硬套进 `message.role` 会污染按 role 或消息数做的断言。
    - `context.injected` 只承载**带实际文本内容**的注入。
    - 被测系统内部机制里"某个动作执行完毕"这类不携带上下文文本的信号（例如一次注入确认），不构成事件。
      它对行为断言没有信息量，和「系统元数据行不进事件流」是同一条原则的延伸，不是新例外。
    - `source` 是可选的原始出处标记（如 Claude Code 自己的 hook 名 `SessionStart`）。
      adapter 按各自协议原样透传供下钻，不强行归一到一组封闭枚举，不同被测系统的命名不必对齐。
    - **这与 niceeval 自己的 [prepare command](../../sandbox/layers.md#command-形状与-identity)是完全不同的两层机制。**
      后者是作者声明、运行器编排的沙箱准备命令；前者是被测 CLI 自己的内部生命周期设施，`context.injected` 只归一后者。

## InputRequest

```ts
interface InputRequest {
  readonly id?: string;
  readonly prompt?: string;
  readonly display?: string;
  readonly action?: string;
  readonly input?: JsonValue;
  readonly options?: readonly { id: string; label?: string }[];
}
```

一个原生问题只产一条请求事件。
字段应足以让 eval 按 ID、文本、动作、参数和选项进行匹配。

## 派生事实

`deriveRunFacts(events)` 统一折叠工具调用、subagent 调用、待输入请求、parked、消息数、压缩次数与 `context.injected` 次数（`contextInjections`）。
Adapter 不预计算断言结果。

折叠后的 `ToolCall.name` 是规范分类，`ToolCall.originalName` 继续保存事件里的原始 `operation.name`；Inspection 的 conversation
同样分别交付原始 `name` 与可选 `tool`。因此 `unknown` 只表示分类结果，不会让上游名称从 Record 或公开读回中消失。

折叠按 `operationId` 把 started 与 finished 对成一条操作：配上 finished 的取其状态；只有 started、尚未等到 finished 的操作状态是 **`pending`**——HITL 停在审批上的工具调用就以这个状态被断言，不是容错分支。
只有 finished、没配上 started 才属于 core 容错，不是正常映射契约。

`context.injected` 不获得专属的 `Turn` 便利字段（不像 `message` 有 `Turn.message`）。
它和 `thinking`、`compaction` 同一档次，通过 `Turn.events` / 跨轮 `events` 数组按 `type` 过滤读取。
`contextInjections` 计数只回答「这一轮有没有发生过注入」这种存在性问题，不替代逐条读取原文用 `text`。

## 工具材料的省略语义

core 用相同 `operationId` 把 started 与 finished 归成一个 `LogicalToolOccurrence`。Adapter 必须保留能确认的原始名称、输入、输出与状态；不能确认的部分不补造。

输入和输出材料在 occurrence 上标为 `complete`、`partial` 或 `unavailable`。`partial` 保留可见片段与缺失边界，`unavailable` 保留具名原因。finished 没有输出时不是空 JSON，也不能据此判成输出不匹配。

HITL 停在审批时只有 started。该 occurrence 的状态是 `pending`，输出是 unavailable。`ToolMatch` 的具体比较与计数规则见 [Scoped assertions](../../assertions/library/scoped-assertions.md)。
