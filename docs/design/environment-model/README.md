# 环境模型:Sandbox Recipe 与 template owner 顺序

Eval 与 Experiment 都声明 Sandbox recipe。
一次 Attempt 激活唯一 template，由当前 Provider 解析成 Sandbox Case，再按 template owner、另一 owner 与 Agent 的顺序准备主 Sandbox。
对 Sandbox Agent，每个实际 Eval × Experiment pair 恰好一方声明 template，并由它选择 Provider；Runner 在 discovery 后、任何 Provider 网络、build 或 Sandbox 创建前对全矩阵检查冲突与缺失。

这个决策主题回答三个问题:

- Eval 或 Experiment 谁为这条 Attempt 提供 active template。
- template owner 怎样决定 Eval 与 Experiment recipe setup 的顺序。
- 现场安装不可行时,作者怎样改用一份已经融合条件的完整 template，而不是让 Runner 合并两个起点。

本主题保留完整 Sandbox Case 与 Agent Ensure 的领域义务。
普通作者使用 SandboxRecipe、SandboxTemplate 与运行中的 Sandbox，不学习 materializer 注册或通用 Requirement/Base 组合语言。

九个 PLAN 都按 Feature Design Package 独立给出 Library、Architecture、Lifecycle 与 Use Case。
[Cases](CASES.md) 固定共同输入和验收结果;候选用例只说明各自怎样覆盖,不能改写 Case 来降低要求。

**相关文档**:
[GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) ·
[CASES](CASES.md) ·
[PLAN-1](PLAN-1/README.md) ·
[PLAN-2](PLAN-2/README.md) ·
[PLAN-3](PLAN-3/README.md) ·
[PLAN-4](PLAN-4/README.md) ·
[PLAN-5](PLAN-5/README.md) ·
[PLAN-6](PLAN-6/README.md) ·
[PLAN-7](PLAN-7/README.md) ·
[PLAN-8](PLAN-8/README.md) ·
[PLAN-9](PLAN-9/README.md) ·
[DECISION](DECISION.md)
