import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  command,
  type ExpEvalEvent,
  type ExpEvent,
  withProjectCopy,
} from "@niceeval/testkit";
import { expect } from "vitest";

const requiredSecrets = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

function requireLiveSecrets(): void {
  const missing = requiredSecrets.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`[configuration] OpenAI converter live E2E requires ${missing.join(", ")}`);
  }
}

export async function proveOpenAiLiveOwner(options: {
  experimentId: string;
  evalId: string;
  caseName: string;
  executionMarkers: readonly string[];
}): Promise<void> {
  requireLiveSecrets();
  await withProjectCopy(
    {
      from: process.cwd(),
      prefix: `niceeval-openai-${options.caseName}-`,
      omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
      links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
    },
    async ({ root }) => {
      const run = await niceeval.run(
        ["exp", options.experimentId, "--rerun", "all", "--json"],
        { cwd: root, timeoutMs: 4 * 60_000 },
      );
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const events = run.ndjson<ExpEvent>();
      // The final stream event is the Record v1 InvocationReceipt; it carries no
      // verdicts, so business results come from each eval event's identity and
      // verdict below (docs/feature/experiments/cli.md).
      const receipt = run.expReceipt();
      expect(receipt.completion).toBe("completed");
      expect(receipt.runIds, run.diagnostic()).not.toHaveLength(0);
      const evalEvent = events.find(
        (event): event is ExpEvalEvent =>
          "event" in event && event.event === "eval" && event.evalId === options.evalId,
      );
      expect(evalEvent, run.diagnostic()).toBeDefined();
      expect(evalEvent).toMatchObject({
        evalId: options.evalId,
        experimentId: options.experimentId,
        verdict: "passed",
        attempts: 1,
      });
      expect(evalEvent?.locator, run.diagnostic()).toBeTruthy();

      const history = await niceeval.run(["show", options.evalId, "--exp", options.experimentId, "--history"], {
        cwd: root,
      });
      expect(history.exitCode, history.diagnostic()).toBe(0);
      expect(history.stdout).toContain("passed");
      expect(history.stdout).toContain("@");

      const execution = await niceeval.run(["show", evalEvent!.locator!, "--execution"], { cwd: root });
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      for (const marker of options.executionMarkers) expect(execution.stdout).toContain(marker);
    },
    {
      stageArtifacts: {
        destinationRoot: process.cwd(),
        entries: [
          {
            source: ".niceeval",
            target: join(
              ".niceeval",
              "e2e-artifacts",
              process.env.NICEEVAL_E2E_INVOCATION_ID ?? `local-${process.pid}-${randomUUID()}`,
              options.caseName,
            ),
            optional: true,
          },
        ],
        collision: "error",
      },
    },
  );
}
