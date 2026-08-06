import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  diagnostic(): string;
}

export interface ControlledProcess {
  done: Promise<ProcessResult>;
  stdout: NodeJS.ReadableStream | null;
  send(signal: NodeJS.Signals): boolean;
}

export function startProcess(
  argv: readonly [string, ...string[]],
  options: { env?: NodeJS.ProcessEnv } = {},
): ControlledProcess {
  const [command, ...args] = argv;
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const done = new Promise<ProcessResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      resolve({
        exitCode,
        signal,
        stdout: out,
        stderr: err,
        diagnostic: () => `$ ${argv.join(" ")}\nexit=${String(exitCode)} signal=${String(signal)}\nstdout:\n${out.slice(-8_000)}\nstderr:\n${err.slice(-8_000)}`,
      });
    });
  });
  return { done, stdout: child.stdout, send: (signal) => child.kill(signal) };
}

export function runProcess(
  argv: readonly [string, ...string[]],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  return startProcess(argv, options).done;
}

export function waitForOutputLine(
  stream: NodeJS.ReadableStream,
  pattern: RegExp,
  timeoutMs: number,
  label: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => finish(new Error(`${label} 在 ${timeoutMs}ms 内没有输出 ${pattern}`)), timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString();
      const match = output.match(pattern);
      if (match) finish(undefined, match[0]);
    };
    const finish = (error?: Error, value?: string): void => {
      clearTimeout(timeout);
      stream.off("data", onData);
      if (error) reject(error);
      else resolve(value!);
    };
    stream.on("data", onData);
  });
}

export function parseJson<T>(text: string, diagnostic: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`stdout 不是完整 JSON：${String(error)}\n${diagnostic}`);
  }
}
