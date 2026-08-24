# Source Map —— 文档行为与源码边界

本页帮助实现工作从已定稿的文档定位到当前源码区域。Feature 文档定义目标契约；源码文件名
不证明某个目标模块已经具备该契约。

Record、Analysis 与 Report 是三个数据层。CLI 只进入各自的 Host SDK；Runner、reader、loader
和物理布局都在 Host 之后。本页列出实现边界，不把历史目录结构误写成公开 API。

## 命令与 Host SDK

| 目标行为 | 当前源码区域 |
|---|---|
| argv 读取、根路由、全局 help/version、退出状态与信号 | `packages/niceeval/src/cli/{application,contribution,program,bootstrap}.ts`；`bootstrap.ts` 是唯一 Node Live Layer 与 Effect runtime edge，`program.ts` 不拥有领域命令 |
| Feature command 挂载 | 各 Feature 的 `cli/` 导出冻结 command 与完整 option/help schema；`packages/niceeval/src/cli/contribution.ts` 只验证、聚合和路由，`bootstrap.ts` 显式挂载 contribution 并提供所需 Layer |
| Docker profile、image cache 与 BuildKit 管理 CLI | `packages/niceeval/src/docker/cli/contribution.ts` 拥有 `niceeval docker` 命令树；Docker-owned cache/profile 操作不进入通用 Sandbox contract |
| Sandbox 留存与 orphan 管理 CLI | `packages/niceeval/src/sandbox/cli/contribution.ts` 拥有 `niceeval sandbox`，调用 Sandbox 自己的 detached/registry 操作；不加载 Eval 配置 |
| Eval catalog CLI | `packages/niceeval/src/eval/{host,cli}/` 拥有 `niceeval list` 的发现投影与呈现 |
| Experiment 命令与 Invocation status | `packages/niceeval/src/experiment/host/` 的高层 typed operations 与 `cli/` contributions；Runner 与 session 存储保持 Host 私有 |
| 项目初始化 | `packages/niceeval/src/project/` 的 Host operation、平台 capability 与 `init` contribution |
| Record 打开、创建、封口与 maintenance | `packages/niceeval/src/record/host/{index,runtime,types}.ts` 的 `recordHost` |
| 由 reader 与 selection 签发 Sample | `packages/niceeval/src/analysis/host.ts` 的 `analysisHost` |
| Report execute、show、serve 与 export | `packages/niceeval/src/report/host/` 的 `reportHost` |

`packages/niceeval/src/cli/bootstrap.ts` 只能组合这些 Host 与 Feature contribution。它不直接调用 `packages/niceeval/src/runner/`、`packages/niceeval/src/record/reader/`、family decoder 或
Report loader。Host 内部才取得 Scope、Layer、lease、reader、writer 或 renderer 实现。

## 运行与持久事实

| 目标行为 | 当前源码区域 |
|---|---|
| Experiment 发现、调度、Invocation-local 并发、共享状态租约、Sandbox 生命周期、reuse 与 receipt | `packages/niceeval/src/runner/{run,lock,shared-state-lease}.ts` 及同目录协作者；由 `experimentHost` 调用 |
| execution claim 与 Record lease 协调 | `packages/niceeval/src/coordination/` 与 `packages/niceeval/src/record/` 的 Host 实现 |
| Record Core、Seal manifest、staging / recovery、Run 原子发布与 migration 编解码 | `packages/niceeval/src/record/{model,codec,migration,host}/`；portable inventory 与 `.niceeval/coordination/` local state 保持分离 |
| 高层 Record 作者 API、callable nominal definition、惰性 command、`record.write` 与 `{ records }` composition | `packages/niceeval/src/record/{authoring.ts,index.ts,host/,writer/}`；普通 Eval `TestContext` 不进入 writer 边界 |
| 底层 Attachment logical definition、persistence revision、adapter、private migration parser 与 Core-owned content/reference declaration compiler | `packages/niceeval/src/record/family/`、`packages/niceeval/src/assertions/record/`、`packages/niceeval/src/sandbox/record/` 与 `packages/niceeval/src/sources/` |
| Runner source-receipt capture authority 与 normalization | `packages/niceeval/src/runner/source-receipts/` 与 `packages/niceeval/src/runner/source-producer.ts` |
| Observability 五个 source family | Adapter terminal Turn 进入 `niceeval.agent-turns`；SessionManager context 进入 `niceeval.turn-contexts`；Sandbox wrapper 进入 `niceeval.sandbox-commands`；Runner clock / diagnostic sink 分别进入 `niceeval.runner-activities` 与 `niceeval.runner-diagnostics`。实现落点以 `packages/niceeval/src/{adapters,agents,sandbox,runner,record}/` 的 capture boundary 与 family declaration 为准。 |
| Observability reader-side view 与 source navigation relation | `packages/niceeval/src/analysis/` 的 conversation、usage、commands、timing、diagnostics projection 与 relation；source navigation 连接 Turn Contexts、Runner Activities 和 Sources，不进入 `record/family/` |
| Assertions current semantic entry、v1→v2→v3 相邻迁移与有界 collection receipt | `packages/niceeval/src/assertions/{api,runtime,match}.ts`、`packages/niceeval/src/assertions/record/` 与 `packages/niceeval/src/record/family/assertions/{definition.ts,persistence.ts,migrate/}` |
| Scope-bound reader 与按需读取 | `packages/niceeval/src/record/reader/`；只能经 `recordHost` 到达 |

