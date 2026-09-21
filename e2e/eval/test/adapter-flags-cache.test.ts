// rerun: pnpm e2e test --repo eval -- --run test/adapter-flags-cache.test.ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

test.concurrent("Adapter flags 规范化等价时复用且 parseFlags 行为版本隔离缓存 [necase_3JRA1GT0ZX74H9V7]", async () => {
  await evalE2E.case("adapter-flags-cache", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const initial = await niceeval.run(["exp", "parsed-flags", "--json"]);
    expect(initial.exitCode, initial.diagnostic()).toBe(0);
    expect(initial.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
    const runId = only(initial.expReceipt().createdRunIds, () => true, initial.diagnostic());
    const request = join(projectRoot, "flags-run.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "run.get", runId } }));
    const inspected = await niceeval.run(["query", "run", "--request", request]);
    expect(inspected.exitCode, inspected.diagnostic()).toBe(0);
    expect(inspected.querySuccess("run.get").run.value.context?.execution?.flags).toEqual({ strategy: "safe", limit: 2, enabled: true });

    const equivalent = await niceeval.run(["exp", "parsed-flags", "--json"], {
      env: { NICEEVAL_E2E_FLAGS_INPUT: '{"strategy":"safe","limit":"2"}' },
    });
    expect(equivalent.exitCode, equivalent.diagnostic()).toBe(0);
    expect(only(equivalent.expEvents(), (event) => event.event === "start", equivalent.diagnostic())).toMatchObject({ reused: 1 });
    expect(await readFile(join(projectRoot, "flags-lifecycle.txt"), "utf8")).toBe("setup\ncreate\n");

    const revision = await niceeval.run(["exp", "parsed-flags", "--json"], {
      env: { NICEEVAL_E2E_FLAGS_REVISION: "parser/v2" },
    });
    expect(revision.exitCode, revision.diagnostic()).toBe(0);
    expect(only(revision.expEvents(), (event) => event.event === "start", revision.diagnostic())).toMatchObject({ reused: 0 });
    expect(revision.expEvalEvents()).toEqual([expect.objectContaining({ verdict: "passed" })]);
    expect(await readFile(join(projectRoot, "flags-lifecycle.txt"), "utf8")).toBe("setup\ncreate\nsetup\ncreate\n");
  });
});
