// Docker 沙箱 provider:用 dockerode 把容器当隔离工作区跑 eval。
// 改编自 agent-eval 的 docker-sandbox.ts,签名对齐 ../types.ts 的 Sandbox 契约
//(runShell/runCommand 的 opts 一律是选项对象,不再用位置参数)。

import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
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
import { t } from "../i18n/index.ts";
import { reportActivity } from "../runner/feedback/sink.ts";
import { classifyProvisionErrorFallback, type SandboxProvisionErrorKind } from "./errors.ts";
import { dockerRunIdentityLabels, type RunIdentity } from "./run-identity.ts";
import {
  supportedBackendCapability,
  type SandboxProviderBackend,
  type SandboxSetupPrefixCacheEligibility,
} from "./backend.ts";
import type { DockerSandboxAccess, DockerSandboxReadiness, DockerSandboxResources } from "./layer.ts";
import { DIND_CAPTURE_QUIESCE_COMMAND, dindContainerCommand } from "./dind-supervisor.ts";
import { ManagedProcessOutput } from "./managed-process.ts";
import {
  makeDockerSetupPrefixCacheCapability,
  type DockerSetupPrefixRootOwnership,
} from "./docker-setup-prefix-cache.ts";

const execFileAsync = promisify(execFile);
const SETUP_PREFIX_PROVIDER_CLEANUP_TIMEOUT_MS = 30_000;

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
 * 硬前置,静默放行等于盲重试(见 docs/feature/sandbox/architecture.md);唯一的例外:
 * 容器已不存在(404),视作对账完成。
 */
export async function reconcileProvision(token: string, socketPath?: string): Promise<void> {
  const docker = new Docker(socketPath === undefined ? undefined : { socketPath });
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
const DOCKER_ACCESS_SOCKET = "unix:///var/run/docker.sock";

/**
 * This is intentionally provider-owned.  It proves the Agent's *initial default*
 * endpoint without pretending to constrain commands the Agent may issue later.
 */
export const DOCKER_ACCESS_COMPATIBILITY_COMMAND = Object.freeze([
  "sh",
  "-ec",
  [
    'test -z "${DOCKER_HOST+x}" || { echo "DOCKER_HOST must be unset" >&2; exit 1; }',
    'test -z "${DOCKER_CONTEXT+x}" || { echo "DOCKER_CONTEXT must be unset" >&2; exit 1; }',
    'context="$(docker context show)"',
    'test "$context" = "default" || { echo "docker context must be default (got $context)" >&2; exit 1; }',
    'default_daemon="$(docker info --format \'{{.ID}}\')"',
    `unix_daemon="$(docker --host=${DOCKER_ACCESS_SOCKET} info --format '{{.ID}}')"`,
    'test -n "$default_daemon" || { echo "bare docker info returned no daemon ID" >&2; exit 1; }',
    'test "$default_daemon" = "$unix_daemon" || { echo "bare and Unix Docker endpoints reached different daemons" >&2; exit 1; }',
  ].join("\n"),
] as const satisfies readonly [string, ...string[]]);

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
  /** raw = 直接请求 privileged；rootless = 只允许受管 rootless daemon。 */
  privileged?: "disabled" | "raw" | "rootless";
  /** Agent在Sandbox内访问Docker的模式；socket模式会显式挂载宿主Unix socket。 */
  dockerAccess?: Readonly<DockerSandboxAccess>;
  /** 创建容器时交给 daemon 强制执行的资源边界。 */
  resources?: Readonly<DockerSandboxResources>;
  /** PID 1 启动后、任何 setup/prepare/agent 命令之前必须通过的作者声明探针。 */
  readiness?: Readonly<DockerSandboxReadiness>;
  /** profile-bound provider fixes every Docker I/O to the attested Unix endpoint. */
  dockerSocketPath?: string;
  /** Descriptor-pinned public resolvers; managed privileged mode never invents defaults. */
  dns?: readonly string[];
  /** Durable watchdog ownership labels, copied to both container and exclusive network. */
  managedLabels?: Readonly<Record<string, string>>;
  rootlessAttestation?: { readonly daemonId: string; readonly dataRoot: string };
  afterStop?: () => Promise<void>;
  /**
   * 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library.md
   * 「PATH:受管变量与 pathPrepend」)。
   */
  pathPrepend?: readonly string[];
}

export interface DockerControlCreateSpec {
  readonly image: string;
  readonly command: readonly string[];
  readonly entrypoint?: string;
  readonly environment: readonly string[];
  readonly workingDir: string;
  readonly user?: string;
  readonly tmpfs: Readonly<Record<string, string>>;
}

export interface DockerControlCreateResult {
  readonly containerId: string;
  readonly networkId: string;
}

