# 标准事件模型

`Turn.events` 是断言的唯一行为数据源。Adapter 将 SDK 事件、结构化响应或 transcript 归一成中性事件，core 再从中派生工具、subagent、HITL 和消息事实。

## 数据结构

```ts
type StreamEvent =
  | { type: "message"; role: "assistant" | "user"; text: string; loc?: SourceLoc }
  | { type: "action.called"; callId: string; name: string; input: JsonValue; tool?: ToolName }
  | { type: "action.result"; callId: string; output?: JsonValue;
      status: "completed" | "failed" | "rejected" }
  | { type: "skill.loaded"; skill: string; callId?: string }
  | { type: "subagent.called"; callId: string; name: string; remoteUrl?: string }
  | { type: "subagent.completed"; callId: string; output?: JsonValue;
      status: "completed" | "failed" }
  | { type: "input.requested"; request: InputRequest }
  | { type: "thinking"; text: string }
  | { type: "context.injected"; text: string; source?: string }
  | { type: "compaction"; reason?: string }
  | { type: "error"; message: string };
```

## 不变量

1. 保持原始发生顺序，不按事件类型重排。
2. action called/result 与 subagent called/completed 使用稳定 call ID 配对。call ID 只需在**一个 called→result 配对内**稳定,不要求跨轮唯一——adapter 按各轮各自编号(OpenAI 兼容协议、transcript 归一常复用 `c1`/`c2`…)是允许的。同一个 call ID 在它的 result 之后再次以 called 出现时,是新的一次调用,core 起一条新记录而非覆盖前一条(否则跨轮聚合会把前几轮的调用抹成「只剩最后一轮」)。
3. `name` 保留原始工具名，`tool` 保存跨 Agent 规范名。
4. 人工拒绝是 `rejected`，执行故障是 `failed`。
5. Skill 加载只产 `skill.loaded`，不重复计入工具调用。
6. 原始协议没有 usage 时省略，不编造数值。
7. **Adapter 不截断。** 工具输出再大也原样交出来——断言跑在完整值上，落盘时才由写入面统一削到 256 KiB 并打 `truncated` 标记（见 [Results · 大值截断](../../results/architecture.md#大值截断)）。Adapter 自己先削一刀会让断言看到不完整的输出，是 bug，不是保护。
8. **`loc` 只属于 eval 侧注入的 user message。** `t.send` 由 core 记录、携带 send 语句的源码位置；adapter 从 SDK 事件或 transcript 归一出的任何消息都不携带 `loc`。消费方以「user message 是否带 `loc`」区分 eval 发出的 send 与被测系统内部注入的 user 消息（agent 自身的续跑提示、对输入的重新包装）——内部注入保留在流里如实呈现，但不是新的一轮。
9. **`context.injected` 是被测系统内部注入的第二种形态：不披着 `message` 外衣的上下文文本。** 不变量 8 的内部注入仍然是一条 `role:"user"` 的 `message`（只是没有 `loc`）；但有些被测系统的注入根本不构成一条消息——例如 Claude Code 的 SessionStart / UserPromptSubmit hook 在下一轮开始前把额外文本前置进模型上下文，这段文本既不是 assistant 说的也不是 user 说的，硬套进 `message.role` 会污染按 role 或消息数做的断言。`context.injected` 只承载**带实际文本内容**的注入；被测系统内部机制里"某个动作执行完毕"这类不携带上下文文本的信号（例如一次注入确认），不构成事件——它对行为断言没有信息量，和「系统元数据行不进事件流」是同一条原则的延伸，不是新例外。`source` 是可选的原始来源标记（如 Claude Code 自己的 hook 名 `SessionStart`），adapter 按各自协议原样透传供下钻，不强行归一到一组封闭枚举，不同被测系统的命名不必对齐。**这与 niceeval 自己的[生命周期 Hook](../../../runner.md#环境预置不进运行器但按顺序调它)（`SandboxHook` 的 `setup`/`teardown`）是完全不同的两层机制**：后者是 niceeval 运行器编排沙箱环境的生命周期 Hook，前者是被测 CLI 自己的内部生命周期设施，`context.injected` 只归一后者。

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

一个原生问题只产一条请求事件。字段应足以让 eval 按 ID、文本、动作、参数和选项进行匹配。

## 派生事实

`deriveRunFacts(events)` 统一折叠工具调用、subagent 调用、待输入请求、parked、消息数、压缩次数与 `context.injected` 次数（`contextInjections`）。Adapter 不预计算断言结果。折叠按 `callId` 把 called 与 result 对成一条调用：配上 result 的取 result 的状态（`completed` / `failed` / `rejected`）；只有 called、尚未等到 result 的调用状态是 **`pending`**——HITL 停在审批上的调用就以这个状态被断言（`calledTool(name, { status: "pending" })`），不是容错分支。只有 result、没配上 called 的情况才属于 core 容错，不是正常映射契约。

`context.injected` 不获得专属的 `Turn` 便利字段（不像 `message` 有 `Turn.message`）——它和 `thinking`、`compaction` 同一档次，通过 `Turn.events` / 跨轮 `events` 数组按 `type` 过滤读取；`contextInjections` 计数只回答「这一轮有没有发生过注入」这种存在性问题，不替代逐条读取原文用 `text`。
