# Sandbox 模型：Sandbox 起点与三方准备顺序

Eval、Experiment 与 Agent 都可能需要准备同一个主 Sandbox。
一次 Attempt 只激活一个逻辑起点，由对应 Provider 读取成完整 `Sandbox Case`，再按候选定义的 owner 顺序执行准备。
对 Sandbox Agent，每个实际 Eval × Experiment pair 必须在创建资源前读取出唯一 root/template；不同 pair 可以使用不同 Provider 和起点。

这个决策主题回答三个问题:

- Eval 或 Experiment 谁为这条 Attempt 提供 active root/template。
- 起点 owner 怎样决定 Eval、Experiment 与 Agent 的准备顺序。
- 现场安装不可行时,作者怎样改用一份已经融合条件的完整 template，而不是让 Runner 合并两个起点。

本主题保留完整 `Sandbox Case` 与 Agent Ensure 的领域义务。
候选必须保留 `SandboxTemplate`、完整 `Sandbox Case` 与运行中的 Sandbox 的边界，不要求普通作者学习 materializer 注册或通用 Requirement/Base 组合语言。

十个 PLAN 都按 Feature Design Package 独立给出 Library、Architecture、Lifecycle 与 Use Case。
[Cases](CASES.md) 固定共同输入和验收结果;候选用例只说明各自怎样守护,不能改写 Case 来降低要求。
最终裁决与选型理由见 [DECISION](DECISION.md);定稿契约在 [Feature · Sandbox Layer](../../feature/sandbox/layers.md)。

**相关文档**:
[GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) ·
[CASES](CASES.md) ·
[DECISION](DECISION.md) ·
[PLAN-1](PLAN-1/README.md) ·
[PLAN-2](PLAN-2/README.md) ·
[PLAN-3](PLAN-3/README.md) ·
[PLAN-4](PLAN-4/README.md) ·
[PLAN-6](PLAN-6/README.md) ·
[PLAN-7](PLAN-7/README.md) ·
[PLAN-8](PLAN-8/README.md) ·
[PLAN-9](PLAN-9/README.md) ·
[PLAN-10](PLAN-10/README.md) ·
[PLAN-11](PLAN-11/README.md)
