// 收尾可调用体的有界执行:eval/agent/sandbox 各段的 cleanup、钩子与实验级 cleanup 共用。
// 有界性是「强清 = 加速收尾」设计的前提(docs/cli.md「中断:三级响应」):任何一个挂起的收尾
// 都不能无限拖住退出,到点按该段自己的失败语义收束(teardown-failed / experiment-teardown-failed
// 诊断),超时后遗留的 promise 悬空,随进程退出消亡。

import { t } from "../i18n/index.ts";

/** 单个收尾可调用体的清理超时(docs 声明值,provider stop 另有自己的 8s 超时)。 */
export const CLEANUP_TIMEOUT_MS = 30_000;

export async function withCleanupTimeout<T>(fn: () => Promise<T> | T, timeoutMs = CLEANUP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t("runner.cleanupTimeout", { timeoutMs }))), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
