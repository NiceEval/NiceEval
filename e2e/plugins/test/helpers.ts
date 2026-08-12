import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { command } from "@niceeval/testkit";
import type { PluginLifecycleEvent } from "../fixtures/events.ts";

export const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

export const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-plugins-",
  omitTopLevel: [".niceeval", "node_modules", "plugin-lifecycle.ndjson", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

export function lifecycleEvents(root: string): PluginLifecycleEvent[] {
  return readFileSync(join(root, "plugin-lifecycle.ndjson"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PluginLifecycleEvent);
}
