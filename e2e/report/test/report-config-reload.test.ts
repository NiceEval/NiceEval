// owner: docs/engineering/testing/e2e/report.md#report-config-reload
// rerun: pnpm e2e test --repo report -- --run test/report-config-reload.test.ts

import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

function withLiveViewConfig(config: string): string {
  const imported = config.replace(
    'import { defineConfig } from "niceeval";',
    'import { defineConfig } from "niceeval";\nimport report from "./reports/config-reload.tsx";\nimport alternateReport from "./reports/config-reload-alternate.tsx";\nimport theme from "./themes/config-reload.ts";',
  );
  if (imported === config) throw new Error("report fixture config no longer has its defineConfig import");
  const configured = imported.replace("  timeoutMs: 60_000,", "  report,\n  theme,\n  timeoutMs: 60_000,");
  if (configured === imported) throw new Error("report fixture config no longer has its timeoutMs field");
  return configured;
}

interface LiveManifest {
  readonly defaultRoute: string;
  readonly pages: readonly { readonly route: string; readonly fragment: string }[];
}

interface LiveRevision {
  readonly content: string;
  readonly bytes: Buffer;
}

async function liveRevision(url: string): Promise<LiveRevision | undefined> {
  try {
    const response = await fetch(url);
    if (response.status !== 200) return undefined;
    const shell = Buffer.from(await response.arrayBuffer());
    const manifestResponse = await fetch(new URL("_niceeval/manifest.json", url));
    if (manifestResponse.status !== 200) return undefined;
    const manifest = await manifestResponse.json() as LiveManifest;
    const page = manifest.pages.find((candidate) => candidate.route === manifest.defaultRoute);
    if (page === undefined) return undefined;
    const [fragmentResponse, themeResponse] = await Promise.all([
      fetch(new URL(page.fragment, url)),
      fetch(new URL("_niceeval/theme.css", url)),
    ]);
    if (fragmentResponse.status !== 200 || themeResponse.status !== 200) return undefined;
    const [fragment, theme] = await Promise.all([
      fragmentResponse.arrayBuffer(),
      themeResponse.arrayBuffer(),
    ]);
    const bytes = Buffer.concat([shell, Buffer.from(fragment), Buffer.from(theme)]);
    return { content: bytes.toString("utf8"), bytes };
  } catch {
    return undefined;
  }
}

async function revisionWithMarkers(url: string, ...markers: string[]): Promise<string | undefined> {
  const revision = await liveRevision(url);
  return revision !== undefined && markers.every((marker) => revision.content.includes(marker)) ? revision.content : undefined;
}

async function themeCss(url: string): Promise<string> {
  const response = await fetch(new URL("_niceeval/theme.css", url));
  expect(response.status).toBe(200);
  return response.text();
}

