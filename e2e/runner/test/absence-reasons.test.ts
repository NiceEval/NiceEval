// rerun: pnpm e2e test --candidate source --repo runner -- --run test/absence-reasons.test.ts
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
test.concurrent.each([
  { mode: "fail-fast", reason: "stopped-by-failure", published: 2, absent: 1 },
  { mode: "early-exit", reason: "early-exit-satisfied", published: 1, absent: 2 },
  { mode: "budget", reason: "budget-exhausted", published: 0, absent: 3 },
])("Run preserves the $mode reason for unpublished planned attempts", async ({ mode, reason, published, absent }) => {
  await runnerE2E.case(`absence-${mode}`, {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "absence-reasons", "--rerun", "all", "--json"], {
      env: { NICEEVAL_ABSENCE_MODE: mode },
    });
    expect(result.exitCode, result.diagnostic()).toBe(mode === "early-exit" ? 0 : 1);
    const runIds = result.expReceipt().createdRunIds;
    expect(runIds).toHaveLength(1);
    const shown = await niceeval.run(["show", `run:${runIds[0]}`, "--json"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const slots = shown.run().run.plannedAttempts;
    expect(slots).toHaveLength(3);
    expect(slots.filter((slot) => slot.publication.state === "published")).toHaveLength(published);
    expect(slots.filter((slot) => slot.publication.state === "absent").map((slot) => slot.publication)).toEqual(
      Array.from({ length: absent }, () => expect.objectContaining({ state: "absent", reason })),
    );
  });
});
