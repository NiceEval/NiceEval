import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command, type ProcessReceipt, withProjectCopy } from "@niceeval/testkit";
import { expect } from "vitest";

const requiredSecrets = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  status?: string;
  passed?: number;
  failed?: number;
  errored?: number;
  completion?: string;
}

function requireLiveSecrets(): void {
  const missing = requiredSecrets.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`[configuration] OpenAI converter live E2E requires ${missing.join(", ")}`);
  }
}

function expectSuccess(receipt: ProcessReceipt): void {
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  expect(receipt.signal, receipt.diagnostic()).toBeNull();
  expect(receipt.timedOut, receipt.diagnostic()).toBe(false);
  expect(receipt.stderr, receipt.diagnostic()).toBe("");
  expect(receipt.stdout, receipt.diagnostic()).not.toMatch(/[\x1b\x08]/);
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
      await mkdir(join(root, "junit"), { recursive: true });
      const run = await niceeval.run(
        ["exp", options.experimentId, "--rerun", "all", "--json", "--junit", `junit/${options.caseName}.xml`],
        { cwd: root, timeoutMs: 4 * 60_000 },
      );
      expectSuccess(run);
      const events = run.ndjson<ExpEvent>();
      expect(events.at(-1)).toMatchObject({
        event: "result",
        status: "passed",
        passed: 1,
        failed: 0,
        errored: 0,
        completion: "complete",
      });
      const evalEvent = events.find(
        (event) => event.event === "eval" && event.evalId === options.evalId && event.locator !== undefined,
      );
      expect(evalEvent, run.diagnostic()).toBeDefined();

      const junit = await readFile(join(root, "junit", `${options.caseName}.xml`), "utf8");
      expect(junit).toContain("<testsuite");
      expect(junit).not.toContain("<failure");
      expect(junit).not.toContain("<error");

      const history = await niceeval.run(["show", options.evalId, "--exp", options.experimentId, "--history"], {
        cwd: root,
      });
      expectSuccess(history);
      expect(history.stdout).toContain("passed");
      expect(history.stdout).toContain("@");

      const execution = await niceeval.run(["show", evalEvent!.locator!, "--execution"], { cwd: root });
      expectSuccess(execution);
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
          {
            source: "junit",
            target: join(
              "junit",
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
