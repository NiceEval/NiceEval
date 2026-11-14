import { Sandbox as RemoteSandbox, SandboxApiException, SandboxManager } from "@alibaba-group/opensandbox";
import { sandboxCreationMetadata } from "../cloud-lifetime.ts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CommandOptions, CommandResult, ManagedProcess, ManagedProcessStart } from "../types.ts";
import type { OpenSandboxOptions } from "../opensandbox.ts";
import { noSandboxBackendCapabilities, supportedBackendCapability, type SandboxProviderBackend } from "../backend.ts";
import { commandLimit, SandboxCommandTimeoutError } from "../deadline.ts";
import { shellQuote } from "../shell.ts";
import { collectLocalFiles } from "../local-files.ts";
import { resolveLocalPath, resolveSandboxPath } from "../paths.ts";
import { downloadDirectoryByList } from "../download-directory.ts";
import { startOpenSandboxProcess } from "./managed-process.ts";

interface ExecutionIdentity {
  readonly uid: number;
  readonly gid: number;
  readonly env: { readonly HOME: string; readonly USER: string; readonly LOGNAME: string };
}

export class OpenSandboxBackend implements SandboxProviderBackend {
  readonly workdir = "/home/sandbox/workspace";
  readonly otlpHost = null;
  readonly capabilities: SandboxProviderBackend["capabilities"] = {
    ...noSandboxBackendCapabilities,
    rootCommands: supportedBackendCapability(true as const),
    setCommandDeadline: supportedBackendCapability((deadlineAt?: number) => { this.deadlineAt = deadlineAt; }),
    managedProcess: supportedBackendCapability((input: ManagedProcessStart) => this.startManagedProcess(input)),
  };
  private stopped = false;
  private remoteRetired = false;
  private stopping?: Promise<void>;
  private readonly identities = new Map<string, Promise<ExecutionIdentity>>();

  private constructor(private remote: RemoteSandbox, private readonly options: OpenSandboxOptions & { readonly lifetimeMs: number },
    _connectionConfig: { domain: string; apiKey?: string; useServerProxy: boolean; disableMetrics: boolean },
    private deadlineAt?: number) {
  }

  get nativeInstanceId(): string { return this.remote.id; }
  get sandboxId(): string { return this.remote.id; }

  static async create(options: OpenSandboxOptions & { readonly lifetimeMs: number }, deadlineAt?: number, snapshotId?: string, runId?: string, creationLabels?: Readonly<Record<string, string>>): Promise<OpenSandboxBackend> {
    const domain = process.env.OPEN_SANDBOX_DOMAIN;
    if (!domain) throw new Error("OPEN_SANDBOX_DOMAIN is required for OpenSandbox");
    const url = new URL(domain);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("OPEN_SANDBOX_DOMAIN must be an HTTP(S) URL without credentials, query or fragment");
    const connectionConfig = { domain, apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true };
    const remote = await OpenSandboxBackend.provision(options, connectionConfig, snapshotId, runId, creationLabels);
    return new OpenSandboxBackend(remote, options, connectionConfig, deadlineAt);
  }

  private static async provision(options: OpenSandboxOptions & { readonly lifetimeMs: number }, connectionConfig: { domain: string; apiKey?: string; useServerProxy: boolean; disableMetrics: boolean }, snapshotId?: string, runId?: string, creationLabels?: Readonly<Record<string, string>>): Promise<RemoteSandbox> {
    const metadata = { ...sandboxCreationMetadata(runId), ...creationLabels, "niceeval-provision-token": randomUUID() };
    let remote: RemoteSandbox;
    try { remote = await RemoteSandbox.create({
      ...(snapshotId === undefined ? { image: options.image } : { snapshotId }),
      connectionConfig,
      metadata,
      timeoutSeconds: Math.ceil(options.lifetimeMs / 1000),
      platform: { os: "linux", arch: options.targetPlatform.arch === "x64" ? "amd64" : "arm64" },
      resource: { cpu: options.resources?.cpu ?? "1", memory: options.resources?.memory ?? "2Gi" },
      secureAccess: false,
      skipHealthCheck: true,
    }); } catch (cause) {
      // A lost create response may still have allocated an instance. Reconcile only
      // our unique token; never issue another create or touch another caller's work.
      const manager = SandboxManager.create({ connectionConfig });
      try {
        const found = await manager.listSandboxInfos({ metadata, pageSize: 100 });
        for (const instance of found.items) {
          if (instance.metadata?.["niceeval-provision-token"] !== metadata["niceeval-provision-token"]) continue;
          try { await manager.killSandbox(instance.id); }
          catch (cleanup) { if (!(cleanup instanceof SandboxApiException && cleanup.statusCode === 404)) throw cleanup; }
        }
      } catch (cleanup) {
        throw new AggregateError([cause, cleanup], "OpenSandbox allocation failed and reconciliation could not confirm retirement; the declared lifetime remains the final bound");
      } finally { await manager.close(); }
      throw cause;
    }
    return remote;
  }

