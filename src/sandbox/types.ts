// sandbox 域类型:运行中 Sandbox、生命周期 hook、命令与文件 IO 的形状。
// 作者声明使用 layer.ts 的闭合 SandboxLayer；本文件不再保留旧 provider spec。

import type { ScopedFeedback } from "../shared/types.ts";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /**
   * 这次执行的命令摘要(有界、已脱敏,与时间树 command 节点同一份文案)。由执行面在最外层
   * 公开调用处附加;直接从 provider 拿到的裸结果可能没有。断言失败时用作 evidence
   * (`commandSucceeded()` 的「命令行本身」),消费方按可选字段读。
   */
  command?: string;
}

/** 内置 provider 名；ProviderModule 的完成态计划使用普通 string 兼容自定义 provider。 */
export type SandboxProvider = "docker" | "vercel" | "e2b" | "local";

/** 镜像/模板里的 Node 运行时版本。 */
export type SandboxRuntime = "node20" | "node24";

/**
 * Sandbox hook 的窄上下文:只有 `experimentId`、`signal` 与作用域绑定的 `progress/diagnostic`,
 * 不借用包含 session / model / telemetry 的完整 `AgentContext`
 * (见 docs/feature/sandbox/library.md「环境层生命周期钩子」)。
 */
export interface SandboxHookContext extends ScopedFeedback {
  /** 运行计划中已解析的实验 id；生命周期 hook 不在脱离 Experiment 的上下文执行。 */
  readonly experimentId: string;
  /** 当前 Invocation 的中止信号；物理 Sandbox 生命周期不从某条 Attempt 借用信号。 */
  readonly signal: AbortSignal;
  /**
   * 第三条反馈通道:上报物理 Sandbox 生命周期的中性环境观测,落进所属 Experiment 的
   * `Run.facts`。这类事实不归属于某一条 Attempt。key 匹配
   * `[a-z0-9._-]{1,64}`,value 是标量;同 key 后写覆盖先写,非法 key 或非标量 value 抛错。
   * 不影响判定,不参与 verdict / 评分 / 指纹。形状与归属语义见
   * docs/feature/record/architecture.md#facts运行事实。
   */
  fact(key: string, value: string | number | boolean): void;
}

/** 沙箱级生命周期钩子(`SandboxLayer.setup()` / `.teardown()` 链式挂载)。 */
export type SandboxHook = (
  sandbox: Sandbox,
  ctx: SandboxHookContext,
) => void | Promise<void>;

export interface CommandOptions {
  /**
   * 这条命令已知会处理的敏感明文（例如 API key、token、HTTP header value）。Runner 仍把
   * 原值交给 provider 执行，但在任何 timing / commands / execution / error 证据落盘前按
   * 这些值做精确替换；本数组本身不落盘、不进指纹。空字符串被忽略。
   *
   * 这是显式 provenance，不是 secret 扫描器：没有登记的自由文本无法被可靠识别；值若先被
   * 调用方编码或拆分，应把实际会出现在命令/输出里的编码形态一并登记。
   */
  readonly sensitiveValues?: readonly string[];
  /**
   * 追加/覆盖本命令的环境变量(与 Sandbox 默认环境叠加,不清空默认值)。`PATH` 是 Sandbox
   * 受管变量,各 provider 保留自己算出的 `PATH`,不保证能被这里覆盖;需要扩展 PATH 用
   * Sandbox factory 的 `pathPrepend`(见 docs/feature/sandbox/library.md「PATH:受管变量与
   * pathPrepend」)。
   */
  readonly env?: Readonly<globalThis.Record<string, string>>;
  /** 本命令的工作目录;省略时落到 `Sandbox.workdir`。相对路径按 workdir 解析,绝对路径原样使用。 */
  readonly cwd?: string;
  /**
   * 把本命令的输出也送进 Sandbox 的「原生日志流」(于是 `docker logs` / Docker UI 的 Logs
   * 标签页能实时看到它)。给 agent 命令(codex exec / bub run / claude)开它,就能在容器
   * 日志里看到 agent 的【原始输出】。provider 各自实现(docker:tee 到 PID1 tail 的文件;
   * 不支持的 provider 忽略)—— 日志怎么浮现是 provider 的事,adapter 只声明意图。
   */
  readonly stream?: boolean;
  /**
   * 命令 stdout 每到一块就调用一次。回调只用于运行中的短命反馈；完整 stdout 仍会原样
   * 出现在返回的 `CommandResult` 里。provider 不支持真流时，至少会在命令结束后按完整
   * stdout 调用一次，不能静默丢掉。
   */
  readonly onStdout?: (chunk: string) => void | Promise<void>;
  /** `onStdout` 的 stderr 对应物；完整 stderr 仍保留在 `CommandResult`。 */
  readonly onStderr?: (chunk: string) => void | Promise<void>;
  /**
   * 覆盖本条命令的执行身份;省略 = Sandbox 默认身份(沿用环境自己声明的身份——Docker 镜像 `USER`、
   * Compose service `user:`、E2B template 默认用户、宿主当前用户,见
   * docs/feature/sandbox/library.md「执行身份」)。
   *
   * 语义跨 provider 一致,各 provider 映射到自己的原生机制(docker:`exec --user`;E2B:
   * `{ user }`;Vercel:只认 `"root"`,映射 `{ sudo: true }`,其它值报错;local:任何值都报错)。
   * 本就全程 root 的 provider视作 no-op;完全无法换身份的 provider 可不支持(抛错)—— 但**省略与
   * 显式值的语义保持一致**,不因 provider 而变。
   */
  readonly user?: string;
  /**
   * 这条命令自己的上限(毫秒)。**省略才是常态**:省略时上限 = attempt deadline 的剩余量
   * (见 docs/feature/sandbox/architecture.md「时限归属」),provider 层没有独立默认。
   * 显式传一个更短的值是有意声明,照常生效;撞线时归属记成「命令显式 timeout」。
   */
  readonly timeoutMs?: number;
  /**
   * 取消本次受管命令树。Provider 必须在 Promise settle 前确认命令树已经终止；无法精确
   * 终止时应退休整个 Sandbox，不能只关闭 transport 后把进程留在后台。
   */
  readonly signal?: AbortSignal;
}

