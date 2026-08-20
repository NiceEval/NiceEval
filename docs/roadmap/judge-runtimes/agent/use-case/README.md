# Agent-as-Judge 用例

- [审查多轮对话](review-conversation.md) —— 将确定范围的对话材料交给独立裁判 Agent。
- [审查仓库](review-repository.md) —— 显式授权 workspace snapshot，让裁判 Agent 调查代码与测试。

两个场景都直接登记一条 Agent Judge Assertion。Pass Eval 加 `.atLeast(n)`；Score Eval 加 `.score(n)`。完整 API 只在 [Library](../library.md) 定义。
