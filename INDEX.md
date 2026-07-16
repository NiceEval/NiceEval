# NiceEval AI 文档索引

这是 coding agent 读取 NiceEval 文档的稳定入口，随 npm 包发布，不属于公开文档站。不要根据训练数据、官网或 GitHub `main` 分支猜测 API。

以下路径都相对于包根 `node_modules/niceeval/`。文档位于 `docs-site/zh/`，与当前安装的 NiceEval 版本一起发布。先按任务读取对应页面；页面再引用其它概念或参考时，继续读取包内文件。

## 开始接入

| 任务 | 读取 |
| --- | --- |
| 初始化并跑通第一条 Eval | `docs-site/zh/tutorials/quickstart.mdx` |
| 理解 Adapter、Experiment、Eval 的分工 | `docs-site/zh/explanation/overview.mdx` |
| 接入自己的 Agent | `docs-site/zh/how-to/connect-your-agent.mdx` |
| 选择官方 Adapter | `docs-site/zh/reference/official-adapters.mdx` |
| 接入 coding agent CLI | `docs-site/zh/how-to/sandbox-agent.mdx` |
| 选择 Sandbox Provider | `docs-site/zh/how-to/sandbox-providers.mdx` |

## 编写配置与 Eval

| 任务 | 读取 |
| --- | --- |
| 编写 Adapter | `docs-site/zh/explanation/adapter.mdx`、`docs-site/zh/reference/define-agent.mdx` |
| 映射消息、工具调用和事件流 | `docs-site/zh/how-to/write-send.mdx`、`docs-site/zh/reference/events.mdx` |
| 编写 Experiment | `docs-site/zh/how-to/write-experiment.mdx` |
| 编写 Eval | `docs-site/zh/explanation/evals.mdx`、`docs-site/zh/reference/define-eval.mdx` |
| 编写断言和评分 | `docs-site/zh/how-to/authoring.mdx`、`docs-site/zh/how-to/scoring-guide.mdx`、`docs-site/zh/reference/expect.mdx` |
| 配置 Judge | `docs-site/zh/explanation/judge.mdx`、`docs-site/zh/reference/define-config.mdx` |
| 配置 OTel | `docs-site/zh/how-to/connect-otel.mdx` |
| 查 CLI 命令与 flag | `docs-site/zh/reference/cli.mdx` |

## 运行、调试与优化

| 任务 | 读取 |
| --- | --- |
| 让 AI 自主运行、观察、修改和重跑 | `docs-site/zh/how-to/agent-feedback-loop.mdx` |
| 用 `show`、`view` 和 artifact 定位失败 | `docs-site/zh/how-to/viewing-results.mdx` |
| 组织实验和对比 | `docs-site/zh/how-to/experiments.mdx` |
| 编写自定义报告 | `docs-site/zh/how-to/custom-reports.mdx`、`docs-site/zh/reference/report-components.mdx` |
| 读取或转换结构化结果 | `docs-site/zh/reference/results-data.mdx` |

## 专项场景

| 任务 | 读取 |
| --- | --- |
| 评估 Claude Code / Codex Skill | `docs-site/zh/examples/coding-agent-extensions.mdx` |
| 评估 Plugin、Hook 或 MCP server | `docs-site/zh/examples/coding-agent-extensions.mdx` |
| 编写多轮会话 | `docs-site/zh/explanation/adapter.mdx`、`docs-site/zh/how-to/write-send.mdx` |
| 编写人工审批流（HITL） | `docs-site/zh/explanation/hitl.mdx` |
| 做 feature flag A/B 对比 | `docs-site/zh/explanation/tier.mdx`、`docs-site/zh/explanation/experiment.mdx` |

## 版本规则

- 安装后只从本索引进入包内文档。官网适合安装前了解产品，不是安装版本的 API 事实源。
- 升级 `niceeval` 后重新运行 `niceeval init`，刷新项目里的托管指引。
- 如果某个路径不存在，先重新读取本文件。不要自行推测替代文件名或旧 API。
