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

interface ReportProblem {
  readonly code: string;
  readonly path: readonly string[];
  readonly refs: readonly string[];
  readonly summary?: string;
}

interface ReportProjections {
  readonly format: "niceeval.report-projections/v1";
  readonly pricingProfile: Record<string, unknown> | null;
  readonly costs: readonly {
    readonly page: { readonly pageId: string; readonly route: string };
    readonly measureId: string;
    readonly row: { readonly key: string; readonly dimensions: Record<string, unknown> };
    readonly profileIdentity: string;
    readonly projection: Record<string, unknown>;
  }[];
}

/** The documented built-in machine document (docs/feature/reports/cli.md). */
interface BuiltInShowDocument {
  readonly format: "niceeval.show/v1" | "niceeval.show/v2";
  readonly locale: "en";
  readonly selection:
    | {
        readonly kind: "project-current";
        readonly sampleIdentity: string;
        readonly experimentIds: readonly string[];
      }
    | {
        readonly kind: "explicit-runs";
        readonly sampleIdentity: string;
        readonly runIds: readonly string[];
      }
    | {
        readonly kind: "attempt-locator";
        readonly sampleIdentity: string;
        readonly locator: string;
      };
  readonly report: { readonly token: string; readonly identity: string };
  readonly page: { readonly route: string; readonly pageId: string; readonly title: string | Record<string, string> };
  readonly data:
    | {
        readonly kind: "groups";
        readonly groups: readonly {
          readonly group:
            | { readonly kind: "named"; readonly groupId: string; readonly key: `named/${string}` }
            | { readonly kind: "singleton"; readonly experimentId: string; readonly key: `singleton/${string}` };
          readonly members: readonly string[];
          readonly href: string;
        }[];
      }
    | {
        readonly kind: "experiment-group";
        readonly group:
          | { readonly kind: "named"; readonly groupId: string; readonly key: `named/${string}` }
          | { readonly kind: "singleton"; readonly experimentId: string; readonly key: `singleton/${string}` };
        readonly comparison:
          | { readonly state: "comparable"; readonly members: readonly string[]; readonly rows: readonly unknown[] }
          | { readonly state: "non-comparable"; readonly members: readonly string[]; readonly issues: readonly { readonly reason: string }[] };
      }
    | {
        readonly kind: "attempt";
        readonly evidence: unknown;
        readonly observability: unknown;
      readonly fileChanges: unknown;
    };
  readonly projections: ReportProjections;
  readonly problems: readonly ReportProblem[];
}

/** The documented custom single-target manifest (docs/feature/reports/cli.md). */
interface CustomTargetExecutionManifest {
  readonly format: "niceeval.report-target-execution/v1";
  readonly locale: "en";
  readonly selection: { readonly kind: "project-current"; readonly sampleIdentity: string; readonly experimentIds: readonly string[] };
  readonly report: { readonly identity: string; readonly title: string | Record<string, string> };
  readonly page: {
    readonly route: string;
    readonly pageId: string;
    readonly title: string | Record<string, string>;
    readonly renderedText: string;
  };
  readonly downloads: readonly { readonly path: string; readonly mediaType: string; readonly bytes: number }[];
  readonly projections: ReportProjections;
  readonly problems: readonly ReportProblem[];
}

function expectCanonicalProblemTable(problems: readonly ReportProblem[], pageId: string): void {
  for (const problem of problems) {
    expect(problem).toMatchObject({
      code: expect.any(String),
      path: ["page", pageId],
      refs: expect.any(Array),
    });
    expect(problem.refs).toEqual([...new Set(problem.refs)].sort());
    if (problem.summary !== undefined) expect(problem.summary).toEqual(expect.any(String));
  }
  const keys = problems.map((problem) => JSON.stringify([
    problem.code,
    problem.path,
    problem.refs,
    problem.summary ?? "",
  ]));
  expect(keys).toEqual([...keys].sort());
}

function expectBuiltInPricingProfile(projections: ReportProjections): void {
  expect(projections).toMatchObject({
    format: "niceeval.report-projections/v1",
    pricingProfile: {
      contentIdentity: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      currency: "USD",
      provenance: { kind: "declared-rate-card" },
    },
  });
}

