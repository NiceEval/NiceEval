# 共同约束

`Match<T>` 的私有 evaluator 只接收候选值。`ScoreMatchContext` 只有受管 `llm`，没有应用 ctx。
Adapter 的 `create` 已返回强类型应用上下文，assertions factory 已有 `{ app, check }`。
应用上下文 facade 和 assertions factory 分别由 `adapter.ts` 拥有。

旧材料方案增加材料工厂声明和再次绑定，用户明确否决这份重复接线。
Agent 已有 `usage`，其输入、缓存读取、缓存写入桶互斥。
现有 Agent `maxTokens` 只加未缓存输入和输出，不能直接命名为完整 token 总量。
Adapter 的 `recordUsage` 账本按物理 callId 保存最终快照；缺失值不等于零。

主 checkout 有尚未提交的旧方案实现与验证。独立审查只读，不把旧实现视为新契约。
