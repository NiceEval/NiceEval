# 官方 Testkit

`@niceeval/testkit` 是场景 Repo 共用的机械设施，不是 NiceEval 产品行为 DSL。它减少进程、数据解码和资源终结代码的复制，
但不替测试决定用户做什么、什么结果算正确。

Testkit 不维护独立 Unit 套件。CLI、Runner、Report、Record、Package 与 Lifecycle 场景通过安装后的 Testkit 入口实际调用
进程、文件系统、artifact staging 与资源生命周期原语；同一原语不再配一套 fixture 自测。类型与构建错误由 `typecheck` 和 clean build 阻断，
运行错误由最先使用它的真实场景收据或资源终态阻断。

Testkit 的源码和身份都跟随当前 checkout。根 runner 直接把源码编译到本次
invocation 的 scratch snapshot，再把该 snapshot 作为本地目录依赖只注入场景
隔离副本。它不先变成 tarball，也不获得发布 artifact 或独立重新执行承诺。
场景源不声明 workspace 或本地路径，避免绕开根 runner。

## 项目与身份

源码位于 `packages/testkit/`，是根 `pnpm-workspace.yaml` 的 `packages/*` 成员。根 workspace、根 lockfile 与根
`packageManager` 是唯一安装权威；`packages/**` 下不得再出现局部 workspace 或 lockfile。`e2e/**` 和
`examples/**` 不是 workspace member。

包名固定为 `@niceeval/testkit`，`package.json` 必须声明 `"private": true`；version 只是收据中的诊断信息，
不是身份、缓存键或稳定性承诺。Testkit 不发布 npm、不采用独立 semver/tag/workflow，也不对仓外消费者建立 API 承诺。
若未来要对外提供测试库，应作为新产品重新设计，不复用本内部包的假公开面。

Testkit 与根 E2E harness 统一使用 Node 22，不维护独立的 Node 兼容矩阵。内部包同时提供 ESM、CJS 与对应类型入口；
构建必须直接输出到新的 staging package，再在同一 scratch filesystem 原子
发布；不得读取、删除或写入共享 `packages/testkit/dist`。runner 校验 package
metadata/exports，并在 install 前、install 后和副本 cleanup 后核对 snapshot
SHA-256。这个 digest 只证明本次临时目录没有被改写，不是发布或 replay 身份。
Testkit 不依赖 NiceEval、根 runner 或 scenario，保持 bootstrap 无环。

## 准入边界

能力按机械契约是否跨至少两个独立 Repo 稳定复用决定，不按测试文件数量决定。

| 能力 | 归属 |
|---|---|
| 命令执行、完整 ProcessReceipt、严格 JSON / NDJSON | Testkit |
| 长驻进程、readiness、timeout 与资源终结 | Testkit 的窄接口 |
| 临时目录与带显式策略的项目副本 | Testkit |
| 显式 source / destination 的 artifact staging | Testkit |
| Browser、context、trace 与 screenshot | Playwright Test |
| stdin / PTY 的产品语义 | 对应 CLI Repo，形成跨 Repo 稳定机械协议前不上移 |

Testkit 只接收稳定机械协议。页面动作、项目排除策略与领域 expected 始终留在 owner 文件。

## API 形状

### 命令与收据

```ts
export type Argv = readonly [string, ...string[]];

export interface ProcessReceipt {
  argv: Argv;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  diagnosticTruncation: { stdout: boolean; stderr: boolean };
  diagnostic(): string;
  json<T = unknown>(): T;
  ndjson<T = unknown>(): T[];
  expResult(): ExpResultEvent;
}

export function runProcess(
  argv: Argv,
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
): Promise<ProcessReceipt>;
```

argv 仍以数组出现在调用点，收据保存完整 argv。`diagnostic()` 只裁剪展示，不改变 `stdout` / `stderr` 原值；
`diagnosticTruncation` 让读者看见哪条展示被裁剪。parser 永远读取完整原值。`env` 合并进父进程变量集合，
其键值不会写入诊断，以免泄漏 secret。

