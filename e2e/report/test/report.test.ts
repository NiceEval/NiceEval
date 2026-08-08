// feature: docs/engineering/testing/e2e/report.md
//
// 这个单一 Journey 只跨公开边界：确定性 exp → show text/JSON → view --out / local server → HTTP。
// locator 只从上一步公开的 --json 事件取得；测试不读取 .niceeval 私有布局。

import { command, pollUntil, waitForOutput, withHttpServer, withProcess } from "@niceeval/testkit";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
  status?: string;
  passed?: number;
  failed?: number;
  errored?: number;
  completion?: string;
}

interface ShowDocument {
  format: string;
  schemaVersion: number;
  view: string;
  sample: { resultsRoot: string; experiments: string[] };
  data: unknown;
}

function staticSiteHandler(root: string) {
  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    if (relativePath.includes("..")) return new Response("not found", { status: 404 });
    try {
      const body = await readFile(join(root, relativePath));
      const contentType = relativePath.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
      return new Response(body, { headers: { "content-type": contentType } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
}

async function htmlWithMarker(url: string, marker: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    if (response.status !== 200) return undefined;
    const html = await response.text();
    return html.includes(marker) ? html : undefined;
  } catch {
    return undefined;
  }
}

function withConfigReport(config: string): string {
  const imported = config.replace(
    'import { defineConfig } from "niceeval";',
    'import { defineConfig } from "niceeval";\nimport report from "./reports/config-reload.ts";',
  );
  if (imported === config) throw new Error("report fixture config no longer has its defineConfig import");
  const configured = imported.replace('  locale: "en",', '  locale: "en",\n  report,');
  if (configured === imported) throw new Error("report fixture config no longer has its locale field");
  return configured;
}

it("安装后的 niceeval 交付确定性 Report evidence 到公开 JSON、导出站与 HTTP", async () => {
  // prepare：只清理本 Journey 自己声明的结果、JUnit 和导出目录。
  const recordRoot = ".niceeval";
  const exportRoot = "site-export";
  const junitPath = "junit/main.xml";
  rmSync(recordRoot, { recursive: true, force: true });
  rmSync(exportRoot, { recursive: true, force: true });
  rmSync("junit", { recursive: true, force: true });
  mkdirSync("junit", { recursive: true });

  // invoke/observe：真实安装后的 binary 运行签入 Agent fixture；三态结果故意使进程非零。
  const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json", "--junit", junitPath]);
  expect(run.exitCode, run.diagnostic()).not.toBe(0);
  expect(run.stderr).toBe("");
  const events = run.ndjson<ExpEvent>();
  const result = events.find((event) => event.event === "result");
  expect(result).toMatchObject({
    event: "result",
    status: "failed",
    passed: 1,
    failed: 1,
    errored: 1,
    completion: "complete",
  });

  const locators = new Map(
    events
      .filter((event) => event.event === "eval" && event.evalId !== undefined && event.locator !== undefined)
      .map((event) => [event.evalId!, event.locator!] as const),
  );
  expect(locators.get("tool-call")).toMatch(/^@/);
  expect(locators.get("deliberate-fail")).toMatch(/^@/);
  expect(locators.get("deliberate-error")).toMatch(/^@/);

  const junit = readFileSync(junitPath, "utf8");
  expect(junit).toContain("<failure");
  expect(junit).toContain("<error");

  // observe/outcome：show text 与 JSON 读取同一份公开范围；locator 由上一条公开事件传递。
  const overviewText = await niceeval.run(["show", "--record", recordRoot]);
  expect(overviewText.exitCode, overviewText.diagnostic()).toBe(0);
  expect(overviewText.stdout).toContain("tool-call");
  expect(overviewText.stdout).toContain("deliberate-fail");
  expect(overviewText.stdout).toContain("deliberate-error");

  const overviewJsonReceipt = await niceeval.run(["show", "--record", recordRoot, "--json"]);
  expect(overviewJsonReceipt.exitCode, overviewJsonReceipt.diagnostic()).toBe(0);
  const overviewJson = overviewJsonReceipt.json<ShowDocument>();
  expect(overviewJson).toMatchObject({
    format: "niceeval.show",
    schemaVersion: 1,
    view: "leaderboard",
    sample: { experiments: ["main"] },
  });
  expect(JSON.stringify(overviewJson.data)).toContain("tool-call");

  const failedJsonReceipt = await niceeval.run([
    "show",
    locators.get("deliberate-fail")!,
    "--record",
    recordRoot,
    "--json",
  ]);
  expect(failedJsonReceipt.exitCode, failedJsonReceipt.diagnostic()).toBe(0);
  const failedJson = failedJsonReceipt.json<ShowDocument>();
  expect(failedJson.view).toBe("attempt");
  expect(JSON.stringify(failedJson.data)).toContain('"verdict":"failed"');

  const customShow = await niceeval.run([
    "show",
    "--record",
    recordRoot,
    "--report",
    "./reports/site.tsx",
    "--page",
    "overview",
  ]);
  expect(customShow.exitCode, customShow.diagnostic()).toBe(0);
  expect(customShow.stdout).toContain("tool-call");

  // invoke/observe：view --out 是公开目录产物；HTTP 只服务这个导出目录并比较同一字节。
  const exported = await niceeval.run([
    "view",
    "--record",
    recordRoot,
    "--report",
    "./reports/site.tsx",
    "--out",
    exportRoot,
    "--no-open",
  ]);
  expect(exported.exitCode, exported.diagnostic()).toBe(0);
  const indexHtml = readFileSync(join(exportRoot, "index.html"), "utf8");
  expect(indexHtml).toContain("Report fixture");
  expect(indexHtml).toContain("tool-call");
  expect(indexHtml).toContain("deliberate-fail");

  await withHttpServer(staticSiteHandler(exportRoot), async ({ url }) => {
    const response = await fetch(`${url}/index.html`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(indexHtml);
  });

  // invoke/observe：不带 --report 时，真实长期运行的 view 从项目 config import 默认报告。
  // --port 0 让 OS 分配端口；withProcess 无论断言成功或失败都会 finally 终结 server。
  const configPath = join(process.cwd(), "niceeval.config.ts");
  const reloadReportPath = join(process.cwd(), "reports", "config-reload.ts");
  const originalConfig = await readFile(configPath, "utf8");
  const originalReloadReport = await readFile(reloadReportPath, "utf8");
  try {
    await writeFile(configPath, withConfigReport(originalConfig), "utf8");
    await withProcess(
      [
        join(process.cwd(), "node_modules", ".bin", "niceeval"),
        "view",
        "--record",
        recordRoot,
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        "--no-open",
      ],
      { cwd: process.cwd(), timeoutMs: 60_000 },
      async (view) => {
        const startup = await waitForOutput(view, "stdout", /http:\/\/127\.0\.0\.1:\d+\//, {
          timeoutMs: 30_000,
          label: "config report view URL",
        });
        const url = startup.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
        expect(url, startup).toBeDefined();
        const origin = url!;

        await pollUntil(
          async () => {
            try {
              return (await fetch(`${origin}healthz`)).status === 200 ? true : undefined;
            } catch {
              return undefined;
            }
          },
          { timeoutMs: 15_000, intervalMs: 100, label: "config report view readiness" },
        );

        const first = await pollUntil(
          () => htmlWithMarker(origin, "CFG_FIRST"),
          { timeoutMs: 15_000, intervalMs: 100, label: "config report initial render" },
        );
        expect(first).not.toContain("CFG_SECOND");

        expect(originalReloadReport).toContain("CFG_FIRST");
        await writeFile(reloadReportPath, originalReloadReport.replace("CFG_FIRST", "CFG_SECOND"), "utf8");

        const second = await pollUntil(
          () => htmlWithMarker(origin, "CFG_SECOND"),
          { timeoutMs: 15_000, intervalMs: 100, label: "config report reload" },
        );
        expect(second).not.toContain("CFG_FIRST");
      },
    );
  } finally {
    await writeFile(configPath, originalConfig, "utf8");
    await writeFile(reloadReportPath, originalReloadReport, "utf8");
  }
}, 120_000);
