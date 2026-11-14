import { sandboxCreationMetadata } from "../cloud-lifetime.ts";
import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { constants } from "node:os";
import { StringDecoder } from "node:string_decoder";
import type { DiagnosticInput } from "../../types.ts";
import { noSandboxBackendCapabilities, supportedBackendCapability, type SandboxProviderBackend } from "../backend.ts";
import { commandLimit, SandboxCommandTimeoutError } from "../deadline.ts";
import { registerSandboxContent, registeredSandboxContentSnapshotOf } from "../content.ts";
import { shellQuote } from "../shell.ts";
import { successfulCommandResult } from "../operations.ts";
import { directoryArchive, expandDirectory, extractDirectory, type DirectorySnapshot } from "./archive.ts";
import { resolveLocalPath, resolveSandboxPath } from "../paths.ts";
import type {
  CommandOptions,
  CommandResult,
  ManagedProcessStart,
  ManagedProcess,
  SandboxOperations,
} from "../types.ts";
import { INSTABOX_MACHINE_SPECS, type InstaboxSandboxOptions } from "../instabox.ts";
import { InstaboxApi, InstaboxApiError, Machine, Operation, Snapshot, SSHToken } from "./api.ts";
import { startInstaboxProcess } from "./process.ts";
import { InstaboxConnection } from "./connection.ts";

export class InstaboxBackend implements SandboxProviderBackend {
  readonly workdir = "/data/home/workspace";
  readonly otlpHost = null;
  readonly capabilities = {
    ...noSandboxBackendCapabilities,
    rootCommands: supportedBackendCapability(true as const),
    managedProcess: supportedBackendCapability((input: ManagedProcessStart) => this.startProcess(input)),
  };
  private token?: SSHToken;
  private stopped = false;
  private stopping?: Promise<void>;
  private connection?: InstaboxConnection;
  private retirementCause?: Error;
  private readonly deleteKey = randomUUID();

  private constructor(
    private readonly api: InstaboxApi,
    private readonly options: InstaboxSandboxOptions & { readonly lifetimeMs: number },
    private readonly operation: Operation,
    private readonly deadlineAt?: number,
    private readonly diagnostic: (input: DiagnosticInput) => void = () => {},
  ) {}

  get nativeInstanceId(): string {
    return this.instanceName;
  }
  private instanceName = "";
  get sandboxId(): string {
    return this.operation.machineId;
  }
  private get path(): string {
    return `/machines/${encodeURIComponent(this.sandboxId)}`;
  }

