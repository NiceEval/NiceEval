import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { threadId, isMainThread } from "node:worker_threads";
import { readProfileManifest } from "./sentry-profile";
import type { ProfilePolicy } from "./sentry";

// Import failures, including a missing target binding, cannot disable error/tracing.
export async function loadNodeProfiling(
  release: string,
  load = async () => {
    const require = createRequire(import.meta.url);
    const profilerRequire = createRequire(require.resolve("@sentry/profiling-node"));
    const bindings = profilerRequire("@sentry/node-cpu-profiler").PrivateCpuProfilerBindings;
    if (!bindings || typeof bindings.startProfiling !== "function" || typeof bindings.stopProfiling !== "function")
      throw new Error("Native profiling binding unavailable");
    return import("@sentry/profiling-node");
  },
) {
  const policy: ProfilePolicy = { enabled: false, threadId };
  try {
    if (!isMainThread) return { policy, integrations: [] };
    const { nodeProfilingIntegration } = await load();
    const integration = nodeProfilingIntegration();
    policy.enabled = true;
    try {
      policy.manifest = readProfileManifest(
        JSON.parse(await readFile(`${process.cwd()}/.next/server/sentry-profile-assets.json`, "utf8")),
        release,
      );
    } catch {
      /* Missing manifest redacts every frame. CI checks the artifact. */
    }
    return { policy, integrations: [integration] };
  } catch {
    console.warn("Sentry Node profiling unavailable; error and tracing remain enabled");
    return { policy, integrations: [] };
  }
}
