// owner: e2e/report show --timing — public phase identity or unavailable
// rerun: pnpm e2e --repo report -- --run test/show/report-timing.test.ts

import { expect, test } from "vitest";
import { PINNED_ENV } from "../support/context.ts";
import { assertPublicShowJson } from "../support/show-json.ts";
import { terminalReport } from "../support/terminal-report.ts";
import { withClassicWorld } from "../support/world.ts";

test("show --timing reports the prepared attempt's available public phase identity without locking duration", async () => {
  await withClassicWorld("show-timing", async ({ commands: { niceeval }, world }) => {
    const locator = world.attemptLocator("classic/baseline", "classic/tool-note");
    const shown = await niceeval.run(["show", locator, "--timing"], { env: PINNED_ENV });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    terminalReport(shown.stdout).expectTiming({
      locator,
      evalId: "classic/tool-note",
      experimentId: "classic/baseline",
      verdict: "passed",
      phases: [
        { name: "eval.run", children: ["turn turn1"] },
        { name: "assertions.evaluate", children: [] },
      ],
    });

    const json = await niceeval.run(["show", locator, "--timing", "--json"], { env: PINNED_ENV });
    expect(json.exitCode, json.diagnostic()).toBe(0);
    const document = assertPublicShowJson(json.json());
    expect(document.view).toBe("timing");
    const data = document.data as {
      kind?: string;
      phases?: readonly {
        name?: string;
        durationMs?: number;
        children?: readonly { key?: string; label?: string; durationMs?: number }[];
      }[];
    };
    expect(data.kind).toBe("attempt");
    expect(data.phases?.map((phase) => phase.name)).toEqual(["eval.run", "assertions.evaluate"]);
    expect(data.phases?.[0]?.children?.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "agent.turn", label: "turn1" },
    ]);
    for (const phase of data.phases!) {
      expect(phase.durationMs, `duration for ${phase.name}`).toEqual(expect.any(Number));
      expect(phase.durationMs!, `duration for ${phase.name}`).toBeGreaterThanOrEqual(0);
      for (const child of phase.children ?? []) {
        expect(child.durationMs, `duration for ${phase.name}/${child.label}`).toEqual(expect.any(Number));
        expect(child.durationMs!, `duration for ${phase.name}/${child.label}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
