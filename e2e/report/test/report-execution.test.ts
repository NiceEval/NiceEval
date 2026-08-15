// owner: docs/engineering/testing/e2e/report.md#report-execution-evidence
// rerun: pnpm e2e --repo report -- --run test/report-execution.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { installedAuthorExportManifest, reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
}

interface Evidence<Value> {
  readonly state: string;
  readonly value?: Value;
}

interface ExecutionShowDocument {
  readonly format: "niceeval.show";
  readonly schemaVersion: 1;
  readonly view: "execution";
  readonly problemTable: readonly unknown[];
  readonly data: {
    readonly state: "available";
    readonly inputState: "complete";
    readonly problemIds: readonly number[];
    readonly value: {
      readonly kind: "attempt-execution";
      readonly identity: {
        readonly locator: string;
        readonly selectedRunId: string;
        readonly originRunId: string;
        readonly slotId: string;
        readonly memberRelation: "origin";
      };
      readonly evaluation: Evidence<{
        readonly experimentId: string;
        readonly evalId: string;
        readonly attempt: number;
        readonly kind: string;
      }>;
      readonly conversation: Evidence<{
        readonly collection: { readonly state: string };
        readonly items: readonly {
          readonly kind?: string;
          readonly role?: string;
          readonly text?: string;
          readonly tool?: string;
          readonly inputSummary?: string;
        }[];
      }>;
      readonly commands: Evidence<{ readonly collection: { readonly state: string }; readonly commands: readonly unknown[] }>;
      readonly usage: Evidence<{
        readonly collection: { readonly state: string };
        readonly observations: readonly { readonly kind?: string; readonly amount?: string; readonly currency?: string }[];
      }>;
      readonly timing: Evidence<{
        readonly collection: { readonly state: string };
        readonly intervals: readonly { readonly phase?: string; readonly label?: string }[];
      }>;
      readonly diagnostics: Evidence<{ readonly collection: { readonly state: string }; readonly diagnostics: readonly unknown[] }>;
    };
  };
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
      readonly phases: readonly { readonly name: string; readonly durationMs: number }[];
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
      expect(shown.stdout).toContain("Trace overview");
      expect(shown.stdout).toContain("Duration");
      expect(shown.stdout).toContain("Turns");
      expect(shown.stdout).toContain("Calls");

      const json = await niceeval.run(["show", toolCall.locator!, "--execution", "--json"]);
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
            identity: { locator: toolCall.locator, memberRelation: "origin" },
            evaluation: {
              state: "available",
              value: { experimentId: "main", evalId: "tool-call", attempt: 0, kind: "pass" },
            },
            conversation: { state: "available", value: { collection: { state: "complete" } } },
            commands: { state: "available", value: { collection: { state: "complete" }, commands: [] } },
            usage: { state: "available", value: { collection: { state: "complete" } } },
            timing: { state: "available", value: { collection: { state: "complete" } } },
            diagnostics: { state: "available", value: { collection: { state: "complete" }, diagnostics: [] } },
          },
        },
      });
      const value = document.data.value;
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

      const filtered = await niceeval.run([
        "show",
        toolCall.locator!,
        "--execution",
        "--grep",
        "report-execution-sentinel-914",
      ]);
      expect(filtered.exitCode, filtered.diagnostic()).toBe(0);
      expect(filtered.stdout).toContain("Filter · /report-execution-sentinel-914/");
      expect(filtered.stdout).toContain("report-execution-sentinel-914");
    },
  );
});

test("show --timing 呈现本轮的阶段树", async () => {
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
      expect(shown.stdout).toContain("agent.send");
      expect(shown.stdout).toContain("assertions.evaluate");

      const json = await niceeval.run(["show", toolCall.locator!, "--timing", "--json"]);
      expect(json.exitCode, json.diagnostic()).toBe(0);
      const document = json.json<TimingShowDocument>();
      expect(document).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "timing",
        problemTable: [],
        data: {
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
        },
      });
    },
  );
});

test("未改写的 0.12 classic 作者 fixture 通过安装候选的 author export manifest 执行", async () => {
  await reportE2E.case(
    "classic-author",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const manifest = await installedAuthorExportManifest(projectRoot);
      expect(manifest.subpaths).toEqual(expect.arrayContaining(["./report", "./report/built-in"]));
      expect(manifest.report).toEqual(expect.arrayContaining([
        "Bars",
        "Col",
        "ExperimentScatter",
        "ExperimentTable",
        "Hero",
        "SampleNotices",
        "SampleSummary",
        "Section",
        "aggregate",
        "costUSD",
        "defineComponent",
        "defineReport",
        "experiment",
        "passRate",
      ]));
      expect(manifest.builtIn).toEqual(expect.arrayContaining([
        "standardAttemptPage",
        "standardAttemptsPage",
        "standardExperimentPage",
        "standardTracesPage",
      ]));

      for (const experimentId of ["classic/baseline", "classic/memory-a", "classic/memory-b"] as const) {
        const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      }

      const shown = await niceeval.run(["show", "--report", "./reports/classic.tsx"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("MemoryBench Classic");
      expect(shown.stdout).toContain("Leaderboard");
      expect(shown.stdout).toContain("classic/memory-b");
    },
  );
});
