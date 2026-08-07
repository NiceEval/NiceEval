# 官方 Testkit

`@niceeval/testkit` 是场景 Repo 共用的机械设施，不是 NiceEval 产品行为 DSL。它减少进程、数据解码和资源终结代码的复制，
但不替测试决定用户做什么、什么结果算正确。

Testkit 遵守 stable-outer / candidate-inner：场景 Repo 精确锁定 Testkit，产品 gate 只替换 NiceEval candidate。

## 项目与发布身份

源码位于 `packages/testkit/`，但它是独立 pnpm 项目，不是根 workspace member。该目录拥有自己的
`pnpm-workspace.yaml`、lockfile、`package.json`、构建与发布命令；在目录内执行 frozen install 不得改写根 lockfile。
包名固定为 `@niceeval/testkit`，使用独立 semver，Node 下限为 18，同时发布 ESM 与 CJS exports。0.x 仍是实验性 API；
达到本文末尾的稳定门槛前不建立稳定承诺。每次候选包验收都在仓库外创建 ESM 与 CJS consumer，并在 Node 18 导入公开入口。

`testkit-vX.Y.Z` 只触发 `.github/workflows/release-testkit.yml`，产品 `vX.Y.Z` 不发布 Testkit。发布链先用非 NiceEval fixture 完成 meta-test，
再只 pack 一次 tarball。仓库外 pilot 把这份 tarball 与 registry 上精确版本的 known-good NiceEval 组合；publish 直接消费
已经通过 pilot 的同一字节，不重新 pack。发布后核对 registry integrity、version、provenance commit 与 tag。

Testkit 首次尚未发布时，NiceEval 产品 gate 明确阻塞；不能用 workspace、`file:` 或本地 tarball 把 Testkit candidate
偷渡进产品验收。发布成功后，以普通依赖升级提交把场景 Repo 改到 registry 精确版本。坏版本不 unpublish；发布补丁版，
消费者继续用精确 pin 回退。

## 准入边界

能力按机械契约是否跨至少两个独立 Repo 稳定复用决定，不按测试文件数量决定。

| 能力 | 归属 |
|---|---|
| 命令执行、完整 ProcessReceipt、严格 JSON / NDJSON | Testkit |
| 长驻进程、readiness、timeout 与资源终结 | Testkit 的窄接口 |
| 临时目录与带显式策略的项目副本 | Testkit |
| HTTP listener 生命周期 | Testkit；path、status、body 与错误阶段留在 Repo |
| Browser、context、trace 与 screenshot | Playwright Test |
| stdin / PTY 的产品语义 | 对应 CLI Repo，形成跨 Repo 稳定机械协议前不上移 |

Testkit 只接收稳定机械协议。页面动作、HTTP 响应策略、项目排除策略与领域 expected 始终留在 owner 文件。

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

### 隔离目录与本地 HTTP

```ts
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
): Promise<T>;

export function withHttpServer<T>(
  handler: (request: Request) => Response | Promise<Response>,
  body: (server: { readonly url: string }) => Promise<T>,
  options?: { hostname?: string; port?: number },
): Promise<T>;
```

`withProjectCopy` 默认只执行逐字节复制，不猜 package manager 或 NiceEval 目录。`omitTopLevel` 只匹配起始目录的第一层名称；
`links[].to` 必须是副本内的相对路径，不能越出临时根。成功、正文失败和链接失败都会删除整个副本。

`withHttpServer` 默认监听 `127.0.0.1:0`，把实际 origin 作为 `url` 交给正文。handler 决定 path、status、header、body 与延迟；
正文结束后 Testkit 关闭 listener，并在端口仍被占用时让测试失败。它不是 NiceEval provider mock。

核心 Unit 不为了“统一写法”默认依赖 Testkit。纯函数 fixture、fake clock、barrier 和领域 factory 继续留在 Vitest Unit；
只有它们与第二个独立消费者形成完全相同的机械契约时，才按同一准入规则评估。

## 不进入 Testkit 的内容

- `ExpPlanDocument`、`HistoryDocument`、`ExecutionDocument` 等领域类型；
- format、schemaVersion、verdict、locator、Eval ID、工具名和 sentinel；
- `runExperiment()`、`showHistory()`、`expectCarry()`、`openAttempt()` 等产品动作；
- `.niceeval/` 私有目录读取或候选导出的常量；
- Report href、role、label 与页面 expected；
- local provider 的 502、response body 和错误阶段；
- Docker、sandbox、backend、container 或 lease 的“已经释放”推断；
- Playwright 的 browser、context、page、trace 与 screenshot 生命周期。

这些内容一旦上移，测试会变短，但读者无法从正文看出命令、独立 oracle 和失败接缝。

## Testkit 自测

Testkit candidate 不用 NiceEval 自测。固定 fixture process 分别产生：

- spawn error、提前退出、不同 exit / signal；
- stdout / stderr 交错、分块 UTF-8 与超过展示上限的完整输出；
- 完整 JSON、前后噪声、截断 JSON、malformed NDJSON 与错误行号；
- waiter 挂载前已经输出 readiness、稍后成功、timeout 与进程提前退出；
- body 成功 / 失败和 cleanup 成功 / 失败的四种组合；
- POSIX process group 或声明过的 Windows capability；
- 临时目录在成功、失败和 timeout 后都被回收。
- 项目复制的排除项、链接越界拒绝、正文与删除同时失败；
- HTTP handler 的动态端口、请求传递、正文失败与 listener 终止确认。

关键 parser、timeout 与 cleanup 分支要做 mutation kill。Meta-test 通过后，再用 pinned known-good NiceEval 验证 Vitest、
Playwright、run-only 与 long-lived process 四个 pilot。

## 发布与采用门禁

1. 本地 meta-test 不使用 NiceEval；仓库外 pilot 只使用 registry known-good NiceEval，不使用产品 candidate；
2. workflow 从 pilot 到 publish 保存同一 tarball SHA-512，且 registry `dist.integrity` 与之对应；
3. 场景 Repo 只消费带 provenance、ESM / CJS、Node 下限和 lockfile integrity 的精确 registry 版本；
4. 产品 run receipt 保存 Testkit version、registry source 与 integrity；注入 NiceEval 前后这些值逐字相同；
5. 每次采用先由一个功能 Repo 与一个 Adapter Repo 校准失败诊断，再扩大消费者；
6. 新 Testkit owner 接管时，同批删除被替代 support，不保留两套机械实现；
7. 至少连续两个 release 稳定且出现两个仓库外消费者，才建立公开稳定承诺。


删除或移动文件后，收尾必须检查并删除本次产生的空目录。
