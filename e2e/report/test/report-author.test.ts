// owner: e2e/report custom report author DX (0.12 defineReport + public components)
// rerun: pnpm e2e --repo report -- --run test/report-author.test.ts

import { expect, test } from "vitest";
import { CLASSIC_EXPERIMENTS, PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";

test("installed CLI loads the typechecked classic report file", async () => {
  await reportE2E.case("author", { artifacts: reportCaseArtifacts() }, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "classic", "--rerun", "all", "--json"], {
      env: PINNED_ENV,
      timeoutMs: 120_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(1);

    const shown = await niceeval.run(["show", "--report", "./reports/classic.tsx"], { env: PINNED_ENV });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("MemoryBench Classic");
    expect(shown.stdout).toContain("Leaderboard");
    expect(shown.stdout).toMatch(/Pass rate|通过率/);
    for (const experimentId of CLASSIC_EXPERIMENTS) {
      expect(shown.stdout).toContain(experimentId);
    }

    const missing = await niceeval.run(["show", "--report", "./reports/classic.tsx", "--page", "does-not-exist"], {
      env: PINNED_ENV,
    });
    expect(missing.exitCode, missing.diagnostic()).not.toBe(0);
    expect(missing.stderr).toMatch(/page .*not found|Available pages/i);
    expect(missing.stderr).toContain("overview");
  });
});
