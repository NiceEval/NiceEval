import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeExpPrepareEvent, decodeExpTerminalEvent } from "niceeval/experiment/host";
import { decodeInspectionDocument, narrowInspectionSuccess } from "niceeval/inspection";
import { beforeAll, expect, test, vi } from "vitest";
import fc from "fast-check";
import { InstaboxBackend } from "../../packages/niceeval/src/sandbox/instabox/sandbox.ts";
import { createLifecycleProject, runCli } from "./fixtures/lifecycle-sandbox/harness.ts";

const secret = "private-fixture-value";
const statuses = [
  { status: 403, code: "permission_denied" },
  { status: 404, code: "not_found" },
] as const;
const observations = new Map<number, { trace: string; snapshotName: string }>();

for (const { status, code } of statuses) {
  beforeAll(async () => {
    vi.stubEnv("INSTABOX_API_KEY", secret);
    const project = await createLifecycleProject({
      attempts: 1,
      maxConcurrency: 1,
      failCreates: [],
      scripts: [{ cleanups: 0, beforeFails: false, test: "pass" }],
    });
    try {
      vi.stubEnv("NICEEVAL_HOME", project.cwd);
      let snapshotName = "";
      let statusReads = 0;
      const probe = vi.spyOn(InstaboxBackend.prototype, "runCommand").mockImplementation(async (command, args) => ({
        exitCode: 0,
        stdout:
          command === "cat" && args?.[0] === "/proc/self/mountinfo"
            ? "1 0 0:1 / / rw - tmpfs tmpfs rw\n"
            : command === "bash" && args?.[1]?.includes("uname -s")
              ? "Linux\nx86_64\nldd (GNU libc)\n"
              : "",
        stderr: "",
      }));
      vi.stubGlobal("fetch", (async (input, init) => {
        const url = new URL(String(input));
        expect(url.origin).toBe("https://api.instabox.sh");
        switch (`${init?.method ?? "GET"} ${url.pathname}`) {
          case "POST /v1/machines":
            return Response.json(
              { id: "create", machineId: "fixture-machine", state: "succeeded", error: null },
              { status: 202 },
            );
          case "GET /v1/machines/fixture-machine":
            return Response.json({
              id: "fixture-machine",
              state: "running",
              operationId: null,
              runtime: { ready: true },
            });
          case "POST /v1/machines/fixture-machine/ssh-tokens":
            return Response.json({
              id: "grant",
              machineId: "fixture-machine",
              token: secret,
              host: "unused.fixture",
              port: 22,
              hostKeyFingerprint: "SHA256:AAAA",
            });
          case "DELETE /v1/machines/fixture-machine":
            return Response.json({ id: "delete", machineId: "fixture-machine", state: "succeeded", error: null });
          case "POST /v1/machines/fixture-machine/snapshots":
            snapshotName = JSON.parse(String(init?.body)).name;
            return Response.json({ id: "sn_fixture", name: snapshotName, status: "pending" }, { status: 202 });
          case "GET /v1/snapshots/sn_fixture":
            statusReads++;
            return Response.json(
              { error: { code, requestId: `req-${status}`, message: secret, stack: secret } },
              { status },
            );
          case "GET /v1/snapshots":
            return Response.json({ snapshots: [{ id: "sn_fixture", name: snapshotName, status: "pending" }] });
          default:
            throw new Error(`Unexpected fixture request: ${init?.method ?? "GET"} ${url.pathname}`);
        }
      }) satisfies typeof fetch);
      try {
        await writeFile(
          join(project.cwd, "experiments/lifecycle.ts"),
          `
import { defineExperiment } from "niceeval";
import { instaboxSandbox, shell } from "niceeval/sandbox";
import agent from "../agent.ts";
export default defineExperiment({
adapter: agent,
sandbox: instaboxSandbox({ template: "fixture", lifetimeMs: 600_000 })
  .before(shell({ id: "fixture-prefix", command: "true" })),
evals: "*",
});
`,
        );
        const result = await runCli(project.cwd, ["exp", "lifecycle", "--rerun", "all", "--json"], {
          NICEEVAL_HOME: project.cwd,
        });
        expect(result.code, result.stderr || result.stdout).toBe(0);
        const events = result.stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(decodeExpTerminalEvent(events.at(-1)).summary.beforeCaches).toEqual({
          total: 1,
          hit: 0,
          prepared: 0,
          degraded: 1,
          failed: 0,
        });
        expect(
          events
            .filter((event) => event.event === "prepare")
            .map(decodeExpPrepareEvent)
            .at(-1),
        ).toMatchObject({ phase: "settled", outcome: "degraded", reason: "snapshot-uncertain" });
        expect(statusReads).toBe(1);
        const locator = events.find((event) => event.event === "eval")?.locator;
        expect(locator).toEqual(expect.any(String));
        const show = await runCli(project.cwd, ["show", locator, "execution", "--json"]);
        expect(show.code, show.stderr || show.stdout).toBe(0);
        observations.set(status, { trace: show.stdout, snapshotName });
      } finally {
        probe.mockRestore();
        vi.unstubAllGlobals();
      }
    } finally {
      vi.unstubAllEnvs();
      await project.dispose();
    }
  });
}

// @feature docs/feature/sandbox/README.md#preparation-failure
test("the public execution trace explains an accepted snapshot's failed status read", () => {
  fc.assert(
    fc.property(fc.constantFrom(...statuses), ({ status, code }) => {
      const { trace, snapshotName } = observations.get(status)!;
      const document = decodeInspectionDocument(JSON.parse(trace));
      if (!document.success) throw new Error(document.reason);
      const result = narrowInspectionSuccess(document.value, "attempt.trace");
      if (!result.success) throw new Error(result.reason);
      const diagnostic = result.value.trace.diagnostics.items.find((item) => item.code === "cache-degraded");
      expect(diagnostic?.summary).toContain("snapshot-uncertain");
      expect(diagnostic?.causes).toEqual([
        {
          code: "snapshot-post-accepted",
          summary: "Instabox snapshot POST accepted with status pending",
          summaryTruncated: false,
        },
        {
          code: code.replaceAll("_", "-"),
          summary: `Instabox snapshot status GET failed: HTTP ${status}, ${code}, requestId=req-${status}`,
          summaryTruncated: false,
        },
      ]);
      expect(trace).not.toContain(secret);
      expect(trace).not.toContain(snapshotName);
    }),
    { examples: [[statuses[0]]], numRuns: 6 },
  );
});