  async initialize(signal: AbortSignal): Promise<void> {
    await this.remote.waitUntilReady({ readyTimeoutSeconds: 120, pollingIntervalMillis: 500, signal });
    const identity = await this.remote.commands.run(["id", "-u"], {}, undefined, signal);
    if (identity.exitCode !== 0 || identity.logs.stdout.map((chunk) => chunk.text).join("").trim() !== "0") {
      throw new Error("OpenSandbox requires an image that starts execd as root; choose the Agent execution identity with openSandbox({ user })");
    }
    // The SDK serializes octal permission digits (755), not a JS octal integer.
    await this.remote.files.createDirectories([{ path: this.workdir, mode: 755 }]);
    if (this.options.user !== undefined) {
      const result = await this.runCommand("chown", [this.options.user, this.workdir], { user: "root", signal });
      if (result.exitCode !== 0) throw new Error(`Cannot initialize OpenSandbox workspace: ${result.stderr}`);
    }
  }

  private identity(user = this.options.user ?? "root"): Promise<ExecutionIdentity> {
    const existing = this.identities.get(user);
    if (existing !== undefined) return existing;
    const pending = this.remote.files.readFile("/etc/passwd").then((passwd) => {
      const fields = passwd.split("\n").map((line) => line.split(":"))
        .find((entry) => /^\d+$/.test(user) ? entry[2] === user : entry[0] === user);
      if (fields === undefined || fields.length < 7 || !/^\d+$/.test(fields[2]!) || !/^\d+$/.test(fields[3]!) || !fields[5]?.startsWith("/")) {
        throw new Error("OpenSandbox execution user must have a valid /etc/passwd entry");
      }
      return { uid: Number(fields[2]), gid: Number(fields[3]), env: { HOME: fields[5], USER: fields[0]!, LOGNAME: fields[0]! } };
    });
    this.identities.set(user, pending);
    return pending;
  }

  private async startManagedProcess(input: ManagedProcessStart): Promise<ManagedProcess> {
    if (this.stopped || this.stopping) throw new Error("OpenSandbox is stopped");
    try {
      const identity = await this.identity();
      const prefix = this.options.pathPrepend ?? [];
      const env: Record<string, string> = { ...identity.env, ...input.env };
      if (prefix.length > 0) {
        const path = await this.runCommand("printenv", ["PATH"], { user: "root" });
        if (path.exitCode !== 0) throw new Error("Cannot resolve OpenSandbox managed PATH");
        env.PATH = `${prefix.join(":")}:${input.env?.PATH ?? path.stdout.trim()}`;
      }
      return await startOpenSandboxProcess({
        remote: this.remote,
        process: { ...input, cwd: resolveSandboxPath(this.workdir, input.cwd), env },
        uid: identity.uid, gid: identity.gid, retire: () => this.stop(),
      });
    } catch (cause) { await this.stop(); throw cause; }
  }

