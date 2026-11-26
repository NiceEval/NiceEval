// 跨进程保证：进程终止与信号——未回收的 Linux zombie 也能关闭 exact Run 并完成补偿 after。
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { execa } from "execa";
import { runHost } from "niceeval/run/host";
import { expect, test } from "vitest";
import { createRecordProject } from "../integration/fixtures/record-harness/project.ts";

const cli = fileURLToPath(new URL("../../packages/niceeval/bin/niceeval.js", import.meta.url));
const zombieWrapper = fileURLToPath(new URL("../../e2e/runner/fixtures/shared-state-zombie-owner.py", import.meta.url));

// @feature docs/feature/state/README.md#shared-state-recovery
test("an unreaped owner permits exact Run recovery and compensating after", { timeout: 25_000 }, async () => {
  const cwd = await createRecordProject("niceeval-lease-zombie-", { held: true });
  const key = "zombie-owner";
  const gates = join(cwd, "gates");
  const attempt = join(cwd, "evals", "held.eval.ts");
  const started = join(gates, "zombie-owner.json");
  const external = join(gates, "external");
  const cleaned = join(gates, "cleaned");
  const args = [...process.execArgv, cli];
  let stopOwner: (() => Promise<void>) | undefined;
  try {
    await writeFile(attempt, (await readFile(attempt, "utf8")).replace('"entered"', '"zombie-owner-agent-started"'));
    await writeFile(join(cwd, "experiments", "runs.ts"), `
      import { unlinkSync, writeFileSync } from "node:fs";
      import { defineExperiment } from "niceeval";
      import adapter from "../adapter.ts";
      export default defineExperiment({
        adapter, evals: ["held"], sharedState: { key: ${JSON.stringify(key)} },
        before() { writeFileSync(${JSON.stringify(external)}, "owned"); },
        after() {
          unlinkSync(${JSON.stringify(external)});
          writeFileSync(${JSON.stringify(cleaned)}, "after");
        }
      });`);
    const options = { cwd, reject: false, timeout: 20_000 };
    const owner = execa("python3", [
      zombieWrapper, started, process.execPath, ...args, "exp", "runs", "--rerun", "all", "--json",
    ], { ...options, env: { NICEEVAL_SHARED_STATE_ZOMBIE_BARRIER: gates } });
    stopOwner = async () => {
      owner.kill("SIGTERM");
      await owner;
    };
    await expect.poll(async () => {
      try {
        return JSON.parse(await readFile(started, "utf8"));
      } catch (error) {
        if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      }
    }, { timeout: 12_000, interval: 20 }).toMatchObject({ state: "Z" });
    const { runs } = await Effect.runPromise(runHost.list({ cwd }));
    const runId = runs[0]!.runId;
    expect((await Effect.runPromise(runHost.get({ cwd, runId }))).run.state).toBe("active");
    expect(await readFile(external, "utf8")).toBe("owned");

    const base = ["exp", "runs", "--after", "--recover-shared-state", key];
    const observed = await execa(process.execPath, [...args, ...base], options);
    const token = /owner token:\s*(\S+)/u.exec(observed.stderr)?.[1];
    if (token === undefined) throw new Error(observed.stderr);
    const recovered = await execa(process.execPath, [
      ...args, ...base, "--owner-token", token, "--confirm-owner-terminated", "--confirm-remote-quiesced",
    ], options);
    expect(recovered.exitCode, recovered.stderr).toBe(0);
    expect(await readFile(cleaned, "utf8")).toBe("after");
    await expect(readFile(external, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await Effect.runPromise(runHost.get({ cwd, runId }))).run.state).toBe("interrupted");
  } finally {
    await stopOwner?.();
    await rm(cwd, { recursive: true, force: true });
  }
});
