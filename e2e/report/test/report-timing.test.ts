// owner: docs/engineering/testing/e2e/report.md#report-timing
// rerun: pnpm e2e --repo report -- --run test/report-timing.test.ts

import { expect, test } from "vitest";
import { PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";
import { classicExpFacts } from "./support/exp.ts";
import { assertPublicShowJson } from "./support/show-json.ts";

const PUBLIC_PHASES = [
  "sandbox.queue",
  "sandbox.create",
  "sandbox.prepare",
  "agent.ensure",
  "workspace.baseline",
  "agent.setup",
  "telemetry.configure",
  "eval.run",
  "workspace.diff",
  "assertions.evaluate",
  "telemetry.collect",
  "agent.teardown",
  "sandbox.cleanup",
  "sandbox.stop",
] as const;

test("show --timing reports public phase identity or unavailable, never locks duration", async () => {
  await reportE2E.case("timing", { artifacts: reportCaseArtifacts() }, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "classic/baseline", "--rerun", "all", "--json"], {
      env: PINNED_ENV,
      timeoutMs: 120_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const locator = classicExpFacts(run.stdout).locator("classic/baseline", "classic/tool-note");

    const shown = await niceeval.run(["show", locator, "--timing"], { env: PINNED_ENV });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const unavailable = shown.stdout.includes("phase timing unavailable");
    const named = PUBLIC_PHASES.filter((phase) => shown.stdout.includes(phase));
    expect(unavailable || named.length > 0, shown.stdout).toBe(true);

    const json = await niceeval.run(["show", locator, "--timing", "--json"], { env: PINNED_ENV });
    expect(json.exitCode, json.diagnostic()).toBe(0);
    const document = assertPublicShowJson(json.json());
    expect(document.view).toBe("timing");
    const data = document.data as { kind?: string; phases?: readonly { name?: string; durationMs?: number }[] };
    if (data.kind === "attempt" && Array.isArray(data.phases) && data.phases.length > 0) {
      for (const phase of data.phases) {
        expect(PUBLIC_PHASES, `unexpected phase ${phase.name}`).toContain(phase.name);
        expect(typeof phase.durationMs === "number" || phase.durationMs === undefined).toBe(true);
      }
    }
  });
});
