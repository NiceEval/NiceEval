# 真实场景 Repo

场景 Repo 是测试的真实用户项目和隔离单位，但分成两套互不复用的消费项目。功能 Repo 验收 NiceEval 自己拥有的
CLI、Runner、Record、Report、Package 与 Lifecycle；Adapter Repo 验收某个真实 SDK / CLI 的协议兼容性。两套 Repo 都不承载
第二套 Behavior / World 语义。

## 目录形状

```text
e2e/
├── cli/                            # ┐
├── runner/                         # │ 功能场景 Repo
├── record/                         # │ 公开 Record API / 格式 owner
├── report/                         # │ 子功能与 Journey 用测试文件命名
├── package/                        # │
├── lifecycle/                      # ┘
├── adapter/                        # Adapter 兼容性 Repo collection
│   ├── ai-sdk/
│   ├── codex-cli/
│   └── local-protocol/
└── scripts/                         # 发现、pack、注入、executor、artifact
```

叶子项目至少包含：

```text
package.json
pnpm-lock.yaml
e2e.json
niceeval.config.ts
evals/
experiments/
test/
```

场景源 `package.json` 和签入 lockfile 不声明 `@niceeval/testkit`；`e2e.json` 的 `harness.testkit: true`
是消费意图的唯一真源。根 runner clean-build 当前 checkout 的 workspace Testkit，再只在隔离副本中注入 `file:` 目录依赖；
场景源本身不使用 workspace link。
直接进入场景执行 `pnpm test` 不是正式入口；它必须非零退出并引导用户在根目录运行
`pnpm e2e --repo <id>`。manifest `command` 直接调用原生 Vitest / Playwright 命令，仅由完成 candidate 与 Testkit 注入的根 runner 执行。

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
| 测试范围 | CLI、Runner、Record、Report、Package、Lifecycle 和功能 Journey | 最小运行路径加 adapter 特有的事件、usage、session、工具身份或故障 |

功能测试不能为了“更真实”改去 `adapter/ai-sdk` 或 `adapter/codex-cli` 运行；那会把功能回归与上游网络、凭据和版本漂移
绑在一起。Adapter 测试也不能因为会调用 `exp` / `show` 就接管 CLI 或 Report 的通用矩阵；这些命令只是读回协议证据的手段。

`adapter/` 是独立于功能 Repo 的 collection，不能把所有 adapter test 放入同一个叶子项目。
`ai-sdk/`、`codex-cli/`、`claude-code/`、`opencode/`、`bub/` 等每个上游入口都拥有自己的 package、配置、
凭据边界、结果根与公开 readback。
无密钥的 `local-protocol/` 只拥有确定性 transport / fault / cleanup，不得用它的 canned event 宣称 live adapter 兼容。

## Repo Manifest

`e2e.json` 只描述编排条件：

```ts
type Executor =
  | { kind: "host" }
  | { kind: "docker"; image: string };

interface E2ERepoManifest {
  schemaVersion: 1;
  id: string;
  areas: readonly (
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
  timeoutMinutes: number;
  harness?: { testkit?: boolean };
  secrets: readonly string[];
  requires?: {
    docker?: boolean;
    externalNetwork?: boolean;
    platforms?: readonly ("linux" | "darwin")[];
    runtimes?: readonly string[];
    browsers?: readonly ("chromium" | "firefox" | "webkit")[];
  };
  paths: readonly string[];
  artifacts: readonly string[];
}
```

manifest 不含测试标题、expected、page matrix、历史 bug 或 contract anchor。`paths` 只是选择优化；无法计算 diff 时多跑，
不能静默少跑。显式 `--repo <id>` 命中已知 Repo、却被所选 lane 全部过滤时必须非零退出并列出可用 lane，不能把零项当成功。

## Candidate 信任链与 Testkit 注入

根 runner 对每次本地整组或 CI workflow：

1. 从待测 checkout pack 一份 NiceEval candidate tgz；
2. 若选中 Repo 声明 `harness.testkit: true`，删除当前 workspace Testkit 的 `dist/` 并完整构建一次；
3. 把每个选中 Repo 复制到新的临时目录；
4. 只在副本中把 `niceeval` 指向 candidate，并新增指向 `packages/testkit` 的绝对 `file:` devDependency；
5. 安装后核对 NiceEval executable 与 candidate integrity；Testkit 只核对实际包名、唯一 directory resolution，以及
   realpath 位于副本自己的 pnpm virtual store；
