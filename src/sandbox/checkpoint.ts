// 沙箱文件系统快照工具——只依赖 Sandbox 接口的最小公约数:
//   runShell    — 在沙箱里执行 shell 脚本
//   readBytes  — 从沙箱读任意路径的原始字节
//   writeBytes — 向沙箱写任意路径的原始字节
//
// 原理:
//   capture: tar czf /tmp/__fe_cp_<uuid>.tar.gz <paths>  →  readBytes
//   restore: writeBytes → /tmp/__fe_rs_<uuid>.tar.gz  →  tar xzf -C /
//
// tar / binary file I/O 在所有 Linux sandbox(Docker、Vercel、e2b、Modal…)里都支持,
// 这段代码对任意 provider 的 Sandbox 实现无改动即可使用。

import { randomUUID } from "node:crypto";
import type { Sandbox } from "../types.ts";
import { shellQuote } from "./shell.ts";
import { t } from "../i18n/index.ts";

// 临时 tar 名带随机后缀:同一沙箱被复用 / 并发做 checkpoint 时,固定名会互相覆盖。
function tmpTarPath(tag: string): string {
  return `/tmp/__fe_${tag}_${randomUUID()}.tar.gz`;
}

/** 把 paths 列出的目录打成 gzip tar,返回 Buffer。 */
export async function createCheckpoint(sb: Sandbox, paths: string[]): Promise<Buffer> {
  if (paths.length === 0) throw new Error(t("checkpoint.emptyTar", { paths: "(none)" }));
  const tmp = tmpTarPath("cp");
  const quoted = paths.map(shellQuote).join(" ");
  try {
    // --ignore-failed-read 允许某个可选路径不存在，但其它 tar 错误必须显式失败。
    const packed = await sb.runShell(`tar czf ${tmp} --ignore-failed-read ${quoted}`);
    if (packed.exitCode !== 0) {
      throw new Error(t("checkpoint.archiveFailed", {
        exitCode: packed.exitCode,
        detail: (packed.stderr || packed.stdout).trim() || "no output",
      }));
    }
    const buf = Buffer.from(await sb.readBytes(tmp));
    if (!buf || buf.length === 0) throw new Error(t("checkpoint.emptyTar", { paths: paths.join(", ") }));
    return buf;
  } finally {
    await sb.runShell(`rm -f ${tmp}`).catch(() => undefined);
  }
}

/** 把 createCheckpoint 返回的 Buffer 还原到沙箱根目录。 */
export async function restoreCheckpoint(sb: Sandbox, data: Buffer): Promise<void> {
  const tmp = tmpTarPath("rs");
  await sb.writeBytes(tmp, data);
  try {
    // -C / 解压到根目录并覆盖同路径文件。不能把 rm 拼在同一条脚本末尾，否则 rm 的
    // exit 0 会掩盖 tar 解压失败。
    const restored = await sb.runShell(`tar xzf ${tmp} -C /`);
    if (restored.exitCode !== 0) {
      throw new Error(t("checkpoint.restoreFailed", {
        exitCode: restored.exitCode,
        detail: (restored.stderr || restored.stdout).trim() || "no output",
      }));
    }
  } finally {
    await sb.runShell(`rm -f ${tmp}`).catch(() => undefined);
  }
}
