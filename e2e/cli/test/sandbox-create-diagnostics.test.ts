import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @issue docs/issues/instabox-preparation-timeout-operation.md
// @feature docs/feature/sandbox/README.md
test.concurrent.each([
  ["snapshot", /snapshot lookup/i],
  ["allocation", /allocation could not be reconciled/i],
  ["grant", /SSH grant/i],
] as const)("show identifies a sandbox creation timeout during %s", async (stage, operation) => {
  await cliE2E.case(`instabox-timeout-${stage}`, {}, async ({ commands: { niceeval }, paths }) => {
    await writeFile(
      join(paths.projectRoot, "experiments", "create-timeout.ts"),
      `
import { defineExperiment } from "niceeval";
import { instaboxSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../agents/deterministic.ts";
export default defineExperiment({
  adapter: preContextErrorAgent,
  sandbox: instaboxSandbox({ snapshotId: "sn_fixture" }),
  evals: ["greet/hello"],
});`,
    );
    const preload = pathToFileURL(join(paths.projectRoot, "fixtures/cloud-lifetime/preparation-timeout.mjs"));
    const result = await niceeval.run(["exp", "create-timeout", "--json"], {
      env: { NODE_OPTIONS: `--import=${preload.href}`, INSTABOX_API_KEY: "fixture-key", NICEEVAL_TEST_TIMEOUT: stage },
    });
    expect(result.exitCode, result.diagnostic()).toBe(1);
    const [event] = result.expEvalEvents();
    expect(event, result.diagnostic()).toMatchObject({ verdict: "errored", locator: expect.any(String) });
    const timing = await niceeval.run(["show", event!.locator!, "timing", "--json"]);
    expect(timing.attemptTiming().timing.activities).toContainEqual(
      expect.objectContaining({ label: "sandbox.create", outcome: "failed" }),
    );
    const trace = await niceeval.run(["show", event!.locator!, "execution", "--json"]);
    const error = trace.attemptTrace().trace.diagnostics.items.find((item) => item.kind === "execution-error");
    expect(error?.summary).toMatch(operation);
    expect(error?.summary).toMatch(/timed out|timeout/i);
    if (stage === "allocation") expect(error?.summary).toContain("deletion deadline");
  });
});
