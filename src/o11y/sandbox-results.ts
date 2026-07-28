// 沙箱内给 Eval 验证脚本读取的行为摘要。它只负责临时文件 + 原子发布；
// 摘要算法唯一来自 derive.ts 的 buildO11ySummary。

import type { Sandbox, StreamEvent } from "../types.ts";
import { buildO11ySummary } from "./derive.ts";

/** 沙箱工作目录内供验证脚本读取的运行摘要路径。 */
export const SANDBOX_O11Y_RESULTS_PATH = "__niceeval__/results.json";
const TEMPORARY_SANDBOX_O11Y_RESULTS_PATH = "__niceeval__/results.json.tmp";

/**
 * 发布当前已累积事件的行为摘要。临时文件仅在完整写入后才 rename 成最终路径；若任一步失败，
 * 删除旧目标和临时文件，使验证脚本以缺文件失败，而非误读旧摘要。
 */
export async function writeSandboxO11yResults(sandbox: Sandbox, events: readonly StreamEvent[]): Promise<void> {
  try {
    await sandbox.writeFiles({
      [TEMPORARY_SANDBOX_O11Y_RESULTS_PATH]: JSON.stringify({ o11y: buildO11ySummary(events) }, null, 2),
    });
    const published = await sandbox.runShell(
      `mv -f ${TEMPORARY_SANDBOX_O11Y_RESULTS_PATH} ${SANDBOX_O11Y_RESULTS_PATH}`,
    );
    if (published.exitCode !== 0) {
      throw new Error(`could not publish ${SANDBOX_O11Y_RESULTS_PATH}: ${published.stderr || `exit ${published.exitCode}`}`);
    }
  } catch (error) {
    await sandbox.runShell(
      `rm -f ${SANDBOX_O11Y_RESULTS_PATH} ${TEMPORARY_SANDBOX_O11Y_RESULTS_PATH}`,
    ).catch(() => undefined);
    throw error;
  }
}
