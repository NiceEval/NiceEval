// owner: docs/engineering/testing/e2e/adapter/codex-cli.md#adapter-codex-app-server-host-config-isolation
// rerun: pnpm e2e run --candidate <candidate.tgz> --repo adapter/codex-app-server -- --run test/host-config-isolation.test.ts

import { expect, test } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { codexAppServerE2E } from "./context.ts";

const HOME_SENTINEL = 'host_sentinel = "HOME must remain byte-identical"\n';
const CODEX_HOME_SENTINEL = 'host_sentinel = "CODEX_HOME must remain byte-identical"\n';

test("容器 Sandbox 运行后宿主 Codex 配置保持不变", async () => {
  await codexAppServerE2E.case(
    "host-config-isolation",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const hostHome = join(paths.projectRoot, "host-home");
      const codexHome = join(paths.projectRoot, "host-codex-home");
      const homeConfig = join(hostHome, ".codex", "config.toml");
      const codexHomeConfig = join(codexHome, "config.toml");
      await mkdir(join(hostHome, ".codex"), { recursive: true });
      await mkdir(codexHome, { recursive: true });
      await writeFile(homeConfig, HOME_SENTINEL, "utf8");
      await writeFile(codexHomeConfig, CODEX_HOME_SENTINEL, "utf8");

      const result = await niceeval.run(
        ["exp", "host-config-isolation", "--rerun", "all"],
        { env: { HOME: hostHome, CODEX_HOME: codexHome } },
      );

      expect(result.exitCode, result.diagnostic()).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("1 passed · 0 failed · 0 errored");
      const homeUnchanged = (await readFile(homeConfig)).equals(Buffer.from(HOME_SENTINEL));
      const codexHomeUnchanged = (await readFile(codexHomeConfig)).equals(Buffer.from(CODEX_HOME_SENTINEL));
      expect(
        { homeUnchanged, codexHomeUnchanged },
        "test-owned Codex config sentinel bytes must remain unchanged",
      ).toEqual({ homeUnchanged: true, codexHomeUnchanged: true });
    },
  );
});
