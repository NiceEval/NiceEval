import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createE2EContext, runProcess } from "@niceeval/testkit";
import type { PluginLifecycleEvent } from "../fixtures/events.ts";

export const e2e = createE2EContext({
  repoId: "plugins",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-plugins-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "plugin-lifecycle.ndjson", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: {
    niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")],
  },
});

export function lifecycleEvents(root: string): PluginLifecycleEvent[] {
  return readFileSync(join(root, "plugin-lifecycle.ndjson"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PluginLifecycleEvent);
}

export function typecheckInstalledPluginConsumer(root: string) {
  return runProcess([join(root, "node_modules", ".bin", "tsc"), "--noEmit"], {
    cwd: root,
    timeoutMs: 60_000,
  });
}

export function validateDynamicPluginConsumer(root: string) {
  return runProcess([process.execPath, "fixtures/dynamic-plugin-validation.mjs"], {
    cwd: root,
    timeoutMs: 30_000,
  });
}
