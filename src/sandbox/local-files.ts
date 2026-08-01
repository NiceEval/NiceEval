// 本地目录文件采集(uploadDirectory 用),docker / vercel / e2b 三个 provider 共用一份。

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
export interface CollectedLocalFile {
  readonly path: string;
  readonly content: Uint8Array;
}

/** 递归收集本地目录下的全部文件;路径统一转成 POSIX 分隔的相对路径,供上传沙箱用。 */
export async function collectLocalFiles(localDir: string, ignore: readonly string[] = []): Promise<CollectedLocalFile[]> {
  const ignored = new Set(ignore);
  const out: CollectedLocalFile[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir)) {
      if (ignored.has(entry)) continue;
      const abs = join(dir, entry);
      const st = await stat(abs);
      if (st.isDirectory()) {
        await walk(abs);
      } else if (st.isFile()) {
        out.push({
          path: relative(localDir, abs).split(sep).join("/"),
          content: await readFile(abs),
        });
      }
    }
  }
  await walk(localDir);
  return out;
}
