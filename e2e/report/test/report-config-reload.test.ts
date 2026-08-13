// owner: docs/engineering/testing/e2e/report.md#report-config-reload
// rerun: pnpm e2e --repo report -- --run test/report-config-reload.test.ts

import { pollUntil, waitForOutput } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

function withLiveViewConfig(config: string): string {
  const imported = config.replace(
    'import { defineConfig } from "niceeval";',
    'import { defineConfig } from "niceeval";\nimport report from "./reports/config-reload.ts";\nimport alternateReport from "./reports/config-reload-alternate.ts";\nimport theme from "./themes/config-reload.ts";',
  );
  if (imported === config) throw new Error("report fixture config no longer has its defineConfig import");
  const configured = imported.replace('  locale: "en",', '  locale: "en",\n  report,\n  theme,');
  if (configured === imported) throw new Error("report fixture config no longer has its locale field");
  return configured;
}

async function htmlWithMarkers(url: string, ...markers: string[]): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    if (response.status !== 200) return undefined;
    const html = await response.text();
    return markers.every((marker) => html.includes(marker)) ? html : undefined;
  } catch {
    return undefined;
  }
}

test("view 重建项目模块、配置与 Record，失败时保留 last-good execution", async () => {
  await reportE2E.case(
    "config-reload",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      expect(run.expReceipt()).toMatchObject({ completion: "completed" });

      const configPath = join(projectRoot, "niceeval.config.ts");
      const reportPath = join(projectRoot, "reports", "config-reload.ts");
      const componentPath = join(projectRoot, "reports", "config-reload-content.ts");
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
      expect(first).toContain("REPORT_FIRST");
      expect(first).toContain("INDIRECT_FIRST");
      expect(first).toContain("SLOTS_3");
      expect(first).toContain("#123456");
      expect(first).not.toContain("INDIRECT_SECOND");

      await writeFile(componentPath, component.replace("INDIRECT_FIRST", "INDIRECT_SECOND"), "utf8");
      const indirect = await pollUntil(
        () => htmlWithMarkers(origin!, "REPORT_FIRST", "INDIRECT_SECOND", "SLOTS_3"),
        { timeoutMs: 15_000, intervalMs: 100, label: "indirect report component reload" },
      );
      expect(indirect).not.toContain("INDIRECT_FIRST");

      await writeFile(themePath, theme.replace("#123456", "#654321"), "utf8");
      const themed = await pollUntil(
        () => htmlWithMarkers(origin!, "INDIRECT_SECOND", "#654321"),
        { timeoutMs: 15_000, intervalMs: 100, label: "theme reload" },
      );
      expect(themed).not.toContain("#123456");

      const alternateConfig = liveConfig.replace("  report,", "  report: alternateReport,");
      expect(alternateConfig).not.toBe(liveConfig);
      await writeFile(configPath, alternateConfig, "utf8");
      const reconfigured = await pollUntil(
        () => htmlWithMarkers(origin!, "CONFIG_SECOND", "INDIRECT_SECOND", "#654321"),
        { timeoutMs: 15_000, intervalMs: 100, label: "running config reload" },
      );
      expect(reconfigured).not.toContain("REPORT_FIRST");

      await writeFile(configPath, liveConfig, "utf8");
      await pollUntil(
        () => htmlWithMarkers(origin!, "REPORT_FIRST", "INDIRECT_SECOND", "#654321"),
        { timeoutMs: 15_000, intervalMs: 100, label: "running config restore" },
      );

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
          const body = await response.text();
          return body.includes("REPORT_FIRST")
            && body.includes("INDIRECT_SECOND")
            && body.includes("#654321")
            && body.includes("niceeval-last-rebuild-problem")
            ? body
            : undefined;
        },
        { timeoutMs: 15_000, intervalMs: 100, label: "config failure retains last-good execution" },
      );
      expect(retainedAfterConfigFailure).toContain("niceeval-last-rebuild-problem");

      await writeFile(configPath, liveConfig, "utf8");
      await pollUntil(
        () => htmlWithMarkers(origin!, "REPORT_FIRST", "INDIRECT_SECOND", "#654321"),
        { timeoutMs: 15_000, intervalMs: 100, label: "config import recovery" },
      );

      // 另一个真实 CLI 进程使用同一份含 TSX Report 的配置，向同一
      // Record root 写入新结果；view 不重启也要读到它。
      const newRecord = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(newRecord.exitCode, newRecord.diagnostic()).toBe(0);
      const withNewRecord = await pollUntil(
        () => htmlWithMarkers(origin!, "SLOTS_4", "REPORT_FIRST", "INDIRECT_SECOND"),
        { timeoutMs: 15_000, intervalMs: 100, label: "record reload" },
      );
      expect(withNewRecord).not.toContain("SLOTS_3");

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
          const body = await response.text();
          return body.includes("REPORT_FIRST")
            && body.includes("INDIRECT_SECOND")
            && body.includes("SLOTS_4")
            && body.includes("niceeval-last-rebuild-problem")
            ? body
            : undefined;
        },
        { timeoutMs: 15_000, intervalMs: 100, label: "broken report retains last-good execution" },
      );
      expect(retained).toContain("niceeval-last-rebuild-problem");

      await writeFile(reportPath, report.replace("REPORT_FIRST", "REPORT_RECOVERED"), "utf8");
      const recovered = await pollUntil(
        () =>
          htmlWithMarkers(
            origin!,
            "REPORT_RECOVERED",
            "INDIRECT_SECOND",
            "SLOTS_4",
            "#654321",
          ),
        { timeoutMs: 15_000, intervalMs: 100, label: "report recovery" },
      );
      expect(recovered).not.toContain("REPORT_FIRST");
    },
  );
});
