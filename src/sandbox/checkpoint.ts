// 沙箱文件系统快照工具——只依赖 Sandbox 接口的最小公约数:
//   runShell    — 在沙箱里执行 shell 脚本
//   downloadFile — 从沙箱读任意路径的原始字节 → Buffer
//   uploadFile   — 向沙箱写任意路径的原始字节 ← Buffer
//
// 原理:
//   capture: tar czf /tmp/__fe_cp__.tar.gz <paths>  →  downloadFile → Buffer
//   restore: uploadFile → /tmp/__fe_rs__.tar.gz  →  tar xzf -C /
//
// tar / binary file I/O 在所有 Linux sandbox(Docker、Vercel、e2b、Modal…)里都支持,
// 这段代码对任意 backend 的 Sandbox 实现无改动即可使用。

import type { Sandbox } from "../types.ts";
import { t } from "../i18n/index.ts";

const CP_TMP = "/tmp/__fe_cp__.tar.gz";
const RS_TMP = "/tmp/__fe_rs__.tar.gz";

/** 把 paths 列出的目录打成 gzip tar,返回 Buffer。 */
export async function createCheckpoint(sb: Sandbox, paths: string[]): Promise<Buffer> {
  const quoted = paths.map(shellQuote).join(" ");
  // --ignore-failed-read:跳过不存在的路径(如 .cache/uv 可能未建);true 保证 exit 0。
  await sb.runShell(`tar czf ${CP_TMP} --ignore-failed-read ${quoted} 2>/dev/null; true`);
  const buf = await sb.downloadFile(CP_TMP);
  await sb.runShell(`rm -f ${CP_TMP}`);
  if (!buf || buf.length === 0) throw new Error(t("checkpoint.emptyTar", { paths: paths.join(", ") }));
  return buf;
}

/** 把 createCheckpoint 返回的 Buffer 还原到沙箱根目录。 */
export async function restoreCheckpoint(sb: Sandbox, data: Buffer): Promise<void> {
  await sb.uploadFile(RS_TMP, data);
  // -C / 解压到根目录,覆盖同路径文件;rm 用 ; 保证无论成败都清理临时文件。
  await sb.runShell(`tar xzf ${RS_TMP} -C / 2>/dev/null; rm -f ${RS_TMP}`);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
