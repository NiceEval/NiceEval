// 跨进程保证：进程终止与信号——已在等待 execution claim 的 Invocation 在原 owner 退出后恢复派发。
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { test } from "vitest";
import { createRecordProject, openGate, waitForGate } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const start = (cwd: string, nodeArgs: string[] = []) => execa(process.execPath, [...process.execArgv, ...nodeArgs, cli, "exp", "runs", "--rerun", "all", "--json"], {
  cwd, reject: false,
});

// @feature docs/feature/experiments/README.md#concurrency-and-queues
test("an already waiting Invocation resumes when its case owner terminates", { timeout: 40_000 }, async () => {
  const cwd = await createRecordProject("niceeval-wait-takeover-", { held: true });
  const owner = start(cwd);
  try {
    await Promise.race([waitForGate(cwd, "entered"), owner.then((r) => { throw new Error(r.stderr); })]);
    // Advance only the waiter's ten-second timers. Ownership checks and both
    // SQLite workers still use real processes, wall time, and transactions.
    const fastPoll = `const startTimer = globalThis.setTimeout;
      globalThis.setTimeout = (fn, ms, ...args) => startTimer(fn, ms === 10000 ? 50 : ms, ...args);`;
    const waiter = start(cwd, ["--import", "data:text/javascript," + encodeURIComponent(fastPoll)]);
    try {
      const started = Promise.withResolvers<void>();
      const lines = createInterface({ input: waiter.stdout! });
      lines.on("line", (line) => {
        const event = JSON.parse(line);
        if (event.event === "lock_wait" && event.status === "started" && event.evalId === "held") started.resolve();
      });
      try {
        await Promise.race([started.promise, waiter.then((r) => { throw new Error(r.stderr); })]);
        await rm(join(cwd, "gates", "entered"));
        owner.kill("SIGKILL");
        await owner;
        await openGate(cwd, "release");
        // The successor must actually enter the Eval after a case poll.
        await waitForGate(cwd, "entered", 5_000);
      } finally {
        lines.close();
      }
    } finally {
      waiter.kill("SIGKILL");
      await waiter;
    }
  } finally {
    owner.kill("SIGKILL");
    await owner;
    await rm(cwd, { recursive: true, force: true });
  }
});
