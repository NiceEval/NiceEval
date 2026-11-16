import { only } from "@niceeval/testkit";

import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/adapters/README.md
// @regression memory/adapter-cache-read-report.md
test.concurrent("按用途与真实模型判定缓存读取率并解释覆盖缺口", async () => {
  await inspectionE2E.case(
    "cache-read",
    { artifacts: inspectionCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      for (const scenario of [
        "exact",
        "missing",
        "zero",
        "partial",
        "unsealed",
        "uncached",
        "unsafe",
        "empty",
        "capacity",
      ]) {
        const run = await niceeval.run(["exp", `cache-read-${scenario}`, "--rerun", "all", "--json"]);
        expect(run.exitCode, run.diagnostic()).toBe(0);
        const event = only(run.expEvalEvents(), (item) => item.evalId === "cache-read", run.diagnostic());
        expect(event.verdict).toBe("passed");

        const read = await niceeval.run(["show", event.locator, "usage", "--json"]);
        expect(read.exitCode, read.diagnostic()).toBe(0);
        const report = read.inspectionSuccess("attempt.usage").usage.cacheRead;
        const planner = only(report.roles, (group) => group.modelRole === "planner", read.diagnostic());
        expect(only(report.roles, (group) => group.modelRole === "unused", read.diagnostic()).rate.state).toBe(
          "unavailable",
        );
        if (scenario === "exact") {
          expect(report.total).toMatchObject({
            rate: { state: "exact", value: 910 / 1100 },
            recordedCalls: 2,
            coveredCalls: 2,
            collectionComplete: true,
            reasons: [],
          });
          expect(planner.rate).toEqual(report.total.rate);
          expect(report.models).toMatchObject([
            { provider: null, model: "fallback", rate: { state: "exact", value: 0.1 } },
            { provider: "offline", model: "primary", rate: { state: "exact", value: 0.9 } },
          ]);
          const shown = await niceeval.run(["show", event.locator, "usage"]);
          expect(shown.exitCode, shown.diagnostic()).toBe(0);
          expect(shown.stdout).toContain("Cache read rate");
          expect(shown.stdout).toContain("82.73%");
          expect(shown.stdout).toContain("no-calls");
        } else if (scenario === "missing") {
          expect(planner).toMatchObject({
            rate: { state: "unavailable", reason: "cache-read-missing" },
            coveredCalls: 0,
            recordedCalls: 2,
            missingCacheReadCalls: 1,
            missingInputTotalCalls: 1,
          });
          expect(only(report.roles, (group) => group.modelRole === "reviewer", read.diagnostic())).toMatchObject({
            coveredCalls: 1,
            unknownStatusCalls: 1,
            rate: { state: "unavailable", reason: "call-status-unknown" },
          });
        } else if (scenario === "zero") {
          expect(planner.rate).toEqual({ state: "unavailable", reason: "zero-input-total" });
        } else if (scenario === "uncached") {
          expect(planner.rate).toEqual({ state: "exact", value: 0 });
        } else if (scenario === "unsafe") {
          expect(planner.rate).toEqual({ state: "unavailable", reason: "unsafe-token-total" });
        } else if (scenario === "empty") {
          expect(report.total.rate).toEqual({ state: "unavailable", reason: "no-calls" });
          expect(report.models).toEqual([]);
        } else if (scenario === "capacity") {
          expect(Buffer.byteLength(read.stdout)).toBeGreaterThan(512 * 1024);
          expect(report.models).toHaveLength(2000);
          expect(planner).toMatchObject({
            rate: { state: "exact", value: 1 },
            coveredCalls: 2000,
            recordedCalls: 2000,
          });
        } else {
          expect(planner).toMatchObject({
            rate: { state: "unavailable", reason: "collection-incomplete" },
            coveredCalls: 1,
            recordedCalls: 1,
            collectionComplete: false,
          });
        }
      }
    },
  );
});
