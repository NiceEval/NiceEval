// 沙箱编排的固定段(对所有沙箱型 agent 一致):收集 workspace 文件、打 git 基线、
// 跑完采 diff。adapter 只管中间「把 agent 跑起来」那一段。

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { DiffData, Sandbox, SandboxFile } from "../types.ts";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  ".turbo",
  ".fastevals",
  "coverage",
]);

/** 递归收集 workspace 目录下 agent 可见的文件(排除构建产物 / 依赖)。 */
export async function collectWorkspaceFiles(dir: string): Promise<SandboxFile[]> {
  const out: SandboxFile[] = [];
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

/** 打 git 基线:gitignore 掉依赖 / 构建产物,提交一版,供之后 diff HEAD 采改动。 */
export async function initGitAndCommit(sandbox: Sandbox): Promise<void> {
  await sandbox.writeFiles({
    ".gitignore": "node_modules/\n.next/\ndist/\npackage-lock.json\n.fastevals/\n__fastevals__/\n",
  });
  await sandbox.runShell(
    'git init -q && git config user.email "fastevals@localhost" && git config user.name "fastevals" && git add -A && git commit -q -m "baseline" || true',
  );
}

/** git diff HEAD 采 agent 生成 / 删除的文件。 */
export async function captureGeneratedFiles(sandbox: Sandbox): Promise<DiffData> {
  const generatedFiles: Record<string, string> = {};
  const deletedFiles: string[] = [];
  try {
    const res = await sandbox.runShell("git add -A && git diff HEAD --name-status");
    const lines = res.stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const status = line.slice(0, tab).trim();
      const path = line.slice(tab + 1).trim();
      if (!path) continue;
      if (status.startsWith("D")) {
        deletedFiles.push(path);
      } else {
        try {
          generatedFiles[path] = await sandbox.readFile(path);
        } catch {
          // 二进制 / 不可读跳过
        }
      }
    }
  } catch {
    // 采集失败返回空
  }
  return { generatedFiles, deletedFiles };
}
