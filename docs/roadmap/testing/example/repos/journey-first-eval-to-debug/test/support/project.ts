import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempProject {
  root: string;
  cleanup(): void;
}

/** 创建并登记一个可清理的临时项目目录；cleanup 无条件执行。 */
export function tempDir(prefix: string): TempProject {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
