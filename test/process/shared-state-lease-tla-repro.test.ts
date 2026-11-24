// 跨进程保证：进程终止与信号——恢复者在清理登记提交后退出，重试不会再次执行已完成的 after。
import { readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { execa } from "execa";
import { experimentHost } from "niceeval/experiment/host";
import { expect, test } from "vitest";
import { createRecordProject, waitForGate } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));

// Terminate just after the transaction retiring the registration commits, before
// its acknowledgement reaches the caller. Both the legacy delete and the
// combined free transition are possible retirement commands.
const interruptAfterRetirement = `
  import { Worker } from "node:worker_threads";
  const postMessage = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(request, ...args) {
    const command = request?.command;
    if (request?.operation === "registry" && (command._tag === "teardown-claim" ||
        (command._tag === "shared-append" && command.kind === "free"))) {
      this.prependListener("message", (response) => {
        if (response.id === request.id && response.state === "success" && response.result === true)
          process.kill(process.pid, "SIGKILL");
      });
    }
    return postMessage.call(this, request, ...args);
  };
`;

// @feature docs/feature/state/README.md#shared-state-recovery
test.each(["owner", "recovery"] as const)("retry after %s committed teardown retirement preserves the completed callback", { timeout: 30_000 }, async (actor) => {
  const cwd = await createRecordProject("niceeval-lease-completion-", { held: true });
  const calls = join(cwd, "gates", "cleanup-calls");
  const key = "cleanup-retry";
  const target = { cwd, experimentSelector: "runs", currentHost: hostname(), recoveryKey: key };
  const start = (args: string[], preload: string[] = []) =>
    execa(process.execPath, [...process.execArgv, ...preload, cli, ...args], { cwd, reject: false, timeout: 20_000 });
  try {
    await writeFile(join(cwd, "experiments", "runs.ts"), `
      import { appendFileSync } from "node:fs";
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({
        adapter, evals: [${JSON.stringify(actor === "recovery" ? "held" : "first")}], sharedState: { key: ${JSON.stringify(key)} },
        after() { appendFileSync(${JSON.stringify(calls)}, "after\\n"); },
      });`);
    const fault = ["--import", `data:text/javascript,${encodeURIComponent(interruptAfterRetirement)}`];
    const owner = start(["exp", "runs", "--rerun", "all", "--json"], actor === "owner" ? fault : []);
    try {
      if (actor === "owner") {
        const stopped = await owner;
        expect(stopped.signal, stopped.stderr).toBe("SIGKILL");
      } else {
        await Promise.race([waitForGate(cwd, "entered"), owner.then((r) => { throw new Error(r.stderr); })]);
      }
    } finally {
      owner.kill("SIGKILL");
      await owner;
    }
    const inspection = await Effect.runPromise(experimentHost.after.inspect(target));
    if (inspection.status !== "ready" || !inspection.evidence) throw new Error("Missing original owner evidence");
    const ownerToken = inspection.evidence.ownerToken;
    if (actor === "recovery") {
      const stopped = await start([
        "exp", "runs", "--after", "--recover-shared-state", key, "--owner-token", ownerToken,
        "--confirm-owner-terminated", "--confirm-remote-quiesced",
      ], fault);
      expect(stopped.signal, stopped.stderr).toBe("SIGKILL");
    }
    expect(await readFile(calls, "utf8")).toBe("after\n");
    const retry = await Effect.runPromise(experimentHost.after.run({
      ...target, ownerToken, confirmOwnerTerminated: true, confirmRemoteQuiesced: true,
    }));
    expect(["already-released", "recovered"]).toContain(retry.status);
    expect(await readFile(calls, "utf8")).toBe("after\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
