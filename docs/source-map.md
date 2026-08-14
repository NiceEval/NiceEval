# Source Map —— 文档行为与源码边界

本页帮助实现工作从已定稿的文档定位到当前源码区域。Feature 文档定义目标契约；源码文件名
不证明某个目标模块已经具备该契约。

Record、Analysis 与 Report 是三个数据层。CLI 只进入各自的 Host SDK；Runner、reader、loader
和物理布局都在 Host 之后。本页列出实现边界，不把历史目录结构误写成公开 API。

## 命令与 Host SDK

| 目标行为 | 当前源码区域 |
|---|---|
| argv 读取、命令分派、退出状态与项目初始化 | `src/cli.ts` |
| `exp`、`--dry`、`accept` 的 list、plan、run 与 accept | `src/experiment/host/index.ts` 的 `experimentHost` |
| Record 打开、创建、封口与 maintenance | `src/record/host/{index,runtime,types}.ts` 的 `recordHost` |
| 由 reader 与 selection 签发 Sample | `src/analysis/host.ts` 的 `analysisHost` |
| Report execute、show、serve 与 export | `src/report/host/` 的 `reportHost` |

`src/cli.ts` 只能组合这些 Host。它不直接调用 `src/runner/`、`src/record/reader/`、family decoder 或
Report loader。Host 内部才取得 Scope、Layer、lease、reader、writer 或 renderer 实现。

## 运行与持久事实

| 目标行为 | 当前源码区域 |
|---|---|
| Experiment 发现、调度、并发、Sandbox 生命周期、reuse 与 receipt | `src/runner/`；由 `experimentHost` 调用 |
| execution claim 与 Record lease 协调 | `src/coordination/` 与 `src/record/` 的 Host 实现 |
| Record Core、Run、Member、Attempt 与 migration 编解码 | `src/record/{model,codec,migration,host}/` |
| 五个固定 family 与各自 collector / decoder | `src/record/family/`、`src/assertions/record/`、`src/o11y/record/`、`src/sandbox/record/` 与 `src/sources/` |
| Scope-bound reader 与按需读取 | `src/record/reader/`；只能经 `recordHost` 到达 |

Verdict、Score 和采用理由由 Assertions、Attempt outcome 与 Member Core 解释，不另建 durable family。
固定 family 的读取结果只有 `available`、`not-recorded`、`unsupported` 与 `invalid`；可迁移旧格式的
引导是 Record open error，不是 family 值。

## Analysis 与 Report

| 目标契约 owner | 源码边界 |
|---|---|
| [Analysis](feature/analysis/README.md) | `src/analysis/{api,definitions,contracts,host}.ts` 拥有 Population、Dimension、Measure、Relation、Host-issued Sample、`aggregate()` 与 `query()`。 |
| [Analysis outputs](feature/analysis/library.md#closedrowssemanticframe-与-domainview) | `src/analysis/` 与 `src/report/semantic/` 形成并校验 `ClosedRows`、`SemanticFrame` 与 `DomainView`。 |
| [Reports](feature/reports/README.md) | `src/report/{definition,components,index}.ts` 是作者面：`defineReport({ pages })`、两种 `defineComponent()`、普通 Page 与参数 Page。 |
| [Report Host](feature/reports/library.md#执行问题和类型化错误) | `src/report/host/{execute,from-record,presentation,static,view-session}.ts` 在 Sample Scope 内执行 `params.encode/decode/enumerate`、`load` 与 `render`，随后交付 `ReportExecution` 与 `ClosedReportTree`。 |
| [Reports CLI](feature/reports/README.md) | `src/cli.ts` 经 `reportHost` 进入；Host 再按需调用 Record 与 Analysis Host，不直接打开物理 reader。 |
| [静态 export](feature/reports/library.md#static-export) | `src/report/host/static.ts` 与 `src/view/` 写出页面、host-data、runtime 和 complete marker。 |

实现时以对应 Feature 文档的 owner、输入和不变量为准。

## 其他核心区域

| 目标行为 | 当前源码区域 |
|---|---|
| Eval 与公开定义类型 | `src/{index,types}.ts`、`src/eval/` |
| Agent 与 Adapter public API | `src/agents/`、`src/adapters/` |
| Sandbox provider 与生命周期 | `src/sandbox/` |
| Report text / web 组件与静态资源 | `src/report/{definition,components,assets,runtime}.ts`、`src/view/` |

修改任一公共行为前，先回到对应 Feature 入口确认契约，再用本页定位影响面。
