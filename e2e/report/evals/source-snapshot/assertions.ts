import type { TestContext } from "niceeval";
import { equals } from "niceeval/expect";

/**
 * Keep this helper in its own project file so runtime source capture records
 * both the eval entry and this callee for `show --source`.
 */
export function checkImportedSnapshot(t: TestContext): void {
  const snapshot = "IMPORTED_ASSERTION_SNAPSHOT_BEFORE";
  t.check(snapshot, equals(snapshot));
}
