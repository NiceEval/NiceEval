import { appendFileSync } from "node:fs";
import { join } from "node:path";

export type PluginLifecycleEvent = Readonly<Record<string, unknown>> & {
  readonly kind: string;
};

export function appendPluginLifecycleEvent(event: PluginLifecycleEvent): void {
  appendFileSync(join(process.cwd(), "plugin-lifecycle.ndjson"), `${JSON.stringify(event)}\n`, "utf8");
}
