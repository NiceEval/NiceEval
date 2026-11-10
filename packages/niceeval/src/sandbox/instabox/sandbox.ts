import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Client } from "ssh2";
import { noSandboxBackendCapabilities, supportedBackendCapability, type SandboxProviderBackend } from "../backend.ts";
import { commandLimit, SandboxCommandTimeoutError } from "../deadline.ts";
import { collectLocalFiles } from "../local-files.ts";
import { downloadDirectoryByList } from "../download-directory.ts";
import { resolveLocalPath, resolveSandboxPath } from "../paths.ts";
import type { CommandOptions, CommandResult, ManagedProcessStart, ManagedProcess } from "../types.ts";
import { INSTABOX_MACHINE_SPECS, type InstaboxSandboxOptions } from "../instabox.ts";
import { InstaboxApi, InstaboxApiError, Machine, Operation, Snapshot, SSHToken } from "./api.ts";
import { startInstaboxProcess } from "./process.ts";

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
  private readonly clients = new Set<Client>();
  private readonly deleteKey = randomUUID();

  private constructor(
    private readonly api: InstaboxApi,
    private readonly options: InstaboxSandboxOptions,
    private readonly operation: Operation,
    private readonly deadlineAt?: number,
  ) {}

  get sandboxId(): string { return this.operation.machineId; }
  private get path(): string { return `/machines/${encodeURIComponent(this.sandboxId)}`; }

  static async create(options: InstaboxSandboxOptions, deadlineAt?: number): Promise<InstaboxBackend> {
    const key = process.env.INSTABOX_API_KEY;
    if (!key) throw new Error("INSTABOX_API_KEY is required for Instabox");
    const api = new InstaboxApi(key);
    if (options.snapshotId !== undefined) {
      const snapshot = await api.json(Snapshot, `/snapshots/${encodeURIComponent(options.snapshotId)}`);
      if (snapshot.id !== options.snapshotId || snapshot.status !== "ready") throw new Error("Instabox snapshot must match the configured ID and be ready");
    }
    const idempotencyKey = randomUUID();
    const body = JSON.stringify({
      ...(options.snapshotId !== undefined ? { snapshotId: options.snapshotId } : { templateId: options.templateId ?? options.template ?? "universal" }),
      name: `niceeval-${idempotencyKey}`,
      ...(options.resources ?? INSTABOX_MACHINE_SPECS["4/8"]),
      deleteAfterSeconds: options.lifetimeMs / 1000,
      autoSuspendAfterSeconds: 0, maxRunMinutes: -1,
      vault: false, secrets: [],
      metadata: { "niceeval.provision": idempotencyKey },
    });
    const request = () => api.json(Operation, "/machines", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body });
    let operation: Operation;
    try { operation = await request(); }
    catch (cause) {
      if (cause instanceof InstaboxApiError && cause.status < 500) throw cause;
      // Replay only the same allocation identity, never allocate a second machine.
      try { operation = await request(); }
      catch { throw new Error("Instabox allocation could not be reconciled; the declared deletion deadline bounds any allocated Machine"); }
    }
    return new InstaboxBackend(api, options, operation, deadlineAt);
  }

  async initialize(signal: AbortSignal): Promise<void> {
    const limit = Math.max(1, Math.min(this.options.lifetimeMs, (this.deadlineAt ?? Infinity) - Date.now()));
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(limit)]);
    await this.api.wait(this.operation, bounded);
    const machine = await this.api.json(Machine, this.path, { signal: bounded });
    if (machine.id !== this.sandboxId || machine.state !== "running" || !machine.runtime.ready) throw new Error("Instabox Machine is not ready");
    this.token = await this.api.json(SSHToken, `${this.path}/ssh-tokens`, {
      method: "POST", body: JSON.stringify({ name: "niceeval-attempt", ttlSeconds: this.options.lifetimeMs / 1000 }), signal: bounded,
    });
    if (this.token.machineId !== this.sandboxId) throw new Error("Instabox SSH grant belongs to another Machine");
    const probe = await this.runShell('test "$(uname -sm)" = "Linux x86_64" && getconf GNU_LIBC_VERSION && test "$(id -u)" != 0 && sudo -n true && git --version && mkdir -p /data/home/workspace', { cwd: "/data/home", signal: bounded });
    if (probe.exitCode !== 0) throw new Error(`Instabox snapshot requires Linux x64 GNU, Node.js 22+, Bash, Git and a non-root user with passwordless sudo; exitCode: ${probe.exitCode}; stdout: ${probe.stdout}; stderr: ${probe.stderr}`);
  }

  private async startProcess(input: ManagedProcessStart, root = false): Promise<ManagedProcess> {
    if (this.stopped || this.stopping || this.token === undefined) throw new Error("Instabox Machine is not available");
    return startInstaboxProcess({
      token: this.token, process: { ...input, cwd: resolveSandboxPath(this.workdir, input.cwd) },
      pathPrepend: this.options.pathPrepend ?? [], root, retire: () => this.stop(),
      register: (client) => { this.clients.add(client); return () => this.clients.delete(client); },
    });
  }

  async runCommand(command: string, args: readonly string[] = [], options: CommandOptions = {}): Promise<CommandResult> {
    if (options.user !== undefined && options.user !== "root") throw new Error("Instabox supports only the snapshot login user or an explicit root override");
    options.signal?.throwIfAborted();
    const limit = commandLimit(options, { deadlineAt: this.deadlineAt });
    const timeout = limit.timeoutMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, Math.ceil(limit.timeoutMs)));
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), ...(timeout ? [timeout] : [])]);
    let rejectCancellation!: (cause: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    void cancelled.catch(() => undefined);
    const cancel = () => {
      const cause = timeout?.aborted
        ? new SandboxCommandTimeoutError("Instabox command timed out", limit.timeoutMs!, limit.explicit)
        : new Error("Instabox command cancelled");
      void this.stop().then(() => rejectCancellation(cause), (cleanup: unknown) => rejectCancellation(new AggregateError([cause, cleanup], "Instabox cancellation cleanup failed")));
    };
    signal.addEventListener("abort", cancel, { once: true });
    const execute = async (): Promise<CommandResult> => {
      const process = await this.startProcess({ argv: [command, ...args], cwd: options.cwd, env: options.env }, options.user === "root");
      await process.closeStdin();
      const stdoutDecoder = new StringDecoder("utf8"), stderrDecoder = new StringDecoder("utf8");
      let stdout = "", stderr = "";
      for await (const chunk of process.output) {
        if (chunk._tag === "Stdout") { const text = stdoutDecoder.write(Buffer.from(chunk.bytes)); stdout += text; if (text) await options.onStdout?.(text); }
        else { const text = stderrDecoder.write(Buffer.from(chunk.bytes)); stderr += text; if (text) await options.onStderr?.(text); }
      }
      const outTail = stdoutDecoder.end(), errTail = stderrDecoder.end();
      stdout += outTail; stderr += errTail;
      if (outTail) await options.onStdout?.(outTail);
      if (errTail) await options.onStderr?.(errTail);
      const result = await process.wait();
      if (result.exitCode === null) throw new Error("Instabox command exited without a numeric status");
      return { stdout, stderr, exitCode: result.exitCode };
    };
    try {
      const result = await Promise.race([execute(), cancelled]);
      if (signal.aborted) return await cancelled;
      return result;
    } catch (cause) {
      if (signal.aborted) return await cancelled;
      await this.stop();
      throw cause;
    } finally { signal.removeEventListener("abort", cancel); }
  }

  runShell(script: string, options?: CommandOptions): Promise<CommandResult> { return this.runCommand("bash", ["-c", script], options); }
  async readBytes(path: string): Promise<Uint8Array> {
    const response = await this.api.request(`${this.path}/files/content?path=${encodeURIComponent(resolveSandboxPath(this.workdir, path))}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  async readText(path: string): Promise<string> { return Buffer.from(await this.readBytes(path)).toString("utf8"); }
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const response = await this.api.request(`${this.path}/files?parents=true&path=${encodeURIComponent(resolveSandboxPath(this.workdir, path))}`, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from(bytes),
    });
    await response.arrayBuffer();
  }
  writeText(path: string, text: string): Promise<void> { return this.writeBytes(path, Buffer.from(text)); }
  async pathExists(path: string): Promise<boolean> {
    try {
      const response = await this.api.request(`${this.path}/files?path=${encodeURIComponent(resolveSandboxPath(this.workdir, path))}`);
      await response.arrayBuffer();
      return true;
    } catch (cause) {
      if (cause instanceof InstaboxApiError && cause.status === 404) {
        // Distinguish an absent file from a deleted Machine.
        await this.api.json(Machine, this.path);
        return false;
      }
      throw cause;
    }
  }
  async uploadFile(source: string | URL, target: string): Promise<void> { await this.writeBytes(target, await readFile(resolveLocalPath(undefined, source))); }
  async uploadDirectory(source: string | URL, target?: string, options: { readonly ignore?: readonly string[] } = {}): Promise<void> {
    for (const file of await collectLocalFiles(resolveLocalPath(undefined, source), options.ignore)) await this.writeBytes(resolveSandboxPath(resolveSandboxPath(this.workdir, target), file.path), file.content);
  }
  async downloadFile(source: string, target: string | URL): Promise<void> {
    const destination = resolveLocalPath(undefined, target);
    await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, await this.readBytes(source));
  }
  downloadDirectory(source: string, target: string | URL, options: { readonly ignore?: readonly string[] } = {}): Promise<void> {
    const remoteDir = resolveSandboxPath(this.workdir, source);
    return downloadDirectoryByList({ localDir: resolveLocalPath(undefined, target), ignore: options.ignore ?? [],
      runShell: (script) => this.runShell(script, { cwd: remoteDir }), readOne: (path) => this.readBytes(`${remoteDir}/${path}`) });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    if (this.stopping) return this.stopping;
    const pending = this.deleteMachine();
    this.stopping = pending;
    try { await pending; this.stopped = true; }
    finally { if (this.stopping === pending) this.stopping = undefined; }
  }

  private async deleteMachine(): Promise<void> {
    const signal = AbortSignal.timeout(25_000);
    try {
      while (true) {
        signal.throwIfAborted();
        try {
          const operation = await this.api.json(Operation, this.path, {
            method: "DELETE", signal,
            headers: { "Idempotency-Key": this.deleteKey, "X-Confirm-Delete": this.sandboxId },
          });
          await this.api.wait(operation, signal);
          break;
        } catch (cause) {
          if (cause instanceof InstaboxApiError && cause.status === 404) break;
          if (!(cause instanceof InstaboxApiError && cause.code === "operation_conflict")) throw cause;
          const machine = await this.api.json(Machine, this.path, { signal });
          if (machine.operationId !== null) {
            const operation = await this.api.json(Operation, `/operations/${encodeURIComponent(machine.operationId)}`, { signal });
            // A failed create still leaves a Machine requiring deletion.
            try { await this.api.wait(operation, signal); } catch { signal.throwIfAborted(); }
          }
        }
      }
    } finally {
      for (const client of this.clients) client.destroy();
      this.clients.clear();
    }
  }
}
