import { readProfileManifest } from "./sentry-profile";
import type { ProfilePolicy } from "./sentry";

export function browserProfilePolicy(release: string): ProfilePolicy {
  const policy: ProfilePolicy = {
    enabled:
      typeof window !== "undefined" && typeof (window as unknown as { Profiler?: unknown }).Profiler === "function",
    threadId: 0,
  };
  // Do not delay initialization of errors/traces. A failed/mismatched manifest redacts frames.
  if (policy.enabled && /^site@[a-f0-9]{40}$/.test(release))
    void fetch(`/_next/static/sentry-profile-assets/${release.slice(5)}.json`, {
      credentials: "omit",
      redirect: "error",
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((manifest) => {
        policy.manifest = readProfileManifest(manifest, release);
      })
      .catch(() => {});
  return policy;
}
