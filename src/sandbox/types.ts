// sandbox 域类型:Sandbox 接口、provider spec(可辨识联合)、命令与文件 IO 的形状。
// 「在哪里跑、如何隔离」的全部契约在这里;provider 实现见本目录各文件,分发见 resolve.ts。

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

/** 内置 provider 名;不出现在 `sandbox` 字段的类型里(spec 用各自的 `provider` 判别字段区分)。 */
export type SandboxProvider = "docker" | "vercel" | "e2b" | "local";

/** 镜像/模板里的 Node 运行时版本。 */
export type SandboxRuntime = "node20" | "node24";

/**
 * SandboxSpec 四个变体共有的沙箱生命周期钩子挂载点:`.setup(fn)` / `.teardown(fn)` 链式方法,
 * 由 `dockerSandbox()` / `vercelSandbox()` / `e2bSandbox()` / `defineSandbox()` 产出的对象上
 * 直接可调。
 *
 * **语义**:环境预置层,俗称「动态镜像层」——本想直接烘进镜像/快照/模板,但内容要按实验
 * (`ctx.flags` / `ctx.experimentId`)动态变化的东西:装某个实验专属的二进制、预热缓存、
 * 写运行期才知道内容的 hook 文件、按 `ctx.experimentId` 载入/回存跨 attempt 的状态。
 *
 * **与另外两层 setup 的分工**(三者都在同一个沙箱生命周期里,各管一层):
 *   · `sandbox.setup`(这里)—— 环境层,不知道具体跑哪个 eval / 接哪个 agent;
 *   · `eval.setup` —— 任务层,准备这次 eval 的素材(如 `npm install` 起始项目依赖);
 *   · `agent.setup` —— 协议层,接入被测 agent(装 CLI、写鉴权 / 模型配置)。
 *
 * **执行顺序**:沙箱就绪 → `sandbox.setup` 钩子 → workspace 上传 / git 基线 / `eval.setup` →
 * `agent.setup` → `agent.tracing.configure` → 逐轮 `send`。`sandbox.setup` 特意排在 git
 * 基线之前——它的改动会被提交进基线,不会被误算进 agent 产出的 diff。收尾按 LIFO:
 * `agent.teardown` 先跑,`sandbox.teardown` 钩子最后跑(沙箱销毁前)。
 *
 * **多钩子**:`.setup(a).setup(b)` 按追加顺序依次执行(a 先 b 后);`.teardown(x).teardown(y)`
 * 按追加的**逆序**执行(y 先 x 后)。每次调用都返回一个新 spec(不改变原对象),可继续链式。
 * `setup` 链中途抛错时后续 `setup` 不再执行,`teardown` 链仍完整走完。
 *
 * **失败语义**:`setup` 钩子抛错按执行错误计——与 `eval.setup` / `agent.setup` 抛错走同一条
 * 路径,不新增错误分类;但不阻断该 attempt 已进入的收尾(已挂载的 `teardown` 钩子仍会在
 * finally 里跑)。`teardown` 钩子报错只作诊断(吞掉 / 记 log),不改变已产出的结果——与
 * `agent.teardown` 现状一致。
 */
export interface SandboxHooks<Self> {
  /** 已挂载的 setup 钩子,按追加顺序保存(内部读取,一般用不到)。 */
  readonly setupHooks?: readonly SandboxHook[];
  /** 已挂载的 teardown 钩子,按追加顺序保存,执行时逆序(内部读取,一般用不到)。 */
  readonly teardownHooks?: readonly SandboxHook[];
  /** 追加一个沙箱级 setup 钩子,返回新 spec;详细契约见 {@link SandboxHooks}。 */
  setup(fn: SandboxHook): Self;
  /** 追加一个沙箱级 teardown 钩子,返回新 spec;详细契约见 {@link SandboxHooks}。 */
  teardown(fn: SandboxHook): Self;
}

/**
 * Sandbox hook 的窄上下文:只有 `experimentId`、`signal` 与作用域绑定的 `progress/diagnostic`,
 * 不借用包含 session / model / telemetry 的完整 `AgentContext`
 * (见 docs/feature/sandbox/library.md「环境层生命周期钩子」)。
 */
