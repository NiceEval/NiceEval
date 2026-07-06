// sandbox 域类型:Sandbox 接口、后端 spec(可辨识联合)、命令与文件 IO 的形状。
// 「在哪里跑、如何隔离」的全部契约在这里;后端实现见本目录各文件,分发见 resolve.ts。

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

/** 内置后端名;只在 sandbox/resolve.ts 内部做环境探测和 CLI `--sandbox` 解析用,不出现在 `sandbox` 字段的类型里。 */
export type SandboxBackend = "docker" | "vercel" | "e2b";

/** 镜像/模板里的 Node 运行时版本。 */
export type SandboxRuntime = "node20" | "node24";

/**
 * Sandbox 的「数据结构」定义 —— 与 agent 一样可带参数(见 docs/sandbox.md)。
 * 必须用工厂函数构造(`dockerSandbox()` / `vercelSandbox()` / `e2bSandbox()` / `defineSandbox()`),
 * 放进 config / experiment 的 `sandbox` 字段 —— 字段类型只接受这个数据结构,不接受裸字符串。
 * 各后端的参数互不相同 —— 这是个按 `backend` 区分的可辨识联合(discriminated union)。
 */
export interface DockerSandboxSpec {
  readonly backend: "docker";
  /** 覆盖默认镜像;默认按 runtime 选 `node:*-slim`。预制模板:传烘焙好 agent CLI 的镜像名。 */
  readonly image?: string;
  readonly runtime?: SandboxRuntime;
}
export interface VercelSandboxSpec {
  readonly backend: "vercel";
  /** 从已有快照起 microVM。预制模板:烘焙好 agent CLI 的 snapshotId。 */
  readonly snapshotId?: string;
  readonly runtime?: SandboxRuntime;
}
export interface E2BSandboxSpec {
  readonly backend: "e2b";
  /** e2b 模板名/ID。预制模板:烘焙好 agent CLI 的模板(如 `"niceeval-agents"`)。省略用 e2b 默认 `"base"`。 */
  readonly template?: string;
  /** 仅作记录;e2b 的 node 版本由模板决定,不在创建时选。 */
  readonly runtime?: SandboxRuntime;
}
/**
 * 用户自定义后端:`create` 直接产出一个 `Sandbox` 实例,不经 resolve.ts 的内置 backend switch。
 * 用 `defineSandbox()` 构造(见 src/define.ts)。`backend` 只用于展示 / 日志,不参与分发。
 */
export interface CustomSandboxSpec {
  readonly backend: string;
  readonly runtime?: SandboxRuntime;
  readonly recommendedConcurrency?: number;
  readonly create: (opts: { timeout?: number; runtime?: SandboxRuntime }) => Promise<Sandbox>;
}

export type SandboxSpec = DockerSandboxSpec | VercelSandboxSpec | E2BSandboxSpec | CustomSandboxSpec;

/** config / experiment 的 `sandbox` 字段:必须是工厂函数产出的 spec 数据结构;沙箱型 agent 不能省略。 */
export type SandboxOption = SandboxSpec;

export interface CommandOptions {
  env?: Record<string, string>;
  cwd?: string;
  /**
   * 把本命令的输出也送进沙箱的「原生日志流」(于是 `docker logs` / Docker UI 的 Logs
   * 标签页能实时看到它)。给 agent 命令(codex exec / bub run / claude)开它,就能在容器
   * 日志里看到 agent 的【原始输出】。后端各自实现(docker:tee 到 PID1 tail 的文件;
   * 不支持的后端忽略)—— 日志怎么浮现是 backend 的事,adapter 只声明意图。
   */
  stream?: boolean;
  /**
   * 以 root 跑本命令。默认 `false` —— 命令以沙箱的标准**非 root** 用户跑(agent 的自然环境)。
   * 给 setup 阶段装系统依赖用(`apt-get install …`、`pip install --break-system-packages …`)。
   *
   * 语义跨后端一致:"本命令以 root 跑,否则以标准非 root 用户跑"。各后端映射到自己的原生机制
   * (docker:`exec --user root`;E2B:`{ user: "root" }`;Vercel:`{ sudo: true }`;Daytona:`{ user }`)。
   * 本就全程 root 的后端(如 Modal)视作 no-op;完全无法提权的后端可不支持(抛错)—— 但**默认值与
   * 语义保持一致**,不因后端而变。
   */
  root?: boolean;
}

export interface Sandbox {
  readonly workdir: string;
  runCommand(cmd: string, args?: string[], opts?: CommandOptions): Promise<CommandResult>;
  runShell(script: string, opts?: CommandOptions): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  /**
   * 一次 shell 往返读全部源码文件(按扩展名收、按目录/文件名忽略)。
   * 取代每个 eval 目录里手写的 find + 逐文件 readFile。
   */
  readSourceFiles(opts?: ReadSourceFilesOptions): Promise<SourceFiles>;
  writeFiles(files: Record<string, string>, targetDir?: string): Promise<void>;
  uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void>;
  uploadDirectory(localDir: string, targetDir?: string, opts?: { ignore?: string[] }): Promise<void>;
  stop(): Promise<void>;
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
   * Docker UI 的 Logs 标签页能实时看到 agent 逐轮活动。docker 后端实现,其它可省略。
   */
  appendLog?(line: string): Promise<void>;

  /**
   * 从沙箱内任意路径读取文件,返回二进制 Buffer。
   * 对应各 backend:Docker getArchive / Vercel readFileToBuffer / e2b files.read(bytes) / …
   */
  downloadFile(path: string): Promise<Buffer>;

  /**
   * 向沙箱内任意路径写入文件(二进制)。
   * 对应各 backend:Docker putArchive / Vercel fs.writeFile(Buffer) / e2b files.write / …
   */
  uploadFile(path: string, content: Buffer): Promise<void>;
}
