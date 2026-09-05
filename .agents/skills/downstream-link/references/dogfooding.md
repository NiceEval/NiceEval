# 下游发现与 dogfooding

真实下游是产品验收环境，各自拥有独立的仓库规则、依赖和运行结果。按任务选择项目，再确认实际路径；Herdr checkout 的父目录不一定是多仓库工作区。

| 项目 | 验收职责 |
| --- | --- |
| `terminal-bench` | 用真实 Terminal-Bench 题目验证运行、查看、诊断与实验工作流 |
| `MemoryBench` | 验证 memory 条件、agent/model 对比实验与报告能力 |
| `NiceEval-Eval` | 验证 INIT、随包索引、安装/分享与文档对 coding agent 的实际效果 |
| `NiceEval-Preview` | 用确定性全功能 Eval 与封存 SQLite Record 验证第一方 View |

用户提供的路径优先。否则只读检查已知工作区和 Git checkout 信息，确认目标存在后才进入；找不到时报告缺少哪个目标，不自动 clone 或创建替代仓库。

进入目标后先读最近的 `AGENTS.md`、`README.md` 或实验入口，并分别检查每个涉及仓库的 Git 状态。多仓库父目录没有统一安装、测试或格式化入口。

确认下游实际消费已发布包、本地 link 还是当前源码；相邻目录不证明它使用当前候选。需要安装本轮修改时，按 skill 的 `pnpm dev:link` 入口构建一次并验证 candidate identity；影响发布运行时的改动必须先完成 `build:package`，既有 View 进程需要重启。

使用最小、能证明契约的实验切片，保留既有结果，只补跑受影响场景。付费模型调用、全量 benchmark、整批作废或全量重跑需要用户明确授权。

读取或诊断下游运行结果时，只使用其规则指定的 `pnpm exec niceeval query` 或 `pnpm exec niceeval view` 公开入口，不直接读取 `.niceeval/` 产物或用相邻源码反推某次运行。固定 Query operation 无法呈现所需信息时，记录 NiceEval 呈现缺口。

通用契约与核心行为的根因在 NiceEval 修复；题目、benchmark、实验和报告特定策略留在下游。跨仓库修改分别验证和提交，不把其它仓库的工作带入 NiceEval 提交。
