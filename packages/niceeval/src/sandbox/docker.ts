// Docker 沙箱 provider:用 dockerode 把容器当隔离工作区跑 eval。
// 改编自 agent-eval 的 docker-sandbox.ts,签名对齐 ../types.ts 的 Sandbox 契约
//(runShell/runCommand 的 opts 一律是选项对象,不再用位置参数)。

import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import Docker from "dockerode";
import { Clock, Effect } from "effect";
import type {
  CommandResult,
  CommandOptions,
  ManagedProcess,
  ManagedProcessStart,
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
import { retireCommandInstance } from "./background-command.ts";
import { reportActivity } from "../runner/feedback/sink.ts";
import { classifyProvisionErrorFallback, type SandboxProvisionErrorKind } from "./errors.ts";
import { dockerRunIdentityLabels, type RunIdentity } from "./run-identity.ts";
import {
  decodeBeforeCacheKeyScope,
  supportedBackendCapability,
  type SandboxBackendCapabilities,
  type SandboxProviderBackend,
  type BeforeCacheBaseEligibility,
  type AttemptBeforeCache,
} from "./backend.ts";
import type { NormalizedDockerSandboxReadiness, DockerSandboxResources } from "./layer.ts";
import { sandboxState } from "./action.ts";
import { ManagedProcessOutput } from "./managed-process.ts";
import { makeDockerBeforeCacheCapability, type DockerBeforeCacheHoldOwnership } from "./docker-before-cache.ts";
import { createDockerStateFiles, DOCKER_SANDBOX_WORKDIR, localDockerSupportsState } from "./docker-state.ts";

const execFileAsync = promisify(execFile);
const BEFORE_CACHE_PROVIDER_CLEANUP_TIMEOUT_MS = 30_000;

function abortableProviderRead<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => {
      signal.removeEventListener("abort", aborted);
      reject(signal.reason);
    };
    signal.addEventListener("abort", aborted, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener("abort", aborted);
        reject(cause);
      },
    );
  });
}

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
 * 硬前置,静默放行等于盲重试(见 docs/feature/sandbox/architecture/README.md);唯一的例外:
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

// 容器「主日志」文件:PID1 tail 它 → `docker logs` 实时显示;agent 命令的 stream 输出 tee 进来。
const CONTAINER_LOG = "/tmp/niceeval-agent.log";

// 命令默认沿用环境自己声明的执行身份:省略 `user` 时 docker exec 不注入 `--user`,
// 镜像 `USER` 原样生效(未声明按 Docker 语义是 root)。需要别的身份走 factory `user`
// (整个 Sandbox 的默认身份)或 runCommand 的 `{ user: "root" }`(只这一条命令)——
// 见 docs/feature/sandbox/library/README.md「执行身份」。
const ROOT_USER = "root";
/** `user` 取值是否等价于 root(数字 uid 0、`0:0` 或字面量 `root`)。 */
function isRootLikeUserSpec(value: string): boolean {
  return value === "0" || value === "0:0" || value === ROOT_USER;
}

/** 创建 Docker 沙箱的选项。 */
export interface DockerSandboxOptions {
  /** attempt 的超时上限(毫秒),单条命令未显式传 `timeout` 时的上限来源;省略 = 没有上限。 */
  timeout: number | undefined;
  /** attempt deadline 的截止时刻(epoch ms);单条命令按**剩余量**取上限(见 deadline.ts)。 */
  deadlineAt: number | undefined;
  /** 容器实例寿命；与单条命令 timeout 分离。 */
  lifetimeMs: number | undefined;
  /** Node 运行时。 */
  runtime: "node20" | "node24";
  /** 覆盖默认镜像(默认按 runtime 选 `node:*-slim`)。预制模板:烘焙好 agent CLI 的镜像名。 */
  image: string | undefined;
  /** runner 绑定到 `sandbox.create` 的反馈句柄(镜像拉取进度走它);省略退回全局 sink。 */
  feedback: import("../types.ts").ScopedFeedback | undefined;
  /** 一次性 provision token:写进容器 label,歧义类失败重试前按它对账(见 errors.ts 的两维分类)。 */
  provisionToken: string | undefined;
  /**
   * 创建期写入的运行标识(host/pid/startedAt),供强杀之后的孤儿核对按 label 事后收回(见
   * docs/feature/sandbox/architecture/README.md「孤儿核对」)。省略时不写这组 label(如直接单测构造
   * DockerSandbox,不经 runtime.ts 的 provider materializer)。
   */
  runIdentity: RunIdentity | undefined;
  /**
   * 覆盖默认 workdir。Compose mainService 附着时用容器 inspect 的 WorkingDir;
   * 省略 = `/home/sandbox/workspace`。
   */
  workdir: string | undefined;
  /**
   * 覆盖整个 Sandbox 的默认执行身份;省略时沿用镜像 `USER`(未声明按 Docker 语义是 root)、
   * Compose service `user:` 或其镜像 `USER`。
   */
  user: string | undefined;
  /** 创建容器时交给 daemon 强制执行的资源边界。 */
  resources: Readonly<DockerSandboxResources>;
  /** PID 1 启动后、任何 setup/prepare/agent 命令之前必须通过的作者声明探针。 */
  readiness: NormalizedDockerSandboxReadiness | undefined;
  /**
   * 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library/README.md
   * 「PATH:受管变量与 pathPrepend」)。
   */
  pathPrepend: readonly string[];
}

export const defaultDockerSandboxOptions: DockerSandboxOptions = {
  timeout: undefined,
  deadlineAt: undefined,
  lifetimeMs: undefined,
  runtime: "node24",
  image: undefined,
  feedback: undefined,
  provisionToken: undefined,
  runIdentity: undefined,
  workdir: undefined,
  user: undefined,
  resources: {},
  readiness: undefined,
  pathPrepend: [],
};

function dockerStatusCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { readonly statusCode?: number }).statusCode
    : undefined;
}

function benignStopError(error: unknown): boolean {
  const status = dockerStatusCode(error);
  return status === 304 || status === 404;
}

function benignRemoveError(error: unknown): boolean {
  return dockerStatusCode(error) === 404;
}

function dockerHostConfig(resources: Readonly<DockerSandboxResources>): Docker.HostConfig {
  const nanoCpus = resources.cpus === undefined ? undefined : Math.round(resources.cpus * 1_000_000_000);
  if (nanoCpus !== undefined && !Number.isSafeInteger(nanoCpus)) {
    throw new TypeError("Docker sandbox resources.cpus is too large to encode as NanoCpus");
  }
  const tmpfs =
    resources.tmpfs === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(resources.tmpfs).map(([path, options]) => [
            path,
            [
              "rw",
              options.executable === true ? "exec" : "noexec",
              "nosuid",
              "nodev",
              `size=${options.sizeBytes}`,
              ...(options.mode === undefined ? [] : [`mode=${options.mode.toString(8).padStart(4, "0")}`]),
              ...(options.uid === undefined ? [] : [`uid=${options.uid}`]),
              ...(options.gid === undefined ? [] : [`gid=${options.gid}`]),
            ].join(","),
          ]),
        );
  return {
    AutoRemove: false,
    ...(nanoCpus === undefined ? {} : { NanoCpus: nanoCpus }),
    ...(resources.memoryBytes === undefined ? {} : { Memory: resources.memoryBytes }),
    ...(resources.memoryBytes === undefined ? {} : { MemorySwap: resources.memoryBytes }),
    ...(resources.pidsLimit === undefined ? {} : { PidsLimit: resources.pidsLimit }),
    ...(resources.readOnlyRootfs === true ? { ReadonlyRootfs: true } : {}),
    ...(tmpfs === undefined ? {} : { Tmpfs: tmpfs }),
  };
}

