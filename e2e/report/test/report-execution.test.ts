// owner: docs/engineering/testing/e2e/report.md#report-execution-evidence
// kill:
// - inverse = unwrap timing JSON to bare PublicTimingJson; outcome = the
//   expected Calculation envelope fails before any phase assertion can pass.
// rerun: pnpm e2e --repo report -- --run test/report-execution.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
}

interface TimingPhase {
  readonly name: string;
  readonly durationMs: number;
}

interface TimingShowDocument {
  readonly format: "niceeval.show";
  readonly schemaVersion: 1;
  readonly view: "timing";
  readonly problemTable: readonly unknown[];
  readonly data: {
    readonly state: "available";
    readonly inputState: "complete";
    readonly problemIds: readonly number[];
    readonly value: {
      readonly kind: "attempt";
      readonly locator: string;
      readonly durationMs: number | null;
      readonly phases: readonly TimingPhase[];
    };
  };
}

interface ExecutionEvidence<Value> {
  state: string;
  value?: Value;
}

interface ExecutionShowDocument {
  format: string;
  schemaVersion: number;
  view: string;
  problemTable: readonly unknown[];
  data: {
    state: string;
    inputState?: string;
    problemIds: readonly number[];
    value?: {
      kind: string;
      identity: {
        locator: string;
        selectedRunId: string;
        originRunId: string;
        slotId: string;
        memberRelation: string;
      };
      evaluation: ExecutionEvidence<{
        experimentId: string;
        evalId: string;
        attempt: number;
        kind: string;
      }>;
      conversation: ExecutionEvidence<{
        collection: { state: string };
        items: readonly {
          kind?: string;
          role?: string;
          text?: string;
          tool?: string;
          inputSummary?: string;
        }[];
      }>;
      commands: ExecutionEvidence<{
        collection: { state: string };
        commands: readonly unknown[];
      }>;
      usage: ExecutionEvidence<{
        collection: { state: string };
        observations: readonly {
          kind?: string;
          amount?: string;
          currency?: string;
        }[];
      }>;
      timing: ExecutionEvidence<{
        collection: { state: string };
        intervals: readonly { phase?: string; label?: string }[];
      }>;
      diagnostics: ExecutionEvidence<{
        collection: { state: string };
        diagnostics: readonly unknown[];
      }>;
    };
  };
}

test("show --execution 呈现本轮 conversation 与工具入参", async () => {
  await reportE2E.case(
    "execution",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const toolCall = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "tool-call" && event.locator !== undefined,
        run.diagnostic(),
      );

      const shown = await niceeval.run(
        ["show", toolCall.locator!, "--execution"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("Deterministic report fixture response.");
      expect(shown.stdout).toContain("write_file");
      expect(shown.stdout).toContain("report-notes.txt");
      expect(shown.stdout).toContain("report-execution-sentinel-914");
      expect(shown.stdout).toMatch(/\bconversation\b/i);
      expect(shown.stdout).toMatch(/\bcompleted\b/i);

      const json = await niceeval.run(
        ["show", toolCall.locator!, "--execution", "--json"],
      );
      expect(json.exitCode, json.diagnostic()).toBe(0);
      const document = json.json<ExecutionShowDocument>();
      expect(document).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "execution",
        problemTable: [],
        data: {
          state: "available",
          inputState: "complete",
          problemIds: [],
          value: {
            kind: "attempt-execution",
            identity: {
              locator: toolCall.locator,
              memberRelation: "origin",
            },
            evaluation: {
              state: "available",
              value: {
                experimentId: "main",
                evalId: "tool-call",
                attempt: 0,
                kind: "pass",
              },
            },
            conversation: { state: "available", value: { collection: { state: "complete" } } },
            commands: {
              state: "available",
              value: { collection: { state: "complete" }, commands: [] },
            },
            usage: { state: "available", value: { collection: { state: "complete" } } },
            timing: { state: "available", value: { collection: { state: "complete" } } },
            diagnostics: {
              state: "available",
              value: { collection: { state: "complete" }, diagnostics: [] },
            },
          },
        },
      });
      const value = document.data.value!;
      expect(value.identity.selectedRunId).toBe(value.identity.originRunId);
      expect(value.identity.slotId).toMatch(/^slot-/);
      expect(value.conversation.value?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          role: "assistant",
          text: "Deterministic report fixture response.",
        }),
        expect.objectContaining({
          kind: "tool-call",
          tool: "write_file",
          inputSummary: expect.stringContaining("report-execution-sentinel-914"),
        }),
      ]));
      expect(value.usage.value?.observations).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "provider-cost", amount: "0.02", currency: "USD" }),
      ]));
      expect(value.timing.value?.intervals.map((interval) => interval.label)).toEqual(
        expect.arrayContaining(["eval.run", "assertions.evaluate"]),
      );

      const grepJson = await niceeval.run([
        "show",
        toolCall.locator!,
        "--execution",
        "--grep",
        "definitely-no-match-6681",
        "--json",
      ]);
      expect(grepJson.exitCode, grepJson.diagnostic()).toBe(0);
      expect(grepJson.json<ExecutionShowDocument>().data).toEqual(document.data);
    },
  );
});

test("show --timing 在当前真实 Runner 中公开可用阶段 timing", async () => {
  await reportE2E.case(
    "timing",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const toolCall = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "tool-call" && event.locator !== undefined,
        run.diagnostic(),
      );
      const shown = await niceeval.run(
        ["show", toolCall.locator!, "--timing"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("eval.run");
      expect(shown.stdout).toContain("assertions.evaluate");

      const json = await niceeval.run(
        ["show", toolCall.locator!, "--timing", "--json"],
      );
      expect(json.exitCode, json.diagnostic()).toBe(0);
      const document = json.json<TimingShowDocument>();
      expect(document).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "timing",
        problemTable: [],
      });
      expect(document.data).toEqual({
        state: "available",
        inputState: "complete",
        problemIds: [],
        value: {
          kind: "attempt",
          locator: toolCall.locator,
          durationMs: expect.any(Number),
          phases: expect.arrayContaining([
            { name: "eval.run", durationMs: expect.any(Number) },
            { name: "assertions.evaluate", durationMs: expect.any(Number) },
          ]),
        },
      });
      expect(document.data.value.phases.map((phase) => phase.name)).toEqual(
        expect.arrayContaining(["eval.run", "assertions.evaluate"]),
      );
    },
  );
});
