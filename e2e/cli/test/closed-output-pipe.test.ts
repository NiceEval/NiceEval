import { withProcess } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { cliBinary, cliE2E } from "./context.ts";

async function assertClosedOutputPipe(stream: "stdout" | "stderr"): Promise<void> {
  await cliE2E.case(`closed-output-pipe-${stream}`, async ({ paths }) => {
    await withProcess([
      process.execPath, "--input-type=module", "-e", `
        import { spawn } from "node:child_process";
        const stream = process.argv[1];
        const child = spawn(process.argv[2], process.argv.slice(3), { stdio: ["ignore", "pipe", "pipe"] });
        child[stream].destroy();
        child[stream === "stdout" ? "stderr" : "stdout"].pipe(process.stderr);
        child.on("error", (error) => { console.error(error); process.exitCode = 2; });
        child.on("close", (code) => { process.exitCode = code ?? 2; });
      `,
      stream, ...cliBinary, ...(stream === "stdout" ? ["show", "--help"] : ["unknown-command"]),
    ], { cwd: paths.projectRoot, processGroup: true, timeoutMs: 30_000 }, async (controlled) => {
      const result = await controlled.done;
      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.stderr, result.diagnostic()).toBe("");
    });
  });
}

// @feature docs/feature/inspection/README.md
test.concurrent("下游关闭 stdout 后 CLI 静默退出且不打印未捕获异常", () => assertClosedOutputPipe("stdout"));

// @feature docs/feature/inspection/README.md
test.concurrent("下游关闭 stderr 后 CLI 静默退出且不打印未捕获异常", () => assertClosedOutputPipe("stderr"));
