# 真实场景 Repo

场景 Repo 是测试的真实用户项目和隔离单位，但分成两套互不复用的消费项目。功能 Repo 验收 NiceEval 自己拥有的
Eval、CLI、Runner、Record、Report、Package 与 Lifecycle；Adapter Repo 验收某个真实 SDK / CLI 的协议兼容性。两套 Repo 都不承载
第二套 Behavior / World 语义。

## 目录形状

```text
e2e/
├── eval/                           # ┐ Eval、Context、Assertions
├── cli/                            # │
├── runner/                         # │ 功能场景 Repo
├── record/                         # │ 公开 Record API / 格式 owner
├── report/                         # │ 子功能与 Journey 用测试文件命名
├── package/                        # │
├── lifecycle/                      # ┘
└── adapter/                        # Adapter 兼容性 Repo collection
    ├── ai-sdk/
    ├── codex-cli/
    ├── codex-app-server/
    └── local-protocol/
```

Host-side 的发现、pack、注入、executor 与 artifact 编排位于私有 workspace package
`packages/e2e-runner/`；场景 Repo 只由根入口编排，不在自己的 `package.json` 或 lockfile 声明 runner 依赖。

叶子项目至少包含：

```text
package.json
pnpm-lock.yaml
project.json
niceeval.config.ts
evals/
experiments/
test/
```

场景源 `package.json` 和签入 lockfile 不声明 `@niceeval/testkit`。`project.json` 中
`targets.e2e.metadata.niceeval.harness.testkit: true` 是消费意图的唯一真源。

根 runner 把当前 checkout 的 workspace Testkit 编译到 invocation-local scratch
snapshot。它只在隔离副本中注入 `file:` 目录依赖；场景源本身不使用 workspace
link。

直接进入场景执行 `pnpm test` 不是正式入口；它必须非零退出并引导用户在根目录运行
`pnpm e2e --repo <id>`。project metadata 的 `command` 直接调用原生 Vitest / Playwright 命令，仅由完成 candidate 与 Testkit 注入的根 runner 执行。

按需要增加 `agents/`、`reports/`、`src/`、`compose.yaml`、`Dockerfile` 和静态 fixture。
目录不必为了形式把每个子功能拆成 Repo。`runner/carry-reuse.test.ts` 与 `runner/history-dedup.test.ts` 可以消费相同的
功能依赖图；`report/first-eval-to-debug.spec.ts` 可以在自己的项目副本里完成 Journey。只有依赖、secret、executor、lane
或资源所有权改变时才增加 Repo；测试会写状态时先给它私有项目副本或结果根，不靠拉长 Repo 名隔离。

## 两套 Repo 的边界

功能 Repo 与 Adapter Repo 可以共同依赖 `@niceeval/testkit` 的进程、严格解码与 cleanup 原语，除此之外不共享现场：

| 边界 | 功能 Repo | Adapter Repo |
|---|---|---|
| 证明对象 | NiceEval 自己拥有的公开功能与跨功能 Journey | 一个外部 SDK / CLI 的真实协议兼容性 |
| Agent / backend | Repo 内签入的确定性 fixture | 对应真实 SDK、CLI、provider 或该协议的本地故障端 |
| 依赖图 | NiceEval candidate 与功能所需的最小依赖 | NiceEval candidate 加该 adapter 的精确上游依赖 |
| 结果根 | 该功能 Repo 的隔离结果 | 每个 `adapter/<id>` 自己的隔离结果 |
| 测试范围 | Eval、CLI、Runner、Record、Report、Package、Lifecycle 和功能 Journey | 最小运行路径加 adapter 特有的事件、usage、session、工具身份或故障 |

功能测试不能为了“更真实”改去 `adapter/ai-sdk` 或 `adapter/codex-cli` 运行；那会把功能回归与上游网络、凭据和版本漂移
绑在一起。Adapter 测试也不能因为会调用 `exp` / `show` 就接管 CLI 或 Report 的通用矩阵；这些命令只是读回协议证据的手段。

`adapter/` 是独立于功能 Repo 的 collection，不能把所有 adapter test 放入同一个叶子项目。
`ai-sdk/`、`codex-cli/`、`claude-code/`、`opencode/`、`bub/` 等每个上游入口都拥有自己的 package、配置、
凭据边界、结果根与公开 readback。

无密钥的 `local-protocol/` 只拥有确定性 protocol state / transport / fault / cleanup，不得用它的 typed fixture 宣称 live adapter 兼容。
多个纯 converter 只有在依赖、密钥、executor、runtime 与资源边界完全相同时才可共用一个无密钥载体；每个入口仍须有独立
fixture、Eval、Experiment、测试文件、项目副本 / 结果根与 owner anchor，默认并行不得共写现场。任一依赖图或资源边界分叉就拆 Repo。

