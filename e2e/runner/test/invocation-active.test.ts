import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command, defined, only, pollUntil, withProcess, withProjectCopy } from "@niceeval/testkit";
import { decodeSessionListDocument, decodeSessionShowDocument } from "niceeval/experiment/host";
import { expect, test } from "vitest";

// @feature docs/feature/run/README.md
// @issue docs/issues/invocation-active-attempts.md
test.concurrent("另一个终端查看运行中 Attempt 的阶段、最近活动及 Docker 原生实例", async () => {
  await withProjectCopy({ from: process.cwd(), prefix: "niceeval-invocation-active-", omitTopLevel: [".niceeval", "node_modules", "test"], links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }] }, async ({ root }) => {
    const binary = resolve("node_modules/.bin/niceeval");
    const niceeval = command([binary]);
    const docker = command(["docker"]);
    await withProcess([binary, "exp", "invocation-active", "--rerun", "all", "--json"], { cwd: root, processGroup: true, timeoutMs: 180_000 }, async (running) => {
      try {
        await pollUntil(async () => existsSync(join(root, "invocation-active-ready")) ? true : undefined, { timeoutMs: 120_000, intervalMs: 50, label: "Attempt ready for inspection" });
        const list = await niceeval.run(["invocation", "list", "--json"], { cwd: root });
        expect(list.exitCode, list.diagnostic()).toBe(0);
        const invocation = only(decodeSessionListDocument(list.json<unknown>()).sessions, () => true);
        const observed = await pollUntil(async () => {
          const result = await niceeval.run(["invocation", "show", invocation.sessionId, "--json"], { cwd: root });
          expect(result.exitCode, result.diagnostic()).toBe(0);
          const doc = decodeSessionShowDocument(result.json<unknown>());
          if (!("experiments" in doc.session)) throw new Error("Active Invocation is not readable");
          const experiment = only(doc.session.experiments, () => true);
          return experiment.activeAttempts?.find((item) => item.detail?.text === "Waiting for inspection release");
        }, { timeoutMs: 15_000, intervalMs: 100, label: "owner activity persisted" });
        expect(observed).toMatchObject({ evalId: "invocation-active", attemptOrdinal: 1, phase: "agent.run", sandbox: { provider: "docker", nativeInstanceId: expect.any(String) } });
        expect(Date.parse(observed.phaseEnteredAt)).not.toBeNaN();
        expect(Date.parse(defined(observed.detail).at)).not.toBeNaN();
        const instance = defined(defined(observed.sandbox).nativeInstanceId);
        const native = await docker.run(["inspect", "--format", "{{.Id}}", instance]);
        expect(native.exitCode, native.diagnostic()).toBe(0);
        expect(native.stdout.trim()).toBe(instance);
        const text = await niceeval.run(["invocation", "show", invocation.sessionId], { cwd: root });
        expect(text.stdout).toContain("invocation-active #1");
        expect(text.stdout).toContain(instance);
        expect(text.stdout).toContain("Waiting for inspection release");
        await writeFile(join(root, "invocation-active-release"), "release");
        const finished = await running.done;
        expect(finished.exitCode, finished.diagnostic()).toBe(0);
        const terminal = await niceeval.run(["invocation", "show", invocation.sessionId, "--json"], { cwd: root });
        const session = decodeSessionShowDocument(terminal.json<unknown>()).session;
        if (!("experiments" in session)) throw new Error("Completed Invocation is not readable");
        expect(session.experiments.flatMap((item) => item.activeAttempts ?? [])).toEqual([]);
      } finally {
        await writeFile(join(root, "invocation-active-release"), "release");
      }
    });
  });
});