  async runCommand(command: string, args: readonly string[] = [], options: CommandOptions = {}): Promise<CommandResult> {
    if (this.stopped || this.stopping) throw new Error("OpenSandbox is stopped");
    const limit = commandLimit(options, { deadlineAt: this.deadlineAt });
    const controller = new AbortController();
    let interrupted!: () => void;
    const interruption = new Promise<never>((_resolve, reject) => {
      interrupted = () => {
        // Aborting the SDK fetch alone can leave its SSE reader waiting after headers.
        // Retirement is the acknowledgement; never settle cancellation before it.
        void this.stop().then(
          () => reject(controller.signal.reason),
          (cleanup: unknown) => reject(new AggregateError([controller.signal.reason, cleanup], "OpenSandbox cancellation could not retire the instance")),
        );
      };
      controller.signal.addEventListener("abort", interrupted, { once: true });
    });
    void interruption.catch(() => undefined);
    const cancel = () => controller.abort(options.signal?.reason ?? new Error("OpenSandbox command cancelled"));
    options.signal?.addEventListener("abort", cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (limit.timeoutMs !== undefined) timer = setTimeout(() => controller.abort(new SandboxCommandTimeoutError("OpenSandbox command timed out", limit.timeoutMs!, limit.explicit)), limit.timeoutMs);
    if (options.signal?.aborted) cancel();
    try {
      controller.signal.throwIfAborted();
      return await Promise.race([this.executeCommand(command, args, options, controller.signal), interruption]);
    } catch (cause) {
      // A transport failure cannot prove the remote command tree has stopped.
      try { await this.stop(); }
      catch (cleanup) { throw new AggregateError([cause, cleanup], "OpenSandbox command failed and instance retirement failed"); }
      throw controller.signal.aborted ? controller.signal.reason : cause;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", interrupted);
    }
  }

  private async executeCommand(command: string, args: readonly string[], options: CommandOptions, signal: AbortSignal): Promise<CommandResult> {
    const identity = await this.identity(options.user);
    const argv = [command, ...args];
    const prefix = this.options.pathPrepend ?? [];
    const invocation = prefix.length === 0 ? argv : ["/bin/sh", "-c", `export PATH=${shellQuote(prefix.join(":"))}:"$PATH"; exec "$@"`, "niceeval", ...argv];
    const result = await this.remote.commands.run(invocation, {
      workingDirectory: resolveSandboxPath(this.workdir, options.cwd), envs: { ...identity.env, ...options.env }, uid: identity.uid, gid: identity.gid,
    }, {
      onStdout: (chunk) => options.onStdout?.(chunk.text),
      onStderr: (chunk) => options.onStderr?.(chunk.text),
    }, signal);
    signal.throwIfAborted();
    if (typeof result.exitCode !== "number") throw new Error("OpenSandbox command ended without an exit code");
    return { stdout: result.logs.stdout.map((chunk) => chunk.text).join(""), stderr: result.logs.stderr.map((chunk) => chunk.text).join(""), exitCode: result.exitCode };
  }
  runShell(script: string, options?: CommandOptions): Promise<CommandResult> { return this.runCommand("bash", ["-lc", script], options); }
  readText(path: string): Promise<string> { return this.remote.files.readFile(resolveSandboxPath(this.workdir, path)); }
  readBytes(path: string): Promise<Uint8Array> { return this.remote.files.readBytes(resolveSandboxPath(this.workdir, path)); }
  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    const absolute = resolveSandboxPath(this.workdir, path);
    await this.remote.files.createDirectories([{ path: dirname(absolute), mode: 755, owner: this.options.user }]);
    await this.remote.files.writeFiles([{ path: absolute, data: content, owner: this.options.user }]);
  }
  writeText(path: string, content: string): Promise<void> { return this.writeBytes(path, new TextEncoder().encode(content)); }
  async pathExists(path: string): Promise<boolean> {
    const result = await this.runCommand("test", ["-e", resolveSandboxPath(this.workdir, path)]);
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error("OpenSandbox path check failed");
    return result.exitCode === 0;
  }
  async uploadFile(source: string | URL, target: string): Promise<void> { await this.writeBytes(target, await readFile(resolveLocalPath(undefined, source))); }
  async uploadDirectory(source: string | URL, target?: string, options: { readonly ignore?: readonly string[] } = {}): Promise<void> {
    const base = resolveSandboxPath(this.workdir, target);
    for (const file of await collectLocalFiles(resolveLocalPath(undefined, source), options.ignore)) await this.writeBytes(resolveSandboxPath(base, file.path), file.content);
  }
  async downloadFile(source: string, target: string | URL): Promise<void> {
    const destination = resolveLocalPath(undefined, target);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await this.readBytes(source));
  }
  async downloadDirectory(source: string, target: string | URL, options: { readonly ignore?: readonly string[] } = {}): Promise<void> {
    const remoteDir = resolveSandboxPath(this.workdir, source);
    await downloadDirectoryByList({ localDir: resolveLocalPath(undefined, target), ignore: options.ignore ?? [], runShell: (script) => this.runShell(script, { cwd: remoteDir }), readOne: (path) => this.readBytes(`${remoteDir}/${path}`) });
  }
  private async retireCurrent(): Promise<void> {
    if (!this.remoteRetired) {
      try { await this.remote.kill(); }
      catch (cause) { if (!(cause instanceof SandboxApiException && cause.statusCode === 404)) throw cause; }
      await this.remote.close();
      this.remoteRetired = true;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = (async () => {
      await this.retireCurrent();
    })();
    try { await this.stopping; } finally { this.stopping = undefined; }
  }
}