`json()` 只接受一个完整 JSON 文档。`ndjson()` 只允许末尾换行，空白噪声、截断内容和 malformed line 都失败；错误包含行号和
原始进程诊断。泛型只是测试本地的字段提示，不从候选包导入 schema，也不验证 NiceEval 领域字段。

Testkit 直接导出公开原始 `ExpEvent` / `ExpResultEvent` 类型，不改名、不折叠字段。`expResult()` 只确认首行是
`niceeval.exp` 的 `start`、末行是字段合法的公开 `result`，然后原样返回末行；它不折叠 verdict、不检查退出码，也不提供
expected 辅助断言。需要检查逐 Eval 身份的场景仍直接用 `ndjson<ExpEvent>()`；其余 Adapter 直接对 `expResult()` 中的
`passed` / `failed` / `errored` / `completion` 写精确预期。

非零 exit 与 signal 会返回收据，`timedOut` 区分 Testkit timeout 与被测进程自行退出。spawn 本身失败时抛
`ProcessStartError`，错误携带完整 argv、cwd 与原始 cause；调用方不用猜是产品 exit 还是命令没有启动。

可以在文件头建立固定命令前缀，但产品参数仍留在调用点：

```ts
const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

const dry = await niceeval.run([
  "exp", "carry", "--dry", "--json",
]);
```

收据中的最终 argv 必须等于前缀和参数的逐项拼接。Testkit 不使用 shell 字符串，不根据 scenario 名选择命令。

### 进程生命周期

```ts
export interface ProcessHandle {
  readonly done: Promise<ProcessReceipt>;
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  signal(signal: NodeJS.Signals): boolean;
  dispose(): Promise<void>;
}

export function startProcess(argv: Argv, options?: StartOptions): ProcessHandle;

export function withProcess<T>(
  argv: Argv,
  options: StartOptions,
  body: (process: ProcessHandle) => Promise<T>,
): Promise<T>;
```

`withProcess()` 是默认入口。readiness 失败、轮询超时、断言异常和正常返回都会进入幂等 cleanup；默认按
TERM → grace period → KILL 结束 owned process。正文已经让进程退出时，cleanup 是 no-op。

`handle.signal()` 永远只向启动的根进程 PID 发送产品刺激。`processGroup: true` 只改变 `dispose()` 与 timeout 的异常终结范围，
让它们终止整组后代。两者不能混成一个动作：Lifecycle 测试若把 SIGINT 直接发给整组，就会由 Testkit 杀掉 backend，
即使产品 teardown 已失效，资源断言也可能假绿。

POSIX 上的 `dispose()` 在根进程已退出后仍检查它创建的 process group；同组后代仍存活时继续执行 TERM → grace → KILL，
并等待整组消失。Windows 没有等价的负 PID group signal，`processGroup: true` 会在 spawn 前明确失败，不静默退化成只杀根进程。

正文和 cleanup 同时失败时抛 `AggregateError([bodyError, cleanupError])`，主错误排第一并作为 cause。只有 cleanup 失败时，
直接抛 cleanup error。

`startProcess()` 只是 caller-owned escape hatch。需要跨 `beforeAll` / `afterAll` 共享时，调用方必须在原生 runner teardown 中
调用 `dispose()`。Testkit 不依赖 GC，也不声称 runner 被 SIGKILL 后还能运行 JavaScript cleanup。

根 runner 仍必须把每个 Repo 放入独立进程组或 container。测试 runner hard timeout / cancel 时由外层回收。POSIX process group、
Windows tree kill 和 container cleanup 是 capability，不能静默降级后仍宣称“无 orphan”。

### 其它 v1 原语

```ts
export function only<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
  diagnostic?: string | (() => string),
): T;

export function defined<T>(
  value: T | null | undefined,
  diagnostic?: string | (() => string),
): T;

export function withTempDir<T>(
  prefix: string,
  body: (root: string) => Promise<T>,
): Promise<T>;

export function waitForOutput(
  process: ProcessHandle,
  stream: "stdout" | "stderr",
  pattern: RegExp,
  options: { timeoutMs: number; label: string },
): Promise<string>;

export function pollUntil<T>(
  probe: () => Promise<T | undefined>,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T>;
```