test("view 重建项目模块、配置与 Record；last-good 保留且 latest intent 获胜", async () => {
  await reportE2E.case(
    "config-reload",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      expect(run.expReceipt()).toMatchObject({ completion: "completed" });
      const initialSlots = run.ndjson<{ readonly event: string }>()
        .filter((event) => event.event === "eval").length;
      expect(initialSlots, run.diagnostic()).toBeGreaterThan(0);
      const initialSlotMarker = `SLOTS_${initialSlots}`;

      const configPath = join(projectRoot, "niceeval.config.ts");
      const reportPath = join(projectRoot, "reports", "config-reload.tsx");
      const componentPath = join(projectRoot, "reports", "config-reload-content.tsx");
      const themePath = join(projectRoot, "themes", "config-reload.ts");
      const config = await readFile(configPath, "utf8");
      const report = await readFile(reportPath, "utf8");
      const component = await readFile(componentPath, "utf8");
      const theme = await readFile(themePath, "utf8");
      const liveConfig = withLiveViewConfig(config);
      expect(report).toContain("REPORT_FIRST");
      expect(component).toContain("INDIRECT_FIRST");
      expect(theme).toContain("#123456");
      await writeFile(configPath, liveConfig, "utf8");

      const view = niceeval.start(
        ["view", "--host", "127.0.0.1", "--port", "0", "--no-open"],
        { timeoutMs: 60_000 },
      );
      const startup = await waitForOutput(view, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
        timeoutMs: 30_000,
        label: "config report view URL",
      });
      const origin = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      expect(origin, startup).toBeDefined();

      await pollUntil(
        async () => {
          try {
            return (await fetch(`${origin!}healthz`)).status === 200 ? true : undefined;
          } catch {
            return undefined;
          }
        },
        { timeoutMs: 15_000, intervalMs: 100, label: "config report view readiness" },
      );

      const firstResponse = await fetch(origin!);
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.text();
      expect(first).toContain('src="_niceeval/app.js"');
      const firstRevision = await liveRevision(origin!);
      expect(firstRevision).toBeDefined();
      expect(firstRevision!.content).toContain("REPORT_FIRST");
      expect(firstRevision!.content).toContain("INDIRECT_FIRST");
      expect(firstRevision!.content).toContain(initialSlotMarker);
      expect(await themeCss(origin!)).toContain("#123456");
      expect(firstRevision!.content).not.toContain("INDIRECT_SECOND");

      await writeFile(componentPath, component.replace("INDIRECT_FIRST", "INDIRECT_SECOND"), "utf8");
      const indirect = await pollUntil(
        () => revisionWithMarkers(origin!, "REPORT_FIRST", "INDIRECT_SECOND", initialSlotMarker),
        { timeoutMs: 15_000, intervalMs: 100, label: "indirect report component reload" },
      );
      expect(indirect).not.toContain("INDIRECT_FIRST");

      await writeFile(themePath, theme.replace("#123456", "#654321"), "utf8");
      const themed = await pollUntil(
        () => revisionWithMarkers(origin!, "INDIRECT_SECOND", "#654321"),
        { timeoutMs: 15_000, intervalMs: 100, label: "theme reload" },
      );
      expect(themed).toContain("INDIRECT_SECOND");
      expect(await themeCss(origin!)).not.toContain("#123456");

      const alternateConfig = liveConfig.replace("  report,", "  report: alternateReport,");
      expect(alternateConfig).not.toBe(liveConfig);
      await writeFile(configPath, alternateConfig, "utf8");
      const reconfigured = await pollUntil(
        () => revisionWithMarkers(origin!, "CONFIG_SECOND", "INDIRECT_SECOND", "#654321"),
        { timeoutMs: 15_000, intervalMs: 100, label: "running config reload" },
      );
      expect(reconfigured).not.toContain("REPORT_FIRST");

      await writeFile(configPath, liveConfig, "utf8");
      await pollUntil(
        () => revisionWithMarkers(origin!, "REPORT_FIRST", "INDIRECT_SECOND", "#654321"),
        { timeoutMs: 15_000, intervalMs: 100, label: "running config restore" },
      );

      // Two legitimate edits race through the watcher. Every observed response
      // must remain a complete last-good page or the complete latest page; an
      // earlier candidate must never become temporarily visible.
      const observedIntentBodies: string[] = [];
      const latestIntent = pollUntil(
        async () => {
          try {
            const revision = await liveRevision(origin!);
            if (revision === undefined) return undefined;
            const body = revision.content;
            observedIntentBodies.push(body);
            if (!body.includes("REPORT_FIRST") || !body.includes("INTENT_LATEST")) return undefined;
            return (await themeCss(origin!)).includes("#654321") ? body : undefined;
          } catch {
            return undefined;
          }
        },
        { timeoutMs: 15_000, intervalMs: 25, label: "latest report module intent" },
      );
      await writeFile(componentPath, component.replace("INDIRECT_FIRST", "INTENT_STALE"), "utf8");
      await writeFile(componentPath, component.replace("INDIRECT_FIRST", "INTENT_LATEST"), "utf8");
      const settledLatestIntent = await latestIntent;
      expect(settledLatestIntent).not.toContain("INTENT_STALE");
      expect(observedIntentBodies).not.toEqual(expect.arrayContaining([
        expect.stringContaining("INTENT_STALE"),
      ]));
      for (const body of observedIntentBodies) {
        expect(body).toContain("REPORT_FIRST");
        expect(body.includes("INDIRECT_SECOND") || body.includes("INTENT_LATEST")).toBe(true);
      }
      const lastGoodBeforeConfigFailure = (await liveRevision(origin!))!.bytes;
      expect(lastGoodBeforeConfigFailure.toString("utf8")).toBe(settledLatestIntent);

      const unsupportedConfigModule = join(projectRoot, "reports", "unsupported-config.niceeval-invalid");
      await writeFile(unsupportedConfigModule, "export default null;\n", "utf8");
      const brokenConfig = liveConfig.replace(
        'import { defineConfig } from "niceeval";',
        'import { defineConfig } from "niceeval";\nimport "./reports/unsupported-config.niceeval-invalid";',
      );
      expect(brokenConfig).not.toBe(liveConfig);
      await writeFile(configPath, brokenConfig, "utf8");
      await waitForOutput(view, "stderr", /view rebuild failed:/, {
        timeoutMs: 15_000,
        label: "current config import failure",
      });
      const retainedAfterConfigFailure = await pollUntil(
        async () => {
          const response = await fetch(origin!);
          if (
            response.status !== 200
            || response.headers.get("x-niceeval-last-rebuild-problem") !== "1"
          ) return undefined;
          const revision = await liveRevision(origin!);
          return revision?.bytes.equals(lastGoodBeforeConfigFailure) ? revision.bytes : undefined;
        },
        { timeoutMs: 15_000, intervalMs: 100, label: "config failure retains last-good execution" },
      );
      expect(retainedAfterConfigFailure.equals(lastGoodBeforeConfigFailure)).toBe(true);

      await writeFile(configPath, liveConfig, "utf8");
      await pollUntil(
        () => revisionWithMarkers(origin!, "REPORT_FIRST", "INTENT_LATEST", "#654321"),
        { timeoutMs: 15_000, intervalMs: 100, label: "config import recovery" },
      );

      // 另一个真实 CLI 进程使用同一份含 TSX Report 的配置，向同一
      // Record root 写入新结果；view 不重启也要读到它。
      const newRecord = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(newRecord.exitCode, newRecord.diagnostic()).toBe(0);
      const addedSlots = newRecord.ndjson<{ readonly event: string }>()
        .filter((event) => event.event === "eval").length;
      expect(addedSlots, newRecord.diagnostic()).toBeGreaterThan(0);
      const reloadedSlotMarker = `SLOTS_${initialSlots + addedSlots}`;
      const withNewRecord = await pollUntil(
        () => revisionWithMarkers(origin!, reloadedSlotMarker, "REPORT_FIRST", "INTENT_LATEST"),
        { timeoutMs: 15_000, intervalMs: 100, label: "record reload" },
      );
      expect(withNewRecord).not.toContain(initialSlotMarker);
      const lastGoodBeforeReportFailure = (await liveRevision(origin!))!.bytes;
      expect(lastGoodBeforeReportFailure.toString("utf8")).toBe(withNewRecord);

      await writeFile(reportPath, 'throw new Error("BROKEN_REPORT");\nexport default {};\n', "utf8");
      await waitForOutput(view, "stderr", /view rebuild failed:/, {
        timeoutMs: 15_000,
        label: "broken report rebuild",
      });
      const retained = await pollUntil(
        async () => {
          const response = await fetch(origin!);
          if (
            response.status !== 200
            || response.headers.get("x-niceeval-last-rebuild-problem") !== "1"
          ) return undefined;
          const revision = await liveRevision(origin!);
          return revision?.bytes.equals(lastGoodBeforeReportFailure) ? revision.bytes : undefined;
        },
        { timeoutMs: 15_000, intervalMs: 100, label: "broken report retains last-good execution" },
      );
      expect(retained.equals(lastGoodBeforeReportFailure)).toBe(true);

      await writeFile(reportPath, report.replace("REPORT_FIRST", "REPORT_RECOVERED"), "utf8");
      const recovered = await pollUntil(
        () =>
          revisionWithMarkers(
            origin!,
            "REPORT_RECOVERED",
            "INTENT_LATEST",
            reloadedSlotMarker,
            "#654321",
          ),
        { timeoutMs: 15_000, intervalMs: 100, label: "report recovery" },
      );
      expect(recovered).not.toContain("REPORT_FIRST");
    },
  );
});