export interface SandboxHookContext extends ScopedFeedback {
  /** 路径推导出的实验 id;不经 experiment 跑时是 undefined。跨 attempt 状态按它分区。 */
  readonly experimentId?: string;
  /** 本次 attempt 的中止信号。 */
  readonly signal: AbortSignal;
  /**
   * 第三条反馈通道:上报本次运行的中性环境观测,落进 `AttemptRecord.facts`。key 匹配
   * `[a-z0-9._-]{1,64}`,value 是标量;同 key 后写覆盖先写,非法 key 或非标量 value 抛错。
   * 不影响判定,不参与 verdict / 评分 / 指纹。形状与归属语义见
   * docs/feature/record/architecture.md#facts运行事实。
   */
  fact(key: string, value: string | number | boolean): void;
}

/** 沙箱级生命周期钩子(`.setup()` / `.teardown()` 链式挂载);`setup` 不返回值——要把 `setup`
 * 创建的句柄传给 `teardown`,以 `sandbox` 实例为键存取(见 {@link SandboxHooks})。 */
export type SandboxHook = (
  sandbox: Sandbox,
  ctx: SandboxHookContext,
) => void | Promise<void>;

/**
 * Sandbox 的「数据结构」定义 —— 与 agent 一样可带参数(见 docs/feature/sandbox/library.md)。
 * 必须用工厂函数构造(`dockerSandbox()` / `vercelSandbox()` / `e2bSandbox()` / `defineSandbox()`),
 * 放进 config / experiment 的 `sandbox` 字段 —— 字段类型只接受这个数据结构,不接受裸字符串。
 * 各 provider 的参数互不相同 —— 这是个按 `provider` 区分的可辨识联合(discriminated union)。
 * 四个变体都带 {@link SandboxHooks} 的 `.setup()` / `.teardown()` 链式方法。
 */
export interface DockerSandboxSpec extends SandboxHooks<DockerSandboxSpec> {
  readonly provider: "docker";
  /** 实例可存活的最长时间；复用调度据此在到期前轮换。 */
  readonly lifetimeMs?: number;
  /** 覆盖默认镜像;默认按 runtime 选 `node:*-slim`。预制模板:传烘焙好 agent CLI 的镜像名。 */
  readonly image?: string;
  /**
   * 按 eval 的 `environment` profile 映射完整 sandbox case。
   * 表值靠判别键区分:`{ image }` 预制、`{ build }` 按需构建、`{ compose }` Compose case。
   * 与 {@link materializers} 同时命中同一 profile 时本表优先。
   */
  readonly environments?: Readonly<globalThis.Record<string, import("./case-types.ts").DockerEnvironmentCase>>;
  /** folder-local source 的物化器,按 source kind(`compose` / `dockerfile`)注册。 */
  readonly materializers?: import("./case-types.ts").SandboxMaterializers;
  readonly runtime?: SandboxRuntime;
}
export interface VercelSandboxSpec extends SandboxHooks<VercelSandboxSpec> {
  readonly provider: "vercel";
  /** 实例可存活的最长时间；复用调度据此在到期前轮换。 */
  readonly lifetimeMs?: number;
  /** 从已有快照起 microVM。预制模板:烘焙好 agent CLI 的 snapshotId。 */
  readonly snapshotId?: string;
  /**
   * 按 eval 的 `environment` profile 映射完整 sandbox case(第一期仅 `{ snapshotId }` 预制)。
   * 与 {@link materializers} 同时命中同一 profile 时本表优先。
   */
  readonly environments?: Readonly<globalThis.Record<string, import("./case-types.ts").VercelEnvironmentCase>>;
  readonly materializers?: import("./case-types.ts").SandboxMaterializers;
  readonly runtime?: SandboxRuntime;
}
export interface E2BSandboxSpec extends SandboxHooks<E2BSandboxSpec> {
  readonly provider: "e2b";
  /** 实例可存活的最长时间；复用调度据此在到期前轮换。 */
  readonly lifetimeMs?: number;
  /** e2b 模板名/ID。预制模板:烘焙好 agent CLI 的模板(如 `"niceeval-agents"`)。省略用 e2b 默认 `"base"`。 */
  readonly template?: string;
  /**
   * 按 eval 的 `environment` profile 映射完整 sandbox case:`{ template }` 预制或 `{ build }` 按需构建。
   * 与 {@link materializers} 同时命中同一 profile 时本表优先。
   */
  readonly environments?: Readonly<globalThis.Record<string, import("./case-types.ts").E2BEnvironmentCase>>;
  readonly materializers?: import("./case-types.ts").SandboxMaterializers;
  /** 仅作记录;e2b 的 node 版本由模板决定,不在创建时选。 */
  readonly runtime?: SandboxRuntime;
}
/**
 * 本地执行:宿主机本地目录直接当 workdir 跑,零隔离、零仪式(见 docs/feature/sandbox/local.md)。
 * `dir` 省略时从进程当前目录向上解析 git 仓库根;不在任何 git 仓库内时报错并给出两条出路
 * (进入目标仓库再跑,或显式传 `dir`)。显式 `dir` 允许任意本地目录,不要求已是 git 仓库。
 */
