import { spawn } from "node:child_process";

export interface ProcessResult {
  argv: readonly string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  diagnostic(): string;
}

export async function runProcess(
  argv: readonly [string, ...string[]],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  const [command, ...args] = argv;
  const cwd = options.cwd ?? process.cwd();
  const startedAt = performance.now();

  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      const result: ProcessResult = {
        argv,
        cwd,
        exitCode,
        signal,
        stdout: out,
        stderr: err,
        durationMs: performance.now() - startedAt,
        diagnostic: () => [
          `$ ${argv.join(" ")}`,
          `cwd: ${cwd}`,
          `exit: ${String(exitCode)} signal: ${String(signal)}`,
          `stdout:\n${out.slice(-8_000)}`,
          `stderr:\n${err.slice(-8_000)}`,
        ].join("\n"),
      };
      resolve(result);
    });
  });
}

export function parseJson<T>(text: string, diagnostic: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`stdout 不是完整 JSON：${String(error)}\n${diagnostic}`);
  }
}

export function parseNdjson<T>(text: string, diagnostic: string): T[] {
  return text.split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`stdout 第 ${index + 1} 行不是 JSON：${String(error)}\n${diagnostic}`);
    }
  });
}
