import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import type {
  CommandOptions,
  CommandResult,
  ManagedProcess,
  ManagedProcessStart,
  SuccessfulCommandResult,
} from "../../types.ts";
import {
  noSandboxBackendCapabilities,
  supportedBackendCapability,
  type SandboxProviderBackend,
} from "../backend.ts";
import { commandLimit, SandboxCommandTimeoutError } from "../deadline.ts";
import { downloadDirectoryByList } from "../download-directory.ts";
import { collectLocalFiles } from "../local-files.ts";
import { ManagedProcessOutput } from "../managed-process.ts";
import { successfulCommandResult } from "../operations.ts";
import { resolveLocalPath, resolveSandboxPath } from "../paths.ts";
import { shellQuote } from "../shell.ts";
import { INCUS_UID, INCUS_USER, INCUS_WORKDIR } from "./descriptor.ts";
import type { IncusControl, IncusInstance } from "./control.ts";
import { INCUS_METADATA, parseIncusSizeBytes } from "./control.ts";
import { incusError } from "./errors.ts";
import type { AllocationIntent } from "./ledger.ts";
import {
  destroyAllocation,
  metadataMatchesIntent,
  volumeMetadataMatchesIntent,
  volumeNameFor,
} from "./ledger.ts";
import type { IncusRuntimePlan } from "./plan.ts";

const READINESS_TIMEOUT_MS = 180_000;
const FILESYSTEM_FORMAT_OVERHEAD_MIN = 256 * 1024 * 1024;
const FILESYSTEM_FORMAT_OVERHEAD_RATIO = 0.1;

export const INCUS_OTLP_HOST = null;

function executionEnvironment(
  mapped: { readonly user: number; readonly group: number },
  overrides: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const isRoot = mapped.user === 0;
  const user = isRoot ? "root" : INCUS_USER;
  return {
    HOME: isRoot ? "/root" : `/home/${INCUS_USER}`,
    USER: user,
    LOGNAME: user,
    ...overrides,
  };
}

function commandLabel(argv: readonly string[]): string {
  const raw = argv[0];
  if (raw === undefined || raw.trim() === "") return "command";
  return basename(raw);
}

export class IncusSandbox implements SandboxProviderBackend {
  readonly workdir = INCUS_WORKDIR;
  readonly sandboxId: string;
  readonly otlpHost = INCUS_OTLP_HOST;
  readonly capabilities = {
    ...noSandboxBackendCapabilities,
    rootCommands: supportedBackendCapability(true as const),
    managedProcess: supportedBackendCapability((input: ManagedProcessStart) => this.startManagedProcess(input)),
  };

  private retired = false;
  private retirement: Promise<void> | undefined;
  private deadlineAt?: number;

  constructor(
    private readonly control: IncusControl,
    private readonly plan: IncusRuntimePlan,
    private readonly instanceName: string,
    readonly allocation: AllocationIntent,
    private readonly commandTimeoutMs: number | undefined,
    deadlineAt?: number,
  ) {
    this.sandboxId = instanceName;
    this.deadlineAt = deadlineAt;
  }

  private mapUser(user: string | undefined): { readonly user: number; readonly group: number } {
    const requested = user ?? INCUS_USER;
    if (requested === "root" || requested === "0") return { user: 0, group: 0 };
    if (requested === INCUS_USER || requested === "1000") return { user: INCUS_UID, group: INCUS_UID };
    throw new Error(
      `Incus sandbox only maps user "root" or configured ${INCUS_USER} (uid ${INCUS_UID}); ${JSON.stringify(requested)} is not supported`,
    );
  }

  private async killProcessGroup(pgid: number): Promise<boolean> {
    const result = await this.control.exec(
      this.plan.project,
      this.instanceName,
      ["sh", "-c", "kill -KILL \"$1\"", "sh", `-${pgid}`],
      { user: 0, group: 0, timeoutMs: 10_000 },
    );
    return result.exitCode === 0;
  }

  private async retireProven(): Promise<void> {
    await this.retire();
  }

