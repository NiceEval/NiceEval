import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { runHost } from "niceeval/run/host";
import { invokeCli } from "./fixtures/judge-harness/harness.ts";
import { createRecordProject } from "./fixtures/record-harness/project.ts";

const path = "evals/first.eval.ts";
const helperCount = 360;
const helpers = Array.from({ length: helperCount }, (_, index) => `source-${index}.ts`);
const source = `import adapter from "../adapter.ts";
${helpers.map((name, index) => `import { check as check${index} } from "../${name}";`).join("\n")}
export default adapter.defineEval({
  test(t) {
    ${helpers.map((_, index) => `check${index}(t);`).join("\n")}
  },
});
/*${"x".repeat(16 * 1024 * 1024)}*/
`;
let cwd: string | undefined;
let runId: string;
let exportedFiles: string[];
let shown: Awaited<ReturnType<typeof invokeCli>>;
let imported: Awaited<ReturnType<typeof invokeCli>>;

function readSeal(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      seal: db.prepare("SELECT logical_seal_identity FROM ne19_runs WHERE run_id=?").get(runId),
      inventory: db.prepare(
        `SELECT logical_inventory,inventory_digest FROM ne19_attachments
        WHERE owner_run_id=? AND family='niceeval.sources'`,
      ).get(runId),
      inlineInventory: db.prepare(
        `SELECT logical_inventory,inventory_digest FROM ne19_attachments
        WHERE owner_run_id=? AND family='niceeval.identity-manifests'`,
      ).get(runId),
    };
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  cwd = await createRecordProject("niceeval-large-record-sources-", { held: false });
  const project = cwd;
  await Promise.all(helpers.map((name) =>
    writeFile(join(project, name), "export function check(t: { ready(): void }) { t.ready(); }\n"),
  ));
  await writeFile(join(cwd, path), source);
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector: "runs",
      config: { maxConcurrency: 1 },
      overrides: { rerun: "all", earlyExit: false },
    }),
  );
  if (planned.status !== "ready") throw new Error("Expected a ready Experiment plan");
  const { receipt } = await Effect.runPromise(experimentHost.invocation.run({ plan: planned.plan }));
  expect(receipt.completion).toBe("completed");
  runId = receipt.createdRunIds[0]!;
  const { run } = await Effect.runPromise(runHost.get({ cwd, runId }));
  const publication = run.slots[0]?.publication;
  if (publication?.state !== "published") throw new Error("Expected a published Attempt");
  exportedFiles = [join(cwd, "portable.sqlite"), join(cwd, "repeat.sqlite")];
  for (const recordPath of exportedFiles) {
    const exported = await invokeCli(cwd, ["run", "export", "--run", runId, "--out", recordPath, "--json"]);
    if (exported.code !== 0) throw new Error(exported.stderr);
  }
  const target = join(cwd, "imported");
  await mkdir(target);
  const first = await invokeCli(target, ["run", "import", exportedFiles[0]!, "--json"]);
  if (first.code !== 0) throw new Error(first.stderr);
  imported = await invokeCli(target, ["run", "import", exportedFiles[1]!, "--json"]);
  shown = await invokeCli(target, ["show", publication.attemptLocator, "source", "--json"]);
}, 60_000);

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

// @feature docs/feature/inspection/README.md#exact-read-and-comparison
test("an exported and imported Run retains the full Sources inventory and source digests", () => {
  const [first, second] = exportedFiles.map(readSeal);
  expect(first?.seal).toMatchObject({ logical_seal_identity: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  expect(first).toEqual(readSeal(join(cwd!, ".niceeval", "record.sqlite")));
  expect(second).toEqual(first);
  const inlineInventory = first?.inlineInventory;
  expect(inlineInventory?.logical_inventory).toBeInstanceOf(Uint8Array);
  const inlineBytes = inlineInventory?.logical_inventory as Uint8Array;
  expect(inlineBytes.byteLength).toBeLessThanOrEqual(64 * 1024);
  expect(createHash("sha256").update(inlineBytes).digest("hex")).toBe(inlineInventory?.inventory_digest);
  const inventory = first?.inventory;
  expect(inventory?.logical_inventory).toBeInstanceOf(Uint8Array);
  expect(JSON.parse(new TextDecoder().decode(inventory?.logical_inventory as Uint8Array))).toMatchObject({
    "$niceeval.record.inventory": {
      byteLength: expect.any(Number),
      digest: inventory?.inventory_digest,
    },
  });
  expect(imported.code, imported.stderr).toBe(0);
  expect(JSON.parse(imported.stdout)).toMatchObject({ alreadyPresent: [runId], imported: [] });
  expect(shown.code, shown.stderr).toBe(0);
  expect(JSON.parse(shown.stdout)).toMatchObject({
    sources: {
      state: "available",
      items: expect.arrayContaining([
        expect.objectContaining({
          path,
          byteLength: Buffer.byteLength(source),
          sha256: createHash("sha256").update(source).digest("hex"),
        }),
      ]),
    },
  });
  expect(new Set(JSON.parse(shown.stdout).sources.items.map((item: { path: string }) => item.path))).toEqual(
    new Set([path, "adapter.ts", ...helpers]),
  );
});
