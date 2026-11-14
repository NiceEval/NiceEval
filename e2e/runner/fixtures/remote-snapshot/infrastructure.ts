import type { E2ECaseContext } from "@niceeval/testkit";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

/** Owns only the fake Provider's Docker image, label and cleanup. */
export async function withSnapshotInfrastructure(
  { run, paths }: E2ECaseContext<{ niceeval: readonly string[] }>,
  use: (fixture: { readonly image: string; readonly filter: string; readonly env: Record<string, string> }) => Promise<void>,
) {
  const id = randomUUID();
  const filter = `label=niceeval.snapshot-fixture=${id}`;
  const image = `niceeval-snapshot-fixture:${id}`;
  try {
    const built = await run(["docker", "build", "--label", `niceeval.snapshot-fixture=${id}`, "-t", image, "fixtures/remote-snapshot"], { timeoutMs: 120_000 });
    if (built.exitCode !== 0) throw new Error(built.diagnostic());
    await use({ image, filter, env: {
      E2B_API_KEY: "local-fixture-only", INSTABOX_API_KEY: "local-fixture-only",
      OPEN_SANDBOX_DOMAIN: "http://fixture.invalid",
      NICEEVAL_HOME: join(paths.projectRoot, ".snapshot-home"),
      NICEEVAL_SNAPSHOT_FIXTURE_ID: id, NICEEVAL_SNAPSHOT_FIXTURE_IMAGE: image,
      NODE_OPTIONS: `--import=${join(paths.projectRoot, "fixtures/remote-snapshot/preload.mjs")}`,
    } });
  } finally {
    for (const [kind, list] of [["container", ["ps", "-aq"]], ["image", ["images", "-q"]]] as const) {
      const resources = await run(["docker", ...list, "--filter", filter]);
      if (resources.exitCode !== 0) throw new Error(resources.diagnostic());
      const ids = [...new Set(resources.stdout.trim().split(/\s+/u).filter(Boolean))];
      if (ids.length) {
        const removed = await run(["docker", kind, "rm", "-f", ...ids]);
        if (removed.exitCode !== 0) throw new Error(removed.diagnostic());
      }
    }
  }
}