export function assertRootlessPrivilegedDaemon(
  info: {
    readonly ID?: string;
    readonly SecurityOptions?: readonly string[];
    readonly DockerRootDir?: string;
    readonly CgroupDriver?: string;
    readonly CgroupVersion?: string;
  },
  dockerHost: string | undefined,
  expected: { readonly daemonId?: string; readonly dataRoot?: string } | undefined,
): void {
  if (dockerHost === undefined || !dockerHost.startsWith("unix://")) {
    throw new Error(
      'privileged Docker sandbox requires an explicit rootless Unix DOCKER_HOST; no default socket or TCP endpoint is allowed',
    );
  }
  const socketPath = dockerHost.slice("unix://".length);
  if (socketPath === "/var/run/docker.sock" || socketPath === "/run/docker.sock") {
    throw new Error("privileged Docker sandbox refuses the host rootful Docker socket");
  }
  const securityOptions = info.SecurityOptions ?? [];
  if (!securityOptions.some((entry) => /(?:^|[=,])rootless(?:$|[=,])/i.test(entry))) {
    throw new Error("privileged Docker sandbox requires a daemon whose SecurityOptions report rootless");
  }
  if (info.CgroupVersion !== "2" || info.CgroupDriver !== "systemd") {
    throw new Error(
      `privileged Docker sandbox requires delegated cgroup v2 with the systemd driver; got ` +
      `version=${info.CgroupVersion ?? "unknown"}, driver=${info.CgroupDriver ?? "unknown"}`,
    );
  }
  if (expected?.daemonId === undefined || expected.daemonId === "") {
    throw new Error("privileged Docker sandbox requires NICEEVAL_ROOTLESS_DOCKER_ID attestation");
  }
  if (info.ID !== expected.daemonId) {
    throw new Error(
      `privileged Docker sandbox daemon ID does not match NICEEVAL_ROOTLESS_DOCKER_ID ` +
      `(expected ${expected.daemonId}, got ${info.ID ?? "unknown"})`,
    );
  }
  if (expected?.dataRoot === undefined || expected.dataRoot === "") {
    throw new Error("privileged Docker sandbox requires NICEEVAL_ROOTLESS_DOCKER_DATA_ROOT attestation");
  }
  if (info.DockerRootDir !== expected.dataRoot) {
    throw new Error(
      `privileged Docker sandbox DockerRootDir does not match NICEEVAL_ROOTLESS_DOCKER_DATA_ROOT ` +
      `(expected ${expected.dataRoot}, got ${info.DockerRootDir ?? "unknown"})`,
    );
  }
}

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

async function startContainerIdempotently(container: Docker.Container): Promise<void> {
  if ((await container.inspect()).State?.Running === true) return;
  try {
    await container.start();
  } catch (error) {
    // A control-owned committed create may be replayed after readiness failed.
    // Accept Docker's 304 only when a fresh inspect proves the same container is running.
    if (dockerStatusCode(error) === 304 && (await container.inspect()).State?.Running === true) return;
    throw error;
  }
}

export function dockerHostConfig(
  privileged: "disabled" | "raw" | "rootless",
  resources: Readonly<DockerSandboxResources>,
  dns: readonly string[] = [],
  socketMount?: { readonly source: string; readonly gid: number },
): Docker.HostConfig {
  const nanoCpus = resources.cpus === undefined ? undefined : Math.round(resources.cpus * 1_000_000_000);
  if (nanoCpus !== undefined && !Number.isSafeInteger(nanoCpus)) {
    throw new TypeError("Docker sandbox resources.cpus is too large to encode as NanoCpus");
  }
  const tmpfs = resources.tmpfs === undefined
    ? undefined
    : Object.fromEntries(Object.entries(resources.tmpfs).map(([path, options]) => [
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
      ]));
  return {
    AutoRemove: false,
    ...(privileged !== "disabled"
      ? { Privileged: true, ...(dns.length === 0 ? {} : { Dns: [...dns] }) }
      : {}),
    ...(socketMount === undefined
      ? {}
      : {
          Mounts: [{ Type: "bind", Source: socketMount.source, Target: "/var/run/docker.sock" }],
          GroupAdd: [String(socketMount.gid)],
        }),
    ...(nanoCpus === undefined ? {} : { NanoCpus: nanoCpus }),
    ...(resources.memoryBytes === undefined ? {} : { Memory: resources.memoryBytes }),
    ...(resources.memoryBytes === undefined ? {} : { MemorySwap: resources.memoryBytes }),
    ...(resources.pidsLimit === undefined ? {} : { PidsLimit: resources.pidsLimit }),
    ...(resources.readOnlyRootfs === true ? { ReadonlyRootfs: true } : {}),
    ...(tmpfs === undefined ? {} : { Tmpfs: tmpfs }),
  };
}

export async function resolveDockerSocketMount(
  socketPath: string,
): Promise<{ readonly source: string; readonly gid: number }> {
  const source = await realpath(socketPath);
  const info = await stat(source);
  if (!info.isSocket()) throw new TypeError(`Docker socket path is not a Unix socket: ${socketPath}`);
  return Object.freeze({ source, gid: info.gid });
}

