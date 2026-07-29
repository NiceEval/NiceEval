/// <reference lib="dom" />

import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium, type Browser } from "@playwright/test";
import { sh } from "../sh.ts";
import type { Evidence } from "../evidence.ts";

export const BRANDED_REPORT = "reports/branded.tsx";
export const SITE_REPORT = "reports/site.tsx";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

export interface RawCommandResult {
  stdout: string;
  stderr: string;
  combined: string;
  status: number;
}

export function shRaw(cmd: string): RawCommandResult {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { stdout, stderr, combined: `${stdout}\n${stderr}`, status: res.status ?? -1 };
}

async function serveStaticDir(rootDir: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
        const filePath = join(rootDir, pathname);
        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const data = await readFile(filePath);
        res.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    })();
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolvePromise, reject) => server.close((err) => (err ? reject(err) : resolvePromise()))),
  };
}

export interface ReportComponentScenarioContext {
  evidence: Evidence;
  browser: Browser;
  brandedBaseUrl: string;
  siteBaseUrl: string;
}

export interface ReportComponentScenario {
  name: string;
  run(ctx: ReportComponentScenarioContext): Promise<void>;
}

/**
 * 所有组件场景共享同一次真实 Evidence、每份自定义报告各一次静态导出，以及同一个浏览器进程。
 * 单个场景只新建隔离 page，不重新跑 Experiment、不重新导出站点。
 */
export async function withReportComponentScenarioContext(
  evidence: Evidence,
  run: (ctx: ReportComponentScenarioContext) => Promise<void>,
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "niceeval-report-components-"));
  const brandedOut = join(scratch, "branded");
  const siteOut = join(scratch, "site");
  let brandedServer: Awaited<ReturnType<typeof serveStaticDir>> | undefined;
  let siteServer: Awaited<ReturnType<typeof serveStaticDir>> | undefined;
  let browser: Browser | undefined;
  try {
    sh(`pnpm exec niceeval view --report ${BRANDED_REPORT} --record ${evidence.resultsRoot} --out ${brandedOut} --no-open`);
    sh(`pnpm exec niceeval view --report ${SITE_REPORT} --record ${evidence.resultsRoot} --page overview --out ${siteOut} --no-open`);
    brandedServer = await serveStaticDir(resolve(brandedOut));
    siteServer = await serveStaticDir(resolve(siteOut));
    browser = await chromium.launch();
    await run({
      evidence,
      browser,
      brandedBaseUrl: brandedServer.baseUrl,
      siteBaseUrl: siteServer.baseUrl,
    });
  } finally {
    await Promise.allSettled([
      browser?.close() ?? Promise.resolve(),
      brandedServer?.close() ?? Promise.resolve(),
      siteServer?.close() ?? Promise.resolve(),
    ]);
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function runReportComponentScenarios(
  ctx: ReportComponentScenarioContext,
  scenarios: readonly ReportComponentScenario[],
): Promise<void> {
  for (const scenario of scenarios) {
    try {
      await scenario.run(ctx);
    } catch (error) {
      throw new Error(`Report 组件验收失败：${scenario.name}`, { cause: error });
    }
  }
}
