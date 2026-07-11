// sandbox 域类型:Sandbox 接口、provider spec(可辨识联合)、命令与文件 IO 的形状。
// 「在哪里跑、如何隔离」的全部契约在这里;provider 实现见本目录各文件,分发见 resolve.ts。

import type { AgentSetup, AgentTeardown } from "../agents/types.ts";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxFile {
  path: string;
  content: string | Buffer;
}

/** 一个源码文件:相对工作区根的路径 + 文本内容。readSourceFiles 的返回元素。 */
export interface SourceFile {
  path: string;
  content: string;
}

/**
 * readSourceFiles 的返回值:仍是一个 SourceFile 数组(.filter/.some/.map 照用),
 * 额外挂上整体匹配 / 按文件匹配的便利方法,省掉 eval 目录里手写的 source-helpers。
 */
export interface SourceFiles extends ReadonlyArray<SourceFile> {
  /** 全部文件内容拼接(每段前带 `// path` 注释),用于整体 regex。 */
  text(): string;
  /** 同 text() 但先剥注释,只看真实代码。 */
  code(): string;
  /** 第一个内容命中 pattern 的文件。 */
  fileMatching(pattern: RegExp): SourceFile | undefined;
  /** 第一个内容命中全部 patterns 的文件(同文件共现,per-file 而非拼接源码)。 */
  fileMatchingAll(patterns: RegExp[]): SourceFile | undefined;
  /** 是否存在路径命中 pattern 的文件。 */
  hasPath(pattern: RegExp): boolean;
}

/** readSourceFiles 的可选项;不传则用一套合理默认。 */
export interface ReadSourceFilesOptions {
  /** 文件扩展名(不带点)。默认 ts/tsx/js/jsx。 */
  extensions?: string[];
  /** 按目录名(任意深度)剪枝。默认 .git/.next/node_modules/dist/build/coverage。 */
  ignoreDirs?: string[];
  /** 按文件 basename 忽略。默认 EVAL.ts/PROMPT.md。 */
  ignoreFiles?: string[];
}

/** 内置 provider 名;不出现在 `sandbox` 字段的类型里(spec 用各自的 `provider` 判别字段区分)。 */
export type SandboxProvider = "docker" | "vercel" | "e2b";

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
 * agent 级 cleanup / `agent.teardown` 先跑,`sandbox.teardown` 钩子最后跑(沙箱销毁前)。
 *
 * **多钩子**:`.setup(a).setup(b)` 按追加顺序依次执行(a 先 b 后);`.teardown(x).teardown(y)`
 * 按追加的**逆序**执行(y 先 x 后)。每次调用都返回一个新 spec(不改变原对象),可继续链式。
 *
 * **失败语义**:`setup` 钩子抛错按执行错误计——与 `eval.setup` / `agent.setup` 抛错走同一条
 * 路径,不新增错误分类;但不阻断该 attempt 已进入的收尾(已跑过的 setup 返回的 cleanup、
 * `teardown` 钩子仍会在 finally 里跑)。`teardown` 钩子报错只作诊断(吞掉 / 记 log),不改变
 * 已产出的结果——与 `agent.teardown` 现状一致。
 */
export interface SandboxHooks<Self> {
  /** 已挂载的 setup 钩子,按追加顺序保存(内部读取,一般用不到)。 */
  readonly setupHooks?: readonly AgentSetup[];
  /** 已挂载的 teardown 钩子,按追加顺序保存,执行时逆序(内部读取,一般用不到)。 */
  readonly teardownHooks?: readonly AgentTeardown[];
  /** 追加一个沙箱级 setup 钩子,返回新 spec;详细契约见 {@link SandboxHooks}。 */
  setup(fn: AgentSetup): Self;
  /** 追加一个沙箱级 teardown 钩子,返回新 spec;详细契约见 {@link SandboxHooks}。 */
  teardown(fn: AgentTeardown): Self;
}