/** `stop()` 时是否销毁容器。Compose 主容器由资源组 `compose down` 回收,附着句柄只松绑。 */
export type DockerSandboxReleaseMode = "destroy" | "detach";

/**
 * Docker 沙箱:为每次运行起一个隔离容器。
 * 实现 ../types.ts 的 Sandbox 接口。
 */
export class DockerSandbox implements SandboxProviderBackend, SandboxReuseCapability {
  readonly workdir: string;
  readonly otlpHost: string | null;
  private docker: Docker;
  private container: Docker.Container | undefined;
  private _containerId = "";
  private timeout: number | undefined;
  private deadlineAt: number | undefined;
  private lifetimeMs: number | undefined;
  /** 容器 PID1 的 dead-man TTL 到期时刻(initialize 里烧进 `timeout` 那一刻定死)。 */
  private expiresAtMs: number | undefined;
  private runtime: string;
  private image: string | undefined;
  /** Exact pristine source image captured during the first initialization; never advances with prefix rebases. */
  private baseIdentity: string | undefined;
  /** Dynamic package-manager mutation can never become a shared BeforeCache baseline for this instance. */
  private runnerToolsInstalledDynamically = false;
  private feedback: import("../types.ts").ScopedFeedback | undefined;
  private provisionToken: string | undefined;
  private runIdentity: RunIdentity | undefined;
  private releaseMode: DockerSandboxReleaseMode = "destroy";
  /** 起点覆盖(factory `user`);省略 = 沿用镜像/Compose 声明的默认身份。 */
  private readonly userOverride: string | undefined;
  private readonly resources: Readonly<DockerSandboxResources>;
  private readonly readiness: NormalizedDockerSandboxReadiness | undefined;
  private containerName: string | undefined;
  /** factory `pathPrepend`;按声明顺序前置到受管 PATH,省略 = 空数组。 */
  private readonly pathPrepend: readonly string[];
  /** 下面三项由 `resolveDefaultIdentity()` 探测得出,构造期先给出安全占位值。 */
  private defaultHome = "/root";
  private defaultUserName = "root";
  private defaultIsRoot = true;
  private npmGlobalDir = "/root/.npm-global";
  private sandboxPath: string;
  private beforeCacheHold: DockerBeforeCacheHoldOwnership | undefined;
  private beforeCacheMountReason: string | undefined;
  readonly capabilities: SandboxBackendCapabilities;

