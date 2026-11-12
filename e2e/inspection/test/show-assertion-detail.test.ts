import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { judgeUsageChatResponse, judgeUsageHttp } from "../fixtures/judge-usage-http.ts";
import { inspectionCaseArtifacts, inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/show-assertion-rationale-hidden.md
test.concurrent("终端断言详情显示已保存的 Judge 理由并提供有效下钻", async () => {
  await inspectionE2E.case("show-assertion-detail", { artifacts: inspectionCaseArtifacts() }, async ({ commands: { niceeval } }) => {
    const fixture = judgeUsageHttp([{ status: 200, body: judgeUsageChatResponse({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }) }]);
    try {
      const baseUrl = await fixture.listen();
      const run = await niceeval.run(["exp", "judge-usage-tokens", "--rerun", "all", "--json"], { env: { NICEEVAL_E2E_JUDGE_USAGE_URL: baseUrl } });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const event = only(run.expEvalEvents(), (item) => item.evalId === "judge-usage-qa", run.diagnostic());
      const attempt = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.get", locator: event.locator } })]);
      expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
      const entry = only(attempt.querySuccess("attempt.get").attempt.assertions.entries, (item) => item.display.label === "Answer QA", attempt.diagnostic());
      const detail = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.assertion.detail", locator: event.locator, entryId: entry.entryId } })]);
      expect(detail.exitCode, detail.diagnostic()).toBe(0);
      expect(JSON.stringify(detail.querySuccess("attempt.assertion.detail").assertion.check)).toContain("The answer names Paris.");
      const listed = await niceeval.run(["show", event.locator, "--assertions"]);
      expect(listed.exitCode, listed.diagnostic()).toBe(0);
      expect(listed.stdout).toContain("The answer names Paris.");
      expect(listed.stdout).not.toMatch(/Rationale\s+not-recorded/u);
      expect(listed.stdout).toContain("--full");
      const shown = await niceeval.run(["show", event.locator, "--assertions", "--entry", entry.entryId, "--full"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("The answer names Paris.");
      expect(shown.stdout).not.toContain(`--entry ${JSON.stringify(entry.entryId)} --full`);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      expect(await fixture.close()).toEqual({ listening: false, openConnections: 0 });
    }
  });
});
