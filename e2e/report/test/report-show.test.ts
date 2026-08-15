// owner: docs/engineering/testing/e2e/report.md#report-show-json
// rerun: pnpm e2e --repo report -- --run test/report-show.test.ts

import { only } from "@niceeval/testkit";
import { stripVTControlCharacters } from "node:util";
import { expect, test } from "vitest";
import {
  reportCaseArtifacts,
  reportE2E,
  runReportPty,
} from "./support.ts";

interface ExpEvent {
  readonly event: string;
  readonly evalId?: string;
  readonly locator?: string;
  readonly verdict?: string;
}

interface Evidence<Value> {
  readonly state: string;
  readonly value?: Value;
}

interface AttemptShowDocument {
  readonly format: "niceeval.show";
  readonly schemaVersion: 1;
  readonly view: "attempt";
  readonly problemTable: readonly unknown[];
  readonly data: {
    readonly state: "available";
    readonly inputState: "complete";
    readonly problemIds: readonly number[];
    readonly value: {
      readonly kind: "attempt";
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
      readonly assertions: Evidence<{
        readonly entries: readonly { readonly entry?: { readonly result?: { readonly state?: string } } }[];
      }>;
      readonly verdict: Evidence<string>;
      readonly score: Evidence<unknown>;
      readonly conversation: Evidence<{
        readonly collection: { readonly state: string };
        readonly items: readonly { readonly kind?: string; readonly role?: string; readonly text?: string }[];
      }>;
      readonly commands: Evidence<{
        readonly collection: { readonly state: string };
        readonly commands: readonly unknown[];
      }>;
      readonly usage: Evidence<{ readonly collection: { readonly state: string } }>;
      readonly timing: Evidence<{ readonly collection: { readonly state: string } }>;
      readonly diagnostics: Evidence<{ readonly collection: { readonly state: string } }>;
    };
  };
}

interface HistoryShowDocument {
  readonly format: "niceeval.show";
  readonly schemaVersion: 1;
  readonly view: "leaderboard";
  readonly sample: {
    readonly selection: {
      readonly policy: "explicit-runs";
      readonly runIds: readonly string[];
    };
    readonly runCount: number;
    readonly slotCount: number;
    readonly denominator: number;
  };
}

test("show 将固定 execution 的文本和机器概览交付给调用方", async () => {
  await reportE2E.case(
    "show-overview",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run([
        "exp",
        "main",
        "--rerun",
        "all",
        "--json",
        "--junit",
        "junit/main.xml",
      ]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      expect(run.expReceipt()).toMatchObject({ completion: "completed" });
      const evals = run.ndjson<ExpEvent>().filter((event) => event.event === "eval");
      expect(evals.map((event) => [event.evalId, event.verdict]).sort()).toEqual([
        ["deliberate-error", "errored"],
        ["deliberate-fail", "failed"],
        ["score", "passed"],
        ["tool-call", "passed"],
      ]);

      const text = await niceeval.run(["show"]);
      expect(text.exitCode, text.diagnostic()).toBe(0);
      expect(text.stdout).toContain("NiceEval");
      expect(text.stdout).toContain("Pass rate");
      expect(text.stdout).toContain("Experiment");
      expect(text.stdout).not.toContain("Report default-overview");

      const json = await niceeval.run(["show", "--json"]);
      expect(json.exitCode, json.diagnostic()).toBe(0);
      expect(json.json<HistoryShowDocument>()).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "leaderboard",
        sample: { runCount: 1, slotCount: 4, denominator: 4 },
      });
      expect(json.stderr).toBe("");
      expect(json.stdout).not.toContain("Loading");
    },
  );
});