test("show 对单组默认直达 comparison，对多组默认列索引并以实验选择精确读取", async () => {
  await reportE2E.case(
    "show-overview",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      expect(run.expReceipt()).toMatchObject({ completion: "completed" });
      const evals = run.expEvalEvents();
      expect(evals.map((event) => [event.evalId, event.verdict]).sort()).toEqual([
        ["deliberate-error", "errored"],
        ["deliberate-fail", "failed"],
        ["score", "passed"],
        ["tool-call", "passed"],
      ]);

      const text = await niceeval.run(["show", "--experiment", "main"]);
      expect(text.exitCode, text.diagnostic()).toBe(0);
      expect(text.stdout).toContain("Experiment comparison");
      expect(text.stdout).toContain("main");

      const singleJson = await niceeval.run(["show", "--experiment", "main", "--json"]);
      expect(singleJson.exitCode, singleJson.diagnostic()).toBe(0);
      const singleDocument = singleJson.json<BuiltInShowDocument>();
      expect(singleDocument).toMatchObject({
        format: "niceeval.show/v2",
        locale: "en",
        selection: {
          kind: "project-current",
          experimentIds: ["main"],
        },
        page: { route: "/group/singleton/main", pageId: "group-singleton" },
        data: {
          kind: "experiment-group",
          group: { kind: "singleton", experimentId: "main", key: "singleton/main" },
          comparison: { state: "comparable", members: ["main"] },
        },
      });
      expectCanonicalProblemTable(singleDocument.problems, "group-singleton");
      expectBuiltInPricingProfile(singleDocument.projections);

      const sourceRun = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(sourceRun.exitCode, sourceRun.diagnostic()).toBe(0);

      const indexText = await niceeval.run(["show"]);
      expect(indexText.exitCode, indexText.diagnostic()).toBe(0);
      expect(indexText.stdout).toContain("niceeval show --experiment 'main'");
      expect(indexText.stdout).toContain("niceeval show --experiment 'source'");
      expect(indexText.stdout).not.toContain("Experiment comparison");

      const indexJson = await niceeval.run(["show", "--json"]);
      expect(indexJson.exitCode, indexJson.diagnostic()).toBe(0);
      const indexDocument = indexJson.json<BuiltInShowDocument>();
      expect(indexDocument).toMatchObject({
        format: "niceeval.show/v2",
        page: { route: "/", pageId: "overview" },
        data: {
          kind: "groups",
          groups: [
            {
              group: { kind: "singleton", experimentId: "main", key: "singleton/main" },
              members: ["main"],
              href: "/group/singleton/main",
            },
            {
              group: { kind: "singleton", experimentId: "source", key: "singleton/source" },
              members: ["source"],
              href: "/group/singleton/source",
            },
          ],
        },
      });

      const selected = await niceeval.run(["show", "--experiment", "main", "--json"]);
      expect(selected.exitCode, selected.diagnostic()).toBe(0);
      expect(selected.json<BuiltInShowDocument>()).toMatchObject({
        format: "niceeval.show/v2",
        page: { route: "/group/singleton/main", pageId: "group-singleton" },
        data: {
          kind: "experiment-group",
          group: { kind: "singleton", experimentId: "main", key: "singleton/main" },
          comparison: { state: "comparable", members: ["main"] },
        },
      });

    },
  );
});

test("show 保留 named identity，并把同组不同 Eval population 闭合为 non-comparable", async () => {
  await reportE2E.case(
    "show-named-group-comparison",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      for (const experimentId of ["classic/baseline", "classic/memory-a", "classic/incompatible"] as const) {
        const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      }

      const shown = await niceeval.run(["show", "--experiment", "classic", "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.json<BuiltInShowDocument>()).toMatchObject({
        format: "niceeval.show/v2",
        page: { route: "/group/named/classic", pageId: "group-named" },
        data: {
          kind: "experiment-group",
          group: { kind: "named", groupId: "classic", key: "named/classic" },
          comparison: {
            state: "non-comparable",
            members: ["classic/baseline", "classic/incompatible", "classic/memory-a"],
            issues: [{ reason: "eval-population-mismatch" }],
          },
        },
      });
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
        run.expEvalEvents(),
        (event) => event.evalId === "deliberate-fail",
        run.diagnostic(),
      );

      const attempt = await niceeval.run(["show", failed.locator, "--json"]);
      expect(attempt.exitCode, attempt.diagnostic()).toBe(0);
      const document = attempt.json<BuiltInShowDocument>();
      expect(document).toMatchObject({
        format: "niceeval.show/v1",
        locale: "en",
        selection: { kind: "attempt-locator", locator: failed.locator },
        page: { route: "/", pageId: "attempt-overview", title: "Attempt overview" },
      });
      expectCanonicalProblemTable(document.problems, "attempt-overview");
      expect(document.data.kind).toBe("attempt");
      expectBuiltInPricingProfile(document.projections);
      expect(document.projections.costs).toEqual([]);

      const payload = JSON.stringify(document.data);
      expect(payload).toContain(failed.locator);
      expect(payload).toContain("mismatched");
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
      const document = historical.json<BuiltInShowDocument>();
      expect(document).toMatchObject({
        format: "niceeval.show/v2",
        locale: "en",
        selection: {
          kind: "explicit-runs",
          runIds: [...historyRunIds].sort(),
        },
        page: { route: "/group/named/classic", pageId: "group-named" },
        data: {
          kind: "experiment-group",
          group: { kind: "named", groupId: "classic", key: "named/classic" },
          comparison: {
            state: "comparable",
            members: ["classic/baseline", "classic/memory-a", "classic/memory-b"],
          },
        },
      });
      expectCanonicalProblemTable(document.problems, "group-named");
      expectBuiltInPricingProfile(document.projections);
      expect(document.projections.costs).toEqual([]);
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
      expect(piped.stdout).toContain("Experiment comparison");
      expect(piped.stdout).toContain("main");
      expect(piped.stdout).not.toMatch(/[╭╮╰╯├┤]/u);

      const terminal = await runReportPty(
        ["show"],
        {
          columns: 120,
          rows: 40,
          cwd: projectRoot,
          env: { TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: undefined },
          timeoutMs: 60_000,
        },
      );
      expect(terminal.exitCode, terminal.diagnostic()).toBe(0);
      const visible = stripVTControlCharacters(terminal.stdout);
      expect(visible).toContain("Experiment comparison");
      expect(visible).toContain("main");
      expect(visible).toMatch(/^╭.*╮$/mu);
      expect(visible).toMatch(/^╰.*╯$/mu);
    },
  );
});

