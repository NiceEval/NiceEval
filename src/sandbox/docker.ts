// Docker 沙箱 provider:用 dockerode 把容器当隔离工作区跑 eval。
// 改编自 agent-eval 的 docker-sandbox.ts,签名对齐 ../types.ts 的 Sandbox 契约
//(runShell/runCommand 的 opts 一律是选项对象,不再用位置参数)。

import { basename, dirname } from "node:path";
import Docker from "dockerode";
import type {
  Sandbox,
  CommandResult,
  CommandOptions,
  SandboxFile,
  SourceFile,
  SourceFiles,
  ReadSourceFilesOptions,
} from "../types.ts";
import { makeSourceFiles } from "./source-files.ts";
import {
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILES,
  DEFAULT_SOURCE_EXTENSIONS,
  collectLocalFiles,
} from "./local-files.ts";
import { buildFindScript, shellQuote } from "./shell.ts";
import { createExecDemuxer, extractFileFromTar, packFilesToTar, readableToBuffer } from "./docker-stream.ts";
import { resolveSandboxPath } from "./paths.ts";
import { t } from "../i18n/index.ts";
import { reportActivity } from "../runner/feedback/sink.ts";
import { classifyProvisionErrorFallback, type SandboxProvisionErrorKind } from "./errors.ts";

/**
 * dockerode 对镜像拉取限流没有专门的错误类型;Docker Hub 429 体现在错误 message 里
 * (如 "toomanyrequests: You have reached your pull rate limit")。
 */
export function classifyProvisionError(e: unknown): SandboxProvisionErrorKind {
  const msg = e instanceof Error ? e.message : String(e);
  // provider 原生限流形态先归拒绝类;没认出的过与文件 IO 共用的保守瞬时兜底分类器。
  if (/toomanyrequests|rate limit exceeded|429/i.test(msg)) return "rate_limit";
  return classifyProvisionErrorFallback(e);
}

/**
 * Provisioning 重试前的对账:按 provision token 查询本地 daemon,查到的实例先销毁再重建
 * (不做断线收养,重建比重连语义干净)。docker create 是对本地 daemon 的调用,歧义窗口极小,
 * 这条主要兜 daemon 代理 / 远程 DOCKER_HOST 的场景。查询或销毁失败必须抛出——对账是重试的
 * 硬前置,静默放行等于盲重试(见 docs/feature/sandbox/architecture.md);唯一的例外:
 * 容器已不存在(404),视作对账完成。
 */
export async function reconcileProvision(token: string): Promise<void> {
  const docker = new Docker();
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`niceeval.provision-token=${token}`] },
  });
  for (const info of containers) {
    try {
      await docker.getContainer(info.Id).remove({ force: true });
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    }
  }
}

// 行首哨兵:源码文件几乎不可能出现这一串,用来切分单次 shell 输出里的多份文件。
const SOURCE_FILE_MARKER = "::FE-SRC-7b3f9c::";

// 各 Node 运行时对应的镜像。用 -slim 变体下载更快、兼容性够用。
const DOCKER_IMAGES: Record<string, string> = {
  node20: "node:20-slim",
  node24: "node:24-slim",
};

// 单条命令默认超时(10 分钟)。
const DEFAULT_TIMEOUT = 600_000;

// 容器「存活上限」(dead-man switch):PID1 用 `timeout <TTL> tail -F` 跑,到点自动退出 →
// 容器停止 → AutoRemove 清理。这样即便宿主进程被 kill -9 / 崩溃 / 断电(SIGINT handler 来不及
// 跑 stop()),孤儿容器也会在 TTL 后自行消失,不靠任何外部状态。TTL 取 attempt 超时的 2 倍并设
// 下限,确保正常运行(setup + agent + 脚本,本就受 attempt 超时约束)绝不会被它误杀。
const TTL_MULTIPLIER = 2;
const TTL_FLOOR_MS = 1_200_000; // 20 分钟

// 容器内工作目录。
const CONTAINER_WORKDIR = "/home/sandbox/workspace";

