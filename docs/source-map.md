# Source Map —— 文档行为与源码边界

本页帮助实现工作从已定稿的文档定位到当前源码区域。Feature 文档定义目标契约；源码文件名
不证明某个目标模块已经具备该契约。

Record 保存 durable facts，固定 Inspection Operations 关闭运行后语义。Delivery 分为 machine query 与 runtime View；CLI 只进入
Host SDK，Runner、reader、SQLite 与 browser transport 都在 Host 之后。

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
| Record 打开、创建、封口与 maintenance | `packages/niceeval/src/record/host/{index,runtime,sqlite-host,types}.ts` 的 `recordHost` |
| 固定运行后 discovery、detail 与 comparison | `packages/niceeval/src/inspection/{catalog,codec,host,source,sources}.ts` 的 `inspectionHost` |
| Machine query 与 runtime View | `packages/niceeval/src/inspection/cli/` 与 `packages/niceeval/src/view/`；Delivery 不重新解释 Record facts |

`packages/niceeval/src/cli/bootstrap.ts` 只能组合这些 Host 与 Feature contribution。它不直接调用 `packages/niceeval/src/runner/`、`packages/niceeval/src/record/reader/`、family decoder 或
Inspection operation。Host 内部才取得 Scope、Layer、lease、reader、writer 或 browser session。

## 仓库维护 CLI

| 目标行为 | 当前源码区域 |
|---|---|
| Repository root 的 argv、Layer、进程交付与唯一 `NodeRuntime.runMain` | `packages/repo-tools/src/cli.ts` |
| `docs` contribution 的装配与显式 domain contribution protocol | `packages/repo-tools/src/docs/{command,contribution}.ts` |
| Feature/Test Trace Schema、compiler、固定投影与各自 domain renderer | `packages/repo-tools/src/docs/{feature-command,test-command,trace}/` |
| canonical RepoRef、target validation 与 Trace relation mutation 的共享锁/generation | `packages/repo-tools/src/docs/trace/{ref,relation-mutation}.ts` |
| Feedback v2、adoption、Memory relation 与 Issue source | `packages/repo-tools/src/feedback/` |
| structured Memory、promotion、supersession 与 E2E regression check | `packages/repo-tools/src/memory/` |

这些命令属于仓库自身，不进入发布的 `niceeval` 产品 CLI。文档查询与维护入口从 `pnpm run repo docs` 进入：Feature/Test 发现分别是 `pnpm run repo docs feature` 与 `pnpm run repo docs test`；
Feedback 与 Memory 仍各自使用 `pnpm feedback` 与 `pnpm memory`。领域 handler 返回结构化 receipt，只有根 `cli.ts` 读取 argv、写 stdout/stderr 和设置退出码。

## 运行与持久事实

