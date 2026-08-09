# Source Map —— 文档行为与源码边界

本页帮助实现工作从已定稿的文档定位到当前源码区域。Feature 文档定义目标契约；源码文件名不证明某个目标模块已经具备该契约。

Record、Sample 和 Reports 正在采用新的边界。本页把它们标为重构边界，而不把历史目录结构误写成新契约的实现 owner。

## 运行与命令

| 目标行为 | 当前源码区域 |
|---|---|
| argv 读取、命令分派、退出状态与项目初始化 | <code>src/cli.ts</code> |
| Eval 与 Experiment 发现 | <code>src/runner/discover.ts</code>、<code>src/runner/eval-selection.ts</code> |
| 调度、并发、锁、budget、carry 与 Attempt 生命周期 | <code>src/runner/{run,attempt,fingerprint,lock,timeout}.ts</code> |
| Sandbox 选择、准备、复用与收尾 | <code>src/runner/{sandbox-*,build-preparation,teardown-registry}.ts</code> 与 <code>src/sandbox/</code> |
| 当前进程的 human / JSON 反馈 | <code>src/runner/feedback/</code> |
| <code>accept</code> 和 Experiment rename 的命令接线 | <code>src/runner/{accept,rename-experiment}.ts</code>、<code>src/cli.ts</code> |

这些区域需要把业务事实写到新的 Run / Attempt channel 边界，并只返回 [Invocation receipt](feature/record/library.md#writer) 所需字段。

## Assertions、Verdict 与执行失败

| 目标行为 | 当前源码区域 |
|---|---|
| 值、作用域、Judge、diff 与证据需求 | <code>src/assertions/</code> |
| Eval context、send、会话和重试 | <code>src/context/</code> |
| Adapter 的原始流、usage 与 telemetry 适配 | <code>src/agents/</code> |
| 四态 Verdict 折叠 | <code>src/shared/verdict.ts</code> |
| 执行失败分类与停止派发 | <code>src/context/{send-failures,send-retry}.ts</code>、<code>src/runner/</code> |

目标 owner 分别是 [Assertions](feature/assertions/architecture.md)、[Verdict](feature/verdict/architecture.md) 和 [执行失败分类](feature/error-classification/architecture.md)。上述源码区域需要以 Attempt-local assertion、verdict 与 diagnostic channels 为输入和输出边界。

## Record、Sample 与 Reports

| 目标契约 owner | 重构边界 |
|---|---|
| [Record](feature/record/README.md) | <code>src/record/</code> 需要收敛到 <code>niceeval.record</code> root、Run、Member、Attempt、channel descriptor、reader 和 writer。不要从现有内部布局推导新的公开文件协议。 |
| [Sample](feature/sample/README.md) | <code>src/sample/index.ts</code> 需要以 RecordReader 形成显式 Run 选择、完整分母和 slot 状态。 |
| [Reports](feature/reports/README.md) | <code>src/report/</code> 需要只接收 ReportInput；文件读取和通道字节规范化留在 reader 边界。 |
| [Reports CLI](feature/reports/README.md) | <code>src/show/</code> 与 <code>src/view/</code> 需要通过 Sample 和 ReportInput 选择、呈现和 export。 |
| [静态 export](feature/reports/README.md#自包含静态-export) | <code>src/view/</code> 与 <code>src/report/</code> 需要写出页面、宿主数据、精确 runtime 和资源清单。 |

这里列出的路径是改造入口，不是对新格式模块名称的承诺。实现时以对应 Feature 文档的 owner、输入和不变量为准。

## 其他核心区域

| 目标行为 | 当前源码区域 |
|---|---|
| Eval 与公开定义类型 | <code>src/{index,types}.ts</code>、<code>src/eval/</code> |
| Agent 与 Adapter public API | <code>src/agents/</code>、<code>src/adapters/</code> |
| Sandbox provider 与生命周期 | <code>src/sandbox/</code> |
| Report text / web 组件与静态资源 | <code>src/report/{definition,components,assets,runtime}.ts</code>、<code>src/view/</code> |

修改任一公共行为前，先回到对应 Feature 入口确认契约，再用本页定位影响面。
