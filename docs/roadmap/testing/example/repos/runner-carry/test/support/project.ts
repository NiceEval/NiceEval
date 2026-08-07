import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface TempProject {
  root: string;
  cleanup(): void;
}

/** 创建并登记一个可清理的临时目录；cleanup 无条件执行。 */
export function tempDir(prefix: string): TempProject {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * 把当前项目复制成隔离副本：会修改 config 或 eval 的场景只在这个副本里进行，
 * 不碰共享现场，也不需要「改完再写回」（见 architecture.md「隔离与证据复用」）。
 * `.niceeval/`、`test/` 与 `node_modules/` 不复制；仅把原 Repo 已安装的 node_modules
 * 链入副本，让 fixture 复制保持轻量。正式 runner 会在副本中安装候选 tarball。
 */
export function copyProject(prefix = "niceeval-e2e-carry-"): TempProject {
  const project = tempDir(prefix);
  cpSync(process.cwd(), project.root, {
    recursive: true,
    filter: (source) => {
      const basename = source.split("/").at(-1) ?? "";
      return basename === ".niceeval" || basename === "test" || basename === "node_modules"
        ? false
        : true;
    },
  });
  symlinkSync(resolve("node_modules"), join(project.root, "node_modules"), "dir");
  return project;
}

/**
 * Repo-local wrapper：copy 的排除项和 node_modules 链接仍由 runner-carry 拥有，
 * 这里只确保正文异常与目录清理异常不会互相遮蔽。
 */
export async function withProjectCopy<T>(
  prefix: string,
  body: (project: TempProject) => Promise<T>,
): Promise<T> {
  const project = copyProject(prefix);
  let bodyError: unknown;
  try {
    return await body(project);
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    try {
      project.cleanup();
    } catch (cleanupError) {
      if (bodyError !== undefined) {
        throw new AggregateError(
          [bodyError, cleanupError],
          "runner-carry 正文和项目副本清理同时失败",
          { cause: bodyError },
        );
      }
      throw cleanupError;
    }
  }
}
