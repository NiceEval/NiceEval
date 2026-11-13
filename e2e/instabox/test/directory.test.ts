import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { context, verifyMachinesAbsent } from "./context.ts";
// @feature docs/feature/sandbox/README.md
test.concurrent("directory upload records one expansion and preserves bytes and modes", async () => {
  await context.case("directory-archive", {}, async ({ commands: { niceeval }, paths }) => {
    const tree = join(paths.projectRoot, "fixtures/tree/nested");
    await mkdir(tree, { recursive: true });
    for (let i = 0; i < 20; i++) await writeFile(join(tree, `file-${i}.bin`), Buffer.from([0, 255, i, 10]));
    await writeFile(join(tree, "run.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(join(tree, "run.sh"), 0o751);
    const machines = join(paths.projectRoot, "machines.txt");
    const transfers = join(paths.projectRoot, "transfers.txt");
    const result = await niceeval.run(["exp", "directory", "--rerun", "all", "--json"], { env: {
      NODE_OPTIONS: `--import=${pathToFileURL(join(paths.projectRoot, "fixtures/machines.mjs")).href} --import=${pathToFileURL(join(paths.projectRoot, "fixtures/archive.mjs")).href}`,
      NICEEVAL_TRANSPORT_MACHINES: machines,
      NICEEVAL_ARCHIVE_RECEIPT: transfers,
    } });
    await verifyMachinesAbsent(machines);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    const transferLog = await readFile(transfers, "utf8");
    expect(transferLog.match(/^archive-put$/gm)).toHaveLength(3);
    expect(transferLog.match(/^archive-get$/gm)).toHaveLength(1);
    const locator = result.expEvalEvents()[0]?.locator;
    expect(locator, result.diagnostic()).toBeDefined();
    const request = join(paths.projectRoot, "trace.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.trace", locator } }));
    const commands = await niceeval.run(["query", "run", "--request", request]);
    expect(commands.exitCode, commands.diagnostic()).toBe(0);
    const items = [];
    for (const commandId of commands.querySuccess("attempt.trace").trace.identityIndex.commandIds) {
      await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v3", operation: {
        kind: "attempt.trace.detail", locator, selector: { kind: "command", commandId },
      } }));
      const detail = await niceeval.run(["query", "run", "--request", request]);
      expect(detail.exitCode, detail.diagnostic()).toBe(0);
      items.push(detail.querySuccess("attempt.trace.detail").detail);
    }
    const start = items.findIndex(item => JSON.stringify(item).includes("directory-upload-start"));
    const end = items.findIndex(item => JSON.stringify(item).includes("directory-upload-end"));
    expect(start, commands.diagnostic()).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    console.info("Directory upload timing:", JSON.stringify(items[end]));
    expect(items.slice(start + 1, end), commands.diagnostic()).toHaveLength(1);
    const actionStart = items.findIndex(item => JSON.stringify(item).includes("directory-action-start"));
    const actionEnd = items.findIndex(item => JSON.stringify(item).includes("directory-action-end"));
    expect(actionStart).toBeGreaterThanOrEqual(0);
    expect(actionEnd).toBeGreaterThan(actionStart);
    expect(items.slice(actionStart + 1, actionEnd), "A declaration-time directory action must also use one expansion").toHaveLength(1);
  });
});