test("自定义 Report 的 show 是单目标阅读面，JSON 只含 target-execution manifest", async () => {
  await reportE2E.case(
    "show-custom-fixture",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      for (const experimentId of ["main", "source"] as const) {
        const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      }

      // This makes the unrelated parameter Page's enumerate() fail. A target
      // show must still succeed because only view/static build the whole site.
      const targetOnlyEnv = { NICEEVAL_E2E_FAIL_UNRELATED_ENUMERATE: "1" };

      const shown = await niceeval.run(
        ["show", "--report", "./reports/site.tsx"],
        { env: targetOnlyEnv },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("Report fixture static");
      expect(shown.stdout).toMatch(/Fixture pass rate is\s+partial \(\d+\/\d+\)/);
      expect(shown.stdout).toContain("Source detail");
      expect(shown.stdout).toContain("Diff detail");
      const unwrapped = shown.stdout.replace(/\s+/gu, " ");
      expect(unwrapped).toContain("Total known cost");
      expect(unwrapped).toContain("experiment main source");

      const json = await niceeval.run(
        ["show", "--report", "./reports/site.tsx", "--json"],
        { env: targetOnlyEnv },
      );
      expect(json.exitCode, json.diagnostic()).toBe(0);
      const manifest = json.json<CustomTargetExecutionManifest>();
      expect(manifest).toMatchObject({
        format: "niceeval.report-target-execution/v1",
        locale: "en",
        selection: {
          kind: "project-current",
          experimentIds: [
            "classic/baseline",
            "classic/incompatible",
            "classic/memory-a",
            "classic/memory-b",
            "main",
            "source",
          ],
        },
        report: { title: "Report fixture" },
        page: {
          route: "/",
          pageId: "overview",
          title: "Report fixture",
          renderedText: expect.stringContaining("Report fixture static"),
        },
        downloads: [],
      });
      expectCanonicalProblemTable(manifest.problems, "overview");
      expect(manifest.report.identity).toEqual(expect.any(String));
      expect(manifest.selection.sampleIdentity).toEqual(expect.any(String));
      expectBuiltInPricingProfile(manifest.projections);
      expect(manifest.projections.costs).toHaveLength(1);
      expect(manifest.projections.costs.map((entry) => entry.page)).toEqual([
        { pageId: "overview", route: "/" },
      ]);
    },
  );
});

test("参数化 show 按规范 key 读取详情页，并对非成员 key 返回单目标错误", async () => {
  await reportE2E.case(
    "show-parameterized",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });

      const json = await niceeval.run(["show", "--report", "./reports/site.tsx", "--json"]);
      expect(json.exitCode, json.diagnostic()).toBe(0);
      const manifest = json.json<CustomTargetExecutionManifest>();
      const slotId = /Slot detail (slot-[a-zA-Z0-9_-]+)/.exec(manifest.page.renderedText);
      expect(slotId, "the overview must expose at least one slot detail target").not.toBeNull();
      const slotKey = slotId![1];

      const detail = await niceeval.run([
        "show",
        "--report",
        "./reports/site.tsx",
        "--page",
        `/slot/${slotKey}`,
        "--json",
      ]);
      expect(detail.exitCode, detail.diagnostic()).toBe(0);
      const detailManifest = detail.json<CustomTargetExecutionManifest>();
      expect(detailManifest).toMatchObject({
        format: "niceeval.report-target-execution/v1",
        page: {
          route: `/slot/${slotKey}`,
          pageId: "slot",
          renderedText: expect.stringContaining(`Slot fixture detail ${slotKey}`),
        },
        problems: [],
      });
      expect(detailManifest.downloads, "a single target carries only its own downloads").toEqual([]);
      expect(detailManifest.projections.costs, "show carries only the selected Page capture").toEqual([]);

      const missing = await niceeval.run([
        "show",
        "--report",
        "./reports/site.tsx",
        "--page",
        "/slot/not-a-member-slot",
      ]);
      expect(missing.exitCode, missing.diagnostic()).not.toBe(0);
      expect(missing.stdout, missing.diagnostic()).not.toContain("Slot fixture detail");
    },
  );
});
