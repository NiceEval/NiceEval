import { captureLoc } from "../source-loc.ts";
import type { ErrorSource } from "./types.ts";

/**
 * Capture a user call site only after a migration has been positively
 * identified. `captureLoc` removes NiceEval's own frames; failure to find a
 * project frame remains explicit instead of pointing at the rejection helper.
 */
export function captureMigrationSource(options: { readonly root?: string | undefined } = {}): ErrorSource {
  try {
    const location = captureLoc({ root: options.root });
    if (location === undefined || location.column === undefined) {
      return { state: "unavailable" as const, reason: "unresolvable" as const };
    }
    return {
      state: "located" as const,
      file: location.file,
      line: location.line,
      column: location.column,
    };
  } catch {
    return { state: "unavailable" as const, reason: "unresolvable" as const };
  }
}
