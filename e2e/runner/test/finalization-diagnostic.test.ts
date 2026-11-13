import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/run/README.md
test.concurrent("存储传输失败时保留原因、Run 与恢复命令", async () => {
  await runnerE2E.case("finalization-diagnostic", {}, async ({ commands: { niceeval }, paths }) => {
    const preload = join(paths.projectRoot, "storage-transport-fault.mjs");
    // Fault only the external worker transport. The real installed CLI, Runner,
    // Record writer, worker, and SQLite database execute without implementation mocks.
    await writeFile(preload, `import { Worker } from 'node:worker_threads';
const original = Worker.prototype.postMessage;
let failed = false;
Worker.prototype.postMessage = function(message, ...rest) {
  if (!failed && message?.operation === 'prepare-finalization') {
    failed = true;
    const cause = new Error('fixture storage transport EIO');
    cause.code = 'EIO';
    throw cause;
  }
  return Reflect.apply(original, this, [message, ...rest]);
};\n`);
    const result = await niceeval.run(["exp", "carry", "--rerun", "all", "--json"], {
      env: { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
    });
    expect(result.exitCode, result.diagnostic()).not.toBe(0);
    expect(result.stderr).toContain("fixture storage transport EIO");
    expect(result.stderr).toContain("operation: prepare-finalization");
    const recovery = result.stderr.match(/niceeval run recover ([0-9a-f-]{36}) --yes/u);
    expect(recovery, result.diagnostic()).not.toBeNull();
    const recovered = await niceeval.run(["run", "recover", recovery![1]!, "--yes"]);
    expect(recovered.exitCode, recovered.diagnostic()).toBe(0);
  });
});
