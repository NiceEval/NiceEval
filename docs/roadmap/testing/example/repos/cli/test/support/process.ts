import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  diagnostic(): string;
}

export function runProcess(argv: readonly [string, ...string[]]): Promise<ProcessResult> {
  const [command, ...args] = argv;
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      resolve({
        exitCode,
        signal,
        stdout: out,
        stderr: err,
        diagnostic: () => [
          `$ ${argv.join(" ")}`,
          `exit=${String(exitCode)} signal=${String(signal)}`,
          `stdout:\n${out.slice(-8_000)}`,
          `stderr:\n${err.slice(-8_000)}`,
        ].join("\n"),
      });
    });
  });
}

export function parseJson<T>(text: string, diagnostic: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`stdout is not one JSON document: ${String(error)}\n${diagnostic}`);
  }
}

export function parseNdjson<T>(text: string, diagnostic: string): T[] {
  return text.split("\n").filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line) as T;
    } catch (error) {
      throw new Error(`stdout line ${index + 1} is not JSON: ${String(error)}\n${diagnostic}`);
    }
  });
}