`waitForOutput` 先检查句柄从 spawn 起保存的字节，再订阅新 chunk，不能因 waiter 挂得稍晚而漏掉 readiness。
`only` 只检查“恰好一个”，谓词与对象身份留在测试。`pollUntil` 只负责时间和最后一次错误；`/health`、信息文件、HTTP 状态等
ready 条件由 Repo 提供。
`withTempDir` 在系统临时目录下为每次调用创建唯一路径，并在正文成功或失败后删除。它用于短命 fixture 收据，不用于要收集的结果根、JUnit 或 trace。

### 隔离目录与 artifact staging

```ts
export type ArtifactStageEntry = {
  source: string;
  target: string;
  optional?: boolean;
};

export type StageArtifactsReceipt = {
  copied: readonly Array<{ source: string; target: string }>;
  skipped: readonly Array<{
    source: string;
    target: string;
    reason: "optional-source-missing";
  }>;
};

export function stageArtifacts(options: {
  sourceRoot: string;
  destinationRoot: string;
  entries: readonly ArtifactStageEntry[];
  collision: "error";
}): Promise<StageArtifactsReceipt>;

export function withProjectCopy<T>(
  options: {
    from: string;
    prefix: string;
    omitTopLevel?: readonly string[];
    links?: readonly {
      from: string;
      to: string;
      type?: "file" | "dir" | "junction";
    }[];
  },
  body: (project: { root: string }) => Promise<T>,
  staging?: {
    stageArtifacts: {
      destinationRoot: string;
      entries: readonly ArtifactStageEntry[];
      collision: "error";
    };
  },
): Promise<T>;
```

`withProjectCopy` 默认只执行逐字节复制，不猜 package manager 或 NiceEval 目录。`omitTopLevel` 只匹配起始目录的第一层名称；
`links[].to` 必须是副本内的相对路径，不能越出临时根。成功、正文失败和链接失败都会删除整个副本。

`stageArtifacts()` 是纯机械的、显式根目录之间的复制原语。

- `sourceRoot` 和 `destinationRoot` 都是绝对目录，且不得相同或互为祖先/后代。重叠判断以 `realpath` 取得的物理目录为准，祖先路径的 symlink 不能绕过它。这样 source entry 不会吸入 destination 内的私有 staging 目录。
- 每个 `source` / `target` 都是非空相对路径，并分别在自己的 root 内完成 containment 检查。
- `collision` 只允许 `"error"`。任何 target 都会在复制前检查重复、父子重叠与已存在状态；Testkit 不会删除或改写已有 target。
- source 本身或递归后代有 symlink 时失败。destination root 到 target parent 的已有链含 symlink 时同样失败。
- 缺失 source 默认失败；只有显式 `optional: true` 才写入 `skipped` receipt。

所有 source 先复制到 `destinationRoot` 内私有临时目录，再提交原来不存在的 target；单次 staging 失败只回滚这一调用
新建的 inode 与空父目录，不触碰既有路径或后来替换掉该 inode 的路径。返回的 receipt 只报告声明的 `source` / `target` 和 copied / skipped 状态，
不猜 `.niceeval`、case 名、cwd 或 artifact 布局。

Node 没有可移植的“目录 `rename` 且禁止替换”原语，因此提交绝不对 target 使用 `rename`。普通文件以排他的
`COPYFILE_EXCL` 创建；目录先以排他的 `mkdir` 取得 root target，再以不替换既有条目的方式写入 descendants。
某个 target 在排他创建前出现时，stage 会失败而不替换该 target。

目录树不是原子发布物，调用方必须独占自己的 destination namespace。其他进程并发写入同一 namespace 时，读者可能看见未完成的树；
这种并发不属于 Testkit 可协调的资源租约。

`withProjectCopy` 的第三参数只有上述声明式 `stageArtifacts` 配置。内部固定把副本 `project.root` 作为 `sourceRoot`，不接受任意 staging callback。

