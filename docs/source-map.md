# Source Map —— 文档行为与源码边界

本页帮助实现工作从已定稿的文档定位到当前源码区域。Feature 文档定义目标契约；源码文件名不证明某个目标模块已经具备该契约。

Record、analysis selection、reuse planning 和 Reports 正在采用新的边界。本页把它们标为重构边界，而不把历史目录结构误写成新契约的实现 owner。

## 运行与命令

| 目标行为 | 当前源码区域 |
|---|---|
| argv 读取、命令分派、退出状态与项目初始化 | `src/cli.ts` |
| Eval 与 Experiment 发现 | `src/runner/discover.ts`、`src/runner/eval-selection.ts` |
| 调度、并发、锁、budget、carry 与 Attempt 生命周期 | `src/runner/{run,attempt,fingerprint,lock,timeout}.ts` |
| Sandbox 选择、准备、复用与收尾 | `src/runner/{sandbox-*,build-preparation,teardown-registry}.ts` 与 `src/sandbox/` |
| 当前进程的 human / JSON 反馈 | `src/runner/feedback/` |
| `accept` 和 Experiment rename 的命令接线 | `src/runner/{accept,rename-experiment}.ts`、`src/cli.ts` |

这些区域需要把业务事实写到新的 Run / Attempt RecordAttachment 边界，并只返回 [Invocation receipt](feature/record/library.md#recordwritesession) 所需字段。

## Assertions、Verdict 与执行失败

| 目标行为 | 当前源码区域 |
|---|---|
| 值、作用域、Judge、diff 与证据需求 | `src/assertions/` |
| Eval context、send、会话和重试 | `src/context/` |
| Adapter 的原始流、usage 与 telemetry 适配 | `src/agents/` |
| 四态 Verdict 折叠 | `src/shared/verdict.ts` |
| 执行失败分类与停止派发 | `src/context/{send-failures,send-retry}.ts`、`src/runner/` |

目标 owner 分别是 [Assertions](feature/assertions/architecture.md)、[Verdict](feature/verdict/architecture.md) 和 [执行失败分类](feature/error-classification/architecture.md)。上述源码区域需要以 Attempt-local assertion、verdict 与 diagnostic RecordAttachment 为输入和输出边界。

## Record、选择与 Reports

| 目标契约 owner | 重构边界 |
|---|---|
| [Record](feature/record/README.md) | `src/record/` 实现内部 current-format reader、maintenance/writer locks、fixed RecordAttachment envelope、完成标识发布与 explicit migration。外部只把目录当作 opaque 资产。 |
| [AnalysisSample](feature/sample/README.md) | `src/sample/analysis.ts` 由内部 host 以 frozen reader 和 analysis selection 形成完整分母与四态 slot；公开只导出纯值、codec 与 narrowing。 |
| [Reuse planning](feature/experiments/cache.md) | Runner 需要从 ProjectTarget、ExecutionTarget、`RecordWriteSession.view` 与具名 policy 形成 reuse/gap；planner 只接收 gaps。 |
| [Reports](feature/reports/README.md) | `src/report/index.ts` 是唯一公开作者入口；内部 host 消费自包含 `ReportExecution`，owner access、Attachment projection 与 bytes 读取不公开。 |
| [Reports CLI](feature/reports/README.md) | `src/show/`、`src/view/` 与 `src/report/host/` 通过内部 selection handle 和 `ReportExecution` 选择、呈现和 export。 |
| [静态 export](feature/reports/README.md#自包含静态-export) | `src/view/` 与 `src/report/` 需要写出页面、宿主数据、精确 runtime 和资源清单。 |

这里列出的路径是改造入口，不是对新格式模块名称的承诺。实现时以对应 Feature 文档的 owner、输入和不变量为准。

## 其他核心区域

| 目标行为 | 当前源码区域 |
|---|---|
| Eval 与公开定义类型 | `src/{index,types}.ts`、`src/eval/` |
| Agent 与 Adapter public API | `src/agents/`、`src/adapters/` |
| Sandbox provider 与生命周期 | `src/sandbox/` |
| Report text / web 组件与静态资源 | `src/report/{definition,components,assets,runtime}.ts`、`src/view/` |

修改任一公共行为前，先回到对应 Feature 入口确认契约，再用本页定位影响面。
