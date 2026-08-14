// owner: e2e/report custom report author DX (0.12 defineReport + public components)
// rerun: pnpm e2e --repo report -- --run test/show/report-author.test.ts

import { expect, test } from "vitest";
import { CLASSIC_BARS, CLASSIC_EXPERIMENTS, CLASSIC_TITLE } from "../support/classic-contract.ts";
import { PINNED_ENV } from "../support/context.ts";
import { terminalReport } from "../support/terminal-report.ts";
import { withClassicWorld } from "../support/world.ts";

test("installed CLI loads the typechecked classic report against the frozen World", async () => {
  await withClassicWorld("show-author", async ({ commands: { niceeval } }) => {
    const shown = await niceeval.run(["show", "--report", "./reports/classic.tsx"], { env: PINNED_ENV });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const report = terminalReport(shown.stdout);
    report.expectTitle(CLASSIC_TITLE);
    report.bars("Pass rate(%)").expectRows(
      CLASSIC_BARS.map((bar) => ({
        label: bar.experiment,
        display: bar.passRate,
        value: Number.parseFloat(bar.passRate) / 100,
      })),
    );
    report.experimentTable(["Experiment", "Model", "Agent", "Avg. time", "Pass rate"]).expectExperiments(
      [...CLASSIC_EXPERIMENTS]
        .reverse()
        .map(({ id, model, agent, passRate }) => ({ id, model, agent, passRate })),
    );

    const missing = await niceeval.run(["show", "--report", "./reports/classic.tsx", "--page", "does-not-exist"], {
      env: PINNED_ENV,
    });
    expect(missing.exitCode, missing.diagnostic()).not.toBe(0);
    expect(missing.stderr).toMatch(/page .*not found|Available pages/i);
    expect(missing.stderr).toContain("overview");
  });
});