  private async execArgv(
    argv: readonly [string, ...string[]],
    opts: CommandOptions = {},
  ): Promise<CommandResult> {
    const limit = commandLimit(opts, { commandTimeoutMs: this.commandTimeoutMs, deadlineAt: this.deadlineAt });
    const mapped = this.mapUser(opts.user);
    const marker = `__niceeval_incus_pgid_${randomUUID().replaceAll("-", "")}__`;
    const wrapped = [
      "setsid",
      "--wait",
      "sh",
      "-c",
      `printf '%s%s\\n' "$1" "$$" >&2; shift; exec "$@"`,
      "niceeval-incus-exec",
      marker,
      ...argv,
    ];
    const spawned = this.control.spawnExec(this.plan.project, this.instanceName, wrapped, {
      cwd: resolveSandboxPath(this.workdir, opts.cwd),
      env: executionEnvironment(mapped, opts.env),
      user: mapped.user,
      group: mapped.group,
    });
    let pgid: number | undefined;
    let stdout = "";
    let stderr = "";
    let stderrPrefix = "";
    let callbackChain = Promise.resolve();
    const enqueue = (handler: ((chunk: string) => void | Promise<void>) | undefined, text: string): void => {
      if (handler === undefined || text.length === 0) return;
      callbackChain = callbackChain.then(() => handler(text));
    };
    spawned.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      enqueue(opts.onStdout, text);
    });
    spawned.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (pgid !== undefined) {
        stderr += text;
        enqueue(opts.onStderr, text);
        return;
      }
      stderrPrefix += text;
      const newline = stderrPrefix.indexOf("\n");
      if (newline < 0) return;
      const first = stderrPrefix.slice(0, newline);
      const rest = stderrPrefix.slice(newline + 1);
      if (first.startsWith(marker) && /^\d+$/.test(first.slice(marker.length))) {
        pgid = Number(first.slice(marker.length));
      } else {
        stderr += `${first}\n`;
        enqueue(opts.onStderr, `${first}\n`);
      }
      if (rest.length > 0) {
        stderr += rest;
        enqueue(opts.onStderr, rest);
      }
      stderrPrefix = "";
    });

    const terminateTree = async (): Promise<boolean> => {
      spawned.killHost();
      if (pgid === undefined) return false;
      return this.killProcessGroup(pgid);
    };

    return await new Promise<CommandResult>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timeout !== undefined) clearTimeout(timeout);
        opts.signal?.removeEventListener("abort", onAbort);
      };
      const flushStderrTail = (): void => {
        if (stderrPrefix.length === 0) return;
        stderr += stderrPrefix;
        enqueue(opts.onStderr, stderrPrefix);
        stderrPrefix = "";
      };
      const settleOk = (exitCode: number): void => {
        if (settled) return;
        settled = true;
        cleanup();
        flushStderrTail();
        void callbackChain.then(
          () => resolve({ stdout, stderr, exitCode }),
          (cause: unknown) => reject(cause),
        );
      };
      const settleErr = (reason: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        flushStderrTail();
        void (async () => {
          try {
            const proven = await terminateTree();
            if (!proven) await this.retireProven();
          } catch {
            // Keep the original Timeout/Abort as the settlement; destroy errors stay on retry.
          }
          await callbackChain.catch(() => undefined);
          reject(reason);
        })();
      };
      const onAbort = (): void => {
        settleErr(opts.signal?.reason instanceof Error
          ? opts.signal.reason
          : new DOMException("sandbox command aborted", "AbortError"));
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      const timeoutMs = limit.timeoutMs;
      if (timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          settleErr(new SandboxCommandTimeoutError(
            `Incus ${commandLabel(argv)} timed out after ${timeoutMs}ms`,
            timeoutMs,
            limit.explicit,
          ));
        }, timeoutMs);
      }
      void spawned.wait().then(settleOk, settleErr);
    });
  }

  private async startManagedProcess(input: ManagedProcessStart): Promise<ManagedProcess> {
    const mapped = this.mapUser(INCUS_USER);
    const marker = `__niceeval_incus_pgid_${randomUUID().replaceAll("-", "")}__`;
    const [command, ...args] = input.argv;
    const wrapped = [
      "setsid",
      "--wait",
      "sh",
      "-c",
      `printf '%s%s\\n' "$1" "$$" >&2; shift; exec "$@"`,
      "niceeval-incus-process",
      marker,
      command,
      ...args,
    ];
    const spawned = this.control.spawnExec(this.plan.project, this.instanceName, wrapped, {
      cwd: resolveSandboxPath(this.workdir, input.cwd),
      env: executionEnvironment(mapped, input.env),
      user: mapped.user,
      group: mapped.group,
      keepStdin: true,
    });
    const output = new ManagedProcessOutput();
    let pgid: number | undefined;
    let stderrPrefix = Buffer.alloc(0);
    spawned.stdout.on("data", (bytes: Buffer) => {
      output.push({ _tag: "Stdout", bytes: new Uint8Array(bytes) });
    });
    spawned.stderr.on("data", (bytes: Buffer) => {
      if (pgid !== undefined) {
        output.push({ _tag: "Stderr", bytes: new Uint8Array(bytes) });
        return;
      }
      stderrPrefix = Buffer.concat([stderrPrefix, bytes]);
      const newline = stderrPrefix.indexOf(10);
      if (newline < 0) return;
      const first = stderrPrefix.subarray(0, newline).toString("utf8");
      const rest = stderrPrefix.subarray(newline + 1);
      if (first.startsWith(marker) && /^\d+$/.test(first.slice(marker.length))) {
        pgid = Number(first.slice(marker.length));
      } else {
        output.push({ _tag: "Stderr", bytes: new Uint8Array(stderrPrefix.subarray(0, newline + 1)) });
      }
      if (rest.length > 0) output.push({ _tag: "Stderr", bytes: new Uint8Array(rest) });
      stderrPrefix = Buffer.alloc(0);
    });
    const flushStderrPrefix = (): void => {
      if (stderrPrefix.length === 0) return;
      output.push({ _tag: "Stderr", bytes: new Uint8Array(stderrPrefix) });
      stderrPrefix = Buffer.alloc(0);
    };
    const exit = spawned.wait().then((exitCode) => {
      flushStderrPrefix();
      output.end();
      return { exitCode } as const;
    }, async (error: unknown) => {
      flushStderrPrefix();
      output.end();
      throw error;
    });
    let closeReceipt: Promise<void> | undefined;
    let terminateReceipt: Promise<void> | undefined;
    let stdinState: "open" | "closing" | "closed" = "open";
    return {
      output,
      writeStdin: (bytes) => new Promise<void>((resolve, reject) => {
        if (stdinState !== "open") {
          reject(new Error("managed process stdin is closed"));
          return;
        }
        spawned.stdin.write(Buffer.from(bytes), (error?: Error | null) => error ? reject(error) : resolve());
      }),
      closeStdin: () => closeReceipt ??= new Promise<void>((resolve) => {
        stdinState = "closing";
        spawned.stdin.end(() => {
          stdinState = "closed";
          resolve();
        });
      }),
      wait: () => exit,
      terminate: () => terminateReceipt ??= (async () => {
        stdinState = "closing";
        if (pgid === undefined) {
          spawned.killHost();
          await this.retireProven();
          throw new Error("Incus managed process did not disclose its process-group identity; the VM was destroyed");
        }
        const proven = await this.killProcessGroup(pgid);
        spawned.killHost();
        if (!proven) {
          await this.retireProven();
          throw new Error(`Incus could not prove process group ${pgid} terminated; the VM was destroyed`);
        }
        await exit.catch(() => undefined);
      })(),
    };
  }

  async runCommand(cmd: string, args: readonly string[] = [], opts: CommandOptions = {}): Promise<CommandResult> {
    return this.execArgv([cmd, ...args], opts);
  }

  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    return this.execArgv(["bash", "-lc", script], opts);
  }

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
    return Buffer.from(await this.readBytes(path)).toString("utf8");
  }

  async writeText(path: string, content: string): Promise<void> {
    await this.writeBytes(path, Buffer.from(content, "utf8"));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return this.control.pullFile(this.plan.project, this.instanceName, resolveSandboxPath(this.workdir, path));
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    const abs = resolveSandboxPath(this.workdir, path);
    await this.runCommand("mkdir", ["-p", dirname(abs)], { user: "root" });
    await this.control.pushFile(this.plan.project, this.instanceName, abs, content, {
      uid: INCUS_UID,
      gid: INCUS_UID,
      mode: "0644",
    });
  }

  async pathExists(path: string): Promise<boolean> {
    const result = await this.runCommand("test", ["-e", resolveSandboxPath(this.workdir, path)]);
    return result.exitCode === 0;
  }

  async uploadFile(source: string | URL, targetPath: string): Promise<void> {
    await this.writeBytes(targetPath, await readFile(resolveLocalPath(undefined, source)));
  }

  async uploadDirectory(
    sourceDir: string | URL,
    targetDir?: string,
    options: { readonly ignore?: readonly string[] } = {},
  ): Promise<void> {
    const files = await collectLocalFiles(resolveLocalPath(undefined, sourceDir), options.ignore);
    const base = resolveSandboxPath(this.workdir, targetDir);
    for (const file of files) {
      await this.writeBytes(resolveSandboxPath(base, file.path), file.content);
    }
  }

  async downloadFile(sourcePath: string, target: string | URL): Promise<void> {
    const destination = resolveLocalPath(undefined, target);
    const parent = dirname(destination);
    await mkdir(parent, { recursive: true });
    try {
      const existing = await lstat(destination);
      if (existing.isSymbolicLink()) {
        throw new Error(`downloadFile refuses existing symlink ${JSON.stringify(destination)}`);
      }
    } catch (cause) {
      const code = cause !== null && typeof cause === "object" && "code" in cause
        ? String((cause as { readonly code?: unknown }).code)
        : "";
      if (code !== "ENOENT") throw cause;
    }
    const parentReal = await realpath(parent);
    const resolvedDest = resolve(parentReal, basename(destination));
    await writeFile(resolvedDest, await this.readBytes(sourcePath));
  }

  async downloadDirectory(
    sourceDir: string,
    targetDir: string | URL,
    options: { readonly ignore?: readonly string[] } = {},
  ): Promise<void> {
    const remoteDir = resolveSandboxPath(this.workdir, sourceDir);
    await downloadDirectoryByList({
      localDir: resolveLocalPath(undefined, targetDir),
      ignore: options.ignore ?? [],
      runShell: (script) => this.runShell(script, { cwd: remoteDir }),
      readOne: (relPath) => this.readBytes(`${remoteDir}/${relPath}`),
    });
  }

  async stop(): Promise<void> {
    await this.retire();
  }

  private retire(): Promise<void> {
    if (this.retired) return Promise.resolve();
    if (this.retirement !== undefined) return this.retirement;
    const attempt = destroyAllocation(this.control, this.allocation, this.plan.project).then(
      () => {
        this.retired = true;
        if (this.retirement === attempt) this.retirement = undefined;
      },
      (error: unknown) => {
        if (this.retirement === attempt) this.retirement = undefined;
        throw error;
      },
    );
    this.retirement = attempt;
    return attempt;
  }
}

