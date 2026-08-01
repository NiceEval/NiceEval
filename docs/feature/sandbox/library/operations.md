# 操作 Sandbox

`t.sandbox`、Adapter 拿到的 `Sandbox` 与 layer callback 拿到的 `SandboxCommandTarget` 共用同一套 `SandboxOperations` 词汇和退出码语义。不同视图只删能力，不允许同名方法改变行为。

## 一份运行中操作协议

```ts
interface SandboxOperations {
  /** Sandbox 内所有相对路径的解析锚点。 */
  readonly workdir: string;

  runCommand(
    command: string,
    args?: readonly string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
  runShell(script: string, options?: CommandOptions): Promise<CommandResult>;

  runCommandOrThrow(
    command: string,
    args?: readonly string[],
    options?: CommandOptions,
  ): Promise<SuccessfulCommandResult>;
  runShellOrThrow(
    script: string,
    options?: CommandOptions,
  ): Promise<SuccessfulCommandResult>;

  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  pathExists(path: string): Promise<boolean>;
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** 有界、脱敏的命令摘要；provider 原始结果可以省略，最外层调用补齐。 */
  readonly command?: string;
}

interface SuccessfulCommandResult extends CommandResult {
  readonly exitCode: 0;
}

interface CommandOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly root?: boolean;
  readonly stream?: boolean;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onStdout?: (chunk: string) => void | Promise<void>;
  readonly onStderr?: (chunk: string) => void | Promise<void>;
}
```

`runCommand()` 把 argv 原样交给进程，不经 shell；`runShell()` 才解释管道、重定向与 `&&`。两者都返回任意 `exitCode`，非零不是 Promise failure，也不自动产生断言。

作者确实要求命令成功时使用名字写明策略的 `runCommandOrThrow()` / `runShellOrThrow()`。它们仅把非零退出转成携带完整 `CommandResult` 的 command-exit error；timeout、取消、transport failure 在四个方法上都会 reject。

没有 `tryCommand()` / `tryShell()`：如果普通方法叫 `runCommand`，它就不应暗含“必须成功”；checked 语义只放在 `OrThrow` 后缀上。同一段 probe 因此直写：

```ts
const probe = await sandbox.runCommand("git", ["--version"]);
if (probe.exitCode !== 0) {
  throw new EvalFatalError(`git probe failed: ${probe.stderr}`);
}
```

命令不会自动重试。命令可能已产生副作用，只有调用者能证明幂等时，才在自己的 layer 或 eval 逻辑里写显式重试。

### 命令 timeout 与取消

`timeoutMs` 是单条命令的显式上限；省略时只受 Attempt deadline。`signal` 与外层 signal 合并，任一取消都进入同一命令树终止协议。

Promise 因 timeout、取消、Attempt interruption 或 Agent runtime cancellation settle 前，Provider 必须确认本次受管命令树已终止；若不能精确终止，就退休并停止整个 Sandbox。只关 stdout/stderr 流、PTY 或 transport 不算终止。

正常命令成功结束后，关闭 transport / session 不得顺带杀死命令有意启动的独立任务服务。保留哪些任务服务由 Sandbox Case 与 reuse/keep 契约决定，不由命令客户端连接寿命猜测。

## 文件：文本、字节与传输分词

Sandbox 内部读写只用五个名字：`readText`、`writeText`、`readBytes`、`writeBytes`、`pathExists`。二进制类型固定为 `Uint8Array`；Node `Buffer` 结构上可直接传入，但公共契约不绑定 Node。

`upload*` / `download*` 只表示**宿主机与 Sandbox 之间真实传输**，不再兼任内存字节读写：

```ts
interface SandboxTransferOperations {
  uploadFile(source: string | URL, targetPath: string): Promise<void>;
  uploadDirectory(
    sourceDir: string | URL,
    targetDir?: string,
    options?: { readonly ignore?: readonly string[] },
  ): Promise<void>;
  downloadFile(sourcePath: string, target: string | URL): Promise<void>;
  downloadDirectory(
    sourceDir: string,
    targetDir: string | URL,
    options?: { readonly ignore?: readonly string[] },
  ): Promise<void>;
}
```

两侧相对路径有不同锚点：

- Sandbox 路径按 `workdir` 解析；
- 宿主 `source` / `target` 的相对字符串按 eval 定义文件所在目录解析，`URL` 原样使用；
- 不使用进程 `cwd`，也不硬编码 provider 的绝对 workdir。

例子：

```ts
await t.sandbox.writeText("src/index.ts", "export const x = 1;\n");
await t.sandbox.writeBytes("assets/logo.png", logoBuffer);
await t.sandbox.uploadDirectory(new URL("tests/", import.meta.url), "/tests");
await t.sandbox.uploadFile(new URL("run-tests.sh", import.meta.url), "/tests/run-tests.sh");
await t.sandbox.downloadDirectory("src", new URL("out/attempt-final/", import.meta.url));
```

固定路径的幂等文件 IO 可以对 429、5xx、连接重置等瞬时传输失败做有限重试。不存在、权限、路径、取消与 Sandbox terminated 第一次即抛；重试不得改变目标路径或把部分结果伪装成完整结果。

批量聚合与过滤不是 Sandbox API：需要明确规则时用一条命令，评 Agent 改动时读归因后的 `t.sandbox.diff`。

## 三个公开视图

```ts
interface Sandbox extends SandboxOperations, SandboxTransferOperations {
  readonly sandboxId: string;
  readonly otlpHost: string | null;
  stop(): Promise<void>;
  appendLog?(line: string): Promise<void>;
}

interface EvalSandbox extends SandboxOperations, SandboxTransferOperations {
  readonly diff: DiffData;
}

interface SandboxCommandTarget extends SandboxOperations {
  copyPath(sourcePath: string, targetPath: string): Promise<void>;
  putContent(content: RegisteredSandboxContent, targetPath: string): Promise<void>;
}
```

- `Sandbox` 是 Provider / Runner / Sandbox Agent 的完整运行句柄，含生命周期；
- `EvalSandbox` 是 `t.sandbox`，含宿主传输和归因 diff，但不含 `stop()` 与 provider 元数据；
- `SandboxCommandTarget` 是 layer callback 的窄视图，不能访问宿主文件系统、停止 Case 或改变拓扑；`putContent()` 只消费先经 `registerSandboxContent()` 登记的 digest-backed 内容。

能力差异用不同成员表达；同名成员的参数、返回值、退出码与取消语义在三个视图中完全一致。

Direct Agent 没有运行中 Sandbox。第一次调用 `t.sandbox.*` 时，错误必须点名具体 API 与 Agent，并提示改用 Sandbox Agent 或移除调用；不另设一份可能漂移的 `requires` 声明。
