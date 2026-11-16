import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("Timing continuation reads every activity exactly once and rejects a different Attempt", async () => {
  await inspectionE2E.case("timing-pages", async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "timing-pages", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const locator = only(run.expEvalEvents(), () => true, run.diagnostic()).locator;
    const first = await niceeval.run(["show", locator, "timing", "--json"]);
    expect(first.exitCode, first.diagnostic()).toBe(0);
    const document = first.attemptTiming();
    expect(document.timing.hasMore).toBe(true);
    expect(document.timing.continuation).toEqual(expect.any(String));
    expect(document.links).toContainEqual({
      rel: "next-page",
      command: `niceeval show ${locator} timing --continuation ${document.timing.continuation}`,
    });
    const human = await niceeval.run(["show", locator, "timing"]);
    expect(human.exitCode, human.diagnostic()).toBe(0);
    expect(human.stdout).toContain("Next");
    expect(human.stdout).toContain(`niceeval show ${locator} timing --continuation`);
    const activities = [...document.timing.activities];
    let page = document.timing;
    let pages = 1;
    while (page.hasMore) {
      expect(pages++).toBeLessThan(10);
      const read = await niceeval.run(["show", locator, "timing", "--continuation", page.continuation!, "--json"]);
      expect(read.exitCode, read.diagnostic()).toBe(0);
      page = read.attemptTiming().timing;
      activities.push(...page.activities);
    }
    expect(pages).toBeGreaterThan(2);
    expect(page.omittedActivityCount).toBe(0);
    expect(page.continuation).toBeUndefined();
    expect(new Set(activities.map((activity) => activity.activityId)).size).toBe(activities.length);
    const evaluation = only(activities, (activity) => activity.label === "eval.run");
    expect(
      activities.filter(
        (activity) =>
          activity.phase === "sandbox.command" &&
          activity.label === "printf" &&
          activity.parentActivityId === evaluation.activityId,
      ),
    ).toHaveLength(140);
    expect(activities.length).toBe(document.timing.activities.length + document.timing.omittedActivityCount);
    const other = await niceeval.run(["exp", "timing-pages", "--rerun", "all", "--json"]);
    expect(other.exitCode, other.diagnostic()).toBe(0);
    const otherLocator = only(other.expEvalEvents(), () => true, other.diagnostic()).locator;
    const stale = await niceeval.run([
      "show",
      otherLocator,
      "timing",
      "--continuation",
      document.timing.continuation!,
      "--json",
    ]);
    expect(stale.exitCode, stale.diagnostic()).not.toBe(0);
    expect(stale.stdout).toContain("restart-required");
  });
});