6. 把 candidate digest、Testkit version/source/installed realpath（诊断）、Repo ID、artifact 路径和 candidate 复现命令写入摘要。

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

Executor 回答测试进程在哪里运行：

- `host`：本机 / Actions runner 的隔离副本；
- `docker`：固定 digest 镜像内的隔离副本，不把源码树可写挂载进容器。

被测 backend 回答 NiceEval 连接什么：本地 HTTP 进程、Docker Compose 服务、真实 SDK、真实 CLI、远端 provider 或 sandbox。
它是 Repo 自己的 fixture，不进入通用 executor 类型。

因此 Docker executor 不自动证明真实 provider；host executor 连接 Docker sandbox 也不等于没有 Docker 边界。
第一版只实现 host 和 Docker 两种 executor。

## 数据与观察边界

- CLI 结果从 exit、stdout、stderr、PTY、JUnit 或 `show --json` 读取；
- Report 从 `show`、`view --out`、HTTP 和浏览器读取；
- Record 格式测试可以用公开 `niceeval/record` API；
- Adapter 从公开运行流和 `show --execution/--timing/--json` 读取；
- 除非磁盘格式本身就是被测契约，不直接扫描 `.niceeval/` 私有布局；
- 不 import 候选内部类型给测试手写 expected。

测试可以从公开 history 取得动态 locator，因为 locator 是上一步用户获得的结果；它随后必须被另一条公开命令真正消费。

## 隔离规则

- 根 runner 每个 Repo、每次重试都创建新副本；
- Vitest 文件保留默认并行，且不依赖顺序；同一 Repo 的共享 evidence 在 prepare 完成后只读；
- 需要写的测试使用独立结果根 / 项目副本；只有运行世界也不同，才为 Journey 增加独立 Repo；
- 短命控制文件位于 `withTempDir()` 创建的系统临时目录，每条 case 一份；需收集的 `.niceeval` / JUnit / trace 仍位于隔离 Repo 内；
- Docker container、network、volume 名带 run ID，不使用全局固定名；
- 本地 `--keep-workdir` 是显式诊断选项，CI 永远收 artifact 后删除隔离副本；
- secret 只进子进程变量集合，摘要和 artifact 统一脱敏，不写进 fixture、manifest 或命令行。

隔离是可靠性的必要条件，但不等于可靠性已经成立。新增、接管或实质修改 owner 时，同一测试还要在三个全新副本、
同一副本连续两次、所属 Repo 默认并行和文件 / 标题单项运行中全部通过，并取得 owned resource 终结收据。
测试级 retry 不参与这项验收；任一次意外失败都说明自动化 owner 尚未成立。

## Adapter Repo

Adapter collection 的拆分单位是“用户实际选择的公开 adapter 入口”，不是测试文件类型。确定性本地协议 Repo 包含最小而真实的
Eval / Experiment 集：

- 一个正常消息往返；
- 一个该 adapter 独有能力，例如工具、session、MCP、usage 或 sandbox；
- 一个可控失败或断流；
- 公开 readback 能确认上游身份被正确保留 / 规范化。

每个 live Repo 默认只保留一条官方工厂的最小兼容性 Journey。只有新增该上游独有、且不能由既有 Journey 观察的协议行为时，
才增加第二条；可控失败与边界值矩阵仍归确定性本地协议 Repo。

“把所有 Eval 跑完且 exit 0”不够。测试必须列出期望 Eval ID，并对每个必要结果或关键事件作断言，防止 discovery 少排后假绿。

Adapter Repo 中出现 `exp`、`show` 或 `--execution` 不表示它也属于功能测试集合。它只保留能把真实 adapter 证据送入
公开读面的最短路径；同一 CLI flag、Report 导航或 carry 规则仍由对应功能 Repo 唯一拥有。

本地协议 backend 固定版本和响应，可进入 PR；真实 provider 版本、模型和 CLI 身份写入 artifact，进入可信 lane。
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
8. 新 owner 通过[可靠性接管门](../README.md#可靠性重复运行)。

选择[不自动化](../README.md#不自动化)时不创建测试文件、空场景 Repo 或伪 owner，也不进入本节 Repo 准入。
该变更只在 PR / release 的 Test impact 保存本次 AI 真实验收收据。
