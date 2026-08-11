// owner: docs/engineering/testing/e2e/report.md#report-config-reload
// rerun: pnpm e2e --repo report -- --run test/report-config-reload.test.ts

import { command, pollUntil, waitForOutput, withProcess, withProjectCopy } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

const binary = join(process.cwd(), "node_modules", ".bin", "niceeval");
const niceeval = command([binary]);

function withLiveViewConfig(config: string): string {
  const imported = config.replace(
    'import { defineConfig } from "niceeval";',
    'import { defineConfig } from "niceeval";\nimport report from "./reports/config-reload.tsx";\nimport alternateReport from "./reports/config-reload-alternate.tsx";\nimport theme from "./themes/config-reload.ts";',
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

test("view 持续重建项目模块、配置、Record，并在修复报告后恢复", async () => {
  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).not.toBe(0);
      expect(run.stdout).toContain('"event":"result"');

      const configPath = join(root, "niceeval.config.ts");
      const reportPath = join(root, "reports", "config-reload.tsx");
      const componentPath = join(root, "reports", "config-reload-content.tsx");
      const themePath = join(root, "themes", "config-reload.ts");
      const config = await readFile(configPath, "utf8");
      const report = await readFile(reportPath, "utf8");
      const component = await readFile(componentPath, "utf8");
      const theme = await readFile(themePath, "utf8");
      const liveConfig = withLiveViewConfig(config);
      expect(report).toContain("REPORT_FIRST");
      expect(component).toContain("INDIRECT_FIRST");
      expect(theme).toContain("#123456");
      await writeFile(configPath, liveConfig, "utf8");

      await withProcess(
        [
          binary,
          "view",
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--no-open",
        ],
        { cwd: root, timeoutMs: 60_000 },
        async (view) => {
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
          expect(first).toContain("ATTEMPTS_3");
          expect(first).toContain("#123456");
          expect(first).not.toContain("INDIRECT_SECOND");

          await writeFile(componentPath, component.replace("INDIRECT_FIRST", "INDIRECT_SECOND"), "utf8");
          const indirect = await pollUntil(
            () => htmlWithMarkers(origin!, "REPORT_FIRST", "INDIRECT_SECOND", "ATTEMPTS_3"),
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

          // 另一个真实 CLI 进程使用同一份含 TSX Report 的配置，向同一
          // Record root 写入新结果；view 不重启也要读到它。
          const newRecord = await niceeval.run(["exp", "source", "--rerun", "all", "--json"], { cwd: root });
          expect(newRecord.exitCode, newRecord.diagnostic()).toBe(0);
          const withNewRecord = await pollUntil(
            () => htmlWithMarkers(origin!, "ATTEMPTS_4", "REPORT_FIRST", "INDIRECT_SECOND"),
            { timeoutMs: 15_000, intervalMs: 100, label: "record reload" },
          );
          expect(withNewRecord).not.toContain("ATTEMPTS_3");

          await writeFile(reportPath, 'throw new Error("BROKEN_REPORT");\nexport default {};\n', "utf8");
          await waitForOutput(view, "stderr", /view rebuild failed:/, {
            timeoutMs: 15_000,
            label: "broken report rebuild",
          });
          const unavailable = await fetch(origin!);
          expect(unavailable.status).toBe(503);
          expect(await unavailable.text()).toContain("current target unavailable");

          await writeFile(reportPath, report.replace("REPORT_FIRST", "REPORT_RECOVERED"), "utf8");
          const recovered = await pollUntil(
            () =>
              htmlWithMarkers(
                origin!,
                "REPORT_RECOVERED",
                "INDIRECT_SECOND",
                "ATTEMPTS_4",
                "#654321",
              ),
            { timeoutMs: 15_000, intervalMs: 100, label: "report recovery" },
          );
          expect(recovered).not.toContain("REPORT_FIRST");
        },
      );
    },
    reportArtifactStaging("config-reload"),
  );
});
