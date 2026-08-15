// owner: docs/engineering/testing/e2e/report.md#report-execution-evidence
// kill:
// - inverse = unwrap timing JSON to bare PublicTimingJson; outcome = the
//   expected Calculation envelope fails before any phase assertion can pass.
// - inverse = accept a missing or extra cell-table key, skip iterative hierarchy
//   depth validation, or retain declared page order; outcome = the public
//   execution JSON loses its failed Page, structured depth error, or canonical
//   page/navigation distinction.
// rerun: pnpm e2e --repo report -- --run test/report-execution.test.ts

import { only, pollUntil, waitForOutput } from "@niceeval/testkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

interface ReportExecutionPageJson {
  readonly state: "rendered" | "data-unavailable" | "execution-failed";
  readonly pageId: string;
  readonly route?: string;
  readonly problemIds: readonly number[];
  readonly document?: {
    readonly children: readonly ReportExecutionBlockJson[];
  };
}

interface ReportExecutionBlockJson {
  readonly type: string;
}

interface ReportExecutionCellTableJson extends ReportExecutionBlockJson {
  readonly type: "cell-table";
  readonly columns: readonly string[];
  readonly hierarchy?: true;
  readonly rows: readonly {
    readonly key: string;
    readonly cells: Readonly<Record<string, string>>;
  }[];
}

interface ReportExecutionJson {
  readonly format: "niceeval.report-show/v1";
  readonly pages: readonly ReportExecutionPageJson[];
  readonly navigation: readonly {
    readonly pageId: string;
    readonly route: string;
    readonly order: number;
  }[];
  readonly problemTable: readonly {
    readonly id: number;
    readonly problem: {
      readonly category: string;
      readonly code: string;
      readonly consumerId: string;
    };
  }[];
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

test("低层 Report 的 cell-table 闭合、层级深度与 execution 页顺序都是公开契约", async () => {
  await reportE2E.case(
    "execution-contracts",
    { artifacts: reportCaseArtifacts(["execution-contracts", "execution-navigation"]) },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const closure = await liveExecutionJson("closure");
      expect(closure.format).toBe("niceeval.report-show/v1");
      const rejectedById = new Map(
        closure.pages
          .filter((page) => page.state === "execution-failed")
          .map((page) => [page.pageId, page]),
      );
      for (const pageId of ["normal-missing", "normal-extra", "hierarchy-missing", "hierarchy-extra"]) {
        const page = rejectedById.get(pageId);
        expect(page, `missing rejected ${pageId} page`).toMatchObject({
          state: "execution-failed",
          route: `/${pageId}`,
          problemIds: [expect.any(Number)],
        });
      }
      expect(
        closure.problemTable
          .map(({ problem }) => [problem.category, problem.code, problem.consumerId])
          .sort((left, right) => left[2]!.localeCompare(right[2]!)),
      ).toEqual([
        ["execution", "semantic-document-invalid", "hierarchy-extra"],
        ["execution", "semantic-document-invalid", "hierarchy-missing"],
        ["execution", "semantic-document-invalid", "normal-extra"],
        ["execution", "semantic-document-invalid", "normal-missing"],
      ]);

      const valid = await exportExecutionJson("valid", "execution-contracts");
      expect(valid.pages.map((page) => [page.pageId, page.route])).toEqual([
        ["root", "/"],
        ["alpha", "/alpha"],
        ["zulu", "/zulu"],
      ]);
      const root = valid.pages.find((page) => page.pageId === "root");
      expect(root).toMatchObject({ state: "rendered", route: "/" });
      const tables = cellTables(root!);
      expect(tables).toHaveLength(3);
      expect(tables.map((table) => table.hierarchy === true)).toEqual([false, true, true]);
      for (const table of tables) {
        for (const row of table.rows) {
          expect(Object.keys(row.cells).sort()).toEqual([...table.columns].sort());
        }
      }

      const deep = await niceeval.run(
        ["show", "--report", "./reports/execution-contracts.ts", "--page", "/"],
        { env: { NICEEVAL_REPORT_EXECUTION_CONTRACT: "deep" } },
      );
      expect(deep.exitCode, deep.diagnostic()).not.toBe(0);
      expect(deep.stderr).toContain("report-limit-exceeded");
      expect(deep.stderr).not.toMatch(/RangeError|Maximum call stack size exceeded/);

      const navigation = await exportExecutionJson("navigation", "execution-navigation");
      expect(navigation.pages.map((page) => [page.pageId, page.route])).toEqual([
        ["zulu", "/"],
        ["alpha", "/alpha"],
        ["zebra", "/zebra"],
      ]);
      expect(navigation.navigation.map((item) => [item.pageId, item.route, item.order])).toEqual([
        ["zulu", "/", 0],
        ["zebra", "/zebra", 1],
        ["alpha", "/alpha", 2],
      ]);

      async function liveExecutionJson(scenario: string): Promise<ReportExecutionJson> {
        const view = niceeval.start(
          [
            "view",
            "--report",
            "./reports/execution-contracts.ts",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--no-open",
          ],
          {
            env: { NICEEVAL_REPORT_EXECUTION_CONTRACT: scenario },
            timeoutMs: 60_000,
          },
        );
        try {
          const startup = await waitForOutput(
            view,
            "stdout",
            /http:\/\/127\.0\.0\.1:\d+\//,
            { timeoutMs: 30_000, label: `${scenario} execution JSON view URL` },
          );
          const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
          expect(origin, startup).toBeDefined();
          return await pollUntil(
            async () => {
              try {
                const response = await fetch(`${origin!}_niceeval/execution.json`);
                return response.status === 200 ? await response.json() as ReportExecutionJson : undefined;
              } catch {
                return undefined;
              }
            },
            { timeoutMs: 15_000, intervalMs: 100, label: `${scenario} execution JSON readiness` },
          );
        } finally {
          await view.dispose();
        }
      }

      async function exportExecutionJson(scenario: string, out: string): Promise<ReportExecutionJson> {
        const exported = await niceeval.run(
          ["view", "--report", "./reports/execution-contracts.ts", "--out", out, "--no-open"],
          { env: { NICEEVAL_REPORT_EXECUTION_CONTRACT: scenario } },
        );
        expect(exported.exitCode, exported.diagnostic()).toBe(0);
        return JSON.parse(
          await readFile(join(projectRoot, out, "_niceeval", "execution.json"), "utf8"),
        ) as ReportExecutionJson;
      }
    },
  );
});

function cellTables(page: ReportExecutionPageJson): readonly ReportExecutionCellTableJson[] {
  if (page.state !== "rendered" || page.document === undefined) {
    throw new Error(`expected rendered execution page, got ${page.state}`);
  }
  return page.document.children.filter(isCellTable);
}

function isCellTable(block: ReportExecutionBlockJson): block is ReportExecutionCellTableJson {
  return block.type === "cell-table";
}
