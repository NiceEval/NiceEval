import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, cpSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";

export type Argv = readonly [string, ...string[]];

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface DiagnosticTruncation {
  stdout: boolean;
  stderr: boolean;
}

export const DIAGNOSTIC_LIMIT = 4096;

export class ProcessReceipt {
  readonly argv: Argv;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly diagnosticTruncation: DiagnosticTruncation;

  constructor(fields: {
    argv: Argv;
    cwd: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  }) {
    this.argv = fields.argv;
    this.cwd = fields.cwd;
    this.exitCode = fields.exitCode;
    this.signal = fields.signal;
    this.stdout = fields.stdout;
    this.stderr = fields.stderr;
    this.durationMs = fields.durationMs;
    this.timedOut = fields.timedOut;
    this.diagnosticTruncation = {
      stdout: fields.stdout.length > DIAGNOSTIC_LIMIT,
      stderr: fields.stderr.length > DIAGNOSTIC_LIMIT,
    };
  }

  diagnostic(): string {
    return [
      `$ ${this.argv.join(" ")}  (cwd: ${this.cwd})`,
      `exit: ${this.exitCode}  signal: ${this.signal}  timedOut: ${this.timedOut}  duration: ${this.durationMs}ms`,
      "--- stdout ---",
      truncateForDisplay(this.stdout, "stdout"),
      "--- stderr ---",
      truncateForDisplay(this.stderr, "stderr"),
    ].join("\n");
  }

  json<T = unknown>(): T {
    try {
      return JSON.parse(this.stdout) as T;
    } catch (cause) {
      throw new Error(`json(): stdout is not a single complete JSON document\n\n${this.diagnostic()}`, { cause });
    }
  }

  ndjson<T = unknown>(): T[] {
    const text = this.stdout;
    if (text.length === 0) throw new Error(`ndjson(): stdout is empty\n\n${this.diagnostic()}`);
    const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
    return lines.filter((line) => line.length > 0).map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (cause) {
        throw new Error(`ndjson(): malformed JSON at line ${index + 1}\n\n${this.diagnostic()}`, { cause });
      }
    });
  }
}

function truncateForDisplay(text: string, stream: "stdout" | "stderr"): string {
  if (text.length <= DIAGNOSTIC_LIMIT) return text;
  return `${text.slice(0, DIAGNOSTIC_LIMIT)}\n… <${stream} truncated: ${text.length - DIAGNOSTIC_LIMIT} bytes omitted>`;
}

function mergedEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return env === undefined ? { ...process.env } : { ...process.env, ...env };
}

