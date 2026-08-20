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
| Experiment 发现、调度、Invocation-local 并发、共享状态租约、Sandbox 生命周期、reuse 与 receipt | `src/runner/{run,lock,shared-state-lease}.ts` 及同目录协作者；由 `experimentHost` 调用 |
| execution claim 与 Record lease 协调 | `src/coordination/` 与 `src/record/` 的 Host 实现 |
| Record Core、Run、Member、Attempt 与 migration 编解码 | `src/record/{model,codec,migration,host}/` |
| 六个固定 family 与各自 collector / decoder | `src/record/family/`、`src/assertions/record/`、`src/o11y/record/`、`src/sandbox/record/`、`src/runner/source-producer.ts` 与 `src/sources/` |
| Scope-bound reader 与按需读取 | `src/record/reader/`；只能经 `recordHost` 到达 |

Verdict、Score 和采用理由由 Assertions、Attempt outcome 与 Member Core 解释，不另建 durable family。
固定 family 的读取结果只有 `available`、`not-recorded`、`unsupported` 与 `invalid`；可迁移旧格式的
引导是 Record open error，不是 family 值。

## Analysis 与 Report

| 目标契约 owner | 源码边界 |
|---|---|
| [Analysis](feature/analysis/README.md) | `src/analysis/{api,definitions,contracts,host}.ts` 拥有 Population、Dimension、Measure、Relation、Host-issued Sample、`aggregate()` 与 `query()`。 |
| [实验组与比较范围](feature/analysis/library.md#实验组与比较范围) | `src/analysis/experiment-groups.ts` 从固定 Sample 派生 Experiment Group、签发 `ExperimentComparisonScope` 并闭合结构可比性；`src/report/built-in/standard.tsx` 与 `src/report/host/{from-record,machine,static}.ts` 分别拥有标准组 Page、`show` 组输出与 Header 真实链接。 |
| [Analysis outputs](feature/analysis/library.md#closedrowssemanticframe-与-domainview) | `src/analysis/` 形成并校验 `ClosedRows`、`SemanticFrame` 与 `DomainView`；`src/report/model/{aggregate,conversions}.ts` 只提供 Report facade 与具名关闭投影，不建立通用作者 semantic model。 |
| [Reports](feature/reports/README.md) | `src/report/definition/{report,tree}.ts`、`definition/primitives/**`、`components/**`、`model/{aggregate,conversions}.ts` 与 `index.ts` 是作者面：`defineReport({ pages })`、两种 `defineComponent()`、普通 Page 与参数 Page。作者只使用标准 React JSX，不增加专属 JSX 入口。 |
| [Report 成本投影](feature/reports/cost-projections/README.md) | `src/analysis/{cost,cost-projection,cost-decimal}.ts` 定义 Profile 验证、slot-provider ledger 与闭合 projection；`src/report/{definition/report.ts,execution/machine.ts,host/{machine,show-target,site-runtime}.ts}` 把已签发 projection 纳入 target 或 site 输出，不重新计算。 |
| [Report 单目标 Host](feature/reports/architecture.md#两条执行路径) | `src/report/host/{execute,from-record,show-target,target-route}.ts` 与 `runtime/{resolved-page,text,web}.ts` 在固定 Sample 内解码并执行一个 Page，短存私有 `ResolvedPage` 后交付 text 或 target manifest；此路径不 `enumerate()`，不形成站点版本。 |
| [Report 站点 Host](feature/reports/architecture.md#两条执行路径) | `src/report/execution/{model,paths}.ts` 与 `src/report/host/{execute,site-assets,site-runtime,static,view-session}.ts` 枚举所有 Page 实例、校验闭包并形成 `ClosedSiteRevision`；view 和 static 只读取这一个 revision 的 bytes。 |
| [Reports CLI](feature/reports/cli.md) | `src/cli.ts` 经 `reportHost` 进入；Host 再按需调用 Record 与 Analysis Host，不直接打开物理 reader。 |
| [静态 export](feature/reports/cli.md#niceeval-view---out) | `src/report/host/static.ts` 写出已验证 `ClosedSiteRevision` 的页面、asset 与下载文件；它不重新执行 Page 或 Analysis。 |

实现时以对应 Feature 文档的 owner、输入和不变量为准。

## 其他核心区域

| 目标行为 | 当前源码区域 |
|---|---|
| Eval 与公开定义类型 | `src/{index,types}.ts`、`src/eval/` |
| Agent 与 Adapter public API | `src/agents/`、`src/adapters/` |
| Sandbox provider 与生命周期 | `src/sandbox/` |
| Report text / web 组件与静态资源 | `src/report/runtime/{resolved-page,text,web}.ts` 与 `src/report/assets/`；`src/view/` 只承载 Host-owned browser shell，不能成为第二条作者 renderer 管线。 |

修改任一公共行为前，先回到对应 Feature 入口确认契约，再用本页定位影响面。
