# Assertions 设计参照

这页只收外部设计参考，不承担用户 API 或内部架构契约。

| 出处 | 借鉴内容 |
|---|---|
| eve.dev evals | gate/soft、`t` / session / turn 接收者模型、`check` / `require`、matcher 与 judge DX |
| Vercel agent-eval | Sandbox diff、transcript 归一化、experiment 与本地结果查看器的工程形状 |
| crabbox | budget、成本上限和 capability 分发纪律 |
| autoevals（Braintrust） | `closedQA`、`factuality`、`summarizes` 三个 judge |

NiceEval 在这些形状之上定义成本聚合、额外 matcher、按接收者选择 judge 默认材料，以及不向 eval 作者暴露 Sandbox 生命周期的分层。