// 容器「主日志」文件:PID1 tail 它 → `docker logs` 实时显示;agent 命令的 stream 输出 tee 进来。
const CONTAINER_LOG = "/tmp/niceeval-agent.log";

// 命令默认以非 root 的 node 用户跑:安全 + 兼容(如 Claude Code 在 root 下拒绝
// --dangerously-skip-permissions)。node:*-slim 镜像自带 UID/GID 1000 的 node 用户。
// 需要 root 的命令(setup 装系统依赖)走 runCommand 的 `{ root: true }`;此默认非 root + 按需提
// root 的模型与 E2B / Vercel / Daytona 一致(见 types.ts 的 CommandOptions.root)。
const SANDBOX_UID = 1000;
const SANDBOX_GID = 1000;
const SANDBOX_USER = `${SANDBOX_UID}:${SANDBOX_GID}`;
const ROOT_USER = "root";

// npm 全局包安装目录(非 root 可写)。
const NPM_GLOBAL_DIR = "/home/node/.npm-global";

// 命令执行时注入的 PATH:把 npm 全局 bin 放最前。
const SANDBOX_PATH = `${NPM_GLOBAL_DIR}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;

/** 创建 Docker 沙箱的选项。 */
export interface DockerSandboxOptions {
  /** 单条命令超时(毫秒)。 */
  timeout?: number;
  /** Node 运行时。 */
  runtime?: "node20" | "node24";
  /** 覆盖默认镜像(默认按 runtime 选 `node:*-slim`)。预制模板:烘焙好 agent CLI 的镜像名。 */
  image?: string;
  /** runner 绑定到 `sandbox.create` 的反馈句柄(镜像拉取进度走它);省略退回全局 sink。 */
  feedback?: import("../types.ts").ScopedFeedback;
  /** 一次性 provision token:写进容器 label,歧义类失败重试前按它对账(见 errors.ts 的两维分类)。 */
  provisionToken?: string;
}

/**
 * Docker 沙箱:为每次运行起一个隔离容器。
 * 实现 ../types.ts 的 Sandbox 接口。
 */
export class DockerSandbox implements Sandbox {
  readonly workdir = CONTAINER_WORKDIR;
  readonly otlpHost = "host.docker.internal";
  private docker: Docker;
  private container: Docker.Container | null = null;
  private _containerId = "";
  private timeout: number;
  private runtime: string;
  private image?: string;
  private feedback?: import("../types.ts").ScopedFeedback;
  private provisionToken?: string;

  constructor(options: DockerSandboxOptions = {}) {
    this.docker = new Docker();
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.runtime = options.runtime ?? "node24";
    this.image = options.image;
    this.feedback = options.feedback;
    this.provisionToken = options.provisionToken;
  }

  /** 创建并启动一个 Docker 沙箱。 */
  static async create(options: DockerSandboxOptions = {}): Promise<DockerSandbox> {
    const sandbox = new DockerSandbox(options);
    try {
      await sandbox.initialize();
    } catch (e) {
      // kill-on-failure:容器创建之后的初始化(start、基础工具安装、工作区属主)一旦失败,
      // 先尽力销毁容器再抛出原始错误——不给重试层留一台无主容器
      // (见 docs/feature/sandbox/architecture.md「Provisioning 失败与重试」)。
      await sandbox.container?.remove({ force: true }).catch(() => {});
      throw e;
    }
    return sandbox;
  }

  /** 拉镜像、起容器、装基础工具、备好工作区与 npm 前缀。 */
  private async initialize(): Promise<void> {
    // 显式 image(预制模板)优先;否则按 runtime 选默认 node:*-slim。
    const imageName = this.image ?? DOCKER_IMAGES[this.runtime];
    if (!imageName) {
      throw new Error(t("docker.unsupportedRuntime", { runtime: this.runtime }));
    }

    // 确保镜像在本地。
    await this.ensureImage(imageName);

    // 起容器(先以 root 做初始化,之后命令切到非 root 用户)。
    // PID1 改成 tail 一个日志文件(而非 sleep infinity):这样容器「主日志」= 这个文件,
    // `docker logs` / Docker UI 的 Logs 标签页能实时显示我们 appendLog 进去的 agent 逐轮活动。
    // 文件先 touch + chmod 666,好让之后以 1000 用户跑的 exec 也能往里 append。
    // 外层 `timeout <TTL>` 是 dead-man switch:宿主异常退出(kill -9 / 崩溃)留下的孤儿容器,
    // 到 TTL 后 PID1 自动退出 → 容器停止 → AutoRemove 清理(见 TTL_* 常量)。
    const ttlSec = Math.ceil(Math.max(this.timeout * TTL_MULTIPLIER, TTL_FLOOR_MS) / 1000);
    this.container = await this.docker.createContainer({
      Image: imageName,
      Cmd: [
        "sh",
        "-c",
        `touch ${CONTAINER_LOG}; chmod 666 ${CONTAINER_LOG}; exec timeout ${ttlSec} tail -n +1 -F ${CONTAINER_LOG}`,
      ],
      WorkingDir: CONTAINER_WORKDIR,
      // provision token:歧义类失败的对账通道(按 label 查询本地容器);
      // keep-candidate:留存候选标记(异常硬退时核对未完成提交的候选)。
      Labels: {
        "niceeval.keep-candidate": "true",
        ...(this.provisionToken ? { "niceeval.provision-token": this.provisionToken } : {}),
      },
      Tty: true,
      HostConfig: {
        // 不带 AutoRemove:留存意图必须在创建期传入(--keep-sandbox 的 suspend = docker stop,
        // 停驻容器的文件系统落盘持久)。默认路径的销毁由 stop() 显式 stop + remove,行为等价;
        // 宿主异常硬退留下的孤儿由 TTL dead-man switch 停驻后按 keep-candidate 标签事后核对。
        AutoRemove: false,
        // 容器经 host.docker.internal 回连宿主上的 OTLP 接收器(tracing agent 用)。
        // Docker Desktop 自带这个名字;Linux 需显式映到 host-gateway,这里统一加上。
        ExtraHosts: ["host.docker.internal:host-gateway"],
      },
    });

    this._containerId = this.container.id;

    await this.container.start();

    // slim 镜像可能缺 CA 证书和 git,补装。
    await this.runCommandAsRoot("bash", [
      "-c",
      "apt-get update -qq && apt-get install -y -qq ca-certificates git curl > /dev/null 2>&1",
    ]);

    // 工作目录交给非 root 用户(node:node)。node 用户(UID 1000)在 slim 镜像里已存在。
    await this.runCommandAsRoot("mkdir", ["-p", CONTAINER_WORKDIR]);
    await this.runCommandAsRoot("chown", ["-R", SANDBOX_USER, CONTAINER_WORKDIR]);

    // 为非 root 全局安装准备 npm 目录。
    await this.runCommandAsRoot("mkdir", ["-p", NPM_GLOBAL_DIR]);
    await this.runCommandAsRoot("chown", ["-R", SANDBOX_USER, NPM_GLOBAL_DIR]);

    // 让 npm 用这个目录当全局前缀(默认非 root,配置落在 node 家目录,供 agent 全局装 CLI 用)。
    await this.runCommand("npm", ["config", "set", "prefix", NPM_GLOBAL_DIR]);
  }

  /** 确保镜像在本地,缺了就拉。 */
  private async ensureImage(imageName: string): Promise<void> {
    try {
      const image = this.docker.getImage(imageName);
      await image.inspect();
    } catch {
      // 镜像不存在,拉取。「progress」而非「diagnostic」—— 这是正常进度,不是需要去重/永久
      // 留痕的 warning。走 create 绑定的 ScopedFeedback(runner 归因到 sandbox.create);
      // 直调(无 runner)时退回全局 sink。
      const progress = (message: string) =>
        this.feedback ? this.feedback.progress({ message }) : reportActivity(message);
      progress(t("docker.imagePullStart", { image: imageName }).trimEnd());
      await this.pullImage(imageName);
      progress(t("docker.imagePullDone", { image: imageName }).trimEnd());
    }
  }

  /** 拉取镜像并跟进度。 */
  private async pullImage(imageName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        this.docker.modem.followProgress(
          stream,
          (followErr: Error | null) => {
            if (followErr) {
              reject(followErr);
            } else {
              resolve();
            }
          },
          // 进度回调(可在此挂进度条)。
          () => {},
        );
      });
    });
  }

  /** 容器短 ID(像 Docker CLI 那样取前 12 位)。 */
  get sandboxId(): string {
    return this._containerId.slice(0, 12);
  }

  /**
   * 在容器里跑一条命令。默认以非 root 的 node 用户跑;`opts.root` 为真则以 root 跑
   * (setup 装系统依赖用)。
   */
  async runCommand(
    cmd: string,
    args: string[] = [],
    opts: CommandOptions = {},
  ): Promise<CommandResult> {
    // stream:把本命令输出也接到容器主日志(PID1 tail 它)→ Docker Logs 看到原始输出。
    // 实现:把 cmd+args 安全拼成 shell 串,经 runShell 走 tee(只 tee stdout,保留 stderr 分离 + 退出码)。
    if (opts.stream) {
      const joined = [cmd, ...args].map(shellQuote).join(" ");
      return this.runShell(joined, {
        env: opts.env,
        cwd: opts.cwd,
        stream: true,
        root: opts.root,
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
      });
    }

    // 保证 npm 全局 bin 在 PATH 里;固定 HOME/USER,让 codex(~/.codex)、npm 全局、
    // bash 的 ~ 展开都落在当前身份的家目录,不依赖 docker exec 是否注入 HOME。
    const isRoot = opts.root === true;
    const env = {
      HOME: isRoot ? "/root" : "/home/node",
      USER: isRoot ? "root" : "node",
      LOGNAME: isRoot ? "root" : "node",
      ...opts.env,
      PATH: SANDBOX_PATH,
      // root 跑 npm 时让 install 脚本也以 root 跑(否则 npm 会把脚本降权到目录属主,可能写不进)。
      // 非 root 时此变量无影响。
      ...(isRoot ? { npm_config_unsafe_perm: "true" } : {}),
    };

    return this.execCommand(cmd, args, {
      env,
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      user: isRoot ? ROOT_USER : SANDBOX_USER,
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
    });
  }

  /** 以 root 跑命令(provider 内部用:容器初始化、属主收敛)。 */
  private async runCommandAsRoot(
    cmd: string,
    args: string[] = [],
    opts: CommandOptions = {},
  ): Promise<CommandResult> {
    return this.execCommand(cmd, args, {
      env: opts.env,
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      user: ROOT_USER,
    });
  }

  /** 把目录属主收敛回非 root 的沙箱用户(putArchive 以 root 解包后用)。 */
  private async chownToSandboxUser(path: string): Promise<void> {
    await this.runCommandAsRoot("chown", ["-R", SANDBOX_USER, path]);
  }

  /** 真正在容器里 exec 一条命令,demux stdout/stderr 并带超时。 */
  private async execCommand(
    cmd: string,
    args: string[] = [],
    opts: {
      env?: Record<string, string>;
      cwd?: string;
      user?: string;
      onStdout?: (chunk: string) => void | Promise<void>;
      onStderr?: (chunk: string) => void | Promise<void>;
    } = {},
  ): Promise<CommandResult> {
    if (!this.container) {
      throw new Error(t("docker.containerNotInitialized"));
    }

    const fullCmd = [cmd, ...args];
    const env = opts.env
      ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)
      : undefined;

    const exec = await this.container.exec({
      Cmd: fullCmd,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: resolveSandboxPath(this.workdir, opts.cwd),
      Env: env,
      User: opts.user,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise<CommandResult>((resolve, reject) => {
      // Docker 把 stdout/stderr 复用在同一条流里(8 字节头 + 载荷),需手动 demux;
      // 跨 chunk 的帧累积逻辑见 docker-stream.ts 的 createExecDemuxer。
      const demuxer = createExecDemuxer();
      // Docker 的 demuxer 先保证帧边界完整，再把每帧即时送给调用方。回调串行化，避免
      // async consumer（如 JSONL 行缓冲）因后一个 chunk 先完成而乱序。
      let callbackChain = Promise.resolve();
      stream.on("data", (chunk: Buffer) => {
        const beforeStdout = demuxer.stdout().length;
        const beforeStderr = demuxer.stderr().length;
        demuxer.push(chunk);
        const stdout = demuxer.stdout().slice(beforeStdout);
        const stderr = demuxer.stderr().slice(beforeStderr);
        if (stdout && opts.onStdout) callbackChain = callbackChain.then(() => opts.onStdout!(stdout));
        if (stderr && opts.onStderr) callbackChain = callbackChain.then(() => opts.onStderr!(stderr));
      });

      // 超时:杀流并 reject。
      const timeoutId = setTimeout(() => {
        stream.destroy();
        reject(new Error(t("docker.commandTimeout", { timeoutMs: this.timeout })));
      }, this.timeout);

      stream.on("end", async () => {
        clearTimeout(timeoutId);
        const stdout = demuxer.stdout();
        const stderr = demuxer.stderr();

        try {
          await callbackChain;
          const inspection = await exec.inspect();
          resolve({
            stdout,
            stderr,
            exitCode: inspection.ExitCode ?? 0,
          });
        } catch (error) {
          reject(error);
        }
      });

      stream.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /** 经 bash -c 跑一段 shell 脚本。opts 为选项对象。 */
  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    if (opts.stream) {
      // 只 tee stdout 到容器主日志:保留 stderr 分离(解析器要)+ pipefail 保留命令退出码。
      const wrapped = `set -o pipefail; { ${script} ; } | tee -a ${CONTAINER_LOG}`;
      return this.runCommand("bash", ["-c", wrapped], {
        env: opts.env,
        cwd: opts.cwd,
        root: opts.root,
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
      });
    }
    return this.runCommand("bash", ["-c", script], opts);
  }

  /** 追加一行到容器主日志(PID1 在 tail)→ Docker 的 Logs 标签页实时可见。 */
  async appendLog(line: string): Promise<void> {
    const esc = line.replace(/'/g, "'\\''");
    await this.runCommand("sh", ["-c", `printf '%s\\n' '${esc}' >> ${CONTAINER_LOG}`]);
  }

  /** 读容器里的文件。 */
  async readFile(path: string): Promise<string> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const result = await this.runCommand("cat", [absPath]);
    if (result.exitCode !== 0) {
      throw new Error(t("docker.readFileFailed", { path: absPath, stderr: result.stderr }));
    }
    return result.stdout;
  }

  /** 判断容器里某文件是否存在。 */
  async fileExists(path: string): Promise<boolean> {
    const result = await this.runCommand("test", ["-f", resolveSandboxPath(this.workdir, path)]);
    return result.exitCode === 0;
  }

  /**
   * 一次 shell 往返读全部源码文件。find 按目录名(任意深度)剪枝、按扩展名收,
   * 每份文件前打一行哨兵 + 相对路径,再 cat 内容;在宿主侧按哨兵切分。
   */
  async readSourceFiles(opts: ReadSourceFilesOptions = {}): Promise<SourceFiles> {
    const extensions = opts.extensions ?? DEFAULT_SOURCE_EXTENSIONS;
    const ignoreDirs = opts.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
    const ignoreFiles = new Set(opts.ignoreFiles ?? DEFAULT_IGNORE_FILES);

    const script =
      `${buildFindScript({ extensions, ignoreDirs })} | ` +
      `while IFS= read -r f; do printf '%s%s\\n' '${SOURCE_FILE_MARKER}' "$f"; cat "$f"; printf '\\n'; done`;
    const result = await this.runShell(script);

    const files: SourceFile[] = [];
    for (const chunk of result.stdout.split(SOURCE_FILE_MARKER)) {
      const newline = chunk.indexOf("\n");
      if (newline < 0) continue; // 第一段(哨兵前的空串)或畸形段
      const path = chunk.slice(0, newline).trim().replace(/^\.\//, "");
      if (!path || ignoreFiles.has(path.split("/").at(-1) ?? "")) continue;
      // 去掉我们额外追加的那个结尾换行,还原文件原始内容。
      const body = chunk.slice(newline + 1);
      const content = body.endsWith("\n") ? body.slice(0, -1) : body;
      files.push({ path, content });
    }
    return makeSourceFiles(files);
  }

  /** 批量写文件(路径 -> 文本内容)。 */
  async writeFiles(files: Record<string, string>, targetDir?: string): Promise<void> {
    const sandboxFiles: SandboxFile[] = Object.entries(files).map(([path, content]) => ({
      path,
      content: Buffer.from(content, "utf-8"),
    }));

    await this.uploadFiles(sandboxFiles, targetDir);
  }

  /** 用 tar 归档把文件灌进容器。 */
  async uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void> {
    if (!this.container) {
      throw new Error(t("docker.containerNotInitialized"));
    }

    if (files.length === 0) {
      return;
    }

    // 打 tar 包。
    const pack = packFilesToTar(
      files.map((file) => ({
        name: file.path,
        content: typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : file.content,
      })),
    );

    const targetPath = resolveSandboxPath(this.workdir, targetDir);

    await this.runCommandAsRoot("mkdir", ["-p", targetPath]);

    // putArchive 以 root 身份解包到目标目录。
    await this.container.putArchive(pack, { path: targetPath });

    // 修正属主:putArchive 上传成 root,改回 node 用户,agent 才能编辑。
    await this.chownToSandboxUser(targetPath);
  }

  async uploadDirectory(localDir: string, targetDir?: string, opts: { ignore?: string[] } = {}): Promise<void> {
    const files = await collectLocalFiles(localDir, opts.ignore);
    await this.uploadFiles(files, targetDir);
  }

  /**
   * 从容器任意路径读文件 → Buffer。
   * 用 Docker getArchive API(原生二进制,无 base64 开销);tar 只有一个 entry,直接解包取内容。
   */
  async downloadFile(path: string): Promise<Buffer> {
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
    const stream = await (this.container as Docker.Container).getArchive({ path: resolveSandboxPath(this.workdir, path) });
    const tarBuf = await readableToBuffer(stream as NodeJS.ReadableStream);
    return extractFileFromTar(tarBuf);
  }

  /**
   * 向容器任意路径写文件(二进制)。
   * 打成单文件 tar → putArchive 到目标目录,与 uploadFiles 同一机制但目标路径自由。
   */
  async uploadFile(destPath: string, content: Buffer): Promise<void> {
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
    const absPath = resolveSandboxPath(this.workdir, destPath);
    const pack = packFilesToTar([{ name: basename(absPath), content }]);
    await (this.container as Docker.Container).putArchive(pack, { path: dirname(absPath) });
  }

  /** 销毁容器:显式 stop + remove(创建时不带 AutoRemove,见 createContainer 的注释)。 */
  async stop(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop({ t: 0 }); // 立即停止
      } catch {
        // 容器可能已停止或被移除,忽略。
      }
      try {
        await this.container.remove({ force: true });
      } catch {
        // 已被移除,忽略。
      }
      this.container = null;
    }
  }

  /**
   * 留存休眠(suspend):`docker stop`——文件系统落盘持久、不占内存、跨 daemon 重启存活。
   * 不用 `docker pause`(内存驻留,daemon 重启即失)也不用 `docker commit`(引入第二种资源面)。
   * 不属于中性 Sandbox 接口——「留下」是 runner 的调度决定,不是沙箱的能力;由 sandbox/keep.ts
   * 在 sandbox/ 域内路由到这里。
   */
  async suspend(): Promise<void> {
    if (!this.container) throw new Error("container already released");
    await this.container.stop({ t: 5 });
  }
}
