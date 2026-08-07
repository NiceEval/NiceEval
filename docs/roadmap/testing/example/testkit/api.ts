/**
 * @niceeval/testkit 0.x 的目标类型草案，不是当前可运行实现。
 * 正式场景 Repo 从精确锁定的 package 导入；这里单独列出接口，方便评审 example。
 */

export type Argv = readonly [string, ...string[]];

export interface ProcessReceipt {
  readonly argv: Argv;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly diagnosticTruncation: {
    readonly stdout: boolean;
    readonly stderr: boolean;
  };
  diagnostic(): string;
  json<T = unknown>(): T;
  ndjson<T = unknown>(): T[];
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export declare class ProcessStartError extends Error {
  readonly argv: Argv;
  readonly cwd: string;
  readonly cause?: unknown;
}

export interface DisposeOptions {
  signal?: NodeJS.Signals;
  killSignal?: NodeJS.Signals;
  graceMs?: number;
}

export interface StartOptions extends RunOptions {
  processGroup?: boolean;
  dispose?: DisposeOptions;
}

export interface ProcessHandle {
  readonly done: Promise<ProcessReceipt>;
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  signal(signal: NodeJS.Signals): boolean;
  dispose(): Promise<void>;
}

export declare function runProcess(
  argv: Argv,
  options?: RunOptions,
): Promise<ProcessReceipt>;

export declare function startProcess(
  argv: Argv,
  options?: StartOptions,
): ProcessHandle;

export interface Command {
  run(args: readonly string[], options?: RunOptions): Promise<ProcessReceipt>;
  start(args: readonly string[], options?: StartOptions): ProcessHandle;
}

export declare function command(prefix: Argv): Command;

export declare function withProcess<T>(
  argv: Argv,
  options: StartOptions,
  body: (process: ProcessHandle) => Promise<T>,
): Promise<T>;

export declare function only<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
  diagnostic?: string | (() => string),
): T;

export declare function defined<T>(
  value: T | null | undefined,
  diagnostic?: string | (() => string),
): T;

export declare function waitForOutput(
  process: ProcessHandle,
  stream: "stdout" | "stderr",
  pattern: RegExp,
  options: { timeoutMs: number; label: string },
): Promise<string>;

export declare function pollUntil<T>(
  probe: () => Promise<T | undefined>,
  options: { timeoutMs: number; intervalMs: number; label: string },
): Promise<T>;

/** 在系统临时目录下创建本次调用的唯一目录，并在 body 成功或失败后删除。 */
export declare function withTempDir<T>(
  prefix: string,
  body: (root: string) => Promise<T>,
): Promise<T>;

export interface ProjectCopyOptions {
  from: string;
  prefix: string;
  omitTopLevel?: readonly string[];
  links?: readonly {
    from: string;
    to: string;
    type?: "file" | "dir" | "junction";
  }[];
}

export declare function withProjectCopy<T>(
  options: ProjectCopyOptions,
  body: (project: { root: string }) => Promise<T>,
): Promise<T>;

export interface HttpServerFixture {
  readonly url: string;
}

export declare function withHttpServer<T>(
  handler: (request: Request) => Response | Promise<Response>,
  body: (server: HttpServerFixture) => Promise<T>,
  options?: { hostname?: string; port?: number },
): Promise<T>;
