// 本地目录文件采集(uploadDirectory 用)与 readSourceFiles 的默认过滤常量,
// docker / vercel / e2b 三个 provider 共用一份。

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { SandboxFile } from "../types.ts";

export const DEFAULT_SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx"];
export const DEFAULT_IGNORE_DIRS = [".git", ".next", "node_modules", "dist", "build", "coverage"];
export const DEFAULT_IGNORE_FILES = ["EVAL.ts", "PROMPT.md"];

/** 递归收集本地目录下的全部文件;路径统一转成 POSIX 分隔的相对路径,供上传沙箱用。 */
export async function collectLocalFiles(localDir: string, ignore: readonly string[] = []): Promise<SandboxFile[]> {
  const ignored = new Set(ignore);
  const out: SandboxFile[] = [];
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