export interface LocalSandboxSpec extends SandboxHooks<LocalSandboxSpec> {
  readonly provider: "local";
  /** 显式指定 workdir;省略时从当前目录向上解析 git 仓库根。目录必须已存在且可写。 */
  readonly dir?: string;
  readonly runtime?: SandboxRuntime;
}

/**
 * 用户自定义 provider:`create` 直接产出一个 `Sandbox` 实例,不经 resolve.ts 的内置 provider switch。
 * 用 `defineSandbox()` 构造(见 src/define.ts)。`provider` 只用于展示 / 日志,不参与分发。
 */
export interface CustomSandboxSpec extends SandboxHooks<CustomSandboxSpec> {
  readonly provider: string;
  readonly runtime?: SandboxRuntime;
  readonly recommendedConcurrency?: number;
  /**
   * 独占串行声明:该 provider 的所有 attempt 共享同一份不可并发的底层资源(如同一棵真实工作树),
   * runner 加一道 provider 级串行闸,显式 `--max-concurrency` / 实验级 `maxConcurrency` 都不解除
   * (见 docs/runner.md「调度:有界并发」)。中性的 provider 声明,省略即不独占。
   */
  readonly exclusive?: boolean;
  /**
   * 与内置 provider 同形的 environment 映射:值是 {@link import("./case-types.ts").CustomEnvironmentCase}
   * (纯数据 identity + materialize)。与 {@link materializers} 同时命中同一 profile 时本表优先。
   */
  readonly environments?: Readonly<globalThis.Record<string, import("./case-types.ts").CustomEnvironmentCase>>;
  readonly materializers?: import("./case-types.ts").SandboxMaterializers;
  /** `feedback` 绑定到 `sandbox.create` 阶段:分配实例 / 拉镜像 / 恢复 run 的进度与诊断走它。 */
  readonly create: (opts: {
    timeout?: number;
    /** attempt 的绝对截止时刻；自定义 provider 应据此约束未显式给 timeout 的命令。 */
    deadlineAt?: number;
    runtime?: SandboxRuntime;
    feedback: ScopedFeedback;
  }) => Promise<Sandbox>;
  /**
   * 「哪些参数可发布」的投影,进结果快照的 ExperimentRunInfo.sandbox.params;
   * 未实现时只落 provider 名。token、凭据路径永远不该出现在返回值里。
   */
  readonly publicConfig?: () => globalThis.Record<string, import("../shared/types.ts").JsonValue>;
}

export type SandboxSpec = DockerSandboxSpec | VercelSandboxSpec | E2BSandboxSpec | LocalSandboxSpec | CustomSandboxSpec;

/** config / experiment 的 `sandbox` 字段:必须是工厂函数产出的 spec 数据结构;沙箱型 agent 不能省略。 */
export type SandboxOption = SandboxSpec;

export interface CommandOptions {
  /** 追加/覆盖本命令的环境变量(与 Sandbox 默认环境叠加,不清空默认值;各 provider 会保留自己固定的 `PATH` 等变量,不保证能被这里覆盖)。 */
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
   * 以 root 跑本命令。默认 `false` —— 命令以 Sandbox 的标准**非 root** 用户跑(agent 的自然环境)。
   * 给 setup 阶段装系统依赖用(`apt-get install …`、`pip install --break-system-packages …`)。
   *
   * 语义跨 provider 一致:"本命令以 root 跑,否则以标准非 root 用户跑"。各 provider 映射到自己的原生机制
   * (docker:`exec --user root`;E2B:`{ user: "root" }`;Vercel:`{ sudo: true }`;Daytona:`{ user }`)。
   * 本就全程 root 的 provider(如 Modal)视作 no-op;完全无法提权的 provider 可不支持(抛错)—— 但**默认值与
   * 语义保持一致**,不因 provider 而变。
   */
  readonly root?: boolean;
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
  runCommandOrThrow(
    cmd: string,
    args?: readonly string[],
    opts?: CommandOptions,
  ): Promise<SuccessfulCommandResult>;
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
