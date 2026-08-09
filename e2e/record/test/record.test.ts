// owner: docs/engineering/testing/e2e/record.md#record-public-api-roundtrip
//
// 只从候选包公开 niceeval/record export 写入并读回；测试不读取或拼接 Record
// 私有文件布局，expected 是公开格式契约中的字面事实。

import { withTempDir } from "@niceeval/testkit";
import { createWriter, openRecord, resolveLocator } from "niceeval/record";
import { expect, it } from "vitest";

const completeEvidenceCoverage = {
  events: { status: "complete" },
  actions: { status: "complete" },
  messages: { status: "complete" },
  usage: { status: "complete" },
  status: { status: "complete" },
  data: { status: "complete" },
} as const;

it("公开 writer 产生的 Run、Attempt 与 events 可由公开 reader 和 locator 完整读回", async () => {
  await withTempDir("niceeval-record-e2e-", async (root) => {
    const writer = createWriter(root, {
      producer: { name: "external-harness", version: "1.0.0" },
    });
    const run = await writer.run({
      experimentId: "public/roundtrip",
      agent: "deterministic-agent",
      model: "fixture-model",
      startedAt: "2026-08-07T00:00:00.000Z",
      configHash: "public-config-hash",
      knownEvalIds: ["greet/hello"],
    });
    await run.writeAttempt(
      {
        id: "greet/hello",
        attempt: 1,
        verdict: "passed",
        durationMs: 42,
        evaluationAlgorithm: "fact-use/v2",
        evaluationKind: "pass",
        factResults: [],
        factUses: [],
        evidenceCoverage: completeEvidenceCoverage,
        facts: { fixture: "record-e2e" },
      },
      {
        events: [{ type: "message", role: "assistant", text: "hello from the public record" }],
      },
    );
    await run.finish({
      completedAt: "2026-08-07T00:00:01.000Z",
      facts: { lane: "pr" },
    });

    const record = await openRecord(root);
    expect(record.unreadable).toEqual([]);
    expect(record.experiments.map((experiment) => experiment.id)).toEqual(["public/roundtrip"]);

    const openedRun = record.experiments[0]!.runs[0]!;
    expect(openedRun.producer).toEqual({ name: "external-harness", version: "1.0.0" });
    expect(openedRun.configHash).toBe("public-config-hash");
    expect(openedRun.knownEvalIds).toEqual(["greet/hello"]);
    expect(openedRun.facts).toEqual({ lane: "pr" });

    const attempt = openedRun.attempts[0]!;
    expect(attempt.evalId).toBe("greet/hello");
    expect(attempt.result).toMatchObject({
      verdict: "passed",
      durationMs: 42,
      facts: { fixture: "record-e2e" },
    });
    expect(await attempt.events()).toEqual([
      { type: "message", role: "assistant", text: "hello from the public record" },
    ]);

    const located = resolveLocator(record, attempt.result.locator);
    expect(located.evalId).toBe("greet/hello");
    expect(located.result.locator).toBe(attempt.result.locator);
  });
});