/**
 * Sandbox 的「数据结构」定义 —— 与 agent 一样可带参数(见 docs/sandbox.md)。
 * 必须用工厂函数构造(`dockerSandbox()` / `vercelSandbox()` / `e2bSandbox()` / `defineSandbox()`),
 * 放进 config / experiment 的 `sandbox` 字段 —— 字段类型只接受这个数据结构,不接受裸字符串。
 * 各 provider 的参数互不相同 —— 这是个按 `provider` 区分的可辨识联合(discriminated union)。
 * 四个变体都带 {@link SandboxHooks} 的 `.setup()` / `.teardown()` 链式方法。
 */
export interface DockerSandboxSpec extends SandboxHooks<DockerSandboxSpec> {
  readonly provider: "docker";
  /** 覆盖默认镜像;默认按 runtime 选 `node:*-slim`。预制模板:传烘焙好 agent CLI 的镜像名。 */
  readonly image?: string;
  readonly runtime?: SandboxRuntime;
}
export interface VercelSandboxSpec extends SandboxHooks<VercelSandboxSpec> {
  readonly provider: "vercel";
  /** 从已有快照起 microVM。预制模板:烘焙好 agent CLI 的 snapshotId。 */
  readonly snapshotId?: string;
  readonly runtime?: SandboxRuntime;
}
export interface E2BSandboxSpec extends SandboxHooks<E2BSandboxSpec> {
  readonly provider: "e2b";
  /** e2b 模板名/ID。预制模板:烘焙好 agent CLI 的模板(如 `"niceeval-agents"`)。省略用 e2b 默认 `"base"`。 */
  readonly template?: string;
  /** 仅作记录;e2b 的 node 版本由模板决定,不在创建时选。 */
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
  readonly create: (opts: { timeout?: number; runtime?: SandboxRuntime }) => Promise<Sandbox>;
}

export type SandboxSpec = DockerSandboxSpec | VercelSandboxSpec | E2BSandboxSpec | CustomSandboxSpec;

/** config / experiment 的 `sandbox` 字段:必须是工厂函数产出的 spec 数据结构;沙箱型 agent 不能省略。 */
export type SandboxOption = SandboxSpec;

export interface CommandOptions {
  /** 追加/覆盖本命令的环境变量(与沙箱默认环境叠加,不清空默认值;各 provider 会保留自己固定的 `PATH` 等变量,不保证能被这里覆盖)。 */
  env?: Record<string, string>;
  /** 本命令的工作目录;省略时落到 `Sandbox.workdir`。相对路径按 workdir 解析,绝对路径原样使用。 */
  cwd?: string;
  /**
   * 把本命令的输出也送进沙箱的「原生日志流」(于是 `docker logs` / Docker UI 的 Logs
   * 标签页能实时看到它)。给 agent 命令(codex exec / bub run / claude)开它,就能在容器
   * 日志里看到 agent 的【原始输出】。provider 各自实现(docker:tee 到 PID1 tail 的文件;
   * 不支持的 provider 忽略)—— 日志怎么浮现是 provider 的事,adapter 只声明意图。
   */
  stream?: boolean;
  /**
   * 以 root 跑本命令。默认 `false` —— 命令以沙箱的标准**非 root** 用户跑(agent 的自然环境)。
   * 给 setup 阶段装系统依赖用(`apt-get install …`、`pip install --break-system-packages …`)。
   *
   * 语义跨 provider 一致:"本命令以 root 跑,否则以标准非 root 用户跑"。各 provider 映射到自己的原生机制
   * (docker:`exec --user root`;E2B:`{ user: "root" }`;Vercel:`{ sudo: true }`;Daytona:`{ user }`)。
   * 本就全程 root 的 provider(如 Modal)视作 no-op;完全无法提权的 provider 可不支持(抛错)—— 但**默认值与
   * 语义保持一致**,不因 provider 而变。
   */
  root?: boolean;
}

