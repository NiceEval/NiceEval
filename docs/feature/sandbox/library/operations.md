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
  /** 已知会出现在本命令/输出里的敏感明文；只供 Attempt 证据脱敏，不改变实际执行。 */
  readonly sensitiveValues?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** 覆盖本条命令的执行身份;省略 = Sandbox 默认身份(见 Library · 执行身份)。 */
  readonly user?: string;
  readonly stream?: boolean;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onStdout?: (chunk: string) => void | Promise<void>;
  readonly onStderr?: (chunk: string) => void | Promise<void>;
}
```

`runCommand()` 把 argv 原样交给进程，不经 shell；`runShell()` 才解释管道、重定向与 `&&`。两者都返回任意 `exitCode`，非零不是 Promise failure，也不自动产生断言。

作者确实要求命令成功时使用名字写明策略的 `runCommandOrThrow()` / `runShellOrThrow()`。它们仅把非零退出转成携带完整 `CommandResult` 的 command-exit error；timeout、取消、transport failure 在四个方法上都会 reject。

方法名同时是命令证据的解释边界。Record 只保存公开调用事实 `checked` 与退出结果：普通方法的非零（`checked: false`）由消费层显示为尚未解释的 `observed`，不能标成失败；checked 方法的非零（`checked: true`）才显示为 `failed`。调用方拿到普通结果后再决定继续、重试或抛出，不会反向改写已经结束的命令节点；Attempt error 与命令退出事实分别保留各自的权威语义。

因此 探测、best-effort cleanup 与“目标不存在即已收敛”的删除动作使用普通方法。确实要求零退出的安装、构建与验证使用 checked 方法。不要通过 `|| true` 抹掉原始退出码，也不另设退出码白名单让 Runner 猜调用方业务语义。

command-exit error 的默认 message 除 exit code 外，还要带经过控制字符清洗与长度收口的 stderr 尾部；stderr 为空时才回落 stdout。fixture/build 的直接死因因此无需下钻 execution 就可见。完整、未截断的 stdout/stderr 仍只保存在 error 携带的 `CommandResult` 与命令证据中。

没有 `tryCommand()` / `tryShell()`：如果普通方法叫 `runCommand`，它就不应暗含“必须成功”；checked 语义只放在 `OrThrow` 后缀上。同一段 探测 因此直写：

```ts
const probe = await sandbox.runCommand("git", ["--version"]);
if (probe.exitCode !== 0) {
  throw new EvalFatalError(`git probe failed: ${probe.stderr}`);
}
```

命令不会自动重试。命令可能已产生副作用，只有调用者能证明幂等时，才在自己的 layer 或 eval 逻辑里写显式重试。

### 已知敏感值与落盘边界

命令把 API key、token、HTTP header value 或其它凭据拼进 argv / shell heredoc 时，调用者必须在同一次调用的 `sensitiveValues` 中登记**实际会出现在文本里的值**：

```ts
const authorization = `Bearer ${connection.apiKey}`;
await sandbox.runShell(
  `cat > ~/.tool/config.json <<'EOF'\n${JSON.stringify({ authorization })}\nEOF`,
  { sensitiveValues: [authorization] },
);
```

Provider 仍收到原始 script、argv 与 env，运行时 stdout/stderr 也原样交还调用方。
变化只发生在 Runner 的落盘边界：命令摘要先精确替换再截断，失败输出与最终执行证据中的同一已知值也替换成 `<redacted>`。
敏感值集合只活在当前 Attempt 内存里，不进入 Observability 的 command / timing、Artifacts、指纹或留存注册表。

这不是按字段名猜测的 secret scanner。NiceEval 不会因为文本出现 `token=`、`api_key` 或 `Authorization` 就擅自隐藏后面的任意内容。未登记的自由文本、调用方先行编码或拆分后未一并登记的形态、Provider 原生日志，以及已有旧 Artifacts，都无法由读取端可靠恢复 provenance。Report 的 Observability、Assertions 与 JSON 页面只展开已经脱敏的落盘值，不会还原原文。

### 命令 timeout 与取消

`timeoutMs` 是单条命令的显式上限；省略时只受 Attempt deadline。`signal` 与外层 signal 合并，任一取消都进入同一命令树终止协议。

Promise 因 timeout、取消、Attempt interruption 或 Agent runtime cancellation settle 前，Provider 必须确认本次受管命令树已终止；若不能精确终止，就退休并停止整个 Sandbox。只关 stdout/stderr 流、PTY 或 transport 不算终止。

正常命令成功结束后，关闭 transport / session 不得顺带杀死命令有意启动的独立任务服务。保留哪些任务服务由 Case 与 reuse/keep 契约决定，不由命令客户端连接寿命猜测。

E2B 的 command RPC 会把直接 shell 的完成与 stdout/stderr event stream EOF 绑在一起；后台服务继承输出管道时，后者可以继续打开。E2B provider 因此以直接 shell 的退出码和前台输出作为命令完成信号，随后只断开 event transport，既不等待后台服务关闭管道，也不把它的输出重定向到 `/dev/null`。这条放行只适用于正常完成；timeout、取消和 interruption 仍按上面的命令树终止协议退休整台 VM。

这个完成信号是 Provider 私有 framing，不是普通输出里的字符串搜索：wrapper 自身被 shell、SDK 或子进程按源码/转义文本回显时，不得把其中的 marker 字面量和 `$exit` 变量误认成完成帧。只有 wrapper 的直接 supervisor 在 shell 已取得子进程状态后写出的、payload 严格为十进制数字且 stdout/stderr 两路一致的帧才可结束命令；协议完整性失败时退出状态必须标为未知，不能用 SDK 默认值或拆帧失败文本伪造。wrapper 的生成与拆帧必须同时经过真实 bash 执行测试，不能由测试替 shell 人工拼出合法 marker。

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
  upload(content: SandboxContent, targetPath: string): Promise<void>;
  downloadFile(sourcePath: string, target: string | URL): Promise<void>;
  downloadDirectory(
    sourceDir: string,
    targetDir: string | URL,
    options?: { readonly ignore?: readonly string[] },
  ): Promise<void>;
}
```