## Repo project

每个场景叶子由一个 Nx `project.json` 同时表达项目身份、affected 图边和编排条件：

```ts
type Executor = { kind: "host" };

interface E2EMetadata {
  schemaVersion: 3;
  batch: string;
  areas: readonly (
    | "eval"
    | "cli"
    | "report"
    | "record"
    | "package"
    | "runner"
    | "adapter"
    | "sandbox"
    | "lifecycle"
  )[];
  lanes: readonly ("pr" | "main" | "nightly" | "release")[];
  executor: Executor;
  command: readonly [string, ...string[]];
  /** Maximum runtime for one test invocation; deterministic Repo 2 minutes, live provider Repo 3 minutes. */
  timeoutMinutes: number;
  harness?: {
    testkit?: boolean;
  };
  secrets: readonly string[];
  requires?: {
    docker?: boolean;
    externalNetwork?: boolean;
    platforms?: readonly ("linux" | "darwin")[];
    runtimes?: readonly string[];
    browsers?: readonly ("chromium" | "firefox" | "webkit")[];
  };
  artifacts: readonly string[];
}

interface E2EProject {
  name: `e2e-${string}`;
  root: `e2e/${string}`;
  tags: readonly ["kind:e2e", ...string[]];
  implicitDependencies: readonly string[];
  targets: {
    e2e: {
      /** Deliberately unresolved: direct Nx execution must fail before side effects. */
      executor: "nx:selection-only";
      cache: false;
      metadata: { niceeval: E2EMetadata };
    };
  };
}
```

metadata 不含测试标题、expected、page matrix、历史 bug、contract anchor 或 affected paths。canonical Repo ID 由
`root` 去掉 `e2e/` 推导；产品 owner 由 `implicitDependencies` 指向的 source domain project 表达。详细管理规则见
[任务图与 E2E 选择](../../task-orchestration/README.md)。

`batch` 是必填的 canonical lowercase placement ID，例如 `host-1`、`docker-1` 或 `browser-1`。它只决定 CI 共机分组，
不表示资源 capability；完整宿主运行条件仍以 `requires` 为唯一真源。

未来同类 Repo 过多时，直接把部分 metadata 改为 `host-2`、`host-3` 等新 ID。planner 会产生额外并行 cell，
不维护第二份 batch registry。

无法计算 diff 时多跑，不能静默少跑。显式 `--repo <id>` 不受 `--diff-path` 过滤。
多个显式 Repo 中任一个不在所选 lane 时，命令必须非零退出并列出该 Repo 的可用 lane。
`requires.runtimes`、`docker`、`browsers`、platform 与 secret 在 test 前有结构化 preflight。
`externalNetwork: true` 在 receipt 中写为“声明但未主动预检”。通用探测不能替代 Repo 自己拥有的 provider/network 行为。

同仓可信 PR 在 affected 集命中 live owner 时、main push 与 schedule 在完整 lane 中纳入这些 live Repo，并按 metadata 白名单注入已登记 secret；
Fork 与 Dependabot 使用无密钥 lane。人工 workflow dispatch 通过 `live_providers` 明确选择是否纳入。
显式 `--repo` 点名 live Repo 却同时排除 external network 属于配置错误，不能变成空计划假绿。

从 project `root` 推导的 ID 是 canonical 相对路径。它允许 `adapter/ai-sdk`，但不允许绝对路径、空段、dot traversal、反斜杠或控制符。
`artifacts` 只允许 canonical `dir/**` 或顶层文件 glob。非法形状使 discovery 聚合报错。
collector 逐段检查 copy root 与 artifact root，拒绝 source symlink、后代 symlink、特殊文件及目标 symlink。
durable root 先物理锚定，root 自身及以下拒绝 symlink。candidate、receipt 与 summary 的目录链也逐段检查。
任一内部 symlink 使该次运行成为 infra。

## Candidate 信任链与 Testkit 注入

根 runner 对每次本地整组或 CI workflow：

1. 从待测 checkout pack 一份 NiceEval candidate tgz；
2. 若选中 Repo 声明 `harness.testkit: true`，删除当前 workspace Testkit 的 `dist/` 并完整构建一次；
3. 把每个选中 Repo 复制到新的临时目录；
4. 只在副本中把 `niceeval` 指向 candidate，并新增指向 `packages/testkit` 的绝对 `file:` devDependency；
5. 安装后核对 NiceEval executable 与 candidate integrity；Testkit 只核对实际包名、唯一 directory resolution，以及
   realpath 位于副本自己的 pnpm virtual store；
6. 把 candidate digest、Testkit version/source/installed realpath（诊断）、Repo ID、artifact 路径和 candidate 复现命令写入摘要。

