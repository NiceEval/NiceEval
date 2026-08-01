// 沙箱编排的固定段(对所有沙箱型 agent 一致):收集 workspace 文件。
// 变更归因(私有 git ledger、send 窗口)见 ledger.ts;adapter 只管「把 agent 跑起来」那一段。

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
export interface WorkspaceFile {
  readonly path: string;
  readonly content: Uint8Array;
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  ".turbo",
  ".niceeval",
  "coverage",
]);

/** 递归收集 workspace 目录下 agent 可见的文件(排除构建产物 / 依赖)。 */
export async function collectWorkspaceFiles(dir: string): Promise<WorkspaceFile[]> {
  const out: WorkspaceFile[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".DS_Store")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        const rel = relative(dir, full).split(sep).join("/");
        const content = await readFile(full);
        out.push({ path: rel, content });
      }
    }
  }
  await walk(dir);
  return out;
}

/** 检查路径是否是目录(workspace 解析用)。 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
