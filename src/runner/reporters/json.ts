// JSON / JUnit 报告器:把运行结果落成机器可读 artifact,接 CI 或下游 dashboard。
// 两者都是「整次运行结束时写一份聚合文件」(不像 Artifacts 的逐 attempt 增量落盘),见
// docs/feature/experiments/cli.md「输出流和落盘节奏」——一旦开始写就必须原子替换目标:
// 半途失败(磁盘满、权限问题、进程被杀)不能把上一次成功的 JSON/JUnit 覆盖成截断文件,
// 那会让 CI 读到一份看似存在、实际损坏的报告,比「文件不存在」更危险。

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Reporter, RunSummary } from "../../types.ts";

/**
 * 同目录 temp → write → rename 的原子替换:内容先整体写进同目录下的临时文件,写完才
 * `rename()` 覆盖真正的目标路径——`rename()` 在同一文件系统内是单一原子操作,读者不可能
 * 观察到「文件存在但内容只写了一半」的中间态。同目录是必须的,跨目录/跨文件系统的
 * rename 不保证原子性(可能退化成先复制再删除)。
 *
 * 失败路径:临时文件写入或 rename 本身抛错时,`rename()` 还没被调用或没有成功,旧目标文件
 * (如果之前存在)完全没被触碰;没有旧目标文件时目录里也不会凭空出现一个新的。失败后立即
 * 清理临时文件(`rm force`,即便清理本身失败也吞掉——不能让「清理垃圾」的次要错误掩盖调用方
 * 真正需要看到的写入失败),成功路径下 `rename()` 之后临时文件已经不在原路径,同样不留残留。
 */
async function atomicWriteFile(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.niceeval-${randomUUID()}.tmp`);
  try {
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, path);
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw e;
  }
}

export function Json(path: string): Reporter {
  return {
    async onRunComplete(summary: RunSummary) {
      await atomicWriteFile(path, JSON.stringify(summary, null, 2));
    },
  };
}

export function JUnit(path: string): Reporter {
  return {
    async onRunComplete(summary: RunSummary) {
      const cases = summary.results
        .map((r) => {
          const name = xmlAttr(`${r.id} [${r.agent}${r.model ? "/" + r.model : ""}]`);
          const time = (r.durationMs / 1000).toFixed(3);
          if (r.verdict === "errored") {
            return `    <testcase name="${name}" time="${time}"><error message="${xmlAttr(r.error?.message ?? "execution error")}"/></testcase>`;
          }
          if (r.verdict === "failed") {
            const msg = xmlAttr(r.assertions.filter((a) => a.outcome === "failed").map((a) => a.name).join("; "));
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
      await atomicWriteFile(path, xml);
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
