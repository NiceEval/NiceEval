// cases: docs/engineering/testing/unit/eval.md
import { describe, expect, it } from "vitest";

import { buildO11ySummary } from "./derive.ts";
import {
  SANDBOX_O11Y_RESULTS_PATH,
  writeSandboxO11yResults,
} from "./sandbox-results.ts";
import type { CommandResult, Sandbox, StreamEvent } from "../types.ts";

function sandboxFixture({ failWrite = false }: { failWrite?: boolean } = {}) {
  const files = new Map<string, string>();
  const sandbox: Sandbox = {
    workdir: "/workspace",
    sandboxId: "fake",
    otlpHost: null,
    async runCommand(): Promise<CommandResult> {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async runShell(script: string): Promise<CommandResult> {
      if (script.startsWith("mv -f ")) {
        const [, , temp, target] = script.split(" ");
        const content = files.get(temp!);
        if (content === undefined) return { stdout: "", stderr: "missing temporary file", exitCode: 1 };
        files.delete(temp!);
        files.set(target!, content);
      } else if (script.startsWith("rm -f ")) {
        for (const path of script.split(" ").slice(2)) files.delete(path);
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    async fileExists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async writeFiles(next: globalThis.Record<string, string>): Promise<void> {
      if (failWrite) throw new Error("disk full");
      for (const [path, content] of Object.entries(next)) files.set(path, content);
    },
    async uploadFiles(): Promise<void> {},
    async uploadDirectory(): Promise<void> {},
    async stop(): Promise<void> {},
    async downloadFile(): Promise<Buffer> {
      return Buffer.from("");
    },
    async uploadFile(): Promise<void> {},
    async downloadDirectory(): Promise<void> {},
  };
  return { sandbox, files };
}

describe("writeSandboxO11yResults", () => {
  it("将唯一派生器的完整摘要原子发布到固定路径", async () => {
    const events: StreamEvent[] = [
      { type: "action.called", callId: "shell-1", name: "bash", input: { command: "pnpm test" }, tool: "shell" },
      { type: "action.result", callId: "shell-1", output: { exitCode: 0 }, status: "completed" },
      { type: "message", role: "assistant", text: "done" },
    ];
    const { sandbox, files } = sandboxFixture();

    await writeSandboxO11yResults(sandbox, events);

    expect(JSON.parse(files.get(SANDBOX_O11Y_RESULTS_PATH)!)).toEqual({ o11y: buildO11ySummary(events) });
    expect(files.has(`${SANDBOX_O11Y_RESULTS_PATH}.tmp`)).toBe(false);
  });

  it("写入失败时删除旧目标和临时文件，读取者只能得到缺文件", async () => {
    const { sandbox, files } = sandboxFixture({ failWrite: true });
    files.set(SANDBOX_O11Y_RESULTS_PATH, JSON.stringify({ o11y: { totalTurns: 99 } }));

    await expect(writeSandboxO11yResults(sandbox, [])).rejects.toThrow("disk full");

    expect(files.has(SANDBOX_O11Y_RESULTS_PATH)).toBe(false);
    expect(files.has(`${SANDBOX_O11Y_RESULTS_PATH}.tmp`)).toBe(false);
  });
});
