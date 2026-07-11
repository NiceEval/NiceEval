// JSON / JUnit 报告器:把运行结果落成机器可读工件,接 CI 或下游 dashboard。

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Reporter, RunSummary } from "../../types.ts";

export function Json(path: string): Reporter {
  return {
    async onRunComplete(summary: RunSummary) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(summary, null, 2), "utf-8");
    },
  };
}

export function JUnit(path: string): Reporter {
  return {
    async onRunComplete(summary: RunSummary) {
      await mkdir(dirname(path), { recursive: true });
      const cases = summary.results
        .map((r) => {
          const name = xmlAttr(`${r.id} [${r.agent}${r.model ? "/" + r.model : ""}]`);
          const time = (r.durationMs / 1000).toFixed(3);
          if (r.verdict === "errored") {
            return `    <testcase name="${name}" time="${time}"><error message="${xmlAttr(r.error ?? "execution error")}"/></testcase>`;
          }
          if (r.verdict === "failed") {
            const msg = xmlAttr(r.assertions.filter((a) => !a.passed).map((a) => a.name).join("; "));
            return `    <testcase name="${name}" time="${time}"><failure message="${msg}"/></testcase>`;
          }
          if (r.verdict === "skipped") {
            return `    <testcase name="${name}" time="${time}"><skipped message="${xmlAttr(r.skipReason ?? "")}"/></testcase>`;
          }
          return `    <testcase name="${name}" time="${time}"/>`;
        })
        .join("\n");
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<testsuite name="niceeval" tests="${summary.results.length}" failures="${summary.failed}" errors="${summary.errored}" skipped="${summary.skipped}" time="${(summary.durationMs / 1000).toFixed(3)}">\n` +
        `${cases}\n</testsuite>\n`;
      await writeFile(path, xml, "utf-8");
    },
  };
}

function xmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
