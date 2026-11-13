import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { createE2EContext } from "@niceeval/testkit";
const context = createE2EContext({
  repoId: "instabox",
  project: { from: process.cwd(), prefix: "niceeval-instabox-", omitTopLevel: ["node_modules", "test", ".niceeval", ".e2e-artifacts"], links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }] },
  commands: { niceeval: [resolve("node_modules/.bin/niceeval")] },
});
// @feature docs/feature/sandbox/README.md
test("retired commands explain the SSH failure and delivered bytes", async () => {
  await context.case("transport-diagnostics", {}, async ({ commands: { niceeval }, paths }) => {
    const receipt = join(paths.projectRoot, "fault.txt");
    const result = await niceeval.run(["exp", "transport", "--rerun", "all"], { env: {
      NODE_OPTIONS: `--import=${pathToFileURL(join(paths.projectRoot, "fixtures/disconnect.mjs")).href}`,
      NICEEVAL_TRANSPORT_FAULT_RECEIPT: receipt,
    } });
    expect(await readFile(receipt, "utf8").catch(() => result.diagnostic())).toBe("client-destroyed\n");
    expect(result.exitCode, result.diagnostic()).toBe(0);
  });
});
