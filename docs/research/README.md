# 外部产品研究

`research/` 保存带观察日期的外部产品事实、与 NiceEval 的能力映射，以及由此得到的产品启发。
这里是决策输入，不是 NiceEval 的目标契约；准备落地的行为仍须进入 `design/`、`roadmap/` 或 `feature/`。

每篇研究至少回答四件事：

1. 观察了哪个版本或日期，事实取自哪些一手材料。
2. 外部产品的真实边界是什么，哪些只是外层引导或营销入口。
3. 它与 NiceEval 的概念如何对应，哪些能力不能直接类比。
4. 哪些做法值得吸收，哪些做法不应复制，以及下一步需要什么证据。

## 研究索引

| 主题 | 研究判断入口 |
|---|---|
| OpenRouter `spawn-ori-eval` 与 Ori Eval | [Skill、评估框架与 NiceEval 的关系](ori-eval.md) |
| Git、Cargo、Deno、pnpm、OpenTofu 与 kubectl | [复杂 CLI 测试体系对照](cli-testing/README.md) |
| Vite、Vitest 与 Playwright | [框架工具自身的 E2E 对照](framework-e2e/README.md) |
| TanStack Table、TanStack Charts 与 NiceEval Reports | [Headless 内核、双面呈现与渐进增强](tanstack-table-charts.md) |
| Vercel `design.md` 与 NiceEval Reports | [读者任务、证据构图与视觉验收](vercel-report-websites.md) |
| Harbor 与 Docker / Agent Sandbox 框架 | [容器启动、keeper、命令执行与 DinD 进程模型](docker-sandbox-process-models.md) |
| Eve 与 NiceEval-Eval 回归题 | [断言 DX、有序行为与逐项断言审视](eve-assertion-dx.md) |
| Eve、smevals、Ori Eval 与评估生态 | [断言 API、语法与作者 DX 横向研究](assertion-api-dx/README.md) |
| agent-eval、Agent SDK、Eve 与 OTel | [Adapter 接入、事件协议与遥测生态](adapters/README.md) |
| Vercel agent-eval `ExperimentConfig` | [Experiment 运行矩阵设计参照](experiments/README.md) |
| LLM tracing、事件历史、内容寻址与可验证存储 | [Record 相似系统研究](record-systems/README.md) |
| Langfuse、MLflow、W&B、Phoenix 与 ClearML | [运行写入、分析与报告作者面](eval-platform-authoring/README.md) |
