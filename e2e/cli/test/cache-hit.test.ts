// owner: docs/engineering/testing/e2e/cli.md#cli-docker-task-build-cache
// rerun: pnpm e2e --repo cli -- --run test/cache-hit.test.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("Docker task build 在不同 Invocation 复用受管 image cache", async () => {
  await cliE2E.case("cache-hit", {}, async ({ commands: { niceeval }, paths }) => {
    const fakeBin = join(paths.projectRoot, "fixtures/cache-hit/bin");
    const env = {
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      XDG_STATE_HOME: join(paths.projectRoot, "state"),
      DOCKER_DEFAULT_PLATFORM: "linux/amd64",
    };
    const first = await niceeval.run(["exp", "cache-hit", "--rerun", "all"], { env });
    expect(first.stdout.replace(/\s+/gu, " "), first.diagnostic()).toContain("built once · docker:dockerfile:cache-hit");

    const second = await niceeval.run(["exp", "cache-hit", "--rerun", "all"], { env });
    expect(second.stdout.replace(/\s+/gu, " "), second.diagnostic()).toContain("build cache hit · docker:dockerfile:cache-hit");
    expect(await readFile(join(paths.projectRoot, "fixtures/cache-hit/build-count"), "utf8")).toBe("1\n");
  });
});
