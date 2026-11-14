import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { command, defined, pollUntil, waitForOutput, withProcess, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// @feature docs/feature/sandbox/README.md
test.concurrent("Docker 下载在传输前排除忽略目录并保留字面量相邻文件", async () => {
  await withProjectCopy(
    {
      from: process.cwd(),
      prefix: "niceeval-e2e-docker-download-",
      omitTopLevel: [".niceeval", "node_modules", "test"],
      links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
    },
    async ({ root }) => {
      const docker = command(["docker"]);
      const context = await docker.run(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
      expect(context.exitCode, context.diagnostic()).toBe(0);
      const endpoint = process.env.DOCKER_HOST ?? context.stdout.trim();
      expect(endpoint).toMatch(/^unix:\/\//u);
      const proxySocket = join(root, "docker.sock");
      await withProcess(
        [process.execPath, resolve("fixtures/docker-byte-proxy.mjs"), endpoint.slice("unix://".length), proxySocket],
        { cwd: root, processGroup: true, timeoutMs: 180_000 },
        async (proxy) => {
          const ready = await waitForOutput(proxy, "stdout", /proxy-ready:\d+/u, {
            timeoutMs: 10_000,
            label: "transparent Docker proxy",
          });
          const port = defined(/proxy-ready:(\d+)/u.exec(ready)?.[1]);
          const transferred = async () => {
            const count = Number(await (await fetch(`http://127.0.0.1:${port}`)).text());
            expect(Number.isSafeInteger(count)).toBe(true);
            return count;
          };
          await withProcess(
            [resolve("node_modules/.bin/niceeval"), "exp", "docker-download", "--rerun", "all", "--json"],
            {
              cwd: root,
              env: { ...process.env, DOCKER_HOST: `unix://${proxySocket}` },
              processGroup: true,
              timeoutMs: 150_000,
            },
            async (controlled) => {
              let ended: string | undefined;
              void controlled.done.then((receipt) => {
                ended = receipt.diagnostic();
              });
              const waitFor = (name: string) =>
                pollUntil(
                  async () => {
                    if (existsSync(join(root, name))) return true;
                    if (ended !== undefined) throw new Error(ended);
                    return undefined;
                  },
                  { timeoutMs: 90_000, intervalMs: 20, label: name },
                );
              await waitFor("download-ready");
              const before = await transferred();
              await writeFile(join(root, "download-release"), "release");
              await waitFor("download-done");
              const downloadBytes = (await transferred()) - before;
              await writeFile(join(root, "download-finish"), "finish");
              const result = await controlled.done;
              expect(result.exitCode, result.diagnostic()).toBe(0);
              expect(result.expReceipt().completion).toBe("completed");
              expect((await readdir(join(root, "download-output"))).sort()).toEqual(["cache", "keep.txt"]);
              expect(await readFile(join(root, "download-output", "keep.txt"), "utf8")).toBe("kept 中");
              expect(await readFile(join(root, "download-output", "cache"), "utf8")).toBe("keep literal neighbor");
              expect(downloadBytes).toBeLessThan(64 * 1024);
              await pollUntil(
                async () => {
                  const listed = await docker.run([
                    "ps",
                    "-aq",
                    "--filter",
                    `label=niceeval.pid=${defined(controlled.pid)}`,
                  ]);
                  expect(listed.exitCode, listed.diagnostic()).toBe(0);
                  return listed.stdout.trim() === "" ? true : undefined;
                },
                { timeoutMs: 15_000, intervalMs: 100, label: "owned download sandbox removed" },
              );
            },
          );
        },
      );
    },
  );
});
