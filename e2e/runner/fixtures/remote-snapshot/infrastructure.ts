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
    // Remove only this invocation's labelled resources. Committed snapshots
    // inherit the fixture label and must disappear before their parent image.
    const missing = (stderr: string) => /No such (?:image|container)(?:\b|:)/iu.test(stderr);
    const containers = await run(["docker", "ps", "-aq", "--filter", filter]);
    if (containers.exitCode !== 0) throw new Error(containers.diagnostic());
    for (const container of new Set(containers.stdout.trim().split(/\s+/u).filter(Boolean))) {
      const removed = await run(["docker", "container", "rm", "-f", container]);
      if (removed.exitCode !== 0 && !missing(removed.stderr)) throw new Error(removed.diagnostic());
    }
    const images = await run(["docker", "images", "-aq", "--filter", filter]);
    if (images.exitCode !== 0) throw new Error(images.diagnostic());
    const owned = new Map<string, { readonly Id: string; readonly Parent: string; readonly Created: string }>();
    for (const imageId of new Set(images.stdout.trim().split(/\s+/u).filter(Boolean))) {
      const inspected = await run(["docker", "image", "inspect", imageId]);
      if (inspected.exitCode !== 0) {
        if (missing(inspected.stderr)) continue;
        throw new Error(inspected.diagnostic());
      }
      const [image] = JSON.parse(inspected.stdout);
      if (image.Config?.Labels?.["niceeval.snapshot-fixture"] !== id)
        throw new Error(`Refusing to remove image outside this snapshot fixture: ${imageId}`);
      owned.set(image.Id, image);
    }
    while (owned.size) {
      // Parent is available with Docker's classic image store. Creation time
      // also orders descendants first on stores that omit Parent metadata.
      const leaves = [...owned.values()]
        .filter((image) => ![...owned.values()].some((child) => child.Parent === image.Id))
        .sort((a, b) => b.Created.localeCompare(a.Created));
      if (!leaves.length) throw new Error("Snapshot fixture image ancestry contains a cycle");
      for (const image of leaves) {
        const removed = await run(["docker", "image", "rm", "-f", "--no-prune", image.Id]);
        if (removed.exitCode !== 0 && !missing(removed.stderr)) throw new Error(removed.diagnostic());
        owned.delete(image.Id);
      }
    }
    // Missing images are harmless; surviving resources owned by this case are
    // still an error, including resources created during a failed invocation.
    for (const list of [["ps", "-aq"], ["images", "-aq"]]) {
      const remaining = await run(["docker", ...list, "--filter", filter]);
      if (remaining.exitCode !== 0) throw new Error(remaining.diagnostic());
      if (remaining.stdout.trim()) throw new Error(`Snapshot fixture leaked resources: ${remaining.stdout.trim()}`);
    }
  }
}
