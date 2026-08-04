// Docker 沙箱 provider:用 dockerode 把容器当隔离工作区跑 eval。
// 改编自 agent-eval 的 docker-sandbox.ts,签名对齐 ../types.ts 的 Sandbox 契约
//(runShell/runCommand 的 opts 一律是选项对象,不再用位置参数)。

import { basename, dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import Docker from "dockerode";
import type {
  CommandResult,
  CommandOptions,
  SandboxReuseCapability,
  SuccessfulCommandResult,
} from "../types.ts";
import { collectLocalFiles, type CollectedLocalFile } from "./local-files.ts";
import { shellQuote } from "./shell.ts";
import {
  createExecDemuxer,
  extractFileFromTar,
  extractFilesFromTar,
  packFilesToTar,
  readableToBuffer,
} from "./docker-stream.ts";
import { resolveLocalPath, resolveSandboxPath } from "./paths.ts";
import { commandLimit, SandboxCommandTimeoutError } from "./deadline.ts";
import { successfulCommandResult } from "./operations.ts";
import { t } from "../i18n/index.ts";
import { reportActivity } from "../runner/feedback/sink.ts";
import { classifyProvisionErrorFallback, type SandboxProvisionErrorKind } from "./errors.ts";
import { dockerRunIdentityLabels, type RunIdentity } from "./run-identity.ts";
import { supportedBackendCapability, type SandboxProviderBackend } from "./backend.ts";

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

// 各 Node 运行时对应的镜像。用 -slim 变体下载更快、兼容性够用。
const DOCKER_IMAGES: globalThis.Record<string, string> = {
  node20: "node:20-slim",
  node24: "node:24-slim",
};

// 容器 dead-man TTL 的兜底基数:四层解析链一个上限都没声明(attempt 没有 deadline)时,
// TTL 仍需要一个具体秒数烧进 PID1。它只决定「孤儿容器多久自行消失」,不是任何命令的上限——
// 单条命令的上限恒从 attempt deadline 派生(见 deadline.ts)。
const TTL_BASE_WITHOUT_DEADLINE = 600_000;

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

// 命令默认沿用环境自己声明的执行身份:省略 `user` 时 docker exec 不注入 `--user`,
// 镜像 `USER` 原样生效(未声明按 Docker 语义是 root)。需要别的身份走 factory `user`
// (整个 Sandbox 的默认身份)或 runCommand 的 `{ user: "root" }`(只这一条命令)——
// 见 docs/feature/sandbox/library.md「执行身份」。
const ROOT_USER = "root";

/** `user` 取值是否等价于 root(数字 uid 0、`0:0` 或字面量 `root`)。 */
function isRootLikeUserSpec(value: string): boolean {
  return value === "0" || value === "0:0" || value === ROOT_USER;
}

/** 创建 Docker 沙箱的选项。 */
export interface DockerSandboxOptions {
  /** attempt 的超时上限(毫秒),单条命令未显式传 `timeout` 时的上限来源;省略 = 没有上限。 */
  timeout?: number;
  /** attempt deadline 的截止时刻(epoch ms);单条命令按**剩余量**取上限(见 deadline.ts)。 */
  deadlineAt?: number;
  /** 容器实例寿命；与单条命令 timeout 分离。 */
  lifetimeMs?: number;
  /** Node 运行时。 */
  runtime?: "node20" | "node24";
  /** 覆盖默认镜像(默认按 runtime 选 `node:*-slim`)。预制模板:烘焙好 agent CLI 的镜像名。 */
  image?: string;
  /** runner 绑定到 `sandbox.create` 的反馈句柄(镜像拉取进度走它);省略退回全局 sink。 */
  feedback?: import("../types.ts").ScopedFeedback;
  /** 一次性 provision token:写进容器 label,歧义类失败重试前按它对账(见 errors.ts 的两维分类)。 */
  provisionToken?: string;
  /**
   * 创建期写入的运行标识(host/pid/startedAt),供强杀之后的孤儿核对按 label 事后收回(见
   * docs/feature/sandbox/architecture.md「孤儿核对」)。省略时不写这组 label(如直接单测构造
   * DockerSandbox,不经 runtime.ts 的 provider materializer)。
   */
  runIdentity?: RunIdentity;
  /**
   * 覆盖默认 workdir。Compose mainService 附着时用容器 inspect 的 WorkingDir;
   * 省略 = `/home/sandbox/workspace`。
   */
  workdir?: string;
  /**
   * 覆盖整个 Sandbox 的默认执行身份;省略时沿用镜像 `USER`(未声明按 Docker 语义是 root)、
   * Compose service `user:` 或其镜像 `USER`。
   */
  user?: string;
  /**
   * 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library.md
   * 「PATH:受管变量与 pathPrepend」)。
   */
  pathPrepend?: readonly string[];
}

/** `stop()` 时是否销毁容器。Compose 主容器由资源组 `compose down` 回收,附着句柄只松绑。 */
export type DockerSandboxReleaseMode = "destroy" | "detach";

/**
 * Docker 沙箱:为每次运行起一个隔离容器。
 * 实现 ../types.ts 的 Sandbox 接口。
 */
export class DockerSandbox implements SandboxProviderBackend, SandboxReuseCapability {
  readonly workdir: string;
  readonly otlpHost = "host.docker.internal";
  private docker: Docker;
  private container: Docker.Container | null = null;
  private _containerId = "";
  private timeout?: number;
  private deadlineAt?: number;
  private lifetimeMs?: number;
  /** 容器 PID1 的 dead-man TTL 到期时刻(initialize 里烧进 `timeout` 那一刻定死)。 */
  private expiresAtMs?: number;
  private runtime: string;
  private image?: string;
  private feedback?: import("../types.ts").ScopedFeedback;
  private provisionToken?: string;
  private runIdentity?: RunIdentity;
  private releaseMode: DockerSandboxReleaseMode = "destroy";
  /** 起点覆盖(factory `user`);省略 = 沿用镜像/Compose 声明的默认身份。 */
  private readonly userOverride?: string;
  /** factory `pathPrepend`;按声明顺序前置到受管 PATH,省略 = 空数组。 */
  private readonly pathPrepend: readonly string[];
  /** 下面三项由 `resolveDefaultIdentity()` 探测得出,构造期先给出安全占位值。 */
  private defaultHome = "/root";
  private defaultUserName = "root";
  private defaultIsRoot = true;
  private npmGlobalDir = "/root/.npm-global";
  private sandboxPath: string;
  readonly capabilities = {
    rootCommands: supportedBackendCapability(true as const),
    appendLog: supportedBackendCapability((line: string) => this.appendLog(line)),
    suspend: supportedBackendCapability(() => this.suspend()),
    ensureLifetime: supportedBackendCapability((minRemainingMs: number) => this.ensureLifetime(minRemainingMs)),
    setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => this.setCommandDeadline(deadlineAt)),
  };

  constructor(options: DockerSandboxOptions = {}) {
    this.docker = new Docker();
    this.workdir = options.workdir ?? CONTAINER_WORKDIR;
    this.timeout = options.timeout;
    this.deadlineAt = options.deadlineAt;
    this.lifetimeMs = options.lifetimeMs;
    this.runtime = options.runtime ?? "node24";
    this.image = options.image;
    this.feedback = options.feedback;
    this.provisionToken = options.provisionToken;
    this.runIdentity = options.runIdentity;
    this.userOverride = options.user === "" ? undefined : options.user;
    this.pathPrepend = options.pathPrepend ?? [];
    this.sandboxPath = this.managedPath(this.npmGlobalDir);
  }

  /** 受管 PATH:`pathPrepend` 按声明顺序前置到 npm 全局 bin + 系统默认路径。 */
  private managedPath(npmGlobalDir: string): string {
    const base = `${npmGlobalDir}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
    return this.pathPrepend.length > 0 ? `${this.pathPrepend.join(":")}:${base}` : base;
  }

  /** 复用下由池在每次借出时换成承接者自己的 deadline(见 sandbox/deadline.ts)。 */
  setCommandDeadline(deadlineAt?: number): void {
    this.deadlineAt = deadlineAt;
  }

  /**
   * 附着到已在跑的容器(Compose mainService)。不改 Cmd/WorkingDir/网络——题目语义原样保留;
   * `stop()` 默认只松绑句柄,整组回收由 Compose 资源组 finalizer 负责。
   */
  static async attach(
    containerId: string,
    options: DockerSandboxOptions & { releaseMode?: DockerSandboxReleaseMode } = {},
  ): Promise<DockerSandbox> {
    const docker = new Docker();
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    if (!info.State?.Running) {
      throw new Error(
        `cannot attach DockerSandbox to container ${containerId.slice(0, 12)}: state is ${info.State?.Status ?? "unknown"}`,
      );
    }
    const inspectedWorkdir =
      typeof info.Config?.WorkingDir === "string" && info.Config.WorkingDir.length > 0
        ? info.Config.WorkingDir
        : CONTAINER_WORKDIR;
    const sandbox = new DockerSandbox({
      ...options,
      workdir: options.workdir ?? inspectedWorkdir,
    });
    sandbox.docker = docker;
    sandbox.container = container;
    sandbox._containerId = info.Id ?? containerId;
    sandbox.releaseMode = options.releaseMode ?? "detach";
    // Compose template 是题目的镜像，不能假设预装了 runner 私有分类账所需的 git。
    // 这属于 provider 兑现 Sandbox 契约的初始化，不应让每条 Eval 改自己的 Dockerfile。
    await sandbox.ensureRunnerTools();
    await sandbox.resolveDefaultIdentity();
    return sandbox;
  }

  /**
   * 寿命确认:容器 TTL 烧在 PID1 的 `timeout` 里,没有续期通道,所以这里只确认、不续期
   * (`SandboxReuseCapability` 允许二选一)。剩余不够就如实说不够,由 runner 轮换实例。
   */
  async ensureLifetime(minRemainingMs: number): Promise<{ ready: true; expiresAt?: string } | { ready: false; reason: string }> {
    if (this.lifetimeMs === undefined) {
      return { ready: false, reason: "the docker sandbox needs lifetimeMs when sandboxReuse is enabled" };
    }
    if (this.expiresAtMs === undefined) {
      return { ready: false, reason: "the docker sandbox has not started yet; its lifetime is unknown" };
    }
    const remaining = this.expiresAtMs - Date.now();
    return remaining >= minRemainingMs
      ? { ready: true, expiresAt: new Date(this.expiresAtMs).toISOString() }
      : {
          ready: false,
          reason:
            `this docker container's dead-man TTL leaves ${Math.round(remaining / 1000)}s, ` +
            `but the next attempt needs ${Math.round(minRemainingMs / 1000)}s (a container TTL cannot be extended)`,
        };
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
    const ttlSec = Math.ceil(Math.max(this.lifetimeMs ?? (this.timeout ?? TTL_BASE_WITHOUT_DEADLINE) * TTL_MULTIPLIER, TTL_FLOOR_MS) / 1000);
    // TTL 一旦烧进 PID1 的 `timeout` 就改不了(容器没有续期通道),所以这里把真实到期时刻记下来,
    // 供 ensureLifetime 如实回答;不够用时由 runner 轮换实例,而不是让容器在 attempt 中途消失。
    this.expiresAtMs = Date.now() + ttlSec * 1000;
    this.container = await this.docker.createContainer({
      Image: imageName,
      Cmd: [
        "sh",
        "-c",
        `touch ${CONTAINER_LOG}; chmod 666 ${CONTAINER_LOG}; exec timeout ${ttlSec} tail -n +1 -F ${CONTAINER_LOG}`,
      ],
      WorkingDir: this.workdir,
      // provision token:歧义类失败的对账通道(按 label 查询本地容器);
      // keep-candidate:留存候选标记(异常硬退时核对未完成提交的候选)。
      Labels: {
        "niceeval.keep-candidate": "true",
        ...(this.provisionToken ? { "niceeval.provision-token": this.provisionToken } : {}),
        ...(this.runIdentity ? dockerRunIdentityLabels(this.runIdentity) : {}),
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
    await this.ensureRunnerTools();

    // 探测默认执行身份(镜像 USER,或 factory 的 `user` 覆盖)的 home 目录,后续 chown 与
    // npm 全局前缀都按它解析,不硬编码 UID/家目录(见 docs/feature/sandbox/library.md「执行身份」)。
    await this.resolveDefaultIdentity();

    // 工作目录交给默认执行身份。
    await this.runCommandAsRoot("mkdir", ["-p", this.workdir]);
    await this.runCommandAsRoot("chown", ["-R", this.chownTarget(), this.workdir]);

    // 为非 root 全局安装准备 npm 目录;root 身份下这一步是无害的自有目录。
    await this.runCommandAsRoot("mkdir", ["-p", this.npmGlobalDir]);
    await this.runCommandAsRoot("chown", ["-R", this.chownTarget(), this.npmGlobalDir]);

    // 让 npm 用这个目录当全局前缀(配置落在默认身份的家目录,供 agent 全局装 CLI 用)。
    await this.runCommand("npm", ["config", "set", "prefix", this.npmGlobalDir]);
  }

  /**
   * 探测 Sandbox 默认执行身份(`this.userOverride` 未设置时即容器/镜像的默认身份)的
   * uid、用户名与家目录:省略 `User` 字段的 exec 沿用容器默认身份,`$HOME` 由容器内
   * `/etc/passwd` 解析,不在 runner 侧维护一张 UID → 家目录的映射表。
   */
  private async resolveDefaultIdentity(): Promise<void> {
    const probe = await this.execCommand("sh", [
      "-c",
      'printf "%s\\n%s\\n%s" "$(id -u)" "$(id -un 2>/dev/null || true)" "$HOME"',
    ], { user: this.userOverride });
    const [rawUid = "", rawName = "", rawHome = ""] = probe.stdout.split("\n");
    const uid = rawUid.trim();
    const name = rawName.trim();
    const home = rawHome.trim();
    this.defaultIsRoot = uid === "0";
    this.defaultUserName = name !== "" ? name : (this.defaultIsRoot ? ROOT_USER : (this.userOverride ?? uid));
    this.defaultHome = home !== "" ? home : (this.defaultIsRoot ? "/root" : `/home/${this.defaultUserName}`);
    this.npmGlobalDir = `${this.defaultHome}/.npm-global`;
    this.sandboxPath = this.managedPath(this.npmGlobalDir);
  }

  /** chown 目标:factory 覆盖时原样复用(接受 name / uid[:gid]),否则用探测出的用户名。 */
  private chownTarget(): string {
    return this.userOverride ?? this.defaultUserName;
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

  /**
   * 补齐 NiceEval 自身运行所需的最小工具面。单容器默认镜像与 Compose 附着容器走同一条：
   * 先 probe，命中时零改动；缺失时以 root 使用镜像已有的包管理器安装。题目镜像无法兑现时
   * 明确报错，不把 `git: command not found` 延后到 workspace.baseline。
   */
  async ensureRunnerTools(): Promise<void> {
    const script = [
      "set -eu",
      "command -v git >/dev/null 2>&1 && exit 0",
      "export DEBIAN_FRONTEND=noninteractive",
      "if command -v apt-get >/dev/null 2>&1; then",
      "  apt-get update -qq && apt-get install -y -qq ca-certificates git curl >/dev/null",
      "elif command -v apk >/dev/null 2>&1; then",
      "  apk add --no-cache ca-certificates git curl >/dev/null",
      "elif command -v microdnf >/dev/null 2>&1; then",
      "  microdnf install -y ca-certificates git curl >/dev/null",
      "elif command -v dnf >/dev/null 2>&1; then",
      "  dnf install -y ca-certificates git curl >/dev/null",
      "elif command -v yum >/dev/null 2>&1; then",
      "  yum install -y ca-certificates git curl >/dev/null",
      "else",
      '  printf "%s\\n" "niceeval Docker runtime requires git for its private change ledger, but the image has no supported package manager (apt-get, apk, microdnf, dnf, or yum)" >&2',
      "  exit 127",
      "fi",
      'command -v git >/dev/null 2>&1 || { printf "%s\\n" "niceeval Docker runtime could not install git for its private change ledger" >&2; exit 127; }',
    ].join("\n");
    const result = await this.runCommandAsRoot("sh", ["-c", script]);
    if (result.exitCode === 0) return;
    const detail = result.stderr.trim().split("\n").at(-1);
    throw new Error(
      `prepare Docker runner tools failed (exit ${result.exitCode})${detail ? `: ${detail}` : ""}`,
    );
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
   * 在容器里跑一条命令。默认沿用 Sandbox 的默认执行身份(factory `user` 覆盖后的身份,
   * 否则镜像声明的 USER);`opts.user` 只覆盖这一条命令。
   */
  async runCommand(
    cmd: string,
    args: readonly string[] = [],
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
        user: opts.user,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        signal: opts.signal,
        onStdout: opts.onStdout,
        onStderr: opts.onStderr,
      });
    }

    // 省略 `user` 时不注入 --user,沿用容器默认身份(factory `user` 覆盖后的身份,否则镜像
    // 声明的 USER);这时 HOME/USER/LOGNAME 用探测出的默认身份家目录,让 codex(~/.codex)、
    // npm 全局、bash 的 ~ 展开都落在正确的地方。显式覆盖时把 HOME 决定权交还 docker exec
    // 自己按容器 /etc/passwd 解析,不代它猜一个可能错的家目录。
    const isRootUser = opts.user !== undefined ? isRootLikeUserSpec(opts.user) : this.defaultIsRoot;
    const env = {
      ...(opts.user === undefined
        ? { HOME: this.defaultHome, USER: this.defaultUserName, LOGNAME: this.defaultUserName }
        : {}),
      ...opts.env,
      PATH: this.sandboxPath,
      // root 跑 npm 时让 install 脚本也以 root 跑(否则 npm 会把脚本降权到目录属主,可能写不进)。
      // 非 root 时此变量无影响。
      ...(isRootUser ? { npm_config_unsafe_perm: "true" } : {}),
    };

    return this.execCommand(cmd, [...args], {
      env,
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      user: opts.user ?? this.userOverride,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
      signal: opts.signal,
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

  /** 把目录属主收敛回默认执行身份(putArchive 以 root 解包后用)。 */
  private async chownToSandboxUser(path: string): Promise<void> {
    await this.runCommandAsRoot("chown", ["-R", this.chownTarget(), path]);
  }

  /** 真正在容器里 exec 一条命令,demux stdout/stderr 并带超时。 */
  private async execCommand(
    cmd: string,
    args: string[] = [],
    opts: {
      env?: globalThis.Record<string, string>;
      cwd?: string;
      user?: string;
      /** 这条命令的显式上限;省略 = 按 attempt deadline 的剩余量。 */
      timeoutMs?: number;
      onStdout?: (chunk: string) => void | Promise<void>;
      onStderr?: (chunk: string) => void | Promise<void>;
      signal?: AbortSignal;
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
        const onStdout = opts.onStdout;
        const onStderr = opts.onStderr;
        if (stdout && onStdout !== undefined) callbackChain = callbackChain.then(() => onStdout(stdout));
        if (stderr && onStderr !== undefined) callbackChain = callbackChain.then(() => onStderr(stderr));
      });

      // 超时:杀流并 reject。上限从 attempt deadline 的剩余量派生(显式传 timeout 时按显式值),
      // 没有 deadline 就不挂这条 timer——provider 层不发明一条自己的线。
      const limit = commandLimit(opts, { commandTimeoutMs: this.timeout, deadlineAt: this.deadlineAt });
      let terminating = false;
      const retireAndReject = (error: Error): void => {
        if (terminating) return;
        terminating = true;
        stream.destroy();
        void this.stop().then(() => reject(error), reject);
      };
      const timeoutMs = limit.timeoutMs;
      const timeoutId = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            retireAndReject(new SandboxCommandTimeoutError(
              t("docker.commandTimeout", { timeoutMs }),
              timeoutMs,
              limit.explicit,
            ));
          }, timeoutMs);
      const onAbort = (): void => {
        const reason = opts.signal?.reason;
        retireAndReject(reason instanceof Error ? reason : new DOMException("sandbox command aborted", "AbortError"));
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts.signal?.aborted) onAbort();

      stream.on("end", async () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        opts.signal?.removeEventListener("abort", onAbort);
        if (terminating) return;
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
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        opts.signal?.removeEventListener("abort", onAbort);
        if (terminating) return;
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
        user: opts.user,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        signal: opts.signal,
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
  async runCommandOrThrow(
    cmd: string,
    args: readonly string[] = [],
    opts: CommandOptions = {},
  ): Promise<SuccessfulCommandResult> {
    return successfulCommandResult(await this.runCommand(cmd, args, opts), opts.sensitiveValues);
  }

  async runShellOrThrow(script: string, opts: CommandOptions = {}): Promise<SuccessfulCommandResult> {
    return successfulCommandResult(await this.runShell(script, opts), opts.sensitiveValues);
  }

  async readText(path: string): Promise<string> {
    const absPath = resolveSandboxPath(this.workdir, path);
    const result = await this.runCommand("cat", [absPath]);
    if (result.exitCode !== 0) {
      throw new Error(t("docker.readFileFailed", { path: absPath, stderr: result.stderr }));
    }
    return result.stdout;
  }

  /** 判断容器里某文件是否存在。 */
  async pathExists(path: string): Promise<boolean> {
    const result = await this.runCommand("test", ["-e", resolveSandboxPath(this.workdir, path)]);
    return result.exitCode === 0;
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.writeBytes(path, Buffer.from(content, "utf-8"));
  }

  /** 用 tar 归档把文件灌进容器。 */
  private async writeCollectedFiles(files: readonly CollectedLocalFile[], targetDir?: string): Promise<void> {
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
        content: Buffer.from(file.content),
      })),
    );

    const targetPath = resolveSandboxPath(this.workdir, targetDir);

    await this.runCommandAsRoot("mkdir", ["-p", targetPath]);

    // putArchive 以 root 身份解包到目标目录。
    await this.container.putArchive(pack, { path: targetPath });

    // 修正属主:putArchive 上传成 root,改回 node 用户,agent 才能编辑。
    await this.chownToSandboxUser(targetPath);
  }

  async uploadFile(source: string | URL, targetPath: string): Promise<void> {
    await this.writeBytes(targetPath, await readFile(resolveLocalPath(undefined, source)));
  }

  async uploadDirectory(
    sourceDir: string | URL,
    targetDir?: string,
    opts: { readonly ignore?: readonly string[] } = {},
  ): Promise<void> {
    const files = await collectLocalFiles(resolveLocalPath(undefined, sourceDir), opts.ignore);
    await this.writeCollectedFiles(files, targetDir);
  }

  /**
   * 递归下载容器内一个目录到本地磁盘,与 uploadDirectory 对称。用 getArchive 单次取回
   * 整棵目录的 tar(而不是逐文件走 downloadFile):getArchive 对目录路径返回的 tar 里,
   * entry 名以请求路径的 basename 为首段(如请求 `/…/out` 得到 `out/x.txt`),剥离首段
   * 还原成相对 localDir 的路径。ignore 命中的路径(任意深度、按 basename)整支排除——
   * tar 已经整体取回,这里是纯本地过滤,不省网络传输,但语义上等价于「命中即剪除」。
   */
  async downloadDirectory(
    sourceDir: string,
    targetDir: string | URL,
    opts: { readonly ignore?: readonly string[] } = {},
  ): Promise<void> {
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
    const localDir = resolveLocalPath(undefined, targetDir);
    const absTargetDir = resolveSandboxPath(this.workdir, sourceDir);
    const stream = await (this.container as Docker.Container).getArchive({ path: absTargetDir });
    const tarBuf = await readableToBuffer(stream as NodeJS.ReadableStream);
    const files = await extractFilesFromTar(tarBuf);
    const ignore = new Set(opts.ignore ?? []);

    await Promise.all(
      files.map(async (file) => {
        const parts = file.name.split("/").slice(1);
        if (parts.length === 0 || parts.some((part) => ignore.has(part))) return;
        const dest = join(localDir, ...parts);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, file.content);
      }),
    );
  }

  /**
   * 从容器任意路径读文件 → Buffer。
   * 用 Docker getArchive API(原生二进制,无 base64 开销);tar 只有一个 entry,直接解包取内容。
   */
  async readBytes(path: string): Promise<Uint8Array> {
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
    const stream = await (this.container as Docker.Container).getArchive({ path: resolveSandboxPath(this.workdir, path) });
    const tarBuf = await readableToBuffer(stream as NodeJS.ReadableStream);
    return extractFileFromTar(tarBuf);
  }

  /**
   * 向容器任意路径写文件(二进制)。
   * 打成单文件 tar → putArchive 到目标目录,与 uploadFiles 同一机制但目标路径自由。
   *
   * 修正属主:putArchive 以 root 解包,不 chown 的话文件在容器里保持 root 属主——非 root
   * 沙箱用户不仅不能编辑它,后续对它做 `mv`/`rm` 这类改动它所在目录项的操作,只要目标目录带
   * sticky bit(如 `/tmp`),也会因为「非属主不能改别人的目录项」被内核拒成
   * `Operation not permitted`(与 uploadFiles() 对整个目标目录 chown 是同一个属主问题,
   * 这里只需精确 chown 这一个文件;真机复现见 memory/docker-uploadfile-tmp-mv-eperm.md)。
   */
  async writeBytes(destPath: string, content: Uint8Array): Promise<void> {
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
    const absPath = resolveSandboxPath(this.workdir, destPath);
    const pack = packFilesToTar([{ name: basename(absPath), content: Buffer.from(content) }]);
    await this.runCommandAsRoot("mkdir", ["-p", dirname(absPath)]);
    await (this.container as Docker.Container).putArchive(pack, { path: dirname(absPath) });
    await this.chownToSandboxUser(absPath);
  }

  async downloadFile(sourcePath: string, target: string | URL): Promise<void> {
    const destination = resolveLocalPath(undefined, target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await this.readBytes(sourcePath));
  }

  /**
   * 释放句柄。`releaseMode: "destroy"`(默认 create 路径)显式 stop + remove;
   * `releaseMode: "detach"`(Compose 附着)只松绑——整组由 compose down 回收,避免主容器先被拆掉留下 sidecar 孤儿。
   */
  async stop(): Promise<void> {
    if (!this.container) return;
    if (this.releaseMode === "detach") {
      this.container = null;
      return;
    }
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