Verdict、Score 和采用理由由 Assertions、Attempt outcome 与 Member Core 解释，不另建 durable family。
source receipt 的 `partial` 属于对应 payload；未声明 source 是 `not-recorded`，已声明但 payload、segment 或 blob
closure 不合法是 `invalid`。这些状态保持 source-local。未知 root format 是 open error；未贡献 family 只在
direct read、reference closure 或完整性检查需要它时返回 `family-definition-required`。

## Analysis 与 Report

| 目标契约 owner | 源码边界 |
|---|---|
| [Analysis](feature/analysis/README.md) | `packages/niceeval/src/analysis/{api,definitions,contracts,host}.ts` 拥有 Population、Dimension、Measure、Relation、Host-issued Sample、`aggregate()` 与 `query()`。 |
| [实验组与比较范围](feature/analysis/library.md#实验组与比较范围) | `packages/niceeval/src/analysis/experiment-groups.ts` 从固定 Sample 派生 Experiment Group、签发 `ExperimentComparisonScope` 并闭合结构可比性；`packages/niceeval/src/report/built-in/standard.tsx` 与 `packages/niceeval/src/report/host/{from-record,machine,static}.ts` 分别拥有标准组 Page、`show` 组输出与 Header 真实链接。 |
| [Analysis outputs](feature/analysis/library.md#closedrowssemanticframe-与-domainview) | `packages/niceeval/src/analysis/` 形成并校验 `ClosedRows`、`SemanticFrame` 与 `DomainView`；`packages/niceeval/src/report/model/{aggregate,conversions}.ts` 只提供 Report facade 与具名关闭投影，不建立通用作者 semantic model。 |
| Assertions typed closed projection | `packages/niceeval/src/analysis/{domain-view,bindings,index}.ts` 从唯一 current entry 形成 Source、Check、Observed、Expected、Explanation tagged sections，并保留 typed policy、contribution、coverage 与 collection receipt；不向 Report 暴露 `JsonValue` 或 matcher diagnostic code 判读职责。 |
| [Reports](feature/reports/README.md) | `packages/niceeval/src/report/definition/{report,tree}.ts`、`definition/primitives/**`、`components/**`、`model/{aggregate,conversions}.ts` 与 `index.ts` 是作者面：`defineReport({ pages })`、两种 `defineComponent()`、普通 Page 与参数 Page。作者只使用标准 React JSX，不增加专属 JSX 入口。 |
| [Report 成本投影](feature/reports/cost-projections/README.md) | `packages/niceeval/src/analysis/{cost,cost-projection,cost-decimal}.ts` 定义 Profile 验证、slot-provider ledger 与闭合 projection；`packages/niceeval/src/report/{definition/report.ts,execution/machine.ts,host/{machine,show-target,site-runtime}.ts}` 把已签发 projection 纳入 target 或 site 输出，不重新计算。 |
| [Report 单目标 Host](feature/reports/architecture.md#两条执行路径) | `packages/niceeval/src/report/host/{execute,from-record,show-target,target-route}.ts` 与 `runtime/{resolved-page,text,web}.ts` 在固定 Sample 内解码并执行一个 Page，短存私有 `ResolvedPage` 后交付 text 或 target manifest；此路径不 `enumerate()`，不形成站点版本。 |
| [Report 站点 Host](feature/reports/architecture.md#两条执行路径) | `packages/niceeval/src/report/execution/{model,paths}.ts` 与 `packages/niceeval/src/report/host/{execute,site-assets,site-runtime,static,view-session}.ts` 枚举所有 Page 实例、校验闭包并形成 `ClosedSiteRevision`；view 和 static 只读取这一个 revision 的 bytes。 |
| [Reports CLI](feature/reports/cli.md) | `packages/niceeval/src/report/cli/` 提供 `show` / `view` contributions；Report Host 再按需调用 Record 与 Analysis Host，不直接打开物理 reader。 |
| [静态 export](feature/reports/cli.md#niceeval-view---out) | `packages/niceeval/src/report/host/static.ts` 写出已验证 `ClosedSiteRevision` 的页面、asset 与下载文件；它不重新执行 Page 或 Analysis。 |

实现时以对应 Feature 文档的 owner、输入和不变量为准。

## 其他核心区域

| 目标行为 | 当前源码区域 |
|---|---|
| Eval 与公开定义类型 | `packages/niceeval/src/{index,types}.ts`、`packages/niceeval/src/eval/` |
| Agent 与 Adapter public API | `packages/niceeval/src/agents/`、`packages/niceeval/src/adapters/` |
| Sandbox provider 与生命周期 | `packages/niceeval/src/sandbox/` |
| Report text / web 组件与静态资源 | `packages/niceeval/src/report/runtime/{resolved-page,text,web}.ts` 与 `packages/niceeval/src/report/assets/`；`packages/niceeval/src/view/` 只承载 Host-owned browser shell，不能成为第二条作者 renderer 管线。 |

修改任一公共行为前，先回到对应 Feature 入口确认契约，再用本页定位影响面。
