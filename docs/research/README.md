# 外部产品研究

`research/` 保存带观察日期的外部产品事实、与 NiceEval 的能力映射，以及由此得到的产品启发。
这里是决策输入，不是 NiceEval 的目标契约；准备落地的行为仍须进入 `design/`、`roadmap/` 或 `feature/`。

每篇研究至少回答四件事：

1. 观察了哪个版本或日期，事实取自哪些一手材料。
2. 外部产品的真实边界是什么，哪些只是外层引导或营销入口。
3. 它与 NiceEval 的概念如何对应，哪些能力不能直接类比。
4. 哪些做法值得吸收，哪些做法不应复制，以及下一步需要什么证据。

## 当前闭环

Research v1 只维护带边界的研究材料，不形成 Feature、Roadmap、Engineering 或 Design 的 Trace 节点，也不写 Trace relation。它从 `pnpm run repo docs research --help` 进入：`package` 建立一个研究包，`page` 建立一个研究页，`add-page` 把新页接入指定研究包，`check <exact-ref>` 只检查这个精确研究对象。

`check` 不接受全库扫描、模糊 pattern 或空 selector。它核对归属、路径、标题、索引和所需的结构字段，使研究包可以被稳定导航；它不联网、不读取外部产品的实时状态，也不判断观察、引文或产品判断是否为真。事实真伪由作者在一手材料与观察日期上负责，不能用结构通过冒充研究判断已获验证。

研究的启发要进入 Design、Roadmap 或 Feature 才能成为 NiceEval 的方向或当前目标。不要把 Research 加进 Trace 来取得可追溯外观，也不要把一次 `check` 成功解释为产品采纳。

## 研究方向

一级目录按 NiceEval 要研究的问题划分，不按外部产品品牌划分。
方向内部再以产品或系统为入口，并使用研究对象自己的概念组织正文；同一产品出现在不同方向时，只回答该方向的问题。

| 方向 | 研究对象 | 研究判断入口 |
|---|---|---|
| Eval authoring | OpenRouter `spawn-ori-eval`、Ori Eval 与 Ori Harness | [Skill、评估框架与 NiceEval 的关系](ori-eval.md) |
| Adapter | agent-eval、Agent SDK、Eve 与 OTel | [Adapter 接入、事件协议与遥测生态](adapters/README.md) |
| Assertion | Eve、smevals、Ori Eval、Promptfoo、Inspect AI、Braintrust、DeepEval 等 | [断言 API、语法与作者 DX](assertion-api-dx/README.md)；[Eve 回归题研究](eve-assertion-dx.md) |
| Experiment | Vercel agent-eval `ExperimentConfig` | [Experiment 运行矩阵设计参照](experiments/README.md) |
| Record storage | Eval/Artifact 平台、application file、事件与列式格式 | [Record 的逻辑写入怎样映射到物理存储](record-storage/README.md) |
| Record → Report | Eval/tracing 平台、实验结果 store、历史查询、Experiment 比较与 Dashboard | [运行事实怎样被保存、看懂、比较并交付](record-to-report/README.md) |
| Report design | TanStack Table / Charts 与 Vercel `design.md` | [已完成结果怎样进入表格、图表与报告网站](report-design/README.md) |
| CLI Insight | 固定 Inspection operation 的确定性 protocol spike | [Machine query、Human show 与 Insight 共用语义](cli-insight/README.md) |
| Sandbox | Harbor、Inspect AI、SWE-ReX、SWE-bench、Docker Sandboxes、Runloop、Incus、Sysbox 与 Firecracker | [容器进程模型](docker-sandbox-process-models.md)；[嵌套 Docker Sandbox](nested-docker-execution/README.md) |
| Testing | Git、Cargo、Deno、pnpm、OpenTofu、kubectl、Vite、Vitest 与 Playwright | [复杂 CLI 测试体系](cli-testing/README.md)；[框架 E2E](framework-e2e/README.md) |
