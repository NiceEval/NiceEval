// 跨进程保证：运行环境——真实 CLI 进程在系统输出错误后正常退出或保留失败
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import fc from "fast-check";
import { expect, test } from "vitest";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));

for (const channel of ["stdout", "stderr"] as const) {
  for (const errno of ["EPIPE", "EIO"] as const) {
    // @feature docs/feature/experiments/README.md#terminal-and-initialization
    test(`CLI handles ${errno} on ${channel} for synchronous and asynchronous writes`, async () => {
      const inputs = fc.boolean();
      await fc.assert(
        fc.asyncProperty(inputs, async (asyncFailure) => {
          const preload = `
            import { Writable } from "node:stream";
            const stream = new Writable({
              write(_chunk, _encoding, callback) {
                process[${JSON.stringify(channel === "stdout" ? "stderr" : "stdout")}].write("output stream exercised\\n");
                const error = Object.assign(new Error("injected output failure"), { code: ${JSON.stringify(errno)} });
                if (${asyncFailure}) setImmediate(() => callback(error));
                else throw error;
              },
            });
            Object.defineProperty(process, ${JSON.stringify(channel)}, { value: stream });
          `;
          const args = channel === "stdout" ? ["--help"] : ["run", "list", "--limit", "0"];
          const res = await execa(
            process.execPath,
            [...process.execArgv, "--import", `data:text/javascript,${encodeURIComponent(preload)}`, cli, ...args],
            { reject: false, timeout: 5_000 },
          );
          expect(res[channel === "stdout" ? "stderr" : "stdout"], JSON.stringify([asyncFailure, errno])).toContain(
            "output stream exercised",
          );
          expect(res.timedOut).toBe(false);
          if (errno === "EPIPE") expect(res.exitCode, res.stderr).toBe(0);
          else expect(res.exitCode, res.stderr).not.toBe(0);
        }),
        { numRuns: 2, examples: [[false], [true]] },
      );
    });
  }
}
