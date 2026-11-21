import fc from "fast-check";
import { expect, test, vi } from "vitest";
import { Sandbox } from "../../packages/niceeval/node_modules/@vercel/sandbox/dist/index.js";
import { VercelSandbox } from "../../packages/niceeval/src/sandbox/vercel.ts";
import { normalizeSandboxPaths } from "../../packages/niceeval/src/sandbox/paths.ts";

// @feature docs/feature/sandbox/library/operations.md#后台命令
test("Vercel keeps in-flight commands on their session while admitting new commands", async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async (shell) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const startedAt = new Date();
      function session(name: string) {
        let stopped = false;
        return {
          name,
          currentSession: () => ({ createdAt: startedAt, timeout: 60_000, sessionId: name }),
          async runCommand({ cmd, args }: { cmd: string; args: readonly string[] }) {
            if (cmd === "first") {
              entered.resolve();
              await release.promise;
            }
            if (stopped) throw new Error("Original Vercel session stopped during its command");
            return { exitCode: 0, stdout: async () => `${name}:${args[1] ?? cmd}`, stderr: async () => "" };
          },
          async snapshot() {
            stopped = true;
            return { snapshotId: "snapshot" };
          },
          async stop() {
            stopped = true;
          },
        };
      }
      const create = vi.spyOn(Sandbox, "create")
        .mockResolvedValueOnce(session("original") as unknown as Sandbox)
        .mockResolvedValueOnce(session("replacement") as unknown as Sandbox);
      try {
        const sandbox = normalizeSandboxPaths(await VercelSandbox.create({
          runtime: "node24", lifetimeMs: 60_000, timeout: 130_000, deadlineAt: startedAt.getTime() + 130_000,
          snapshotId: "base", pathPrepend: [],
          feedback: { progress: () => {}, diagnostic: () => {} },
        }), "vercel");
        const first = sandbox.runCommand("first", [], { timeoutMs: 5_000 });
        void first.catch(() => {});
        try {
          await entered.promise;
          const short = await sandbox.runCommand("short", [], { timeoutMs: 5_000 });
          expect(short.stdout).toBe("original:short");
          const longer = shell ? sandbox.runShell("second") : sandbox.runCommand("second");
          await expect(longer).rejects.toMatchObject({ name: "VercelSessionLifetimeError" });
        } finally {
          release.resolve();
          await first.catch(() => {});
        }
        await expect(first).resolves.toMatchObject({ stdout: "original:first", exitCode: 0 });
        await expect(sandbox.runCommand("third")).resolves.toMatchObject({ stdout: "replacement:third", exitCode: 0 });
      } finally {
        release.resolve();
        create.mockRestore();
      }
    }),
    { examples: [[false]], numRuns: 2 },
  );
});
