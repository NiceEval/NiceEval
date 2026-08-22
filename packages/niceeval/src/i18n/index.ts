// CLI / Node runtime i18n: keep message keys and t(key, vars); English catalog only.
// View keeps its own zh/en dictionaries in src/view/app/i18n.ts.
// Shared interpolate / Locale types live in core.ts.

import { en, type MessageKey } from "./en.ts";
import { interpolate, type Vars } from "./core.ts";

export type { MessageKey } from "./en.ts";
export type { Vars } from "./core.ts";

export function t(key: MessageKey, vars: Vars = {}): string {
  return interpolate(en[key], vars);
}
