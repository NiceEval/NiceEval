// 默认本地工件报告器:给 `fastevals view` 提供稳定的离线输入。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Reporter, RunSummary } from "../../types.ts";

export function Artifacts(root = ".fastevals"): Reporter {
  let outputDir = "";

  return {
    async onRunStart() {
      outputDir = join(root, safeTimestamp(new Date()));
      await mkdir(outputDir, { recursive: true });
    },
    async onRunComplete(summary) {
      if (!outputDir) outputDir = join(root, safeTimestamp(new Date(summary.startedAt)));
      await mkdir(outputDir, { recursive: true });
      const enriched: RunSummary = { ...summary, outputDir };
      await writeFile(join(outputDir, "summary.json"), JSON.stringify(enriched, null, 2), "utf-8");
      await writeFile(
        join(outputDir, "results.jsonl"),
        summary.results.map((r) => JSON.stringify(r)).join("\n") + (summary.results.length ? "\n" : ""),
        "utf-8",
      );
    },
  };
}

function safeTimestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}
