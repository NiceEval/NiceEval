# 官方 Testkit

`@niceeval/testkit` 是场景 Repo 共用的机械设施，不是 NiceEval 产品行为 DSL。它减少进程、数据解码和资源终结代码的复制，
但不替测试决定用户做什么、什么结果算正确。

交付方式的比较与 stable-outer 裁决见 [Design · Testkit](../../design/user-readable-testing/TESTKIT.md)。

## 为什么值得试点

当前 Example 有 10 个独立场景 Repo。复用按消费者而不是文件数判断：

| 能力 | 独立消费者 | v1 |
|---|---:|---|
| run + 完整 process receipt | 10 | 接收 |
| 严格 JSON | 9 | 接收 |
| 严格 NDJSON | 6 | 接收 |
| `only` / `defined` | 7 | 接收 |
| 长驻 process + readiness + cleanup | AI SDK、Lifecycle | 接收窄接口 |
| 临时目录 | Runner carry、Journey | 接收 |
| HTTP fixture | Local protocol | 保留 Repo |
| 项目复制规则 | Runner carry | 保留 Repo |
| Browser lifecycle | Report、Journey | 继续使用 Playwright Test |
| stdin / PTY | 尚无两个相同消费者 | 暂不接收 |

第一批能替换 9 份 process、7 份 assertion、1 份 temp-dir support，共 741 行；CommonJS test 另有约 27 行内联 spawn。
Runner carry 的 project copy 与 Local protocol 的 HTTP handler 共 101 行，连同 Playwright 页面动作和所有 expected 原样保留。

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
  "exp", "smoke", "--dry", "--json",
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

这些内容一旦上移，测试会变短，但读者无法从正文看出命令、独立 oracle 和失败接缝。完整目标代码见
[Testkit Example](example/testkit/README.md)。

## Testkit 自测

Testkit candidate 不用 NiceEval 自测。固定 fixture process 分别产生：

- spawn error、提前退出、不同 exit / signal；
- stdout / stderr 交错、分块 UTF-8 与超过展示上限的完整输出；
- 完整 JSON、前后噪声、截断 JSON、malformed NDJSON 与错误行号；
- waiter 挂载前已经输出 readiness、稍后成功、timeout 与进程提前退出；
- body 成功 / 失败和 cleanup 成功 / 失败的四种组合；
- POSIX process group 或声明过的 Windows capability；
- 临时目录在成功、失败和 timeout 后都被回收。

关键 parser、timeout 与 cleanup 分支要做 mutation kill。Meta-test 通过后，再用 pinned known-good NiceEval 验证 Vitest、
Playwright、run-only 与 long-lived process 四个 pilot。

## 迁移顺序

1. 私有 packaged prototype：实现并跑 meta-tests，不进入产品 release gate；
2. 发布精确版本 0.x，建立 provenance、ESM / CJS、Node 下限和 lockfile integrity；
3. 先迁移 CLI、Report、AI SDK 与 Lifecycle 四种 pilot；
4. 确认失败诊断不退化，再迁移其它 Repo，并同批删除被替代 support；
5. 连续两个 release 稳定且出现两个仓库外消费者后，再决定公开稳定承诺。

删除或移动文件后，收尾必须检查并删除本次产生的空目录。
