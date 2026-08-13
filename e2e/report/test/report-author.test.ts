// owner: docs/engineering/testing/e2e/report.md#report-author-dx
// rerun: pnpm e2e --repo report -- --run test/report-author.test.ts

import { expect, test } from "vitest";
import { CLASSIC_EXPERIMENTS, PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";

test("installed CLI loads the typechecked classic report file", async () => {
  await reportE2E.case("author", { artifacts: reportCaseArtifacts() }, async ({ commands: { niceeval, tsc } }) => {
    const checked = await tsc.run(["--noEmit", "-p", "tsconfig.owner.json"]);
    expect(checked.exitCode, checked.diagnostic()).toBe(0);

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

    const singlePage = await niceeval.run(
      ["show", "--report", "./reports/classic-single-page.tsx"],
      { env: PINNED_ENV },
    );
    expect(singlePage.exitCode, singlePage.diagnostic()).toBe(0);
    expect(singlePage.stdout).toMatch(/^Pass rate\s+Experiments\s+Evals/m);
    expect(singlePage.stdout).toContain("Pass rate(%)");
    expect(singlePage.stdout).not.toContain("semantic-document-invalid");
    for (const experimentId of CLASSIC_EXPERIMENTS) {
      expect(singlePage.stdout).toContain(experimentId);
    }

    const missing = await niceeval.run(["show", "--report", "./reports/classic.tsx", "--page", "does-not-exist"], {
      env: PINNED_ENV,
    });
    expect(missing.exitCode, missing.diagnostic()).not.toBe(0);
    expect(missing.stderr).toMatch(/page .*not found|Available pages/i);
    expect(missing.stderr).toContain("overview");
  });
});