/** managed privileged Attempt 的独占 outer network；允许 NAT 出站，但禁止 sibling 互通。 */
export function dockerManagedNetworkOptions(
  provisionToken: string | undefined,
  nonce: string = randomUUID(),
  managedLabels: Readonly<Record<string, string>> = {},
): Docker.NetworkCreateOptions {
  return {
    Name: `niceeval-attempt-${nonce}`,
    CheckDuplicate: false,
    Driver: "bridge",
    Internal: false,
    Attachable: false,
    Options: {
      "com.docker.network.bridge.enable_icc": "false",
    },
    Labels: {
      "niceeval.managed-network": "true",
      ...(provisionToken === undefined ? {} : { "niceeval.provision-token": provisionToken }),
      ...managedLabels,
    },
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
  private container: Docker.Container | null = null;
  private network: Docker.Network | null = null;
  private _containerId = "";
  private timeout?: number;
  private deadlineAt?: number;
  private lifetimeMs?: number;
  /** 容器 PID1 的 dead-man TTL 到期时刻(initialize 里烧进 `timeout` 那一刻定死)。 */
  private expiresAtMs?: number;
  private runtime: string;
  private image?: string;
  /** Exact pristine source image captured during the first initialization; never advances with prefix rebases. */
  private baseImageId?: string;
  /** Dynamic package-manager mutation can never become a shared SetupPrefix baseline for this instance. */
  private runnerToolsInstalledDynamically = false;
  private feedback?: import("../types.ts").ScopedFeedback;
  private provisionToken?: string;
  private runIdentity?: RunIdentity;
  private releaseMode: DockerSandboxReleaseMode = "destroy";
  /** 起点覆盖(factory `user`);省略 = 沿用镜像/Compose 声明的默认身份。 */
  private readonly userOverride?: string;
  private readonly privileged: "disabled" | "raw" | "rootless";
  private readonly dockerAccess?: Readonly<DockerSandboxAccess>;
  private readonly resources: Readonly<DockerSandboxResources>;
  private readonly readiness?: Readonly<DockerSandboxReadiness>;
  private readonly dockerSocketPath?: string;
  private readonly dns: readonly string[];
  private readonly managedLabels: Readonly<Record<string, string>>;
  private containerName?: string;
  private readonly rootlessAttestation?: { readonly daemonId: string; readonly dataRoot: string };
  private readonly afterStop?: () => Promise<void>;
  /** factory `pathPrepend`;按声明顺序前置到受管 PATH,省略 = 空数组。 */
  private readonly pathPrepend: readonly string[];
  /** DinD 覆盖容器 User 为 root 后，仍用镜像 USER 作为 Agent 默认身份。 */
  private imageDefaultUser?: string;
  /** 下面三项由 `resolveDefaultIdentity()` 探测得出,构造期先给出安全占位值。 */
  private defaultHome = "/root";
  private defaultUserName = "root";
  private defaultIsRoot = true;
  private npmGlobalDir = "/root/.npm-global";
  private sandboxPath: string;
  private setupPrefixRoot?: DockerSetupPrefixRootOwnership;
  private setupPrefixMountReason?: string;
  readonly capabilities = {
    rootCommands: supportedBackendCapability(true as const),
    appendLog: supportedBackendCapability((line: string) => this.appendLog(line)),
    suspend: supportedBackendCapability(() => this.suspend()),
    ensureLifetime: supportedBackendCapability((minRemainingMs: number) => this.ensureLifetime(minRemainingMs)),
    setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => this.setCommandDeadline(deadlineAt)),
    managedProcess: supportedBackendCapability((input: ManagedProcessStart) => this.startManagedProcess(input)),
    setupPrefixCache: supportedBackendCapability(makeDockerSetupPrefixCacheCapability({
      eligibility: () => this.setupPrefixCacheEligibility(),
      captureExactImage: (labels, knownSensitiveValues, signal) =>
        this.captureSetupPrefixImage(labels, knownSensitiveValues, signal),
      rebaseToExactImage: (imageId, plannedContainerName, signal) =>
        this.rebaseSetupPrefixImage(imageId, plannedContainerName, signal),
      destroyCurrentForCacheRecovery: () => this.destroyCurrentContainer(false),
      adoptSetupPrefixRoot: (root) => this.adoptSetupPrefixRoot(root),
      recoverCleanBase: (signal) => this.recoverSetupPrefixCleanBase(signal),
    })),
  };

  private async startManagedProcess(input: ManagedProcessStart): Promise<ManagedProcess> {
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
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
          resolve({ exitCode: inspection.ExitCode ?? null });
        }, finishError);
      }, 100);
    });
    let closeReceipt: Promise<void> | undefined;
    let terminateReceipt: Promise<void> | undefined;
    let stdinState: "open" | "closing" | "closed" = "open";
    return {
      output,
      writeStdin: (bytes) => new Promise<void>((resolve, reject) => {
        if (stdinState !== "open") { reject(new Error("managed process stdin is closed")); return; }
        stream.write(Buffer.from(bytes), (error?: Error | null) => error ? reject(error) : resolve());
      }),
      closeStdin: () => closeReceipt ??= new Promise<void>((resolve) => {
        stdinState = "closing";
        stream.end(() => { stdinState = "closed"; resolve(); });
      }),
      wait: () => exit,
      terminate: () => terminateReceipt ??= (async () => {
        stdinState = "closing";
        const inspection = await exec.inspect().catch(() => undefined);
        if (!inspection?.Running) { await exit.catch(() => undefined); return; }
        if (processGroup === undefined) {
          const error = new Error("docker managed process did not disclose its process-group identity; sandbox retirement is required");
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
          Cmd: ["sh", "-c", "kill -KILL \"$1\"", "sh", `-${processGroup}`],
          AttachStdout: true,
          AttachStderr: true,
          User: "root",
        });
        const killStream = await killer.start({});
        const killOutput = await readableToBuffer(killStream);
        const killed = await killer.inspect();
        if (killed.ExitCode !== 0) {
          const error = new Error(`docker could not terminate managed process group ${processGroup}; sandbox retirement is required: ${killOutput.toString("utf8")}`);
          finishError(error);
          throw error;
        }
        await exit;
      })(),
    };
  }

  constructor(options: DockerSandboxOptions = {}) {
    this.docker = new Docker(options.dockerSocketPath === undefined ? undefined : { socketPath: options.dockerSocketPath });
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
    this.privileged = options.privileged ?? "disabled";
    this.dockerAccess = options.dockerAccess;
    // Docker bridge 能否回连宿主取决于宿主防火墙与 daemon 网络策略，provider 不能把
    // host-gateway 伪装成稳定能力。null 让 runner 把 attempt-scope collector 放进沙箱；
    // 作者确有受控 tunnel 时仍可用 config.telemetry.host 显式覆盖。
    this.otlpHost = null;
    this.resources = options.resources ?? {};
    this.readiness = options.readiness;
    this.dockerSocketPath = options.dockerSocketPath;
    this.dns = Object.freeze([...(options.dns ?? [])]);
    this.managedLabels = Object.freeze({ ...(options.managedLabels ?? {}) });
    this.rootlessAttestation = options.rootlessAttestation;
    this.afterStop = options.afterStop;
    this.pathPrepend = options.pathPrepend ?? [];
    this.sandboxPath = this.managedPath(this.npmGlobalDir);
  }

  private setupPrefixCacheEligibility(): SandboxSetupPrefixCacheEligibility {
    if (this.dockerSocketPath !== undefined || this.privileged === "rootless") {
      return {
        _tag: "Unsupported",
        code: "profile-managed",
        reason: "persistent setup-prefix capture is limited to the default local Docker daemon",
      };
    }
    if (this.releaseMode === "detach") {
      return {
        _tag: "Unsupported",
        code: "compose",
        reason: "Compose and attached containers have group-owned state outside one writable outer rootfs",
      };
    }
    if (this.dockerAccess?.mode === "socket") {
      return {
        _tag: "Unsupported",
        code: "host-socket",
        reason: "a mounted host Docker socket is state outside the captured outer rootfs",
      };
    }
    if (this.resources.readOnlyRootfs === true) {
      return {
        _tag: "Unsupported",
        code: "read-only-rootfs",
        reason: "persistent setup-prefix capture requires a writable outer rootfs",
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
    if (this.setupPrefixMountReason !== undefined) {
      return {
        _tag: "Unsupported",
        code: "mounted-state",
        reason: this.setupPrefixMountReason,
      };
    }
    if (
      this.resources.dockerDataBytes !== undefined ||
      (this.dockerAccess?.mode === "dind" &&
        (this.dockerAccess.isolation === "managed-rootless" || this.dockerAccess.storageProfile !== undefined))
    ) {
      return {
        _tag: "Unsupported",
        code: "profile-backed-dind",
        reason: "DinD capture requires /var/lib/docker to remain in the writable outer rootfs",
      };
    }
    if (this.baseImageId === undefined || !/^sha256:[a-f0-9]{64}$/u.test(this.baseImageId)) {
      return {
        _tag: "Unsupported",
        code: "base-image-unverified",
        reason: "persistent setup-prefix capture requires a verified exact Base image id",
      };
    }
    return {
      _tag: "Eligible",
      persistence: "persistent",
      dependency: "parent-backed",
      baseImageId: this.baseImageId,
    };
  }

  private adoptSetupPrefixRoot(root: DockerSetupPrefixRootOwnership): void {
    if (this.container === null || this._containerId !== root.containerId) {
      throw new Error("cannot attach a setup-prefix durable root to a different Docker container");
    }
    if (this.setupPrefixRoot !== undefined) {
      throw new Error("the previous setup-prefix durable root has not been released");
    }
    this.setupPrefixRoot = root;
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
      const initializationError = await sandbox.withInitializationDiagnostics(e);
      // kill-on-failure:容器创建之后的初始化(start、基础工具安装、工作区属主)一旦失败,
      // 先尽力销毁容器再抛出原始错误——不给重试层留一台无主容器
      // (见 docs/feature/sandbox/architecture.md「Provisioning 失败与重试」)。
      const cleanupErrors: unknown[] = [];
      try {
        await sandbox.container?.remove({ force: true });
        sandbox.container = null;
      } catch (cleanupError) {
        if (benignRemoveError(cleanupError)) {
          sandbox.container = null;
        } else {
          cleanupErrors.push(cleanupError);
        }
      }
      try {
        await sandbox.network?.remove();
        sandbox.network = null;
      } catch (cleanupError) {
        if (dockerStatusCode(cleanupError) === 404) {
          sandbox.network = null;
        } else {
          cleanupErrors.push(cleanupError);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [initializationError, ...cleanupErrors],
          "Docker sandbox initialization failed and its partial container/network could not be fully removed",
        );
      }
      throw initializationError;
    }
    return sandbox;
  }

  /** Control service owns create/remove; this handle only starts, initializes and detaches. */
  static async createControlled(
    options: DockerSandboxOptions,
    create: (spec: DockerControlCreateSpec) => Promise<DockerControlCreateResult>,
  ): Promise<DockerSandbox> {
    const sandbox = new DockerSandbox(options);
    const imageName = sandbox.image ?? DOCKER_IMAGES[sandbox.runtime];
    if (!imageName) throw new Error(t("docker.unsupportedRuntime", { runtime: sandbox.runtime }));
    await sandbox.ensureImage(imageName);
    const inspectedImage = await sandbox.docker.getImage(imageName).inspect();
    if (!/^sha256:[a-f0-9]{64}$/u.test(inspectedImage.Id)) {
      throw new Error(`Docker profile source image ${imageName} did not resolve to an exact image id`);
    }
    sandbox.baseImageId = inspectedImage.Id;
    const declaredVolumes = Object.keys(inspectedImage.Config?.Volumes ?? {}).sort();
    sandbox.setupPrefixMountReason = declaredVolumes.length === 0
      ? undefined
      : `image-declared volumes are outside the declared profile surfaces: ${declaredVolumes.join(", ")}`;
    const isDind = sandbox.dockerAccess?.mode === "dind";
    if (isDind) {
      const declaredUser = inspectedImage.Config?.User?.trim();
      sandbox.imageDefaultUser = declaredUser === "" ? undefined : declaredUser;
    }
    const ttlSec = Math.ceil(Math.max(
      sandbox.lifetimeMs ?? (sandbox.timeout ?? TTL_BASE_WITHOUT_DEADLINE) * TTL_MULTIPLIER,
      TTL_FLOOR_MS,
    ) / 1000);
    sandbox.expiresAtMs = Date.now() + ttlSec * 1000;
    const dindCommand = isDind ? dindContainerCommand(ttlSec, CONTAINER_LOG) : undefined;
    const tmpfs = dockerHostConfig(sandbox.privileged, sandbox.resources).Tmpfs ?? {};
    const created = await create({
      image: inspectedImage.Id,
      command: dindCommand === undefined
        ? ["sh", "-c", `touch ${CONTAINER_LOG}; chmod 666 ${CONTAINER_LOG}; exec timeout ${ttlSec} tail -n +1 -F ${CONTAINER_LOG}`]
        : [...dindCommand.Entrypoint.slice(1), ...dindCommand.Cmd],
      ...(dindCommand === undefined ? {} : { entrypoint: dindCommand.Entrypoint[0]! }),
      environment: [],
      workingDir: sandbox.workdir,
      ...(isDind ? { user: ROOT_USER } : sandbox.userOverride === undefined ? {} : { user: sandbox.userOverride }),
      tmpfs,
    });
    sandbox.container = sandbox.docker.getContainer(created.containerId);
    sandbox.network = sandbox.docker.getNetwork(created.networkId);
    sandbox._containerId = created.containerId;
    sandbox.releaseMode = "detach";
    try {
      await startContainerIdempotently(sandbox.container);
      await sandbox.waitForReadiness();
      await sandbox.ensureRunnerTools();
      await sandbox.resolveDefaultIdentity();
      await sandbox.runCommandAsRoot("mkdir", ["-p", sandbox.workdir]);
      await sandbox.runCommandAsRoot("chown", ["-R", sandbox.chownTarget(), sandbox.workdir]);
      await sandbox.runCommandAsRoot("mkdir", ["-p", sandbox.npmGlobalDir]);
      await sandbox.runCommandAsRoot("chown", ["-R", sandbox.chownTarget(), sandbox.npmGlobalDir]);
      await sandbox.runCommand("npm", ["config", "set", "prefix", sandbox.npmGlobalDir]);
      return sandbox;
    } catch (error) {
      throw await sandbox.withInitializationDiagnostics(error);
    }
  }

  /** DinD 容器 kill-on-failure 前收集有界诊断，普通 Docker 保持原错误形状。 */
  private async withInitializationDiagnostics(error: unknown): Promise<unknown> {
    if (this.dockerAccess?.mode !== "dind" || this.container === null) return error;
    const sections: string[] = [];
    try {
      const logs = await this.container.logs({ stdout: true, stderr: true, tail: 256 });
      const bytes = Buffer.isBuffer(logs)
        ? logs
        : await readableToBuffer(logs as unknown as NodeJS.ReadableStream);
      const tail = bytes.subarray(Math.max(0, bytes.length - 256 * 1024)).toString("utf-8").trim();
      if (tail !== "") sections.push(`docker logs (tail):\n${tail}`);
    } catch {
      // 诊断采集是 best effort；不能覆盖初始化原错误。
    }
    try {
      const state = await this.container.inspect();
      if (state.State?.Running === true) {
        const daemonTail = await this.execCommand("tail", ["-c", String(256 * 1024), "/tmp/dockerd.log"], {
          user: ROOT_USER,
        });
        const tail = (daemonTail.stderr || daemonTail.stdout).trim();
        if (tail !== "") sections.push(`dockerd.log (tail):\n${tail}`);
      }
    } catch {
      // daemon 提前退出时 supervisor 已把有界 tail 写入 docker logs。
    }
    if (sections.length === 0) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`${message}\n${sections.join("\n")}`, { cause: error });
  }

  /** 拉镜像、起容器、装基础工具、备好工作区与 npm 前缀。 */
  private async initialize(operationSignal?: AbortSignal): Promise<void> {
    operationSignal?.throwIfAborted();
    const socketMount = this.dockerAccess?.mode === "socket"
      ? await resolveDockerSocketMount(this.dockerAccess.socketPath)
      : undefined;
    // 显式 image(预制模板)优先;否则按 runtime 选默认 node:*-slim。
    const imageName = this.image ?? DOCKER_IMAGES[this.runtime];
    if (!imageName) {
      throw new Error(t("docker.unsupportedRuntime", { runtime: this.runtime }));
    }

    if (this.privileged === "rootless") {
      assertRootlessPrivilegedDaemon(
        await this.docker.info(),
        this.dockerSocketPath === undefined ? undefined : `unix://${this.dockerSocketPath}`,
        this.rootlessAttestation === undefined ? undefined : {
          daemonId: this.rootlessAttestation.daemonId,
          dataRoot: this.rootlessAttestation.dataRoot,
        },
      );
      if (this.dns.length === 0) throw new Error("managed rootless Docker requires descriptor-pinned DNS servers");
      this.network = await this.docker.createNetwork(
        dockerManagedNetworkOptions(this.provisionToken, randomUUID(), this.managedLabels),
      );
    }

    // 确保镜像在本地。
    await this.ensureImage(imageName, operationSignal);
    operationSignal?.throwIfAborted();
    const sourceInspection = await abortableProviderRead(
      this.docker.getImage(imageName).inspect(
        operationSignal === undefined ? {} : { abortSignal: operationSignal } as Docker.ImageInspectOptions & {
          readonly abortSignal: AbortSignal;
        },
      ),
      operationSignal,
    );
    if (!/^sha256:[a-f0-9]{64}$/u.test(sourceInspection.Id)) {
      throw new Error(`Docker source image ${imageName} did not resolve to an exact image id`);
    }
    this.baseImageId ??= sourceInspection.Id;
    const declaredVolumes = Object.keys(sourceInspection.Config?.Volumes ?? {}).sort();
    this.setupPrefixMountReason = declaredVolumes.length === 0
      ? undefined
      : `image-declared volumes are outside the captured outer rootfs: ${declaredVolumes.join(", ")}`;

    const isDind = this.dockerAccess?.mode === "dind";
    if (isDind) {
      const declaredUser = sourceInspection.Config?.User?.trim();
      this.imageDefaultUser = declaredUser === "" ? undefined : declaredUser;
    }

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
    const dindCommand = isDind ? dindContainerCommand(ttlSec, CONTAINER_LOG) : undefined;
    const exactSourceImageId = sourceInspection.Id;
    this.container = await this.docker.createContainer({
      ...(this.containerName === undefined ? {} : { name: this.containerName }),
      Image: exactSourceImageId,
      ...(operationSignal === undefined ? {} : { abortSignal: operationSignal }),
      ...(dindCommand === undefined
        ? {
            Cmd: [
              "sh",
              "-c",
              `touch ${CONTAINER_LOG}; chmod 666 ${CONTAINER_LOG}; exec timeout ${ttlSec} tail -n +1 -F ${CONTAINER_LOG}`,
            ],
          }
        : { Entrypoint: [...dindCommand.Entrypoint], Cmd: [...dindCommand.Cmd], User: ROOT_USER }),
      WorkingDir: this.workdir,
      // provision token:歧义类失败的对账通道(按 label 查询本地容器);
      // keep-candidate:留存候选标记(异常硬退时核对未完成提交的候选)。
      Labels: {
        "niceeval.keep-candidate": "true",
        ...(isDind
          ? {
              "niceeval.docker-access": "dind",
              "niceeval.dind-readiness-user": this.userOverride ?? this.imageDefaultUser ?? ROOT_USER,
            }
          : {}),
        ...(this.provisionToken ? { "niceeval.provision-token": this.provisionToken } : {}),
        ...(this.runIdentity ? dockerRunIdentityLabels(this.runIdentity) : {}),
        ...this.managedLabels,
      },
      Tty: true,
      // 不带 AutoRemove:留存意图必须在创建期传入(--keep-sandbox 的 suspend = docker stop,
      // 停驻容器的文件系统落盘持久)。默认路径的销毁由 stop() 显式 stop + remove,行为等价;
      // 宿主异常硬退留下的孤儿由 TTL dead-man switch 停驻后按 keep-candidate 标签事后核对。
      HostConfig: {
        ...dockerHostConfig(this.privileged, this.resources, this.dns, socketMount),
        ...(this.network === null ? {} : { NetworkMode: this.network.id }),
      },
    });

    this._containerId = this.container.id;

    await this.container.start(operationSignal === undefined ? {} : { abortSignal: operationSignal });

    const createdInspection = await abortableProviderRead(this.container.inspect(), operationSignal);
    if (createdInspection.Image !== exactSourceImageId) {
      throw new Error(
        `Docker container uses ${createdInspection.Image}, expected resolved exact Base image ${exactSourceImageId}`,
      );
    }
    const providerMounts = (createdInspection.Mounts ?? []).map((mount) => mount.Destination).filter(Boolean).sort();
    if (providerMounts.length > 0) {
      this.setupPrefixMountReason = `container mounts are outside the captured outer rootfs: ${providerMounts.join(", ")}`;
    }

    await this.waitForReadiness(operationSignal);

    // slim 镜像可能缺 CA 证书和 git,补装。
    await this.ensureRunnerTools(operationSignal);

    // 探测默认执行身份(镜像 USER,或 factory 的 `user` 覆盖)的 home 目录,后续 chown 与
    // npm 全局前缀都按它解析,不硬编码 UID/家目录(见 docs/feature/sandbox/library.md「执行身份」)。
    await this.resolveDefaultIdentity(operationSignal);

    // 工作目录交给默认执行身份。
    await this.runCommandAsRoot("mkdir", ["-p", this.workdir], { signal: operationSignal });
    await this.runCommandAsRoot("chown", ["-R", this.chownTarget(), this.workdir], { signal: operationSignal });

    // 为非 root 全局安装准备 npm 目录;root 身份下这一步是无害的自有目录。
    await this.runCommandAsRoot("mkdir", ["-p", this.npmGlobalDir], { signal: operationSignal });
    await this.runCommandAsRoot("chown", ["-R", this.chownTarget(), this.npmGlobalDir], { signal: operationSignal });

    // 让 npm 用这个目录当全局前缀(配置落在默认身份的家目录,供 agent 全局装 CLI 用)。
    await this.runCommand("npm", ["config", "set", "prefix", this.npmGlobalDir], { signal: operationSignal });
  }

  /** Docker start 只代表 PID 1 存活；Docker access 先证明默认端点，再跑作者 readiness。 */
  private waitForReadiness(signal?: AbortSignal): Promise<void> {
    return Effect.runPromise(this.waitForReadinessEffect(signal));
  }

  private waitForReadinessEffect(signal?: AbortSignal): Effect.Effect<void, unknown> {
    const readiness = this.readiness;
    if (readiness === undefined) return Effect.void;
    const readinessUser = readiness.user ?? this.userOverride ??
      (this.dockerAccess?.mode === "dind" ? this.imageDefaultUser : undefined);
    return Effect.gen(this, function* () {
      const deadline = (yield* Clock.currentTimeMillis) + readiness.timeoutMs;
      if (this.dockerAccess !== undefined) {
        yield* this.waitForReadinessProbeEffect({
          command: DOCKER_ACCESS_COMPATIBILITY_COMMAND,
          user: readinessUser,
          intervalMs: readiness.intervalMs,
          deadline,
          phase: "Docker access compatibility",
          timeoutMs: readiness.timeoutMs,
          signal,
        });
      }
      yield* this.waitForReadinessProbeEffect({
        command: readiness.command,
        user: readinessUser,
        intervalMs: readiness.intervalMs,
        deadline,
        phase: "Docker sandbox readiness",
        timeoutMs: readiness.timeoutMs,
        signal,
      });
    });
  }

  private waitForReadinessProbeEffect(input: {
    readonly command: readonly [string, ...string[]];
    readonly user: string | undefined;
    readonly intervalMs: number | undefined;
    readonly deadline: number;
    readonly phase: string;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
  }): Effect.Effect<void, unknown> {
    const [command, ...args] = input.command;
    let lastFailure = "probe has not run";
    const attempt: Effect.Effect<void, unknown> = Effect.gen(this, function* () {
      const now = yield* Clock.currentTimeMillis;
      if (now > input.deadline) return yield* timedOut();
      const state = yield* Effect.tryPromise({
        try: () => Promise.resolve(this.container?.inspect(
          input.signal === undefined ? undefined : { abortSignal: input.signal },
        )),
        catch: (error) => error,
      });
      if (state?.State?.Running !== true) {
        return yield* Effect.fail(new Error(
          `Docker sandbox exited before ${input.phase.toLowerCase()} completed ` +
          `(state=${state?.State?.Status ?? "missing"})`,
        ));
      }
      const probeNow = yield* Clock.currentTimeMillis;
      const result = yield* Effect.either(Effect.tryPromise({
        try: () => this.execCommand(command, args, {
          user: input.user,
          timeoutMs: Math.max(1, input.deadline - probeNow),
          timeoutRetirement: "stop",
          signal: input.signal,
        }),
        catch: (error) => error,
      }));
      if (result._tag === "Right") {
        if (result.right.exitCode === 0) return;
        lastFailure = result.right.stderr.trim() || result.right.stdout.trim() || `exit ${result.right.exitCode}`;
      } else {
        lastFailure = result.left instanceof Error ? result.left.message : String(result.left);
      }
      const afterAttempt = yield* Clock.currentTimeMillis;
      const remaining = input.deadline - afterAttempt;
      if (remaining <= 0) return yield* timedOut();
      yield* Effect.sleep(Math.min(input.intervalMs ?? 250, remaining));
      return yield* attempt;
    });
    const timedOut = (): Effect.Effect<never, Error> => {
      const diagnosticUser = input.user ?? this.imageDefaultUser ?? ROOT_USER;
      const permissionHelp = this.dockerAccess?.mode === "dind" && /permission denied/i.test(lastFailure)
        ? `; DinD user ${JSON.stringify(diagnosticUser)} must belong to the docker group ` +
          `(the inner socket remains root:docker 0660)`
        : "";
      return Effect.fail(new Error(
        `${input.phase} timed out after ${input.timeoutMs}ms: ${lastFailure}${permissionHelp}`,
      ));
    };
    return attempt;
  }

  /**
   * 探测 Sandbox 默认执行身份(`this.userOverride` 未设置时即容器/镜像的默认身份)的
   * uid、用户名与家目录:省略 `User` 字段的 exec 沿用容器默认身份,`$HOME` 由容器内
   * `/etc/passwd` 解析,不在 runner 侧维护一张 UID → 家目录的映射表。
   */
  private async resolveDefaultIdentity(signal?: AbortSignal): Promise<void> {
    const probe = await this.execCommand("sh", [
      "-c",
      'printf "%s\\n%s\\n%s" "$(id -u)" "$(id -un 2>/dev/null || true)" "$HOME"',
    ], {
      user: this.userOverride ??
        (this.dockerAccess?.mode === "dind" ? this.imageDefaultUser : undefined),
      signal,
    });
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
  private async ensureImage(imageName: string, signal?: AbortSignal): Promise<void> {
    try {
      const image = this.docker.getImage(imageName);
      await abortableProviderRead(image.inspect(
        signal === undefined ? {} : { abortSignal: signal } as Docker.ImageInspectOptions & {
          readonly abortSignal: AbortSignal;
        },
      ), signal);
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
  async ensureRunnerTools(signal?: AbortSignal): Promise<void> {
    const probe = await this.runCommandAsRoot("sh", ["-c", "command -v git >/dev/null 2>&1"], { signal });
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
    const result = await this.runCommandAsRoot("sh", ["-c", script], { signal });
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
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
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
    opts: {
      env?: globalThis.Record<string, string>;
      cwd?: string;
      user?: string;
      /** 这条命令的显式上限;省略 = 按 attempt deadline 的剩余量。 */
      timeoutMs?: number;
      /** create/readiness 失败需在删除前采集日志，因此只先停容器。 */
      timeoutRetirement?: "destroy" | "stop";
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
      ...(opts.signal === undefined ? {} : { abortSignal: opts.signal }),
    });

    const stream = await exec.start({
      hijack: true,
      stdin: false,
      ...(opts.signal === undefined ? {} : { abortSignal: opts.signal }),
    });

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
        const retirement = opts.timeoutRetirement === "stop"
          ? this.container?.stop({ t: 5 }).catch((stopError) => {
              if (!benignStopError(stopError)) throw stopError;
            }) ?? Promise.resolve()
          : this.stop();
        void retirement.then(() => reject(error), reject);
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

      const finish = async (known?: Awaited<ReturnType<typeof exec.inspect>>): Promise<void> => {
        if (settled) return;
        settled = true;
        cleanup();
        stream.destroy();
        try {
          await callbackChain;
          const inspection = known ?? await exec.inspect(
            opts.signal === undefined ? {} : { abortSignal: opts.signal },
          );
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
        void exec.inspect(opts.signal === undefined ? {} : { abortSignal: opts.signal }).then((inspection) => {
          if (!settled && inspection.Running === false && drainTimer === undefined) {
            drainTimer = setTimeout(() => { void finish(inspection); }, 100);
          }
        }).catch(() => undefined).finally(() => { pollInFlight = false; });
      }, 250);
      completionPoll.unref();

      stream.on("end", () => { void finish(); });

      stream.on("error", (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
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
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
    const localDir = resolveLocalPath(undefined, targetDir);
    const absTargetDir = resolveSandboxPath(this.workdir, sourceDir);
    const tarBuf = await this.readArchiveBytes(absTargetDir);
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
    const tarBuf = await this.readArchiveBytes(resolveSandboxPath(this.workdir, path));
    return extractFileFromTar(tarBuf);
  }

  /**
   * Docker getArchive 对 ReadonlyRootfs 容器中的 tmpfs 会错误返回 404，即使 exec 能看到文件。
   * readonly 模式改由容器内 tar，再把二进制归档编码成 ASCII 经 exec 流取回。
   */
  private async readArchiveBytes(absPath: string): Promise<Buffer> {
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
    if (this.resources.readOnlyRootfs !== true) {
      const stream = await (this.container as Docker.Container).getArchive({ path: absPath });
      return readableToBuffer(stream as NodeJS.ReadableStream);
    }
    const result = await this.runShell(
      `tar -C ${shellQuote(dirname(absPath))} -cf - -- ${shellQuote(basename(absPath))} | base64`,
      { user: ROOT_USER },
    );
    if (result.exitCode !== 0) {
      throw new Error(`failed to archive ${absPath} inside read-only Docker sandbox: ${result.stderr.trim()}`);
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
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
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
    if (!this.container) throw new Error(t("docker.containerNotInitialized"));
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
        void exec.inspect().then((value) => {
          if (value.Running === false) finish(value);
        }).catch(reject).finally(() => { pollInFlight = false; });
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

  private async captureSetupPrefixImage(
    labels: Readonly<Record<string, string>>,
    knownSensitiveValues: readonly string[],
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const eligibility = this.setupPrefixCacheEligibility();
    if (eligibility._tag === "Unsupported") throw new Error(eligibility.reason);
    const container = this.container;
    if (container === null) throw new Error("Docker setup-prefix staging container has already been released");

    if (this.dockerAccess?.mode === "dind") {
      const [command, ...args] = DIND_CAPTURE_QUIESCE_COMMAND;
      const quiesced = await this.runCommand(command, args, { user: ROOT_USER, timeoutMs: 20_000, signal });
      if (quiesced.exitCode !== 0) {
        throw new Error(
          `raw DinD could not gracefully stop inner containers/containerd/dockerd before capture: ` +
          `${quiesced.stderr.trim() || quiesced.stdout.trim() || `exit ${quiesced.exitCode}`}`,
        );
      }
    }

    try {
      await container.stop({ t: 5, abortSignal: signal });
    } catch (cause) {
      if (!benignStopError(cause)) throw cause;
    }
    signal.throwIfAborted();
    const stopped = await container.inspect({ abortSignal: signal });
    if (stopped.State?.Running === true) throw new Error("outer Docker staging container is still running after graceful stop");

    // Capture ordering is deliberate: inner daemon (above) → outer stop → host sync → commit.
    await execFileAsync("sync", [], { timeout: 30_000, signal });
    const changes = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `LABEL ${key}=${JSON.stringify(value)}`);
    const committed = await container.commit({ changes, abortSignal: signal }) as {
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
      const validationError = new Error("captured Docker image config/history contains a framework-known sensitive value");
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

  private async rebaseSetupPrefixImage(
    imageId: string,
    plannedContainerName: string,
    signal: AbortSignal,
  ): Promise<{ readonly containerId: string; readonly imageId: string }> {
    signal.throwIfAborted();
    const eligibility = this.setupPrefixCacheEligibility();
    if (eligibility._tag === "Unsupported") throw new Error(eligibility.reason);
    if (!/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error("setup-prefix restore requires an exact image id");

    // DestroyOnly is intentional: cached staging never runs normal teardown/after callbacks.
    await this.destroyCurrentContainer(false, signal);
    this.image = imageId;
    this.containerName = plannedContainerName;
    this.provisionToken = randomUUID();
    this.expiresAtMs = undefined;
    this.imageDefaultUser = undefined;
    this.defaultHome = "/root";
    this.defaultUserName = "root";
    this.defaultIsRoot = true;
    this.npmGlobalDir = "/root/.npm-global";
    this.sandboxPath = this.managedPath(this.npmGlobalDir);

    try {
      await this.initialize(signal);
      signal.throwIfAborted();
      const inspection = await this.container!.inspect({ abortSignal: signal });
      if (inspection.Image !== imageId) {
        throw new Error(`fresh private container uses ${inspection.Image}, expected exact image ${imageId}`);
      }
      return { containerId: inspection.Id, imageId: inspection.Image };
    } catch (cause) {
      const initializationError = signal.aborted ? cause : await this.withInitializationDiagnostics(cause);
      try {
        await this.destroyCurrentContainer(false);
      } catch (cleanupCause) {
        throw new AggregateError(
          [initializationError, cleanupCause],
          "Docker exact-image rebase failed and its partial container/network could not be fully removed",
        );
      }
      throw initializationError;
    }
  }

  private async recoverSetupPrefixCleanBase(
    signal: AbortSignal,
  ): Promise<{ readonly baseImageId: string; readonly sandboxId: string }> {
    const baseImageId = this.baseImageId;
    if (baseImageId === undefined || !/^sha256:[a-f0-9]{64}$/u.test(baseImageId)) {
      throw new Error("Docker sandbox has no verified exact Base image for clean recovery");
    }
    const recovered = await this.rebaseSetupPrefixImage(
      baseImageId,
      `niceeval-setup-prefix-recovery-${randomUUID()}`,
      signal,
    );
    return { baseImageId, sandboxId: recovered.containerId.slice(0, 12) };
  }

  private async destroyCurrentContainer(runAfterStop: boolean, operationSignal?: AbortSignal): Promise<void> {
    const cleanupSignal = operationSignal ?? AbortSignal.timeout(SETUP_PREFIX_PROVIDER_CLEANUP_TIMEOUT_MS);
    const container = this.container;
    if (container === null) {
      if (this.setupPrefixRoot !== undefined) {
        const root = this.setupPrefixRoot;
        await root.release();
        if (this.setupPrefixRoot === root) this.setupPrefixRoot = undefined;
      }
      return;
    }
    if (this.releaseMode === "detach") {
      this.container = null;
      this.network = null;
      if (runAfterStop) await this.afterStop?.();
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
    if (removed && this.container === container) this.container = null;
    if (removed && this.network !== null) {
      const network = this.network;
      try {
        await network.remove({ abortSignal: cleanupSignal } as {});
        if (this.network === network) this.network = null;
      } catch (error) {
        if (dockerStatusCode(error) === 404) {
          if (this.network === network) this.network = null;
        } else {
          cleanupErrors.push(error);
        }
      }
    }
    if (removed && this.setupPrefixRoot !== undefined) {
      const root = this.setupPrefixRoot;
      if (root.containerId !== container.id) {
        cleanupErrors.push(new Error("setup-prefix durable root belongs to a different Docker container"));
      } else {
        try {
          await root.release();
          if (this.setupPrefixRoot === root) this.setupPrefixRoot = undefined;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `failed to destroy Docker sandbox ${this.sandboxId}`);
    }
    if (runAfterStop) await this.afterStop?.();
  }

  /**
   * 释放句柄。`releaseMode: "destroy"`(默认 create 路径)显式 stop + remove;
   * `releaseMode: "detach"`(Compose 附着)只松绑——整组由 compose down 回收,避免主容器先被拆掉留下 sidecar 孤儿。
   */
  async stop(): Promise<void> {
    await this.destroyCurrentContainer(true);
  }

  /** Watchdog commit records container + exclusive network as one lifecycle unit. */
  get managedNetworkId(): string | undefined {
    return this.network?.id;
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
