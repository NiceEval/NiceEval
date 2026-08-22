# Judge Material

Judge Material 定义一次 Judge 求值可以直接读取什么。它把 Turn、Action result、自定义内容与评分定义中的参考资料变成具名、已封口的 Judge Material View；LLM Judge 与 Agent Judge 只消费作者绑定到 Judge Check 的 View。

这条边界解决的不是“怎样把 trace 序列化给模型”，而是“怎样证明作者授权了哪些证据”。`t.judge` 不会自动附加完整 trace；同样，作者也不能再用 raw `events`、`toolCalls` 或任意对象绕过材料边界。

## 核心心智

```text
Execution source / Grading definition source
                  │
                  ▼
         branded Material View
                  │
        recipe slot 明确绑定
                  ▼
             Judge Check
                  │
       MaterialBindingManifest
                  ▼
          LLM Judge / Agent Judge
```

作者是可信的，但可能误把材料给得过宽；材料内容、工具输出、工作区文件与模型文本都是不可信输入。系统保证每条直接进入 evaluator 的 channel 都经过显式授权、预算和审计，不承诺追踪自然语言里的传递性信息流。Agent 若把工具输出抄进 reply，作者随后显式授权 reply 时，该信息会随 reply 进入 Judge。

Prompt injection 防护只保证材料不能变成 rubric、系统协议或工具权限，不保证 Judge 一定判对。通用 secret 猜测、隐藏思维链保存、workspace 精确 read set 推断和完整 information-flow non-interference 都不属于本方向。

## 范围

本方向拥有 Material View、selector、Judge Check、manifest、材料预算与直接可见性审计。LLM 的 provider/profile 与判分图归 [LLM Judge](../llm/README.md)；Agent 的独立 Session、workspace capability 与调查归 [Agent Judge](../agent/README.md)；历史 source ref 与重评复用归 [Replayable Grading](../../replayable-grading/README.md)。

## 入口

- [Library](library.md) —— View、selector、recipe slot 与 Judge Check。
- [Architecture](architecture.md) —— owner、manifest、coverage、安全、身份与审计。
- [Use cases](use-case/README.md) —— 最小回复、动作、结果、自定义材料与合批。
