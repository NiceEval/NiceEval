// owner: docs/engineering/testing/e2e/adapter/sdk-converters.md#claude-sdk-stream-deterministic
// rerun: pnpm e2e --repo adapter/sdk-converters -- --run test/claude-sdk-stream.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { sdkConverterE2E, sdkConverterRecordArtifacts } from "./support.ts";

const EXPECTED = [{
  experimentId: "claude-sdk-stream",
  evalId: "claude-sdk-stream",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

test("createClaudeSdkEventStream 的锁定上游帧经 Experiment 和公开 CLI 确定性读回", async () => {
  await sdkConverterE2E.case(
    "claude-sdk-stream",
    sdkConverterRecordArtifacts,
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run([
        "exp", "claude-sdk-stream", "--rerun", "all", "--json",
      ]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const receipt = run.expReceipt();
      expect(receipt.completion, run.diagnostic()).toBe("completed");
      expect(receipt.invocationId, run.diagnostic()).toBeTruthy();
      expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
      const events = assertExpEvalOutcomes(run.expEvalEvents(), EXPECTED, () => run.diagnostic());
      const event = exactEval(events, EXPECTED[0], () => run.diagnostic());

      const shown = await niceeval.run(["show", "--run", receipt.runIds[0]!, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(
        shown.json<{ selection: { kind: string; runIds: readonly string[] } }>().selection,
        shown.diagnostic(),
      ).toMatchObject({ kind: "explicit-runs", runIds: [receipt.runIds[0]!] });

      const source = await niceeval.run(["show", event.locator, "--source"]);
      expect(source.exitCode, source.diagnostic()).toBe(0);
      expect(source.stdout).toContain("Recorded source");
      expect(source.stdout).toContain("evals/claude-sdk-stream.eval.ts");
      expect(source.stdout).toContain("sourceItem");
      expect(source.stdout).toContain("available");
      expect(source.stdout).toContain("export default defineEval({");

      const execution = await niceeval.run([
        "show", event.locator, "--execution", "--json",
      ]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      expect(execution.stdout).toContain("claude-sdk-assistant-marker");
      expect(execution.stdout).toMatch(/"tool":"(?:shell|Bash)"/);
      expect(execution.stdout).toContain('"tool":"Read"');
      expect(execution.stdout).toContain('"tool":"Write"');
      expect(execution.stdout).toContain("rejected");
    },
  );
});
