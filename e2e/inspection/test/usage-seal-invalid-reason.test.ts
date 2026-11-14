import { only } from "@niceeval/testkit";

import { expect, test } from "vitest";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/adapters/README.md
// @regression memory/adapter-seal-reason-diagnostic.md
test.concurrent("非法封存原因在调用处解释格式，捕获后仍保留采集错误与已登记用量", async () => {
  await inspectionE2E.case("usage-seal-invalid-reason", { artifacts: inspectionCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "usage-seal-invalid-reason", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "usage-seal-invalid-reason", run.diagnostic());
    expect(event.verdict).toBe("errored");

    const attempt = await niceeval.run(["show", event.locator, "--json"]);
    expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
    const entry = only(attempt.inspectionSuccess("attempt.get").attempt.assertions.entries, () => true, attempt.diagnostic());

    const detail = await niceeval.run(["show", event.locator, entry.entryId, "--full", "--json"]);
    expect(detail.exitCode, detail.diagnostic()).toBe(0);
    expect(detail.inspectionSuccess("attempt.assertion.detail").assertion.check).toMatchObject({ state: "matched" });

    const read = await niceeval.run(["show", event.locator, "usage", "--json"]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    expect(read.inspectionSuccess("attempt.usage").usage).toMatchObject({ state: "partial", calls: [{ callId: "accepted" }] });
  });
});
