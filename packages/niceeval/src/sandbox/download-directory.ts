// vercel / e2b 共用的 downloadDirectory 两阶段模板,与 uploadDirectory 对称:
// Phase 1 只做 find(列出远端目录下全部文件的相对路径,短命令快速结束);Phase 2 经 readOne
// 逐文件独立读取二进制内容,不依赖长命令输出流——即使 session 快到平台上限,后半段读取也
// 不会被截断。写回本地磁盘时自动建目录,不做文本编码转换、不拼接。
// docker provider 走 getArchive 单次 tar 拉取,不经过这个模板(见 docker.ts)。

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommandResult } from "../types.ts";
import { buildDownloadFindScript } from "./shell.ts";

export async function downloadDirectoryByList(opts: {
  localDir: string;
  ignore: readonly string[];
  /** 已绑定远端目录为 cwd 的 shell 执行器;script 只需管 find 本身。 */
  runShell: (script: string) => Promise<CommandResult>;
  /** 按远端目录下的相对路径读取一个文件的二进制内容。 */
  readOne: (relPath: string) => Promise<Uint8Array>;
}): Promise<void> {
  const result = await opts.runShell(buildDownloadFindScript({ ignore: opts.ignore }));

  const paths = result.stdout
    .trim()
    .split("\n")
    .map((p) => p.trim().replace(/^\.\//, ""))
    .filter(Boolean);

  await Promise.all(
    paths.map(async (relPath) => {
      const content = await opts.readOne(relPath);
      const dest = join(opts.localDir, relPath);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
    }),
  );
}