各场景 `pnpm-workspace.yaml` 对 `@parcel/watcher` 与 `msgpackr-extract` 显式关闭构建脚本：两者是 candidate 依赖图引入的
可选原生扩展，不启用时使用各自的 JS 回退实现。

场景 Repo 禁止 workspace link、相邻源码相对 import、直接执行根仓库 `src/` 或修改 `node_modules/niceeval`。
否则测试通过只说明工作树能自洽，不能说明发布包可消费。

Testkit 的进程、文件与生命周期原语先用非 NiceEval fixture 测试，再以当前 checkout 的目录依赖进入产品 E2E。
产品断言不得从 Testkit 或 candidate 派生 expected；receipt 必须区分 candidate 身份失败与 Testkit harness 注入失败。

测试正文也不能临时新建一个只写了 `package.json`、却没有安装候选包的嵌套 consumer，然后在里面运行
`pnpm exec niceeval`。Package 场景优先让叶子 Repo 本身就是目标 consumer；确实需要二级 consumer 时，runner 必须在那个目录
重复候选注入、安装和 executable 身份核验，并把两级收据都写入 artifact。

Release 必须发布通过 preflight 的同一 tarball；验收后重新 pack 会切断信任链。

场景源 manifest/lock 出现 `@niceeval/testkit`、`workspace:` 或 checkout 相对路径时，runner 在 prepare 前失败。
`file:` 只允许由 runner 在临时副本中指向当前 checkout 的 `packages/testkit`；NiceEval 始终指向已验证的 candidate tgz。

## Executor 与被测 Backend 分开

Executor 当前只回答一种运行位置：`host`，即本机 / Actions runner 的隔离副本。

被测 backend 回答 NiceEval 连接什么：本地 HTTP 进程、Docker Compose 服务、真实 SDK、真实 CLI、远端 provider 或 sandbox。
它是 Repo 自己的 fixture，不进入通用 executor 类型。

Docker 是 Repo 的 backend / sandbox 依赖，不属于 executor 类型。host executor 连接 Docker sandbox 不等于没有 Docker 边界；
声明 `requires.docker: true` 的 Repo 在 daemon 缺失时获得 `configuration`，不能留一个声明后运行时报 unsupported 的假契约。

## 数据与观察边界

- CLI 结果从 exit、stdout、stderr、PTY、JUnit 或 `show --json` 读取；
- Report 从 `show`、`view --out`、HTTP 和浏览器读取；
- Record 目录只作为 opaque 整体由 CLI 产生、复制或进入 Git，不通过 Library API 读取内部结构或写入；
- Adapter 从公开运行流、签入代表 Report 的 `show --page <route>` 与 `show --json` 读取；
- 不直接扫描 `.niceeval/` 私有布局；无法通过 CLI / Report 观察的事实属于呈现缺口，不以测试绕过；
- 不 import 候选内部类型给测试手写 expected。

测试可以从公开 history 取得动态 locator，因为 locator 是上一步用户获得的结果；它随后必须被另一条公开命令真正消费。

功能 Repo 的 `.niceeval` 只来自本次 invocation 中安装后 candidate 的完整 Experiment 运行。不得签入、下载或从另一个 Repo
复制结果作为常规测试输入。旧版本迁移若成为公开 CLI 契约，由 CLI Journey 使用最小完整目录 fixture 验收迁移结果，不把
具体文件 schema 变成作者契约。只读 case 可以共享本轮
冻结 evidence；修改 Eval、config、结果或执行 accept 的 case 必须在私有项目副本中先完成自己的初始运行。

## 隔离规则

- 根 runner 每个 Repo、每次重试都创建新副本；
- Vitest 文件保留默认并行，且不依赖顺序；同一 Repo 的共享 evidence 在 prepare 完成后只读；
- 需要写的测试使用独立结果根 / 项目副本；只有运行世界也不同，才为 Journey 增加独立 Repo；
- 短命控制文件位于 `withTempDir()` 创建的系统临时目录，每条 case 一份；需收集的 `.niceeval` / JUnit / trace 仍位于隔离 Repo 内；
- Docker container、network、volume 名带 run ID，不使用全局固定名；
- 本地 `--keep-workdir` 是显式诊断选项，保留 scratch 副本但不保留活进程；
  `CI` 变量存在时在任何运行副作用前拒绝，CI 永远收 artifact 后删除隔离副本；
- secret 只进子进程变量集合，摘要和 artifact 统一脱敏，不写进 fixture、manifest 或命令行。

未声明的敏感名变量不会进入 preflight、install 或 test。敏感名包含 token、key、secret、password、credential、auth、jwt 与数据库连接名。
PATH、locale、代理路由及 Node/pnpm 的普通运行变量保留。receipt 绝不写 secret 值。