两侧相对路径的定位基准不同：

- Sandbox 路径按 `workdir` 定位；
- 宿主 `source` / `target` 的相对字符串按 eval 定义文件所在目录定位，`URL` 原样使用；
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

批量聚合与过滤不是 Sandbox API：需要明确规则时用一条命令。评 Agent 改动时用 `fileChanged` / `notInDiff` 等归因断言（见[断言 Sandbox 结果](asserting-results.md)），读文件当前内容用 `readText`。

## 三个公开视图

```ts
interface Sandbox extends SandboxOperations, SandboxTransferOperations {
  readonly sandboxId: string;
  readonly otlpHost: string | null;
  stop(): Promise<void>;
  appendLog?(line: string): Promise<void>;
}

interface EvalSandbox extends SandboxOperations, SandboxTransferOperations {
  // 归因断言声明:changedPaths / noChanges / fileChanged / fileDeleted / notInDiff。
  // 完整契约见「断言 Sandbox 结果」;不存在通用或延迟的 diff subject。
}

interface SandboxCommandTarget extends SandboxOperations {
  readonly sandboxId: string;
  copyPath(sourcePath: string, targetPath: string): Promise<void>;
  putContent(content: SandboxContent, targetPath: string): Promise<void>;
}
```

- `Sandbox` 是 Provider / Runner / Sandbox Agent 的完整运行句柄，含生命周期；
- `EvalSandbox` 是 `t.sandbox`，含宿主传输与归因断言声明（见[断言 Sandbox 结果](asserting-results.md)），但不含 `stop()` 与 provider 元数据；
- `SandboxCommandTarget` 是 layer callback 的窄视图，不能访问宿主文件系统或停止 Case；`putContent()` 只消费 `sandboxContent.*()` 登记的 digest-backed 内容。它实时暴露当前物理实例的 `sandboxId`，让已经确定 Provider 的可信 opaque callback 关联自行取得并登记 cleanup 的宿主辅助资源，但不让声明式 layer 改变 NiceEval 管理的 Case 拓扑。
- `putContent()` 会把大文件拆成有界写入并在 Sandbox 内原子合并；单次 provider 请求不承载整个大文件，失败也不暴露部分目标文件。

能力差异用不同成员表达；同名成员的参数、返回值、退出码与取消语义在三个视图中完全一致。

Direct Agent 没有运行中 Sandbox。第一次调用 `t.sandbox.*` 时，错误必须点名具体 API 与 Agent，并提示改用 Sandbox Agent 或移除调用；不另设一份可能漂移的 `requires` 声明。