- 正文成功或失败后都会先 stage，再 cleanup 副本。
- 多错误按 `[bodyError, stagingError, cleanupError]` 排列。存在 body error 时它始终排第一并作为 `cause`。
- 场景调用点自行决定 destination 布局。根 runner 注入的 `NICEEVAL_E2E_INVOCATION_ID` 必须先校验为单个安全 path segment。
- case 名同样是单个安全 segment。Report 一类的额外目录必须是规范且受 containment 约束的相对路径，再拼进该 case namespace。

核心 Unit 不为了“统一写法”默认依赖 Testkit。纯函数 fixture、fake clock、barrier 和领域 factory 继续留在 Vitest Unit；
只有它们与第二个独立消费者形成完全相同的机械契约时，才按同一准入规则评估。

## 不进入 Testkit 的内容

- `ExpPlanDocument`、`HistoryDocument`、`ExecutionDocument` 等派生领域文档；
- 对原始 `ExpEvent` / `ExpResultEvent` 字段的二次命名、折叠或领域解释；
- 工具名和 sentinel 的 expected；
- `runExperiment()`、`showHistory()`、`expectCarry()`、`openAttempt()` 等产品动作；
- `.niceeval/` 私有目录读取或候选导出的常量；
- Report href、role、label 与页面 expected；
- local provider 的 502、response body 和错误阶段；
- Docker、sandbox、backend、container 或 lease 的“已经释放”推断；
- Playwright 的 browser、context、page、trace 与 screenshot 生命周期。

这些内容一旦上移，测试会变短，但读者无法从正文看出命令、独立 oracle 和失败接缝。

## 真实场景验收

- CLI、Runner、Package 与 Lifecycle 用 `command()`、`withProjectCopy()` 和进程收据执行仓库外用户动作；
- Runner 与 Lifecycle 用 `only()`、`defined()` 和 `pollUntil()`核对真实结果与资源终态；
- Report 与确定性 UI Message Stream 场景用 `withProcess()`、`waitForOutput()`和严格数据解码观察长驻进程；
- Record 与 Lifecycle 用 `withTempDir()`证明临时资源在正文结束后消失；
- Eval 与 Report 在 `withProjectCopy()` 的声明式 staging 中保留本轮 artifact，供 runner 收集而不作为下一 case 的输入。

这些场景已经让主要原语经过真实进程、目录、artifact staging 和 cleanup。为某个边缘输入另造 Testkit fixture 仍是在第二层重复同一机械命题，
不因更易定位而获得 Unit 资格。若场景无法稳定制造某个设施故障，就按[不自动化](README.md#不自动化)处置，不建立脆弱自测。

## 构建与采用门禁

1. `pnpm --filter @niceeval/testkit typecheck` 不使用 NiceEval；根 frozen install 必须能直接运行，Testkit 不设独立 Unit 命令。
2. 每次根 runner invocation 只在确有 `harness.testkit: true` 消费者时，把当前 Testkit 编译成 scratch snapshot 一次；不 pack、不上传。
3. runner 只在隔离副本中加入指向该 scratch snapshot 的绝对 `file:` 目录依赖。真实 `pnpm install` 必须产生唯一 directory
   resolution，安装后的包名与版本正确，realpath 位于副本自己的 virtual store，而不是 checkout 源目录。
4. NiceEval candidate tgz 不得包含 `packages/testkit/**`，任何 dependency 字段也不得声明 `@niceeval/testkit`。
5. 场景以 `e2e.json` 的 `harness.testkit: true` 声明消费意图；场景源 `package.json` / lockfile 不包含 Testkit、`workspace:`
   或预先签入的本地目录引用。
6. receipt 只保存 Testkit version、checkout 相对 source path、snapshot digest 与副本内 installed realpath；这些字段只供诊断。
   exact replay 只描述保留的 NiceEval candidate 字节，不把当前 checkout 的 Testkit 伪装成可独立重新执行的 artifact。
7. Testkit、根 workspace/lock 或注入契约变化时，plan 使 path 优化 fail-open，选中该 lane 全集。未来若缓存 Testkit 构建，
   cache key 必须来自源码与构建输入，不能用 version 或 pnpm store 命中代替当前 checkout 身份。

删除或移动文件后，收尾必须检查并删除本次产生的空目录。