function parseUid(text: string): number | undefined {
  const match = /^\s*(\d+)\s*$/m.exec(text);
  if (match === null || match[1] === undefined) return undefined;
  return Number(match[1]);
}

export function cappedReadinessTimeoutMs(deadlineAt: number | undefined): number {
  if (deadlineAt === undefined) return READINESS_TIMEOUT_MS;
  return Math.max(1, Math.min(READINESS_TIMEOUT_MS, deadlineAt - Date.now()));
}

export async function waitForReadiness(
  control: IncusControl,
  plan: IncusRuntimePlan,
  instanceName: string,
  intent: AllocationIntent,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "guest agent not ready";
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Incus readiness aborted");
    const instance = await control.getInstance(plan.project, instanceName);
    if (instance === undefined) {
      throw incusError(
        "sandbox-allocation-lost",
        `Incus instance ${JSON.stringify(instanceName)} disappeared before readiness.`,
        ["Inspect Incus inventory; do not recreate from a guessed locator."],
      );
    }
    if (instance.status.toLowerCase() !== "running") {
      last = `instance status ${instance.status}`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    // Images can be published after their original multi-user target was
    // already reached. A cloned VM then sees the enabled unit but systemd does
    // not replay that target transaction. Readiness explicitly starts the
    // idempotent guest-init unit so both base and artifact clones converge.
    const guestInit = await control.exec(
      plan.project,
      instanceName,
      ["systemctl", "start", "niceeval-docker-data.service"],
      { user: 0, group: 0, timeoutMs: 60_000, signal },
    );
    if (guestInit.exitCode !== 0) {
      last = guestInit.stderr.trim() || guestInit.stdout.trim() || "Docker data guest-init failed";
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const workspace = await control.exec(
      plan.project,
      instanceName,
      ["bash", "-lc", `mkdir -p ${shellQuote(INCUS_WORKDIR)} && chown ${INCUS_UID}:${INCUS_UID} ${shellQuote(INCUS_WORKDIR)}`],
      { user: 0, group: 0, timeoutMs: 15_000, signal },
    );
    if (workspace.exitCode !== 0) {
      last = workspace.stderr.trim() || workspace.stdout.trim() || "workspace mkdir failed";
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const identity = await control.exec(
      plan.project,
      instanceName,
      ["id", "-u"],
      { cwd: INCUS_WORKDIR, user: INCUS_UID, group: INCUS_UID, timeoutMs: 10_000, signal },
    );
    if (identity.exitCode !== 0 || parseUid(identity.stdout) !== INCUS_UID) {
      last = `guest user is not uid ${INCUS_UID}`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const info = await control.exec(
      plan.project,
      instanceName,
      ["bash", "-lc", "printf 'HOST=%s\\n' \"${DOCKER_HOST:-}\"; docker info; docker compose version"],
      { cwd: INCUS_WORKDIR, user: INCUS_UID, group: INCUS_UID, timeoutMs: 30_000, signal },
    );
    if (info.exitCode !== 0) {
      last = info.stderr.trim() || info.stdout.trim() || "docker info failed";
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    const host = /^HOST=(.*)$/m.exec(info.stdout)?.[1] ?? "";
    if (host !== "" && host !== "unix:///var/run/docker.sock") {
      throw incusError(
        "sandbox-readiness-failed",
        "Guest Docker is not sandbox-private.",
        ["Use a trusted Incus image whose dockerd listens on the guest Unix socket only."],
      );
    }
    if (!/Server Version:/i.test(info.stdout) && !/server version/i.test(info.stdout)) {
      last = "docker info did not report a server version";
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (!/Docker Compose version v?2/i.test(info.stdout + info.stderr)
      && !/compose version v?2/i.test(info.stdout + info.stderr)
    ) {
      throw incusError(
        "sandbox-readiness-failed",
        "Guest docker compose version is not v2.",
        ["Publish a trusted image that includes Docker Compose v2."],
      );
    }
    if (plan.executionDomain === "reference") {
      await assertReferenceReadiness(control, plan, instanceName, intent, instance);
    }
    return;
  }
  throw incusError(
    "sandbox-readiness-failed",
    `Incus guest did not become ready before timeout: ${last}`,
    ["Inspect the VM console via Incus; NiceEval will destroy the allocation."],
  );
}

async function assertReferenceReadiness(
  control: IncusControl,
  plan: IncusRuntimePlan,
  instanceName: string,
  intent: AllocationIntent,
  instance: IncusInstance,
): Promise<void> {
  if (!metadataMatchesIntent(instance, intent)) {
    throw incusError(
      "sandbox-readiness-failed",
      "Incus instance metadata did not match the allocation identity at readiness.",
      ["Destroy the instance and retry; do not adopt an object with mismatched generation."],
    );
  }
  const expectedVolume = intent.dockerDataVolume ?? volumeNameFor(intent.allocationId);
  const device = instance.expandedDevices?.dockerdata;
  if (
    device === undefined
    || device.type !== "disk"
    || device.pool !== plan.storagePool
    || device.source !== expectedVolume
  ) {
    throw incusError(
      "sandbox-readiness-failed",
      "Reference allocation is missing the dedicated Docker data disk identity (pool/source).",
      ["Attach a private custom volume with pool+source; non-root disk size is not a valid Incus identity."],
    );
  }
  if (plan.storage === "dedicated-block" && device.path !== undefined && device.path !== "") {
    throw incusError(
      "sandbox-readiness-failed",
      "Reference block Docker data disk must be attached without a guest path; guest-init mounts it.",
      ["Do not set path on a block custom volume disk device."],
    );
  }
  if (plan.storage !== "dedicated-block" && device.path !== "/var/lib/docker") {
    throw incusError(
      "sandbox-readiness-failed",
      "Filesystem Docker data volume must be attached at /var/lib/docker.",
      ["Attach the custom filesystem volume with path=/var/lib/docker."],
    );
  }
  const volume = await control.getVolume(plan.project, plan.storagePool, expectedVolume);
  if (volume === undefined || !volumeMetadataMatchesIntent(volume, intent)) {
    throw incusError(
      "sandbox-readiness-failed",
      "Docker data volume metadata did not match allocation identity at readiness.",
      ["Destroy the allocation; do not adopt a volume with mismatched generation."],
    );
  }
  const volumeSize = parseIncusSizeBytes(volume.config.size);
  if (volumeSize !== plan.allocatedDockerDataBytes) {
    throw incusError(
      "sandbox-readiness-failed",
      "Docker data volume size does not match the allocated Docker data bytes.",
      ["Attest pool/source/allocation/generation/size together; pathname or pool total is not enough."],
    );
  }
  const proof = await control.exec(
    plan.project,
    instanceName,
    [
      "bash",
      "-lc",
      [
        `test "$(stat -c %u ${shellQuote(INCUS_WORKDIR)})" = ${INCUS_UID}`,
        "python3 -c 'import os, json; st = os.statvfs(\"/var/lib/docker\"); print(json.dumps({\"blocks\": st.f_blocks, \"frsize\": st.f_frsize, \"total\": st.f_blocks * st.f_frsize, \"bavail\": st.f_bavail}))'",
        "docker ps -aq | awk 'END{exit (NR==0)?0:1}'",
        "docker volume ls -q | awk 'END{exit (NR==0)?0:1}'",
      ].join(" && "),
    ],
    { user: INCUS_UID, group: INCUS_UID, timeoutMs: 20_000 },
  );
  if (proof.exitCode !== 0) {
    throw incusError(
      "sandbox-readiness-failed",
      "Reference readiness could not prove allocation identity, quota, or empty Docker runtime.",
      ["Inspect guest docker and the dedicated data disk; NiceEval will not mark the sandbox ready."],
    );
  }
  let parsed: { total?: number };
  try {
    parsed = JSON.parse(proof.stdout.trim().split("\n").at(-1) ?? "") as { total?: number };
  } catch {
    throw incusError(
      "sandbox-readiness-failed",
      "Reference readiness could not parse guest statfs proof.",
      ["The trusted image must provide python3 for capacity attestation."],
    );
  }
  const allocated = plan.allocatedDockerDataBytes;
  const overhead = Math.max(FILESYSTEM_FORMAT_OVERHEAD_MIN, Math.floor(allocated * FILESYSTEM_FORMAT_OVERHEAD_RATIO));
  if (typeof parsed.total !== "number" || parsed.total > allocated || parsed.total + overhead < allocated) {
    throw incusError(
      "sandbox-readiness-failed",
      "Guest statfs total size does not prove the allocated Docker data disk (formatting overhead excluded from available space).",
      ["Compare filesystem total to the allocated volume size; do not treat bavail as capacity."],
    );
  }
  const gen = instance.config[INCUS_METADATA.generation];
  const allocationId = instance.config[INCUS_METADATA.allocationId];
  if (gen !== String(intent.generation) || allocationId !== intent.allocationId) {
    throw incusError(
      "sandbox-readiness-failed",
      "Guest allocation/generation metadata is missing at readiness.",
      ["Round-trip allocation metadata before handing the sandbox to the Agent."],
    );
  }
}