export interface Sandbox {
  /** 沙箱内项目/工作区根目录的绝对路径(agent 命令的默认 cwd,也是 git baseline 提交的位置)。各方法的相对路径都以此为基准解析,省略 `cwd`/`targetDir` 时也落到这里。 */
  readonly workdir: string;
  /**
   * 执行单个命令,`args` 作为独立 argv 传递、不经 shell 解释(无 `&&`、管道、通配符展开)。
   * 只想跑一个可执行文件、参数来自外部输入、担心注入时优先用它。
   */
  runCommand(cmd: string, args?: string[], opts?: CommandOptions): Promise<CommandResult>;
  /**
   * 执行一整段脚本,经 shell(bash)解释,支持 `&&`、管道、`$()`、重定向等。
   * 需要拼多条命令或做条件判断时用它。
   */
  runShell(script: string, opts?: CommandOptions): Promise<CommandResult>;
  /** 读取沙箱内文件的文本内容(UTF-8)。文件不存在时抛错,不返回空字符串——需要容错请自行 `.catch()`。 */
  readFile(path: string): Promise<string>;
  /** 检查沙箱内路径是否存在。跨 provider 语义不完全一致:仅保证对普通文件可靠,对目录路径的行为不同 provider 不保证一致。 */
  fileExists(path: string): Promise<boolean>;
  /**
   * 一次 shell 往返读全部源码文件(按扩展名收、按目录/文件名忽略)。
   * 取代每个 eval 目录里手写的 find + 逐文件 readFile。
   */
  readSourceFiles(opts?: ReadSourceFilesOptions): Promise<SourceFiles>;
  /** 写入若干文本文件(内容已在内存里的字符串);是 `uploadFiles` 的文本特化,省略 `targetDir` 落到 workdir。 */
  writeFiles(files: Record<string, string>, targetDir?: string): Promise<void>;
  /** 批量写入若干文件,内容可以是文本或二进制 Buffer;省略 `targetDir` 落到 workdir。 */
  uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void>;
  /** 把本地磁盘上的一个目录整体上传进沙箱(递归读取本地文件后按 `uploadFiles` 写入);`opts.ignore` 是排除规则,省略 `targetDir` 落到 workdir。 */
  uploadDirectory(localDir: string, targetDir?: string, opts?: { ignore?: string[] }): Promise<void>;
  /** 销毁沙箱占用的计算资源(容器/microVM)。调用后沙箱不可再用;是否可安全重复调用因 provider 而异,不要依赖这一点。 */
  stop(): Promise<void>;
  /** 本沙箱的稳定标识(各 provider 原生 ID,如 Docker 容器 ID 前缀);用于跨调用关联同一沙箱的会话状态,也用于日志展示。 */
  readonly sandboxId: string;
  /**
   * 本地 OTLP 接收器的目标 host。
   * - `string`:沙箱内可通过该 hostname 回连宿主 OTLP 端口(如 docker 的 `host.docker.internal`)。
   * - `null`:沙箱运行在远程云端(如 e2b/vercel),无法访问宿主本地端口 → 跳过 tracing。
   *   可通过环境变量 `NICEEVAL_OTLP_HOST` 强制覆盖(如配置 tunnel 时)。
   */
  readonly otlpHost: string | null;

  /**
   * 可选:把一行写进容器的「主日志」(PID1 在 tail 它)——于是 `docker logs` /
   * Docker UI 的 Logs 标签页能实时看到 agent 逐轮活动。docker provider 实现,其它可省略。
   */
  appendLog?(line: string): Promise<void>;

  /**
   * 从沙箱内任意路径读取文件,返回二进制 Buffer。
   * 对应各 provider:Docker getArchive / Vercel readFileToBuffer / e2b files.read(bytes) / …
   */
  downloadFile(path: string): Promise<Buffer>;

  /**
   * 向沙箱内任意路径写入文件(二进制)。
   * 对应各 provider:Docker putArchive / Vercel fs.writeFile(Buffer) / e2b files.write / …
   */
  uploadFile(path: string, content: Buffer): Promise<void>;
}