根 runner 给每个原生 test command 注入新的非秘密 `NICEEVAL_E2E_INVOCATION_ID`。它的 outer supervisor 只拥有自己创建的 detached
process group；测试另开 session、container、server 或 Sandbox 时，仍由该 Repo 在资源 receipt 中证明终结。Owner 接管的 same-copy
两次 test 保留同一个安装副本，但必须使用两个不同的 invocation ID，且 receipt 按 test attempt 关联这两个 ID，避免 artifact namespace
collision 假红。

child `close` 后，runner 还会探测自己的 process group。残留组依次收到 TERM、grace 与 KILL。
capture 中的 groupCleanup 写入这次探测、所发信号与确认终态。它只承诺自己创建的 detached group。

隔离是可靠性的必要条件，但不等于可靠性已经成立。
新增、接管或实质修改 owner 时，使用根 `takeover` 入口固定 candidate、checkout、Testkit 与 source snapshot。
确定性 owner 还要在三个彼此隔离的副本、同一已安装副本连续两次、所属 Repo 默认并行和文件 / 标题单项运行中全部通过。

takeover summary 写入 source snapshot 的相对路径、字节数、SHA-256 清单和总 digest。
每份 receipt 绑定该 digest；矩阵核验六个观察标签、copy ID、attempt、唯一 invocation ID 与 cleanup 终态。
测试级 retry 不参与这项验收；任一次意外失败都说明自动化 owner 尚未成立。

真实 provider live owner 在可信 PR 的 affected 集或 main / nightly 全量 E2E 中完成真实兼容性运行与公开 readback；它不以 provider 随机性承担 takeover
重复门。

## Adapter Repo

Adapter collection 的拆分单位是“用户实际选择的公开 adapter 入口”，不是测试文件类型。确定性 UI Message Stream Repo 包含最小而真实的
Eval / Experiment 集：

- 一个正常消息往返；
- 一个该 adapter 独有能力，例如工具、session、MCP、usage 或 sandbox；
- 一个可控失败或断流；
- 公开 readback 能确认上游身份被正确保留 / 规范化。

每个 live Repo 默认只保留一条官方工厂的最小兼容性 Journey。只有新增该上游独有、且不能由既有 Journey 观察的协议行为时，
才增加第二条；可控失败与边界值矩阵仍归确定性 UI Message Stream Repo。

“把所有 Eval 跑完且 exit 0”不够。测试必须列出期望 Eval ID，并对每个必要结果或关键事件作断言，防止 discovery 少排后假绿。

Adapter Repo 中出现 `exp`、`show` 或代表 Report Page 不表示它也属于功能测试集合。它只保留能把真实 adapter 证据送入
公开读面的最短路径；同一 CLI 选择、Report 导航或 carry 规则仍由对应功能 Repo 唯一拥有。

只有 converter 的 SDK 可以拥有受限 live consumer glue，但边界是机械的：raw SDK frame 原样进入候选包的公开 converter；
Repo 不构造 `StreamEvent`，不手写 SDK 字段映射，不自行计算 canonical tool、usage 或终局。Glue 只处理 SDK invocation、
`AbortSignal`、session/resume 与应用特有 HITL orchestration，且必须在文档中明确它不是官方 factory。需要自定义 envelope 的
transport 不能把 envelope 称为 raw upstream protocol；无法守住这些限制时，保留 `unproven`，不建 live Repo。

UI Message Stream backend 固定版本和响应，可进入 PR；真实 provider 版本、模型和 CLI 身份写入 artifact，进入可信 lane。
二者应是不同叶子 Repo，避免共享依赖、结果与子进程变量后把本地 fixture 误报成某个 live adapter 的证明。

真实 provider 只拥有上游兼容性，不拥有确定性产品语义。结构化外部故障不算 pass；同一 candidate 的 AI 真实兼容性验收
可以替代本次有效 live 结果，并在 PR Test impact 写明版本、生产入口、公开观察与未守护风险。

## Repo 准入

新 Repo 合入前必须证明：

1. 可从仓库外副本安装候选 tarball；
2. 本地单条命令和单文件测试可复现；
3. expected 不来自候选；
4. 失败报告含阶段和原始收据；
5. 无密钥 Repo 能在 PR lane 运行，live Repo 缺 secret 时启动前明确失败；
6. 标成 `regression` 的历史 bug case 能杀死对应旧实现；只能证明相似风险的 case 不挂该 commit；
7. 被替代旧测试在同批删除。
8. 新确定性 owner 通过[可靠性接管门](../README.md#可靠性重复运行)；live owner 按上文在可信 affected 或 full E2E 中真实运行。

选择[不自动化](../README.md#不自动化)时不创建测试文件、空场景 Repo 或伪 owner，也不进入本节 Repo 准入。
该变更只在 PR / release 的 Test impact 保存本次 AI 真实验收收据。