  private async startManagedProcess(input: ManagedProcessStart): Promise<ManagedProcess> {
    if (!this.container) throw new Error(`Container not initialized`);
    const [command, ...args] = input.argv;
    const env = {
      HOME: this.defaultHome,
      USER: this.defaultUserName,
      LOGNAME: this.defaultUserName,
      ...input.env,
      PATH: this.sandboxPath,
      ...(this.defaultIsRoot ? { npm_config_unsafe_perm: "true" } : {}),
    };
    const marker = `__NICEEVAL_MANAGED_PID_${randomUUID()}__`;
    const exec = await this.container.exec({
      // If the Docker exec leader is already a process-group leader, setsid
      // forks. --wait keeps Docker's receipt tied to the native child lifetime.
      Cmd: ["setsid", "--wait", "sh", "-c", `printf '${marker}%s\\n' "$$" >&2; exec "$@"`, "sh", command, ...args],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: resolveSandboxPath(this.workdir, input.cwd),
      Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
      User: this.userOverride,
    });
    const stream = await exec.start({ hijack: true, stdin: true });
    const output = new ManagedProcessOutput();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on("data", (bytes: Buffer) => output.push({ _tag: "Stdout", bytes: new Uint8Array(bytes) }));
    let stderrPrefix = Buffer.alloc(0);
    let processGroup: number | undefined;
    stderr.on("data", (bytes: Buffer) => {
      if (processGroup !== undefined) {
        output.push({ _tag: "Stderr", bytes: new Uint8Array(bytes) });
        return;
      }
      stderrPrefix = Buffer.concat([stderrPrefix, bytes]);
      const newline = stderrPrefix.indexOf(10);
      if (newline < 0) return;
      const first = stderrPrefix.subarray(0, newline).toString("utf8");
      if (!first.startsWith(marker) || !/^\d+$/.test(first.slice(marker.length))) {
        output.push({ _tag: "Stderr", bytes: new Uint8Array(stderrPrefix) });
      } else {
        processGroup = Number(first.slice(marker.length));
        const rest = stderrPrefix.subarray(newline + 1);
        if (rest.length > 0) output.push({ _tag: "Stderr", bytes: new Uint8Array(rest) });
      }
      stderrPrefix = Buffer.alloc(0);
    });
    this.docker.modem.demuxStream(stream, stdout, stderr);
    let poll: ReturnType<typeof setInterval> | undefined;
    let settled = false;
    let rejectExit!: (error: unknown) => void;
    const finishError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      if (poll !== undefined) clearInterval(poll);
      output.end();
      stream.destroy();
      rejectExit(error);
    };
    const exit = new Promise<import("../types.ts").ManagedProcessExit>((resolve, reject) => {
      rejectExit = reject;
      stream.once("error", finishError);
      poll = setInterval(() => {
        void exec.inspect().then((inspection) => {
          if (inspection.Running) return;
          if (settled) return;
          settled = true;
          if (poll !== undefined) clearInterval(poll);
          output.end();
          stream.destroy();
          resolve({ exitCode: inspection.ExitCode ?? null, signal: undefined });
        }, finishError);
      }, 100);
    });
    let closeReceipt: Promise<void> | undefined;
    let terminateReceipt: Promise<void> | undefined;
    let stdinState: "open" | "closing" | "closed" = "open";
    return {
      output,
      writeStdin: (bytes) =>
        new Promise<void>((resolve, reject) => {
          if (stdinState !== "open") {
            reject(new Error("managed process stdin is closed"));
            return;
          }
          stream.write(Buffer.from(bytes), (error?: Error | null) => (error ? reject(error) : resolve()));
        }),
      closeStdin: () =>
        (closeReceipt ??= new Promise<void>((resolve) => {
          stdinState = "closing";
          stream.end(() => {
            stdinState = "closed";
            resolve();
          });
        })),
      wait: () => exit,
      terminate: () =>
        (terminateReceipt ??= (async () => {
          stdinState = "closing";
          const inspection = await exec.inspect().catch(() => undefined);
          if (!inspection?.Running) {
            await exit.catch(() => undefined);
            return;
          }
          if (processGroup === undefined) {
            const error = new Error(
              "docker managed process did not disclose its process-group identity; sandbox retirement is required",
            );
            finishError(error);
            throw error;
          }
          // Do not route this provider-owned control operation through runCommand's
          // command-tree supervisor: killing the target exec while that supervisor
          // samples the same tree creates an ambiguous non-zero receipt. Docker's
          // own exec receipt is the exact acknowledgement for this one kill(2).
          const killer = await this.container!.exec({
            // POSIX `kill` is a shell builtin in slim images (no /usr/bin/kill).
            // The PGID is a separate positional parameter, never interpolated.
            Cmd: ["sh", "-c", 'kill -KILL "$1"', "sh", `-${processGroup}`],
            AttachStdout: true,
            AttachStderr: true,
            User: "root",
          });
          const killStream = await killer.start({});
          const killOutput = await readableToBuffer(killStream);
          const killed = await killer.inspect();
          if (killed.ExitCode !== 0) {
            const error = new Error(
              `docker could not terminate managed process group ${processGroup}; sandbox retirement is required: ${killOutput.toString("utf8")}`,
            );
            finishError(error);
            throw error;
          }
          await exit;
        })()),
    };
  }

  constructor(options: DockerSandboxOptions = defaultDockerSandboxOptions) {
    this.docker = new Docker();
    this.workdir = options.workdir ?? DOCKER_SANDBOX_WORKDIR;
    this.timeout = options.timeout;
    this.deadlineAt = options.deadlineAt;
    this.lifetimeMs = options.lifetimeMs;
    this.runtime = options.runtime;
    this.image = options.image;
    this.feedback = options.feedback;
    this.provisionToken = options.provisionToken;
    this.runIdentity = options.runIdentity;
    this.userOverride = options.user === "" ? undefined : options.user;
    // Docker bridge 能否回连宿主取决于宿主防火墙与 daemon 网络策略，provider 不能把
    // host-gateway 伪装成稳定能力。null 让 runner 把 attempt-scope collector 放进沙箱；
    // 作者确有受控 tunnel 时仍可用 config.telemetry.host 显式覆盖。
    this.otlpHost = null;
    this.resources = options.resources;
    this.readiness = options.readiness;
    this.pathPrepend = options.pathPrepend;
    this.sandboxPath = this.managedPath(this.npmGlobalDir);
    this.attemptBeforeCache = makeDockerBeforeCacheCapability({
      baseReference: options.image ?? DOCKER_IMAGES[this.runtime]!,
      eligibility: () => this.beforeCacheEligibility(),
      captureExactImage: (labels, knownSensitiveValues, signal) =>
        this.captureBeforeCacheImage(labels, knownSensitiveValues, signal),
      rebaseToExactImage: (imageId, plannedContainerName, signal) =>
        this.rebaseBeforeCacheImage(imageId, plannedContainerName, signal),
      destroyCurrentForCacheRecovery: () => this.destroyCurrentContainer(),
      adoptBeforeCacheHold: (root) => this.adoptBeforeCacheHold(root),
      fallBackToBase: (signal) => this.recoverBeforeCacheCleanBase(signal),
    });
    this.capabilities = {
      rootCommands: supportedBackendCapability(true as const),
      appendLog: supportedBackendCapability((line: string) => this.appendLog(line)),
      suspend: supportedBackendCapability(() => this.suspend()),
      ensureLifetime: supportedBackendCapability((minRemainingMs: number) => this.ensureLifetime(minRemainingMs)),
      setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => this.setCommandDeadline(deadlineAt)),
      managedProcess: supportedBackendCapability((input: ManagedProcessStart) => this.startManagedProcess(input)),
      ...(localDockerSupportsState(this.resources.readOnlyRootfs === true)
        ? {
            state: supportedBackendCapability(
              createDockerStateFiles({
                container: () => {
                  if (this.container === undefined) throw new Error("Docker State instance is unavailable.");
                  return this.container;
                },
                home: () => this.defaultHome,
                npmDirectory: () => this.npmGlobalDir,
                workdir: this.workdir,
                logPath: CONTAINER_LOG,
              }),
            ),
          }
        : {}),
    };
  }

  readonly attemptBeforeCache: AttemptBeforeCache;

  private beforeCacheEligibility(): BeforeCacheBaseEligibility {
    if (this.releaseMode === "detach") {
      return {
        _tag: "Unsupported",
        code: "compose",
        reason: "Compose and attached containers have group-owned state outside one writable outer rootfs",
      };
    }
    if (this.resources.readOnlyRootfs === true) {
      return {
        _tag: "Unsupported",
        code: "read-only-rootfs",
        reason: "persistent before-cache capture requires a writable outer rootfs",
      };
    }
    if (this.runnerToolsInstalledDynamically) {
      return {
        _tag: "Unsupported",
        code: "dynamic-runner-tools",
        reason: "provider runner tools required a dynamic package-manager/network installation",
      };
    }
    if (this.resources.tmpfs !== undefined && Object.keys(this.resources.tmpfs).length > 0) {
      return {
        _tag: "Unsupported",
        code: "mounted-state",
        reason: "tmpfs state is not part of a Docker image commit",
      };
    }
    if (this.beforeCacheMountReason !== undefined) {
      return {
        _tag: "Unsupported",
        code: "mounted-state",
        reason: this.beforeCacheMountReason,
      };
    }
    if (this.baseIdentity === undefined || !/^sha256:[a-f0-9]{64}$/u.test(this.baseIdentity)) {
      return {
        _tag: "Unsupported",
        code: "base-image-unverified",
        reason: "persistent before-cache capture requires a verified exact Base image id",
      };
    }
    return {
      _tag: "Eligible",
      persistence: "persistent",
      dependency: "parent-backed",
      coverage: sandboxState.all,
      baseIdentity: this.baseIdentity,
      keyScope: decodeBeforeCacheKeyScope({
        cacheFormat: "niceeval-docker-cache/current",
        semanticIdentity: { capture: "outer-writable-rootfs" },
      }),
    };
  }

  private adoptBeforeCacheHold(hold: DockerBeforeCacheHoldOwnership): void {
    if (this.container === undefined || this._containerId !== hold.containerId) {
      throw new Error("cannot attach a before-cache durable hold to a different Docker container");
    }
    if (this.beforeCacheHold !== undefined) {
      throw new Error("the previous before-cache durable hold has not been released");
    }
    this.beforeCacheHold = hold;
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
    options: DockerSandboxOptions & {
      releaseMode?: DockerSandboxReleaseMode | undefined;
    } = defaultDockerSandboxOptions,
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
        : DOCKER_SANDBOX_WORKDIR;
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
  async ensureLifetime(
    minRemainingMs: number,
  ): Promise<{ ready: true; expiresAt?: string } | { ready: false; reason: string }> {
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
  static async create(options: DockerSandboxOptions = defaultDockerSandboxOptions): Promise<DockerSandbox> {
    return Effect.runPromise(DockerSandbox.createEffect(options));
  }

  /** The runtime-facing provisioning path keeps Clock and interruption in its caller's Effect. */
  static createEffect(
    options: DockerSandboxOptions = defaultDockerSandboxOptions,
  ): Effect.Effect<DockerSandbox, unknown> {
    const sandbox = new DockerSandbox(options);
    return Effect.tryPromise({
      try: () => sandbox.initializeBeforeReadiness(),
      catch: (error) => error,
    }).pipe(
      Effect.andThen(sandbox.waitForReadinessEffect()),
      Effect.andThen(
        Effect.tryPromise({
          try: () => sandbox.initializeAfterReadiness(),
          catch: (error) => error,
        }),
      ),
      Effect.as(sandbox),
      Effect.catch((error) => sandbox.cleanupAfterInitializationFailureEffect(error)),
    );
  }

  private cleanupAfterInitializationFailureEffect(error: unknown): Effect.Effect<never, unknown> {
    return Effect.tryPromise({
      try: async () => {
        // kill-on-failure:容器创建之后的初始化(start、基础工具安装、工作区属主)一旦失败,
        // 先尽力销毁容器再抛出原始错误——不给重试层留一台无主容器
        // (见 docs/feature/sandbox/architecture/README.md「Provisioning 失败与重试」)。
        const cleanupErrors: unknown[] = [];
        try {
          await this.container?.remove({ force: true });
          this.container = undefined;
        } catch (cleanupError) {
          if (benignRemoveError(cleanupError)) {
            this.container = undefined;
          } else {
            cleanupErrors.push(cleanupError);
          }
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [error, ...cleanupErrors],
            "Docker sandbox initialization failed and its partial container could not be fully removed",
          );
        }
        throw error;
      },
      catch: (cause) => cause,
    });
  }

  /** 拉镜像、起容器、装基础工具、备好工作区与 npm 前缀。 */
  private async initializeBeforeReadiness(operationSignal?: AbortSignal): Promise<void> {
    operationSignal?.throwIfAborted();
    // 显式 image(预制模板)优先;否则按 runtime 选默认 node:*-slim。
    const imageName = this.image ?? DOCKER_IMAGES[this.runtime];
    if (!imageName) {
      throw new Error(`Unsupported runtime: ${this.runtime}`);
    }

    // 确保镜像在本地。
    await this.ensureImage(imageName, operationSignal);
    operationSignal?.throwIfAborted();
    const sourceInspection = await abortableProviderRead(
      this.docker.getImage(imageName).inspect(
        operationSignal === undefined
          ? {}
          : ({ abortSignal: operationSignal } as Docker.ImageInspectOptions & {
              readonly abortSignal: AbortSignal;
            }),
      ),
      operationSignal,
    );
    if (!/^sha256:[a-f0-9]{64}$/u.test(sourceInspection.Id)) {
      throw new Error(`Docker source image ${imageName} did not resolve to an exact image id`);
    }
    this.baseIdentity ??= sourceInspection.Id;
    const declaredVolumes = Object.keys(sourceInspection.Config?.Volumes ?? {}).sort();
    this.beforeCacheMountReason =
      declaredVolumes.length === 0
        ? undefined
        : `image-declared volumes are outside the captured outer rootfs: ${declaredVolumes.join(", ")}`;

    // 起容器(先以 root 做初始化,之后命令切到非 root 用户)。
    // PID1 改成 tail 一个日志文件(而非 sleep infinity):这样容器「主日志」= 这个文件,
    // `docker logs` / Docker UI 的 Logs 标签页能实时显示我们 appendLog 进去的 agent 逐轮活动。
    // 文件先 touch + chmod 666,好让之后以 1000 用户跑的 exec 也能往里 append。
    // 外层 `timeout <TTL>` 是 dead-man switch:宿主异常退出(kill -9 / 崩溃)留下的孤儿容器,
    // 到 TTL 后 PID1 自动退出 → 容器停止 → AutoRemove 清理(见 TTL_* 常量)。
    const ttlSec = Math.ceil(
      Math.max(this.lifetimeMs ?? (this.timeout ?? TTL_BASE_WITHOUT_DEADLINE) * TTL_MULTIPLIER, TTL_FLOOR_MS) / 1000,
    );
    // TTL 一旦烧进 PID1 的 `timeout` 就改不了(容器没有续期通道),所以这里把真实到期时刻记下来,
    // 供 ensureLifetime 如实回答;不够用时由 runner 轮换实例,而不是让容器在 attempt 中途消失。
    this.expiresAtMs = Date.now() + ttlSec * 1000;
    const exactSourceImageId = sourceInspection.Id;
    this.container = await this.docker.createContainer({
      ...(this.containerName === undefined ? {} : { name: this.containerName }),
      Image: exactSourceImageId,
      ...(operationSignal === undefined ? {} : { abortSignal: operationSignal }),
      Cmd: [
        "sh",
        "-c",
        `touch ${CONTAINER_LOG}; chmod 666 ${CONTAINER_LOG}; exec timeout ${ttlSec} tail -n +1 -F ${CONTAINER_LOG}`,
      ],
      WorkingDir: this.workdir,
      // provision token:歧义类失败的对账通道(按 label 查询本地容器);
      // keep-candidate:留存候选标记(异常硬退时核对未完成提交的候选)。
      Labels: {
        niceeval: "true",
        "niceeval.keep-candidate": "true",
        ...(this.provisionToken ? { "niceeval.provision-token": this.provisionToken } : {}),
        ...(this.runIdentity ? dockerRunIdentityLabels(this.runIdentity) : {}),
      },
      Tty: true,
      // 不带 AutoRemove:留存意图必须在创建期传入(--keep-sandbox 的 suspend = docker stop,
      // 停驻容器的文件系统落盘持久)。默认路径的销毁由 stop() 显式 stop + remove,行为等价;
      // 宿主异常硬退留下的孤儿由 TTL dead-man switch 停驻后按 keep-candidate 标签事后核对。
      HostConfig: dockerHostConfig(this.resources),
    });

    this._containerId = this.container.id;

    await this.container.start(operationSignal === undefined ? {} : { abortSignal: operationSignal });

    const createdInspection = await abortableProviderRead(this.container.inspect(), operationSignal);
    if (createdInspection.Image !== exactSourceImageId) {
      throw new Error(
        `Docker container uses ${createdInspection.Image}, expected resolved exact Base image ${exactSourceImageId}`,
      );
    }
    const providerMounts = (createdInspection.Mounts ?? [])
      .map((mount) => mount.Destination)
      .filter(Boolean)
      .sort();
    if (providerMounts.length > 0) {
      this.beforeCacheMountReason = `container mounts are outside the captured outer rootfs: ${providerMounts.join(", ")}`;
    }
  }

  private async initializeAfterReadiness(operationSignal?: AbortSignal): Promise<void> {
    // slim 镜像可能缺 CA 证书和 git,补装。
    await this.ensureRunnerTools(operationSignal);

    // 探测默认执行身份(镜像 USER,或 factory 的 `user` 覆盖)的 home 目录,后续 chown 与
    // npm 全局前缀都按它解析,不硬编码 UID/家目录(见 docs/feature/sandbox/library/README.md「执行身份」)。
    await this.resolveDefaultIdentity(operationSignal);

    // 工作目录交给默认执行身份。
    await this.runCommandAsRoot("mkdir", ["-p", this.workdir], {
      signal: operationSignal,
    });
    await this.runCommandAsRoot("chown", ["-R", this.chownTarget(), this.workdir], {
      signal: operationSignal,
    });

    // 为非 root 全局安装准备 npm 目录;root 身份下这一步是无害的自有目录。
    await this.runCommandAsRoot("mkdir", ["-p", this.npmGlobalDir], {
      signal: operationSignal,
    });
    await this.runCommandAsRoot("chown", ["-R", this.chownTarget(), this.npmGlobalDir], {
      signal: operationSignal,
    });

    // 让 npm 用这个目录当全局前缀(配置落在默认身份的家目录,供 agent 全局装 CLI 用)。
    await this.runCommand("npm", ["config", "set", "prefix", this.npmGlobalDir], {
      signal: operationSignal,
    });
  }

  private waitForReadinessEffect(signal?: AbortSignal): Effect.Effect<void, unknown> {
    const readiness = this.readiness;
    if (readiness === undefined) return Effect.void;
    const readinessUser = readiness.user ?? this.userOverride;
    return Effect.gen({ self: this }, function* () {
      const deadline = (yield* Clock.currentTimeMillis) + readiness.timeoutMs;
      yield* this.waitForReadinessProbeEffect({
        command: readiness.command,
        user: readinessUser,
        intervalMs: readiness.intervalMs,
        deadline,
        timeoutMs: readiness.timeoutMs,
        signal,
      });
    });
  }

  private waitForReadinessProbeEffect(input: {
    readonly command: readonly [string, ...string[]];
    readonly user: string | undefined;
    readonly intervalMs: number;
    readonly deadline: number;
    readonly timeoutMs: number;
    readonly signal: AbortSignal | undefined;
  }): Effect.Effect<void, unknown> {
    const [command, ...args] = input.command;
    let lastFailure = "probe has not run";
    const attempt: Effect.Effect<void, unknown> = Effect.gen({ self: this }, function* () {
      const now = yield* Clock.currentTimeMillis;
      if (now > input.deadline) return yield* timedOut();
      const state = yield* Effect.tryPromise({
        try: () =>
          Promise.resolve(
            this.container?.inspect(input.signal === undefined ? undefined : { abortSignal: input.signal }),
          ),
        catch: (error) => error,
      });
      if (state?.State?.Running !== true) {
        return yield* Effect.fail(
          new Error(
            `Docker sandbox exited before docker sandbox readiness completed ` +
              `(state=${state?.State?.Status ?? "missing"})`,
          ),
        );
      }
      const probeNow = yield* Clock.currentTimeMillis;
      const result = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            this.execCommand(
              command,
              args,
              {
                user: input.user,
                timeoutMs: Math.max(1, input.deadline - probeNow),
                signal: input.signal,
              },
              "stop",
            ),
          catch: (error) => error,
        }),
      );
      if (result._tag === "Success") {
        if (result.success.exitCode === 0) return;
        lastFailure = result.success.stderr.trim() || result.success.stdout.trim() || `exit ${result.success.exitCode}`;
      } else {
        lastFailure = result.failure instanceof Error ? result.failure.message : String(result.failure);
      }
      const afterAttempt = yield* Clock.currentTimeMillis;
      const remaining = input.deadline - afterAttempt;
      if (remaining <= 0) return yield* timedOut();
      yield* Effect.sleep(Math.min(input.intervalMs, remaining));
      return yield* attempt;
    });
    const timedOut = (): Effect.Effect<never, Error> =>
      Effect.fail(new Error(`Docker sandbox readiness timed out after ${input.timeoutMs}ms: ${lastFailure}`));
    return attempt;
  }

  /**
   * 探测 Sandbox 默认执行身份(`this.userOverride` 未设置时即容器/镜像的默认身份)的
   * uid、用户名与家目录:省略 `User` 字段的 exec 沿用容器默认身份,`$HOME` 由容器内
   * `/etc/passwd` 解析,不在 runner 侧维护一张 UID → 家目录的映射表。
   */
  private async resolveDefaultIdentity(signal?: AbortSignal): Promise<void> {
    const user = this.userOverride;
    const probe = await this.execCommand(
      "sh",
      ["-c", 'printf "%s\\n%s\\n%s" "$(id -u)" "$(id -un 2>/dev/null || true)" "$HOME"'],
      {
        user,
        signal,
      },
    );
    const [rawUid = "", rawName = "", rawHome = ""] = probe.stdout.split("\n");
    const uid = rawUid.trim();
    const name = rawName.trim();
    const home = rawHome.trim();
    this.defaultIsRoot = uid === "0";
    const detectedUserName = (): string => {
      if (name !== "") return name;
      if (this.defaultIsRoot) return ROOT_USER;
      return this.userOverride ?? uid;
    };
    this.defaultUserName = detectedUserName();
    const detectedHome = (): string => {
      if (home !== "") return home;
      if (this.defaultIsRoot) return "/root";
      return `/home/${this.defaultUserName}`;
    };
    this.defaultHome = detectedHome();
    this.npmGlobalDir = `${this.defaultHome}/.npm-global`;
    this.sandboxPath = this.managedPath(this.npmGlobalDir);
  }

  /** chown 目标:factory 覆盖时原样复用(接受 name / uid[:gid]),否则用探测出的用户名。 */
  private chownTarget(): string {
    return this.userOverride ?? this.defaultUserName;
  }

  /** 确保镜像在本地,缺了就拉。 */
  private async ensureImage(imageName: string, signal?: AbortSignal): Promise<void> {
    try {
      const image = this.docker.getImage(imageName);
      await abortableProviderRead(
        image.inspect(
          signal === undefined
            ? {}
            : ({ abortSignal: signal } as Docker.ImageInspectOptions & {
                readonly abortSignal: AbortSignal;
              }),
        ),
        signal,
      );
    } catch (cause) {
      signal?.throwIfAborted();
      if (/^sha256:[a-f0-9]{64}$/u.test(imageName)) {
        throw new Error(`Docker exact image ${imageName} is absent and cannot be pulled by a mutable locator`, {
          cause,
        });
      }
      // 镜像不存在,拉取。「progress」而非「diagnostic」—— 这是正常进度,不是需要去重/永久
      // 留痕的 warning。走 create 绑定的 ScopedFeedback(runner 归因到 sandbox.create);
      // 直调(无 runner)时退回全局 sink。
      const progress = (message: string) =>
        this.feedback ? this.feedback.progress({ message }) : reportActivity(message);
      progress(`Pulling Docker image: ${imageName}...`.trimEnd());
      await this.pullImage(imageName);
      progress(`Docker image ready: ${imageName}`.trimEnd());
    }
  }

  /**
   * 补齐 NiceEval 自身运行所需的最小工具面。单容器默认镜像与 Compose 附着容器走同一条：
   * 先 probe，命中时零改动；缺失时以 root 使用镜像已有的包管理器安装。题目镜像无法兑现时
   * 明确报错，不把 `git: command not found` 延后到 workspace.baseline。
   */
  async ensureRunnerTools(signal?: AbortSignal): Promise<void> {
    const probe = await this.runCommandAsRoot("sh", ["-c", "command -v git >/dev/null 2>&1"], {
      signal,
    });
    if (probe.exitCode === 0) return;
    this.runnerToolsInstalledDynamically = true;
    const script = [
      "set -eu",
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
    const result = await this.runCommandAsRoot("sh", ["-c", script], {
      signal,
    });
    if (result.exitCode === 0) return;
    const detail = result.stderr.trim().split("\n").at(-1);
    throw new Error(`prepare Docker runner tools failed (exit ${result.exitCode})${detail ? `: ${detail}` : ""}`);
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
  get nativeInstanceId(): string {
    return this._containerId;
  }

  get sandboxId(): string {
    return this._containerId.slice(0, 12);
  }

  /**
   * 在容器里跑一条命令。默认沿用 Sandbox 的默认执行身份(factory `user` 覆盖后的身份,
   * 否则镜像声明的 USER);`opts.user` 只覆盖这一条命令。
   */
  async runCommand(cmd: string, args: readonly string[] = [], opts: CommandOptions = {}): Promise<CommandResult> {
    // stream:把本命令输出也接到容器主日志(PID1 tail 它)→ Docker Logs 看到原始输出。
    // 实现:把 cmd+args 安全拼成 shell 串,经 runShell 走 tee(只 tee stdout,保留 stderr 分离 + 退出码)。
    if (opts.stream) {
      const joined = [cmd, ...args].map(shellQuote).join(" ");
      return this.runShell(joined, {
        env: opts.env,
        cwd: opts.cwd,
        stream: true,
        user: opts.user,
        timeoutMs: opts.timeoutMs,
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

    const user = opts.user ?? this.userOverride;
    return this.execCommand(cmd, [...args], {
      env,
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      user,
      timeoutMs: opts.timeoutMs,
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
      signal: opts.signal,
    });
  }

  /** 以 root 跑命令(provider 内部用:容器初始化、属主收敛)。 */
  private async runCommandAsRoot(cmd: string, args: string[] = [], opts: CommandOptions = {}): Promise<CommandResult> {
    return this.execCommand(cmd, args, {
      env: opts.env,
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      user: ROOT_USER,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
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
    opts: CommandOptions = {},
    /** create/readiness 失败需在删除前采集日志，因此只先停容器。 */
    timeoutRetirement: "destroy" | "stop" = "destroy",
  ): Promise<CommandResult> {
    if (!this.container) {
      throw new Error(`Container not initialized`);
    }
    opts.signal?.throwIfAborted();
    const container = this.container;
    const retire = () =>
      retireCommandInstance(opts.signal, async () => {
        // Compose owns removal of the group. Stop its main container before reporting termination.
        if (timeoutRetirement === "stop" || this.releaseMode === "detach") {
          await container
            .stop({ t: 0, abortSignal: AbortSignal.timeout(BEFORE_CACHE_PROVIDER_CLEANUP_TIMEOUT_MS) })
            .catch((error) => {
              if (!benignStopError(error)) throw error;
            });
        } else {
          await this.stop();
        }
      });

    const fullCmd = [cmd, ...args];
    const env = opts.env ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`) : undefined;

    const exec = await container
      .exec({
        Cmd: fullCmd,
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: resolveSandboxPath(this.workdir, opts.cwd),
        Env: env,
        User: opts.user,
        ...(opts.signal === undefined ? {} : { abortSignal: opts.signal }),
      })
      .catch(async (error: unknown) => {
        if (opts.signal?.aborted) await retire();
        throw error;
      });

    const stream = await exec
      .start({
        hijack: true,
        stdin: false,
        ...(opts.signal === undefined ? {} : { abortSignal: opts.signal }),
      })
      .catch(async (error: unknown) => {
        if (opts.signal?.aborted || dockerStatusCode(error) === undefined) await retire();
        throw error;
      });

    return new Promise<CommandResult>((resolve, reject) => {
      // Docker 把 stdout/stderr 复用在同一条流里(8 字节头 + 载荷),需手动 demux;
      // 跨 chunk 的帧累积逻辑见 docker-stream.ts 的 createExecDemuxer。
      const demuxer = createExecDemuxer();
      // Docker 的 demuxer 先保证帧边界完整，再把每帧即时送给调用方。回调串行化，避免
      // async consumer（如 JSONL 行缓冲）因后一个 chunk 先完成而乱序。
      let callbackChain = Promise.resolve();
      const deliver = ({ stdout, stderr }: { stdout: string; stderr: string }): void => {
        const onStdout = opts.onStdout;
        const onStderr = opts.onStderr;
        if (stdout && onStdout !== undefined) callbackChain = callbackChain.then(() => onStdout(stdout));
        if (stderr && onStderr !== undefined) callbackChain = callbackChain.then(() => onStderr(stderr));
        void callbackChain.catch(() => undefined);
      };
      stream.on("data", (chunk: Buffer) => {
        deliver(demuxer.push(chunk));
      });

      // 超时:杀流并 reject。上限从 attempt deadline 的剩余量派生(显式传 timeout 时按显式值),
      // 没有 deadline 就不挂这条 timer——provider 层不发明一条自己的线。
      const limit = commandLimit(opts, {
        commandTimeoutMs: this.timeout,
        deadlineAt: this.deadlineAt,
      });
      let settled = false;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      let completionPoll: ReturnType<typeof setInterval> | undefined;
      let pollInFlight = false;
      const cleanup = (): void => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        if (completionPoll !== undefined) clearInterval(completionPoll);
        if (drainTimer !== undefined) clearTimeout(drainTimer);
        opts.signal?.removeEventListener("abort", onAbort);
      };
      const retireAndReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        stream.destroy();
        void retire().then(() => reject(error), reject);
      };
      const timeoutMs = limit.timeoutMs;
      const timeoutId =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              retireAndReject(
                new SandboxCommandTimeoutError(`Command timed out after ${timeoutMs}ms`, timeoutMs, limit.explicit),
              );
            }, timeoutMs);
      const onAbort = (): void => {
        const reason = opts.signal?.reason;
        retireAndReject(reason instanceof Error ? reason : new DOMException("sandbox command aborted", "AbortError"));
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts.signal?.aborted) onAbort();

      const finish = async (known?: Awaited<ReturnType<typeof exec.inspect>>): Promise<void> => {
        if (settled) return;
        settled = true;
        cleanup();
        stream.destroy();
        try {
          deliver(demuxer.finish());
          await callbackChain;
          const inspection =
            known ?? (await exec.inspect(opts.signal === undefined ? {} : { abortSignal: opts.signal }));
          resolve({
            stdout: demuxer.stdout(),
            stderr: demuxer.stderr(),
            exitCode: inspection.ExitCode ?? 0,
          });
        } catch (error) {
          reject(error);
        }
      };

      // rootless Docker 偶尔在 exec 已退出且 ExecIDs 已清空后仍不关闭 hijacked HTTP 流。
      // 不能只等 `end`：同时以 daemon 的 exec inspect 为完成事实，留 100ms drain 尾帧后收口。
      completionPoll = setInterval(() => {
        if (settled || pollInFlight || drainTimer !== undefined) return;
        pollInFlight = true;
        void exec
          .inspect(opts.signal === undefined ? {} : { abortSignal: opts.signal })
          .then((inspection) => {
            if (!settled && inspection.Running === false && drainTimer === undefined) {
              drainTimer = setTimeout(() => {
                void finish(inspection);
              }, 100);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            pollInFlight = false;
          });
      }, 250);
      completionPoll.unref();

      stream.on("end", () => {
        void finish();
      });

      stream.on("error", (error: Error) => {
        retireAndReject(error);
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
        timeoutMs: opts.timeoutMs,
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
      throw new Error(`Failed to read file ${absPath}: ${result.stderr}`);
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
      throw new Error(`Container not initialized`);
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

    // Docker 对 ReadonlyRootfs 容器会无条件拒绝 putArchive，即便目标实际位于可写 tmpfs。
    // 这类 sandbox 逐文件走 exec stdin；路径仍由 resolveSandboxPath 收敛在受管目录内。
    if (this.resources.readOnlyRootfs === true) {
      for (const file of files) {
        const destination = resolveSandboxPath(targetPath, file.path);
        await this.runCommandAsRoot("mkdir", ["-p", dirname(destination)]);
        await this.writeBytesViaExec(destination, Buffer.from(file.content));
      }
      await this.chownToSandboxUser(targetPath);
      return;
    }

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
    if (!this.container) throw new Error(`Container not initialized`);
    const localDir = resolveLocalPath(undefined, targetDir);
    const absTargetDir = resolveSandboxPath(this.workdir, sourceDir);
    const tarBuf = await this.readArchiveBytes(absTargetDir, opts.ignore);
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
    if (!this.container) throw new Error(`Container not initialized`);
    const tarBuf = await this.readArchiveBytes(resolveSandboxPath(this.workdir, path));
    return extractFileFromTar(tarBuf);
  }

  /**
   * Docker getArchive 对 ReadonlyRootfs 容器中的 tmpfs 会错误返回 404，即使 exec 能看到文件。
   * readonly 模式改由容器内 tar，再把二进制归档编码成 ASCII 经 exec 流取回。
   */
  private async readArchiveBytes(absPath: string, ignoredNames: readonly string[] = []): Promise<Buffer> {
    if (!this.container) throw new Error(`Container not initialized`);
    const names = [...new Set(ignoredNames)].filter(
      (name) => name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0"),
    );
    if (this.resources.readOnlyRootfs !== true && names.length === 0) {
      const stream = await (this.container as Docker.Container).getArchive({ path: absPath });
      return readableToBuffer(stream as NodeJS.ReadableStream);
    }
    // Archive relative to the requested directory so its own basename is never
    // excluded. Escape tar patterns: ignore contains literal names, not globs.
    const archive =
      names.length === 0
        ? `tar -C ${shellQuote(dirname(absPath))} -cf - -- ${shellQuote(basename(absPath))}`
        : `tar -C ${shellQuote(absPath)} -cf - ${names
            .map((name) => shellQuote(`--exclude=${name.replace(/[\\*?[\]]/gu, "\\$&")}`))
            .join(" ")} -- .`;
    const result = await this.runShell(`set -o pipefail; ${archive} | base64`, { user: ROOT_USER });
    if (result.exitCode !== 0) {
      throw new Error(`failed to archive ${absPath} inside Docker sandbox: ${result.stderr.trim()}`);
    }
    return Buffer.from(result.stdout.replace(/\s+/g, ""), "base64");
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
    if (!this.container) throw new Error(`Container not initialized`);
    const absPath = resolveSandboxPath(this.workdir, destPath);
    await this.runCommandAsRoot("mkdir", ["-p", dirname(absPath)]);
    if (this.resources.readOnlyRootfs === true) {
      await this.writeBytesViaExec(absPath, Buffer.from(content));
      await this.chownToSandboxUser(absPath);
      return;
    }
    const pack = packFilesToTar([{ name: basename(absPath), content: Buffer.from(content) }]);
    await (this.container as Docker.Container).putArchive(pack, { path: dirname(absPath) });
    await this.chownToSandboxUser(absPath);
  }

  /** readonly rootfs 下向可写 tmpfs 投递字节；Docker exec stdin 不触发 putArchive 的 blanket 拒绝。 */
  private async writeBytesViaExec(absPath: string, content: Buffer): Promise<void> {
    if (!this.container) throw new Error(`Container not initialized`);
    const exec = await this.container.exec({
      Cmd: ["sh", "-c", 'cat > "$1"', "niceeval-write", absPath],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      User: ROOT_USER,
    });
    const stream = await exec.start({ hijack: true, stdin: true });
    const inspection = await new Promise<Awaited<ReturnType<typeof exec.inspect>>>((resolve, reject) => {
      let settled = false;
      let pollInFlight = false;
      const cleanup = (): void => {
        clearInterval(poll);
        clearTimeout(timeout);
      };
      const finish = (value: Awaited<ReturnType<typeof exec.inspect>>): void => {
        if (settled) return;
        settled = true;
        cleanup();
        stream.destroy();
        resolve(value);
      };
      const inspectAndFinish = (): void => {
        if (settled || pollInFlight) return;
        pollInFlight = true;
        void exec
          .inspect()
          .then((value) => {
            if (value.Running === false) finish(value);
          })
          .catch(reject)
          .finally(() => {
            pollInFlight = false;
          });
      };
      const poll = setInterval(inspectAndFinish, 100);
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        stream.destroy();
        reject(new Error(`timed out writing ${absPath} inside read-only Docker sandbox`));
      }, 30_000);
      stream.on("error", (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      });
      stream.on("end", inspectAndFinish);
      stream.end(content);
    });
    if ((inspection.ExitCode ?? 0) !== 0) {
      throw new Error(`failed to write ${absPath} inside read-only Docker sandbox`);
    }
  }

  async downloadFile(sourcePath: string, target: string | URL): Promise<void> {
    const destination = resolveLocalPath(undefined, target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await this.readBytes(sourcePath));
  }

  private async captureBeforeCacheImage(
    labels: Readonly<Record<string, string>>,
    knownSensitiveValues: readonly string[],
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const eligibility = this.beforeCacheEligibility();
    if (eligibility._tag === "Unsupported") throw new Error(eligibility.reason);
    const container = this.container;
    if (container === undefined) throw new Error("Docker before-cache staging container has already been released");

    try {
      await container.stop({ t: 5, abortSignal: signal });
    } catch (cause) {
      if (!benignStopError(cause)) throw cause;
    }
    signal.throwIfAborted();
    const stopped = await container.inspect({ abortSignal: signal });
    if (stopped.State?.Running === true)
      throw new Error("outer Docker staging container is still running after graceful stop");

    // Capture ordering is deliberate: container stop → host sync → commit.
    await execFileAsync("sync", [], { timeout: 30_000, signal });
    const changes = Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `LABEL ${key}=${JSON.stringify(value)}`);
    const committed = (await container.commit({ changes, abortSignal: signal })) as {
      readonly Id?: string;
      readonly ID?: string;
    };
    const imageId = committed.Id ?? committed.ID;
    if (imageId === undefined || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) {
      throw new Error("Docker commit did not return an exact image id");
    }
    signal.throwIfAborted();

    const image = this.docker.getImage(imageId);
    const inspection = await abortableProviderRead(image.inspect(), signal);
    signal.throwIfAborted();
    const history = await abortableProviderRead(image.history(), signal);
    signal.throwIfAborted();
    const persisted = JSON.stringify({ config: inspection.Config, history });
    const leaked = knownSensitiveValues.some((value) => value.length > 0 && persisted.includes(value));
    if (leaked) {
      const validationError = new Error(
        "captured Docker image config/history contains a framework-known sensitive value",
      );
      try {
        await image.remove({ abortSignal: signal } as Docker.ImageRemoveOptions & {
          readonly abortSignal: AbortSignal;
        });
      } catch (cleanupCause) {
        throw new AggregateError([validationError, cleanupCause], "sensitive captured image could not be removed");
      }
      throw validationError;
    }
    return imageId;
  }

  private async rebaseBeforeCacheImage(
    imageId: string,
    plannedContainerName: string,
    signal: AbortSignal,
  ): Promise<{ readonly containerId: string; readonly imageId: string }> {
    // The before-cache capability is Promise-shaped. Its implementation still owns the
    // complete restore lifecycle in one Effect, so readiness shares its Clock/fiber.
    return Effect.runPromise(this.rebaseBeforeCacheImageEffect(imageId, plannedContainerName, signal));
  }

  private rebaseBeforeCacheImageEffect(
    imageId: string,
    plannedContainerName: string,
    signal: AbortSignal,
  ): Effect.Effect<{ readonly containerId: string; readonly imageId: string }, unknown> {
    const prepare = Effect.tryPromise({
      try: async () => {
        signal.throwIfAborted();
        const eligibility = this.beforeCacheEligibility();
        if (eligibility._tag === "Unsupported") throw new Error(eligibility.reason);
        if (!/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error("before-cache restore requires an exact image id");
        // DestroyOnly is intentional: cached staging never runs normal teardown/after callbacks.
        await this.destroyCurrentContainer(signal);
        this.image = imageId;
        this.containerName = plannedContainerName;
        this.provisionToken = randomUUID();
        this.expiresAtMs = undefined;
        this.defaultHome = "/root";
        this.defaultUserName = "root";
        this.defaultIsRoot = true;
        this.npmGlobalDir = "/root/.npm-global";
        this.sandboxPath = this.managedPath(this.npmGlobalDir);
      },
      catch: (cause) => cause,
    });

    return prepare.pipe(
      Effect.andThen(Effect.tryPromise({ try: () => this.initializeBeforeReadiness(signal), catch: (cause) => cause })),
      Effect.andThen(this.waitForReadinessEffect(signal)),
      Effect.andThen(
        Effect.tryPromise({
          try: async () => {
            await this.initializeAfterReadiness(signal);
            signal.throwIfAborted();
            const inspection = await this.container!.inspect({ abortSignal: signal });
            if (inspection.Image !== imageId) {
              throw new Error(`fresh private container uses ${inspection.Image}, expected exact image ${imageId}`);
            }
            return { containerId: inspection.Id, imageId: inspection.Image };
          },
          catch: (cause) => cause,
        }),
      ),
      Effect.catch((cause) => this.cleanupAfterBeforeCacheRebaseFailureEffect(cause)),
    );
  }

  private cleanupAfterBeforeCacheRebaseFailureEffect(cause: unknown): Effect.Effect<never, unknown> {
    return Effect.tryPromise({
      try: async () => {
        try {
          await this.destroyCurrentContainer();
        } catch (cleanupCause) {
          throw new AggregateError(
            [cause, cleanupCause],
            "Docker exact-image rebase failed and its partial container could not be fully removed",
          );
        }
        throw cause;
      },
      catch: (error) => error,
    });
  }

  private async recoverBeforeCacheCleanBase(
    signal: AbortSignal,
  ): Promise<{ readonly baseIdentity: string; readonly sandboxId: string }> {
    const baseIdentity = this.baseIdentity;
    if (baseIdentity === undefined || !/^sha256:[a-f0-9]{64}$/u.test(baseIdentity)) {
      throw new Error("Docker sandbox has no verified exact Base image for clean recovery");
    }
    const recovered = await this.rebaseBeforeCacheImage(
      baseIdentity,
      `niceeval-before-cache-recovery-${randomUUID()}`,
      signal,
    );
    return { baseIdentity, sandboxId: recovered.containerId.slice(0, 12) };
  }

  private async destroyCurrentContainer(operationSignal?: AbortSignal): Promise<void> {
    const cleanupSignal = operationSignal ?? AbortSignal.timeout(BEFORE_CACHE_PROVIDER_CLEANUP_TIMEOUT_MS);
    const container = this.container;
    if (container === undefined) {
      if (this.beforeCacheHold !== undefined) {
        const hold = this.beforeCacheHold;
        await hold.release();
        if (this.beforeCacheHold === hold) this.beforeCacheHold = undefined;
      }
      return;
    }
    if (this.releaseMode === "detach") {
      this.container = undefined;
      return;
    }

    const cleanupErrors: unknown[] = [];
    try {
      await container.stop({ t: 0, abortSignal: cleanupSignal });
    } catch (error) {
      if (!benignStopError(error)) cleanupErrors.push(error);
    }
    let removed = false;
    try {
      await container.remove({ force: true, abortSignal: cleanupSignal } as Docker.ContainerRemoveOptions & {
        readonly abortSignal: AbortSignal;
      });
      removed = true;
    } catch (error) {
      if (benignRemoveError(error)) removed = true;
      else cleanupErrors.push(error);
    }
    if (removed && this.container === container) this.container = undefined;
    if (removed && this.beforeCacheHold !== undefined) {
      const hold = this.beforeCacheHold;
      if (hold.containerId !== container.id) {
        cleanupErrors.push(new Error("before-cache durable hold belongs to a different Docker container"));
      } else {
        try {
          await hold.release();
          if (this.beforeCacheHold === hold) this.beforeCacheHold = undefined;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `failed to destroy Docker sandbox ${this.sandboxId}`);
    }
  }

  /**
   * 释放句柄。`releaseMode: "destroy"`(默认 create 路径)显式 stop + remove;
   * `releaseMode: "detach"`(Compose 附着)只松绑——整组由 compose down 回收,避免主容器先被拆掉留下 sidecar 孤儿。
   */
  async stop(): Promise<void> {
    await this.destroyCurrentContainer();
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
