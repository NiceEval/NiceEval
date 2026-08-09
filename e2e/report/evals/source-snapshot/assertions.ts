import type { TestContext } from "niceeval";
import { equals } from "niceeval/expect";

export const IMPORTED_ASSERTION_SNAPSHOT = "IMPORTED_ASSERTION_SNAPSHOT_BEFORE";

/**
 * 这个 helper 必须保留在独立项目文件中：调用 t.check() 时，运行时 source registry
 * 会同时捕获本文件与 Eval 入口的 callers 链，供 `show --source` 真实读回。
 */
export function checkImportedSnapshot(t: TestContext): void {
  t.check(IMPORTED_ASSERTION_SNAPSHOT, equals(IMPORTED_ASSERTION_SNAPSHOT));
}
