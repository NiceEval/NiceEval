// 本地目录文件采集(uploadDirectory 用),docker / vercel / e2b / incus 共用一份。
// 默认 lstat：拒绝 symlink，也不跟随 source root 外的文件。

import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export interface CollectedLocalFile {
  readonly path: string;
  readonly content: Uint8Array;
}

function assertInsideRoot(root: string, candidate: string, label: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath === "" || relativePath.startsWith(`..${sep}`) || relativePath === ".." || relativePath.startsWith("..")) {
    throw new Error(`${label} ${JSON.stringify(candidate)} is outside ${JSON.stringify(root)}`);
  }
}

/** 递归收集本地目录下的全部文件;路径统一转成 POSIX 分隔的相对路径,供上传沙箱用。 */
export async function collectLocalFiles(localDir: string, ignore: readonly string[] = []): Promise<CollectedLocalFile[]> {
  const ignored = new Set(ignore);
  const given = await lstat(localDir);
  if (given.isSymbolicLink()) {
    throw new Error(`uploadDirectory source ${JSON.stringify(localDir)} is a symlink`);
  }
  if (!given.isDirectory()) {
    throw new Error(`uploadDirectory source ${JSON.stringify(localDir)} is not a directory`);
  }
  const root = await realpath(localDir);
  const out: CollectedLocalFile[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir)) {
      if (entry.includes("\0")) throw new Error("uploadDirectory source contains a NUL in a path");
      if (ignored.has(entry)) continue;
      const abs = join(dir, entry);
      const st = await lstat(abs);
      if (st.isSymbolicLink()) {
        throw new Error(`uploadDirectory refuses symlink ${JSON.stringify(abs)}`);
      }
      const resolved = resolve(abs);
      assertInsideRoot(root, resolved, "uploadDirectory source");
      if (st.isDirectory()) {
        await walk(resolved);
      } else if (st.isFile()) {
        out.push({
          path: relative(root, resolved).split(sep).join("/"),
          content: await readFile(resolved),
        });
      }
    }
  }
  await walk(root);
  return out;
}
