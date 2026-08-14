// owner: docs/engineering/testing/e2e/report.md#report-execution-evidence
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
  name?: unknown;
  durationMs?: unknown;
}

interface TimingData {
  locator?: unknown;
  unavailable?: unknown;
  state?: unknown;
  status?: unknown;
  kind?: unknown;
  reason?: unknown;
  durationMs?: unknown;
  phases?: unknown;
}

interface TimingShowDocument {
  format?: unknown;
  view?: unknown;
  sample?: unknown;
  problemTable?: unknown;
  data?: TimingData;
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

test("show --timing 只公开阶段身份或明确不可用", async () => {
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
      const textUnavailable = /phase timing unavailable/i.test(shown.stdout);
      const textNamedPhase = shown.stdout.match(
        /\b(?:eval\.run|sandbox\.[a-z]+|agent\.[a-z]+|assertions\.[a-z]+|telemetry\.[a-z]+|workspace\.[a-z]+)\b/,
      );
      expect(
        textUnavailable || textNamedPhase !== null,
        shown.stdout,
      ).toBe(true);

      const json = await niceeval.run(
        ["show", toolCall.locator!, "--timing", "--json"],
      );
      expect(json.exitCode, json.diagnostic()).toBe(0);
      const document = json.json<TimingShowDocument>();
      const receipt = JSON.stringify(document);
      expect(document.format, receipt).toBe("niceeval.show");
      expect(document.view, receipt).toBe("timing");
      expect(document.data, receipt).toEqual(expect.any(Object));
      expect(Array.isArray(document.problemTable), receipt).toBe(true);
      const data = document.data!;
      expect(Object.keys(data).sort(), receipt).not.toEqual(["locator"]);
      expect(typeof data.kind, receipt).toBe("string");
      expect(String(data.kind).length, receipt).toBeGreaterThan(0);
      expect(data.locator, receipt).toBe(toolCall.locator);
      expect("durationMs" in data, receipt).toBe(true);
      expect(
        data.durationMs === null || typeof data.durationMs === "number",
        receipt,
      ).toBe(true);
      expect(Array.isArray(data.phases), receipt).toBe(true);
      const phases = data.phases as TimingPhase[];
      const named = phases.filter((phase) => typeof phase.name === "string" && phase.name.length > 0);
      const jsonUnavailable = isExplicitUnavailable(data);
      expect(
        named.length > 0 || jsonUnavailable,
        `timing JSON must expose named phases or an explicit unavailable status: ${receipt}`,
      ).toBe(true);
      expect(jsonUnavailable, receipt).toBe(textUnavailable);
      if (named.length > 0) {
        expect(textNamedPhase, shown.stdout).not.toBeNull();
        const names = named.map((phase) => phase.name);
        expect(names, receipt).toEqual(expect.arrayContaining(["eval.run", "assertions.evaluate"]));
        for (const phase of named) {
          expect(typeof phase.name, receipt).toBe("string");
          if (!("durationMs" in phase) || phase.durationMs === undefined || phase.durationMs === null) {
            continue;
          }
          expect(typeof phase.durationMs, receipt).toBe("number");
        }
      }
    },
  );
});

function isExplicitUnavailable(data: TimingData): boolean {
  const markers = [data.unavailable, data.state, data.status, data.kind, data.reason];
  return markers.some((value) => {
    if (value === true) return true;
    return typeof value === "string" && /unavail/i.test(value);
  });
}