| 目标行为 | 当前源码区域 |
|---|---|
| Experiment 发现、调度、Invocation-local 并发、共享状态租约、Sandbox 生命周期、reuse 与 receipt | `packages/niceeval/src/runner/{run,lock,shared-state-lease}.ts` 及同目录协作者；由 `experimentHost` 调用 |
| [Setup 前缀缓存](roadmap/sandbox-cache/setup-prefix/README.md) 的 Action state、DAG 线性化、前缀协调、capture 与 private clone | `packages/niceeval/src/sandbox/{action,backend,docker,docker-setup-prefix-cache}.ts`、`packages/niceeval/src/sandbox/docker-profile/` 与 `packages/niceeval/src/runner/attempt.ts`；Profile 的 raw-image artifact、lease、journal 与回收落在 `packaging/docker-profile-host/` |
| execution claim 与 Record lease 协调 | `packages/niceeval/src/coordination/` 与 `packages/niceeval/src/record/` 的 Host 实现 |
| Record Core、Logical Seal、SQLite schema、publication、snapshot 与 migration | `packages/niceeval/src/record/{model,sqlite,host}/`；`.niceeval/record/record.sqlite` 与 cache/coordination/user state 分离 |
| 高层 Record 作者 API、nominal Definition、batch collection 与 `{ records }` composition | `packages/niceeval/src/record/{authoring.ts,index.ts,host/,writer/}`；`write`、`append`、`appendAll` 与 `close` 只进入 owner-scoped session |
| 底层 Attachment logical definition、persistence revision、adapter、private migration parser 与 Core-owned content/reference declaration compiler | `packages/niceeval/src/record/family/`、`packages/niceeval/src/assertions/record/`、`packages/niceeval/src/sandbox/record/` 与 `packages/niceeval/src/sources/` |
| Runner source-receipt capture authority 与 normalization | `packages/niceeval/src/runner/source-receipts/` 与 `packages/niceeval/src/runner/source-producer.ts` |
| Observability 五个 source family | Adapter terminal Turn 进入 `niceeval.agent-turns`；SessionManager context 进入 `niceeval.turn-contexts`；Sandbox wrapper 进入 `niceeval.sandbox-commands`；Runner clock / diagnostic sink 分别进入 `niceeval.runner-activities` 与 `niceeval.runner-diagnostics`。实现落点以 `packages/niceeval/src/{adapters,agents,sandbox,runner,record}/` 的 capture boundary 与 family declaration 为准。 |
| Observability reader-side fixed projection 与 source navigation | `packages/niceeval/src/inspection/{catalog,host,sources}.ts` 与 `packages/niceeval/src/record/host/source-navigation-relation.ts` 形成 closed source result；不形成用户可注册的统计层 |
| Assertions current semantic entry、v1→v2→v3→v4 相邻迁移与有界 collection receipt | `packages/niceeval/src/assertions/{api,runtime,match}.ts`、`packages/niceeval/src/assertions/record/` 与 `packages/niceeval/src/record/family/assertions/{definition.ts,persistence.ts,migrate/}` |
| Scope-bound reader 与按需读取 | `packages/niceeval/src/record/reader/`；只能经 `recordHost` 到达 |

Verdict、Score 和采用理由由 Assertions、Attempt outcome 与 Member Core 解释，不另建 durable family。
source receipt 的 `partial` 属于对应 payload；未声明 source 是 `not-recorded`，已声明但 payload、segment 或 blob
closure 不合法是 `invalid`。这些状态保持 source-local。未知 root format 是 open error；未贡献 family 只在
direct read、reference closure 或完整性检查需要它时返回 `family-definition-required`。

## Inspection 与 Delivery

| 目标契约 owner | 源码边界 |
|---|---|
| [Inspection](feature/inspection/README.md) | `packages/niceeval/src/inspection/{catalog,codec,host,source,sources}.ts` 拥有 operation catalog、closed document codec、selection audit、sealed source、missing、Evidence 与 comparison。 |
| Machine CLI | `packages/niceeval/src/inspection/cli/contribution.ts` 路由 `query discover / explain / run`；它只输出 closed result 的 canonical codec。 |
| [Insight](feature/insight/README.md) | `packages/niceeval/src/view/` 与 `view/cli/contribution.ts` 拥有 loopback server、session/Origin、完整 SQLite Snapshot delivery、refresh、last-good 与 SPA；浏览器 Worker 执行 Inspection 的固定 query。 |

实现时以对应 Feature 文档的 owner、输入和不变量为准。

## 其他核心区域

| 目标行为 | 当前源码区域 |
|---|---|
| Eval 与公开定义类型 | `packages/niceeval/src/{index,types}.ts`、`packages/niceeval/src/eval/` |
| Agent 与 Adapter public API | `packages/niceeval/src/agents/`、`packages/niceeval/src/adapters/` |
| Sandbox provider 与生命周期 | `packages/niceeval/src/sandbox/` |
| 用户 State、service module、SQLite worker 与迁移 | `packages/niceeval/src/state/{definition,composition,runtime,path,migrations,types,storage-worker,worker-protocol}.ts`；`state/cli/contribution.ts` 只挂载用户 State 迁移命令。 |
| 第一方 Insight SPA、loopback session 与运行时资源 | `packages/niceeval/src/view/`；读取完整 Snapshot 上的固定 Inspection query，不能成为作者 renderer 管线。 |

修改任一公共行为前，先回到对应 Feature 入口确认契约，再用本页定位影响面。