export interface SuccessfulCommandResult extends CommandResult {
  readonly exitCode: 0;
}

/** 三个运行中 Sandbox 视图共用的操作词汇；同名成员在不同视图中不得改变语义。 */
export interface SandboxOperations {
  /** Sandbox 内项目/工作区根目录的绝对路径(agent 命令的默认 cwd,也是 git baseline 提交的位置)。各方法的相对路径都以此为基准解析,省略 `cwd`/`targetDir` 时也落到这里。 */
  readonly workdir: string;
  /**
   * 执行单个命令,`args` 作为独立 argv 传递、不经 shell 解释(无 `&&`、管道、通配符展开)。
   * 只想跑一个可执行文件、参数来自外部输入、担心注入时优先用它。
   */
  runCommand(cmd: string, args?: readonly string[], opts?: CommandOptions): Promise<CommandResult>;
  /**
   * 执行一整段脚本,经 shell(bash)解释,支持 `&&`、管道、`$()`、重定向等。
   * 需要拼多条命令或做条件判断时用它。
   */
  runShell(script: string, opts?: CommandOptions): Promise<CommandResult>;
  /**
   * 像 `runCommand` 一样执行单个命令，但非零退出时抛出 `SandboxCommandExitError`。错误消息附带
   * 有界、已清理和脱敏的 stderr 尾部；stderr 为空时回退 stdout。完整输出保留在异常的
   * `result` 字段中。成功结果的 `exitCode` 在类型上固定为 `0`。
   */
  runCommandOrThrow(
    cmd: string,
    args?: readonly string[],
    opts?: CommandOptions,
  ): Promise<SuccessfulCommandResult>;
  /**
   * 像 `runShell` 一样执行 shell 脚本，但非零退出时抛出 `SandboxCommandExitError`。错误摘要、
   * 完整输出和成功结果的语义与 `runCommandOrThrow` 相同。
   */
  runShellOrThrow(script: string, opts?: CommandOptions): Promise<SuccessfulCommandResult>;
  /** 读取 Sandbox 内文件的文本内容(UTF-8)。文件不存在时抛错。 */
  readText(path: string): Promise<string>;
  /** 写入 Sandbox 内一个 UTF-8 文本文件；父目录不存在时自动创建。 */
  writeText(path: string, content: string): Promise<void>;
  /** 精确读取 Sandbox 内文件字节；公共契约不绑定 Node Buffer。 */
  readBytes(path: string): Promise<Uint8Array>;
  /** 精确写入 Sandbox 内文件字节；父目录不存在时自动创建。 */
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  /** 检查 Sandbox 内文件或目录路径是否存在。 */
  pathExists(path: string): Promise<boolean>;
}

/** 只用于宿主机与 Sandbox 之间真实传输；内存内容读写使用 read/writeText/Bytes。 */
export interface SandboxTransferOperations {
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

export interface Sandbox extends SandboxOperations, SandboxTransferOperations {
  /** 销毁 Sandbox 占用的计算资源(容器/microVM)。调用后 Sandbox 不可再用;是否可安全重复调用因 provider 而异,不要依赖这一点。 */
  stop(): Promise<void>;
  /** 本 Sandbox 的稳定标识(各 provider 原生 ID,如 Docker 容器 ID 前缀);用于跨调用关联同一 Sandbox 的会话状态,也用于日志展示。 */
  readonly sandboxId: string;
  /**
   * 本地 OTLP 接收器的目标 host。
   * - `string`:Sandbox 内可通过该 hostname 回连宿主 OTLP 端口(如 docker 的 `host.docker.internal`)。
   * - `null`:Sandbox 运行在远程云端(如 e2b/vercel),无法访问宿主本地端口 → 跳过 tracing。
   *   可通过环境变量 `NICEEVAL_OTLP_HOST` 强制覆盖(如配置 tunnel 时)。
   */
  readonly otlpHost: string | null;

  /**
   * 可选:把一行写进容器的「主日志」(PID1 在 tail 它)——于是 `docker logs` /
   * Docker UI 的 Logs 标签页能实时看到 agent 逐轮活动。docker provider 实现,其它可省略。
   */
  appendLog?(line: string): Promise<void>;

}

/** 复用调度需要的中立寿命确认能力。 */
export interface SandboxReuseCapability {
  ensureLifetime(minRemainingMs: number): Promise<
    | { ready: true; expiresAt?: string }
    | { ready: false; reason: string }
  >;
}