  static async create(
    options: InstaboxSandboxOptions & { readonly lifetimeMs: number },
    deadlineAt?: number,
    runId?: string,
    diagnostic?: (input: DiagnosticInput) => void,
    creationLabels?: Readonly<Record<string, string>>,
  ): Promise<InstaboxBackend> {
    if (options.lifetimeMs < 60_000 || options.lifetimeMs > 86_400_000)
      throw new Error("Instabox lifetimeMs must be between 60 seconds and 24 hours");
    const key = process.env.INSTABOX_API_KEY;
    if (!key) throw new Error("INSTABOX_API_KEY is required for Instabox");
    const api = new InstaboxApi(key);
    if (options.snapshotId !== undefined) {
      const snapshot = await api.json(Snapshot, `/snapshots/${encodeURIComponent(options.snapshotId)}`);
      if (snapshot.id !== options.snapshotId || snapshot.status !== "ready")
        throw new Error("Instabox snapshot must match the configured ID and be ready");
    }
    const idempotencyKey = randomUUID();
    const body = JSON.stringify({
      ...(options.snapshotId !== undefined
        ? { snapshotId: options.snapshotId }
        : { templateId: options.templateId ?? options.template ?? "universal" }),
      name: `niceeval-${idempotencyKey}`,
      ...(options.resources ?? INSTABOX_MACHINE_SPECS["4/8"]),
      deleteAfterSeconds: Math.ceil(options.lifetimeMs / 1000),
      autoSuspendAfterSeconds: 0,
      maxRunMinutes: -1,
      vault: false,
      secrets: [],
      metadata: { ...sandboxCreationMetadata(runId), ...creationLabels, "niceeval.provision": idempotencyKey },
    });
    const request = () =>
      api.json(Operation, "/machines", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body });
    let operation: Operation;
    try {
      operation = await request();
    } catch (cause) {
      if (cause instanceof InstaboxApiError && cause.status < 500) throw cause;
      // Replay only the same allocation identity, never allocate a second machine.
      try {
        operation = await request();
      } catch {
        throw new Error(
          "Instabox allocation could not be reconciled; the declared deletion deadline bounds any allocated Machine",
        );
      }
    }
    const backend = new InstaboxBackend(api, options, operation, deadlineAt, diagnostic);
    backend.instanceName = `niceeval-${idempotencyKey}`;
    return backend;
  }

  async initialize(signal: AbortSignal): Promise<void> {
    const limit = Math.max(1, Math.min(this.options.lifetimeMs, (this.deadlineAt ?? Infinity) - Date.now()));
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(limit)]);
    await this.api.wait(this.operation, bounded);
    const machine = await this.api.json(Machine, this.path, { signal: bounded });
    if (machine.id !== this.sandboxId || machine.state !== "running" || !machine.runtime.ready)
      throw new Error("Instabox Machine is not ready");
    this.token = await this.api.json(SSHToken, `${this.path}/ssh-tokens`, {
      method: "POST",
      body: JSON.stringify({ name: "niceeval-attempt", ttlSeconds: Math.ceil(this.options.lifetimeMs / 1000) }),
      signal: bounded,
    });
    if (this.token.machineId !== this.sandboxId) throw new Error("Instabox SSH grant belongs to another Machine");
    this.connection = new InstaboxConnection(this.token);
    const probe = await this.runShell(
      'test "$(uname -sm)" = "Linux x86_64" && getconf GNU_LIBC_VERSION && test "$(id -u)" != 0 && sudo -n true && git --version && mkdir -p /data/home/workspace',
      { cwd: "/data/home", signal: bounded },
    );
    if (probe.exitCode !== 0)
      throw new Error(
        `Instabox snapshot requires Linux x64 GNU, Node.js 22+, Bash, Git and a non-root user with passwordless sudo; exitCode: ${probe.exitCode}; stdout: ${probe.stdout}; stderr: ${probe.stderr}`,
      );
  }

  private async startProcess(input: ManagedProcessStart, root = false): Promise<ManagedProcess> {
    this.assertAvailable();
    if (this.stopped || this.stopping || this.token === undefined || this.connection === undefined)
      throw new Error("Instabox Machine is not available");
    return startInstaboxProcess({
      token: this.token,
      process: { ...input, cwd: resolveSandboxPath(this.workdir, input.cwd) },
      pathPrepend: this.options.pathPrepend ?? [],
      root,
      retire: (cause) => {
        this.retirementCause ??= cause;
        return this.stop();
      },
      connection: this.connection,
      diagnostic: this.diagnostic,
    });
  }

  async runCommand(
    command: string,
    args: readonly string[] = [],
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    this.assertAvailable();
    if (options.user !== undefined && options.user !== "root")
      throw new Error("Instabox supports only the snapshot login user or an explicit root override");
    options.signal?.throwIfAborted();
    const limit = commandLimit(options, { deadlineAt: this.deadlineAt });
    const timeout =
      limit.timeoutMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, Math.ceil(limit.timeoutMs)));
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), ...(timeout ? [timeout] : [])]);
    let rejectCancellation!: (cause: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    void cancelled.catch(() => undefined);
    const cancel = () => {
      const cause = timeout?.aborted
        ? new SandboxCommandTimeoutError("Instabox command timed out", limit.timeoutMs!, limit.explicit)
        : new Error("Instabox command cancelled");
      void this.stop().then(
        () => rejectCancellation(cause),
        (cleanup: unknown) =>
          rejectCancellation(new AggregateError([cause, cleanup], "Instabox cancellation cleanup failed")),
      );
    };
    signal.addEventListener("abort", cancel, { once: true });
    const execute = async (): Promise<CommandResult> => {
      const process = await this.startProcess(
        { argv: [command, ...args], cwd: options.cwd, env: options.env },
        options.user === "root",
      );
      await process.closeStdin();
      const stdoutDecoder = new StringDecoder("utf8"),
        stderrDecoder = new StringDecoder("utf8");
      let stdout = "",
        stderr = "";
      for await (const chunk of process.output) {
        if (chunk._tag === "Stdout") {
          const text = stdoutDecoder.write(Buffer.from(chunk.bytes));
          stdout += text;
          if (text) await options.onStdout?.(text);
        } else {
          const text = stderrDecoder.write(Buffer.from(chunk.bytes));
          stderr += text;
          if (text) await options.onStderr?.(text);
        }
      }
      const outTail = stdoutDecoder.end(),
        errTail = stderrDecoder.end();
      stdout += outTail;
      stderr += errTail;
      if (outTail) await options.onStdout?.(outTail);
      if (errTail) await options.onStderr?.(errTail);
      const result = await process.wait();
      const exitCode =
        result.exitCode ??
        (result.signal && result.signal in constants.signals
          ? 128 + constants.signals[result.signal as keyof typeof constants.signals]
          : undefined);
      if (exitCode === undefined) throw new Error("Instabox command exited without a numeric status or known signal");
      return { stdout, stderr, exitCode };
    };
    try {
      const result = await Promise.race([execute(), cancelled]);
      if (signal.aborted) return await cancelled;
      return result;
    } catch (cause) {
      if (signal.aborted) return await cancelled;
      try {
        await this.stop();
      } catch (cleanup) {
        const reason = this.retirementCause ?? cause;
        throw new AggregateError(
          [cause, cleanup],
          `${reason instanceof Error ? reason.message : String(reason)}; Machine cleanup failed`,
        );
      }
      throw cause;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  runShell(script: string, options?: CommandOptions): Promise<CommandResult> {
    return this.runCommand("bash", ["-c", script], options);
  }
  private assertAvailable(): void {
    if (this.retirementCause) throw this.retirementCause;
    if (this.stopped || this.stopping) throw new Error("Instabox Machine is not available");
  }
  private async fileRequest(...args: Parameters<InstaboxApi["request"]>): Promise<Response> {
    this.assertAvailable();
    try {
      return await this.api.request(...args);
    } catch (cause) {
      throw this.retirementCause ?? cause;
    }
  }
  async readBytes(path: string): Promise<Uint8Array> {
    const response = await this.fileRequest(
      `${this.path}/files/content?path=${encodeURIComponent(resolveSandboxPath(this.workdir, path))}`,
      {
        timeoutMs: 120_000,
      },
    );
    return new Uint8Array(await response.arrayBuffer());
  }
  async readText(path: string): Promise<string> {
    return Buffer.from(await this.readBytes(path)).toString("utf8");
  }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const timeoutMs = Math.max(60_000, Math.ceil(bytes.byteLength / (64 * 1024)) * 1000);
    const response = await this.fileRequest(
      `${this.path}/files?parents=true&path=${encodeURIComponent(resolveSandboxPath(this.workdir, path))}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: Buffer.from(bytes),
        timeoutMs,
      },
    );
    await response.arrayBuffer();
  }
  writeText(path: string, text: string): Promise<void> {
    return this.writeBytes(path, Buffer.from(text));
  }
  async pathExists(path: string): Promise<boolean> {
    try {
      const response = await this.fileRequest(
        `${this.path}/files?path=${encodeURIComponent(resolveSandboxPath(this.workdir, path))}`,
      );
      await response.arrayBuffer();
      return true;
    } catch (cause) {
      if (cause instanceof InstaboxApiError && cause.status === 404) {
        // Distinguish an absent file from a deleted Machine.
        this.assertAvailable();
        try {
          await this.api.json(Machine, this.path);
        } catch (error) {
          throw this.retirementCause ?? error;
        }
        return false;
      }
      throw cause;
    }
  }
  async uploadFile(source: string | URL, target: string): Promise<void> {
    this.assertAvailable();
    const body = await openAsBlob(resolveLocalPath(undefined, source));
    const response = await this.fileRequest(
      `${this.path}/files?parents=true&path=${encodeURIComponent(resolveSandboxPath(this.workdir, target))}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body,
        timeoutMs: Math.max(60_000, Math.ceil(body.size / (64 * 1024)) * 1000),
      },
    );
    await response.arrayBuffer();
  }
  async uploadDirectory(
    source: string | URL,
    target?: string,
    options: { readonly ignore?: readonly string[] } = {},
  ): Promise<void> {
    this.assertAvailable();
    const snapshot = registeredSandboxContentSnapshotOf(
      registerSandboxContent(resolveLocalPath(undefined, source), import.meta.url),
    );
    if (snapshot.kind !== "directory") throw new Error("uploadDirectory requires a directory");
    const ignored = new Set(options.ignore ?? []);
    await this.uploadContentDirectory(
      {
        ...snapshot,
        entries: snapshot.entries.filter((entry) => !entry.path.split("/").some((part) => ignored.has(part))),
      },
      resolveSandboxPath(this.workdir, target),
      {
        runCommandOrThrow: async (command, args) => successfulCommandResult(await this.runCommand(command, args)),
      },
    );
  }
  async uploadContentDirectory(
    snapshot: DirectorySnapshot,
    targetPath: string,
    commands: Pick<SandboxOperations, "runCommandOrThrow">,
  ): Promise<void> {
    this.assertAvailable();
    const id = randomUUID();
    const target = resolveSandboxPath(this.workdir, targetPath).replace(/\/+$/, "");
    if (!target) throw new Error("Cannot replace the filesystem root with a directory archive");
    const archive = `/tmp/niceeval-upload-${id}.tar`;
    const bytes = await directoryArchive(snapshot);
    await this.writeBytes(archive, bytes);
    const config = Buffer.from(
      JSON.stringify({
        target,
        archive,
        id,
        entries: snapshot.entries.map((entry) => ({ path: entry.path, kind: entry.kind })),
      }),
    ).toString("base64");
    await commands.runCommandOrThrow("node", ["-e", expandDirectory, config], { cwd: "/tmp" });
  }
  async downloadFile(source: string, target: string | URL): Promise<void> {
    this.assertAvailable();
    const destination = resolveLocalPath(undefined, target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await this.readBytes(source));
  }
  async downloadDirectory(
    source: string,
    target: string | URL,
    options: { readonly ignore?: readonly string[] } = {},
  ): Promise<void> {
    const remoteDir = resolveSandboxPath(this.workdir, source);
    // The archive is Machine-owned temporary data, reclaimed with its Scope.
    const archive = `/tmp/niceeval-download-${randomUUID()}.tar`;
    const result = await this.runShell(
      `tar --hard-dereference -cpf ${shellQuote(archive)} -C ${shellQuote(remoteDir)} .`,
    );
    successfulCommandResult(result);
    await extractDirectory(await this.readBytes(archive), resolveLocalPath(undefined, target), options.ignore ?? []);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    if (this.stopping) return this.stopping;
    const pending = this.deleteMachine();
    this.stopping = pending;
    try {
      await pending;
      this.stopped = true;
    } finally {
      if (this.stopping === pending) this.stopping = undefined;
    }
  }

  private async deleteMachine(): Promise<void> {
    const signal = AbortSignal.timeout(25_000);
    try {
      while (true) {
        signal.throwIfAborted();
        try {
          const operation = await this.api.json(Operation, this.path, {
            method: "DELETE",
            signal,
            headers: { "Idempotency-Key": this.deleteKey, "X-Confirm-Delete": this.sandboxId },
          });
          await this.api.wait(operation, signal);
          break;
        } catch (cause) {
          if (cause instanceof InstaboxApiError && cause.status === 404) break;
          if (!(cause instanceof InstaboxApiError && cause.code === "operation_conflict")) throw cause;
          const machine = await this.api.json(Machine, this.path, { signal });
          if (machine.operationId !== null) {
            const operation = await this.api.json(Operation, `/operations/${encodeURIComponent(machine.operationId)}`, {
              signal,
            });
            // A failed create still leaves a Machine requiring deletion.
            try {
              await this.api.wait(operation, signal);
            } catch {
              signal.throwIfAborted();
            }
          }
        }
      }
    } finally {
      this.connection?.close();
    }
  }
}