test("show 对 immutable Attempt 交付精确 evidence JSON", async () => {
  await reportE2E.case(
    "show-attempt-json",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      const failed = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "deliberate-fail" && event.locator !== undefined,
        run.diagnostic(),
      );
      const attempt = await niceeval.run(["show", failed.locator!, "--json"]);
      expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
      const document = attempt.json<AttemptShowDocument>();
      expect(document).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "attempt",
        problemTable: [],
        data: {
          state: "available",
          inputState: "complete",
          problemIds: [],
          value: {
            kind: "attempt",
            identity: { locator: failed.locator, memberRelation: "origin" },
            evaluation: {
              state: "available",
              value: { experimentId: "main", evalId: "deliberate-fail", attempt: 0, kind: "pass" },
            },
            verdict: { state: "available", value: "failed" },
            score: { state: "not-applicable" },
            conversation: { state: "available", value: { collection: { state: "complete" } } },
            commands: { state: "available", value: { collection: { state: "complete" }, commands: [] } },
            usage: { state: "available", value: { collection: { state: "complete" } } },
            timing: { state: "available", value: { collection: { state: "complete" } } },
            diagnostics: { state: "available", value: { collection: { state: "complete" } } },
          },
        },
      });
      expect(document.data.value.identity.selectedRunId).toBe(document.data.value.identity.originRunId);
      expect(document.data.value.identity.slotId).toMatch(/^slot-/);
      expect(document.data.value.assertions.value?.entries.map((entry) => entry.entry?.result?.state)).toContain(
        "mismatched",
      );
      // This fixture only evaluates an assertion and never calls t.send(). Its
      // Observability collection is complete, but there is no Agent message to
      // invent. The tool-call journey owns non-empty conversation evidence.
      expect(document.data.value.conversation.value?.items).toEqual([]);

    },
  );
});

test("show --run 保留 deterministic classic World 的历史 Run 与 Attempt 身份", async () => {
  await reportE2E.case(
    "show-classic-world",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const historyRunIds: string[] = [];
      for (const experimentId of ["classic/baseline", "classic/memory-a", "classic/memory-b", "classic/baseline"] as const) {
        const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
        const runId = only(run.expReceipt().runIds, () => true, run.diagnostic());
        historyRunIds.push(runId);
      }

      const historical = await niceeval.run([
        "show",
        ...historyRunIds.flatMap((runId) => ["--run", runId]),
        "--json",
      ]);
      expect(historical.exitCode, historical.diagnostic()).toBe(0);
      expect(historical.json<HistoryShowDocument>()).toMatchObject({
        format: "niceeval.show",
        schemaVersion: 1,
        view: "leaderboard",
        sample: {
          selection: { policy: "explicit-runs", runIds: [...historyRunIds].sort() },
          runCount: 4,
          slotCount: 36,
          denominator: 36,
        },
      });
    },
  );
});

test("show 在 pipe 与真实 PTY 中保留独立、可读的公开文本", async () => {
  await reportE2E.case(
    "show-pty",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });

      const piped = await niceeval.run(["show"]);
      expect(piped.exitCode, piped.diagnostic()).toBe(0);
      expect(piped.stdout).toContain("Pass rate");
      expect(piped.stdout).toContain("tool-call");

      const terminal = await runReportPty(
        ["show"],
        {
          columns: 120,
          rows: 40,
          cwd: projectRoot,
          env: { TERM: "dumb", NO_COLOR: undefined, FORCE_COLOR: undefined },
          timeoutMs: 60_000,
        },
      );
      expect(terminal.exitCode, terminal.diagnostic()).toBe(0);
      const visible = stripVTControlCharacters(terminal.stdout);
      expect(visible).toContain("Pass rate");
      expect(visible).toContain("Experiment");
      expect(visible).toContain("tool-call");
    },
  );
});

test("show 不渲染不完整的 locale map，而是在公开问题面保留可诊断错误", async () => {
  await reportE2E.case(
    "show-invalid-locale",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });

      const shown = await niceeval.run(["show", "--report", "./reports/invalid-localized-text.tsx"]);
      expect(shown.exitCode, shown.diagnostic()).not.toBe(0);
      expect(shown.stderr).toContain("report-site-execution-problem");
      expect(shown.stderr).toContain("semantic-tree-invalid");
      expect(shown.stderr).toContain("a localized text map must provide text for en and zh-CN");
      expect(shown.stdout).not.toContain("Incomplete locale map must not render");
    },
  );
});
