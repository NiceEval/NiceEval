// vercel / e2b / incus 共用的 downloadDirectory 两阶段模板,与 uploadDirectory 对称:
// Phase 1 只做 find -print0(NUL 分隔相对路径);Phase 2 经 readOne 逐文件独立读取二进制。
// 写回本地磁盘前拒绝绝对路径、..、NUL，并验证 resolved destination 仍在 target root。

import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { CommandResult } from "../types.ts";
import { buildDownloadFindScript } from "./shell.ts";

function assertSafeRelativePath(relPath: string): string {
  if (relPath.includes("\0")) throw new Error("downloadDirectory listed a path containing NUL");
  const trimmed = relPath.replace(/^\.\//, "");
  if (trimmed === "" || isAbsolute(trimmed) || trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new Error(`downloadDirectory listed an absolute path ${JSON.stringify(relPath)}`);
  }
  const parts = trimmed.split(/[\\/]/);
  if (parts.some((part) => part === ".." || part.includes("\0"))) {
    throw new Error(`downloadDirectory listed a path that escapes the target root ${JSON.stringify(relPath)}`);
  }
  return trimmed;
}

function assertInsideRoot(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || relativePath.startsWith("..")) {
    throw new Error(`downloadDirectory destination ${JSON.stringify(candidate)} is outside ${JSON.stringify(root)}`);
  }
}

export async function downloadDirectoryByList(opts: {
  localDir: string;
  ignore: readonly string[];
  /** 已绑定远端目录为 cwd 的 shell 执行器;script 只需管 find 本身。 */
  runShell: (script: string) => Promise<CommandResult>;
  /** 按远端目录下的相对路径读取一个文件的二进制内容。 */
  readOne: (relPath: string) => Promise<Uint8Array>;
}): Promise<void> {
  await mkdir(opts.localDir, { recursive: true });
  const root = await realpath(opts.localDir);
  const result = await opts.runShell(buildDownloadFindScript({ ignore: opts.ignore }));
  if (result.exitCode !== 0) {
    throw new Error(`downloadDirectory listing failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  const listed = result.stdout.split("\0").map((entry) => entry.replace(/^\.\//, "")).filter(Boolean);
  await Promise.all(
    listed.map(async (rawPath) => {
      const relPath = assertSafeRelativePath(rawPath);
      const dest = resolve(root, ...relPath.split("/"));
      assertInsideRoot(root, dest);
      const parent = dirname(dest);
      await mkdir(parent, { recursive: true });
      try {
        const existing = await lstat(dest);
        if (existing.isSymbolicLink()) {
          throw new Error(`downloadDirectory refuses existing symlink ${JSON.stringify(dest)}`);
        }
      } catch (cause) {
        const code = cause !== null && typeof cause === "object" && "code" in cause
          ? String((cause as { readonly code?: unknown }).code)
          : "";
        if (code !== "ENOENT") throw cause;
      }
      const parentReal = await realpath(parent);
      const resolvedDest = resolve(parentReal, basename(dest));
      assertInsideRoot(root, resolvedDest);
      const content = await opts.readOne(relPath);
      await writeFile(resolvedDest, content);
    }),
  );
}