export async function runProcess(argv: Argv, options: RunProcessOptions = {}): Promise<ProcessReceipt> {
  const cwd = options.cwd ?? process.cwd();
  const startedAt = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    env: mergedEnv(options.env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  return await new Promise<ProcessReceipt>((resolveReceipt, reject) => {
    let settled = false;
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
            }, 2000).unref();
          }, options.timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveReceipt(
        new ProcessReceipt({
          argv,
          cwd,
          exitCode,
          signal,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          durationMs: Date.now() - startedAt,
          timedOut,
        }),
      );
    };

    child.on("error", (cause) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

export interface RunPtyOptions {
  cwd: string;
  columns: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

function shellQuote(segment: string): string {
  return `'${segment.replace(/'/g, `'\\''`)}'`;
}

/** Fallback PTY: same util-linux `script` transport as @niceeval/testkit. */
export async function runPty(argv: Argv, options: RunPtyOptions): Promise<ProcessReceipt> {
  const env: NodeJS.ProcessEnv = {
    ...mergedEnv(options.env),
    TERM: options.env?.TERM ?? "dumb",
    COLUMNS: String(options.columns),
    LINES: String(options.rows ?? 40),
  };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  const stty = `stty cols ${options.columns} rows ${options.rows ?? 40}; `;
  const session = `unset NO_COLOR FORCE_COLOR; ${stty}exec ${argv.map(shellQuote).join(" ")}`;
  const receipt = await runProcess(["script", "-q", "-f", "-e", "-c", session, "/dev/null"], {
    cwd: options.cwd,
    env,
    timeoutMs: options.timeoutMs,
  });
  return new ProcessReceipt({
    argv,
    cwd: options.cwd,
    exitCode: receipt.exitCode,
    signal: receipt.signal,
    stdout: receipt.stdout.replace(/\r\n/g, "\n"),
    stderr: receipt.stderr.replace(/\r\n/g, "\n"),
    durationMs: receipt.durationMs,
    timedOut: receipt.timedOut,
  });
}

export interface StartOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  processGroup?: boolean;
  timeoutMs?: number;
}

export class ProcessHandle {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  readonly done: Promise<ProcessReceipt>;
  private stdoutText = "";
  private stderrText = "";
  private readonly child: ChildProcess;
  private readonly argv: Argv;
  private readonly cwd: string;

  get bufferedStdout(): string {
    return this.stdoutText;
  }

  get bufferedStderr(): string {
    return this.stderrText;
  }

  constructor(argv: Argv, options: StartOptions, child: ChildProcess) {
    this.argv = argv;
    this.cwd = options.cwd ?? process.cwd();
    this.child = child;
    this.pid = child.pid;
    const stdoutTee = child.stdout === null ? null : new PassThrough();
    const stderrTee = child.stderr === null ? null : new PassThrough();
    child.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutText += chunk.toString("utf8");
      stdoutTee?.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrText += chunk.toString("utf8");
      stderrTee?.write(chunk);
    });
    this.stdout = stdoutTee;
    this.stderr = stderrTee;
    const startedAt = Date.now();
    this.done = new Promise<ProcessReceipt>((resolveReceipt, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => {
        stdoutTee?.end();
        stderrTee?.end();
        resolveReceipt(
          new ProcessReceipt({
            argv,
            cwd: this.cwd,
            exitCode: code,
            signal,
            stdout: this.stdoutText,
            stderr: this.stderrText,
            durationMs: Date.now() - startedAt,
            timedOut: false,
          }),
        );
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      await Promise.race([this.done, new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
    }
    await this.done.catch(() => {});
  }
}

export function startProcess(argv: Argv, options: StartOptions = {}): ProcessHandle {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: options.cwd ?? process.cwd(),
    env: mergedEnv(options.env),
    stdio: ["ignore", "pipe", "pipe"],
    detached: options.processGroup === true,
  });
  return new ProcessHandle(argv, options, child);
}

export function waitForOutput(
  handle: ProcessHandle,
  stream: "stdout" | "stderr",
  pattern: RegExp,
  options: { timeoutMs: number; label: string },
): Promise<string> {
  const readable = handle[stream];
  if (readable === null) return Promise.reject(new Error(`${options.label}: ${stream} is not piped`));
  const read = () => (stream === "stdout" ? handle.bufferedStdout : handle.bufferedStderr);
  return new Promise<string>((resolveWait, reject) => {
    let finished = false;
    const finish = (outcome: { value: string } | { error: unknown }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      readable.off("data", onData);
      if ("value" in outcome) resolveWait(outcome.value);
      else reject(outcome.error);
    };
    const inspect = () => {
      pattern.lastIndex = 0;
      const text = read();
      if (pattern.test(text)) finish({ value: text });
    };
    const onData = () => inspect();
    const timer = setTimeout(() => {
      finish({
        error: new Error(
          `${options.label}: timed out after ${options.timeoutMs}ms waiting for ${pattern}; ${stream}=${JSON.stringify(read())}`,
        ),
      });
    }, options.timeoutMs);
    readable.on("data", onData);
    inspect();
    void handle.done.then(
      (receipt) => {
        inspect();
        if (!finished) {
          finish({
            error: new Error(`${options.label}: process exited before producing ${pattern}\n\n${receipt.diagnostic()}`),
          });
        }
      },
      (error: unknown) => finish({ error }),
    );
  });
}

function resolveDiagnostic(diagnostic: string | (() => string) | undefined, fallback: string): string {
  if (diagnostic === undefined) return fallback;
  return typeof diagnostic === "function" ? diagnostic() : diagnostic;
}

export function only<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
  diagnostic?: string | (() => string),
): T {
  const matches = values.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(resolveDiagnostic(diagnostic, `expected exactly one match, got ${matches.length}`));
  }
  return matches[0] as T;
}

export function defined<T>(value: T | null | undefined, diagnostic?: string | (() => string)): T {
  if (value === null || value === undefined) {
    throw new Error(resolveDiagnostic(diagnostic, "expected a defined value"));
  }
  return value;
}

export async function pollUntil<T>(
  probe: () => Promise<T | undefined>,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(options.intervalMs, remaining)));
  }
  const message = `${options.label}: timed out after ${options.timeoutMs}ms`;
  if (lastError !== undefined) throw new Error(message, { cause: lastError });
  throw new Error(message);
}

export type ArtifactStageEntry = { source: string; target: string; optional?: boolean };

export type ProjectCopyOptions = {
  from: string;
  prefix: string;
  omitTopLevel?: readonly string[];
  links?: readonly { from: string; to: string; type?: "file" | "dir" | "junction" }[];
};

export interface E2ECommand {
  run(args: readonly string[], options?: Omit<RunProcessOptions, "cwd">): Promise<ProcessReceipt>;
  start(args: readonly string[], options?: Omit<StartOptions, "cwd" | "processGroup">): ProcessHandle;
}

export interface E2ECaseContext<Commands extends Record<string, Argv>> {
  readonly paths: Readonly<{ sourceRoot: string; projectRoot: string; artifactRoot: string }>;
  readonly commands: { readonly [Name in keyof Commands]: E2ECommand };
  run(argv: Argv, options?: Omit<RunProcessOptions, "cwd">): Promise<ProcessReceipt>;
  start(argv: Argv, options?: Omit<StartOptions, "cwd" | "processGroup">): ProcessHandle;
}

export interface E2EContext<Commands extends Record<string, Argv>> {
  case<T>(
    caseId: string,
    options: { artifacts?: readonly ArtifactStageEntry[] },
    body: (context: E2ECaseContext<Commands>) => Promise<T>,
  ): Promise<T>;
  case<T>(caseId: string, body: (context: E2ECaseContext<Commands>) => Promise<T>): Promise<T>;
}

function append(prefix: Argv, args: readonly string[]): Argv {
  return [...prefix, ...args] as Argv;
}

export function createE2EContext<const Commands extends Record<string, Argv>>(options: {
  repoId: string;
  sourceRoot?: string;
  project: ProjectCopyOptions;
  commands: Commands;
}): E2EContext<Commands> {
  const sourceRoot = resolve(options.sourceRoot ?? options.project.from);

  async function runCase<T>(
    caseId: string,
    body: (context: E2ECaseContext<Commands>) => Promise<T>,
  ): Promise<T> {
    const projectRoot = mkdtempSync(join(tmpdir(), options.project.prefix));
    const artifactRoot = join(sourceRoot, ".e2e-artifacts", "local", caseId);
    const omit = new Set(options.project.omitTopLevel ?? []);
    try {
      cpSync(options.project.from, projectRoot, {
        recursive: true,
        filter: (src) => {
          const rel = relative(resolve(options.project.from), src);
          if (rel === "" || rel === ".") return true;
          const top = rel.split(sep)[0] ?? rel;
          return !omit.has(top);
        },
      });
      for (const link of options.project.links ?? []) {
        const dest = resolve(projectRoot, link.to);
        mkdirSync(dirname(dest), { recursive: true });
        if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
        symlinkSync(link.from, dest, link.type === "dir" ? "dir" : "file");
      }
      mkdirSync(artifactRoot, { recursive: true });

      const handles: ProcessHandle[] = [];
      const start = (argv: Argv, startOptions: Omit<StartOptions, "cwd" | "processGroup"> = {}): ProcessHandle => {
        const handle = startProcess(argv, { ...startOptions, cwd: projectRoot, processGroup: true });
        void handle.done.catch(() => {});
        handles.push(handle);
        return handle;
      };
      const commands = Object.fromEntries(
        Object.entries(options.commands).map(([name, prefix]) => [
          name,
          {
            run: (args: readonly string[], runOptions?: Omit<RunProcessOptions, "cwd">) =>
              runProcess(append(prefix, args), { ...runOptions, cwd: projectRoot }),
            start: (args: readonly string[], startOptions?: Omit<StartOptions, "cwd" | "processGroup">) =>
              start(append(prefix, args), startOptions),
          },
        ]),
      ) as E2ECaseContext<Commands>["commands"];

      try {
        return await body({
          paths: Object.freeze({ sourceRoot, projectRoot, artifactRoot }),
          commands,
          run: (argv, runOptions) => runProcess(argv, { ...runOptions, cwd: projectRoot }),
          start,
        });
      } finally {
        for (const handle of handles.reverse()) await handle.dispose();
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }

  return {
    case<T>(
      caseId: string,
      optionsOrBody: { artifacts?: readonly ArtifactStageEntry[] } | ((context: E2ECaseContext<Commands>) => Promise<T>),
      maybeBody?: (context: E2ECaseContext<Commands>) => Promise<T>,
    ): Promise<T> {
      const body = typeof optionsOrBody === "function" ? optionsOrBody : maybeBody;
      if (body === undefined) throw new Error("E2E case body is required");
      return runCase(caseId, body);
    },
  };
}


