// owner: docs/engineering/testing/e2e/migrate.md#historical-v1-labels

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ATTEMPT_ID, commitRecord, copyV1Fixture, e2e, RUN_ID, sha256 } from "./support.ts";

for (const [caseName, historicalLabel] of [
  ["historical-leading-zero-label", "turn01"],
  ["historical-large-integer-label", "turn999999999999999999999"],
] as const) {
  test(`v1 合法历史 label ${historicalLabel} 无损迁移`, async () => {
    await e2e.case(caseName, async ({ paths, commands: { candidate }, run }) => {
      const recordRoot = join(paths.projectRoot, ".niceeval", "record");
      copyV1Fixture(paths.sourceRoot, recordRoot);
      const attemptAttachment = join(recordRoot, "runs", RUN_ID, "attempts", ATTEMPT_ID, "attachments", "niceeval.observability");
      const payloadPath = join(attemptAttachment, "payload.json");
      const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as { "timing-data": { intervals: Array<{ phase: string; label: string }> } };
      const send = payload["timing-data"].intervals.find((interval) => interval.phase === "agent.send");
      expect(send).toBeDefined();
      send!.label = historicalLabel;
      writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`);
      const payloadBefore = sha256(payloadPath);
      await commitRecord(run, `fixture: ${caseName}`);
      const migrated = await candidate.run(["migrate", "--yes"]);
      expect(migrated.exitCode, migrated.diagnostic()).toBe(0);
      expect(sha256(payloadPath)).toBe(payloadBefore);
      expect(JSON.parse(readFileSync(payloadPath, "utf8"))["timing-data"].intervals).toContainEqual(
        expect.objectContaining({ phase: "agent.send", label: historicalLabel }),
      );
    });
  });
}
