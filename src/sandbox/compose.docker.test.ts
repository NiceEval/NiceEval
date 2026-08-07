// 真机 Docker opt-in：NICEEVAL_DOCKER_TEST=1 pnpm exec vitest run --project unit src/sandbox/compose.docker.test.ts
// 覆盖 attempt signal 已 abort 时的 Compose 整组回收，以及 owned/anonymous/external volume 边界。

import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Docker from "dockerode";
import { describe, expect, it } from "vitest";
import {
  collectComposeBuilds,
  COMPOSE_MATERIALIZER_REVISION,
  materializeDockerComposeProviderCase,
  runDockerCompose,
} from "./compose.ts";
import { computeCaseKey } from "./identity.ts";

const runDocker = process.env.NICEEVAL_DOCKER_TEST === "1";

describe.runIf(runDocker)("Docker Compose provider real cleanup", () => {
  it("aborted attempt 仍删除 project container/network/owned+anonymous volumes，并保留 external volume", async () => {
    const root = await mkdtemp(join(tmpdir(), "niceeval-compose-docker-"));
    const suffix = randomUUID().slice(0, 8);
    const externalVolume = `niceeval-external-${suffix}`;
    const docker = new Docker();
    await docker.createVolume({ Name: externalVolume, Labels: { "niceeval.test-external": suffix } });

    const composePath = join(root, "compose.yaml");
    await writeFile(
      join(root, "Dockerfile"),
      `FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce\n` +
        "RUN apk add --no-cache bash curl git\n" +
        "VOLUME /anonymous\n" +
        'CMD ["tail", "-f", "/dev/null"]\n',
      "utf-8",
    );
    await writeFile(
      composePath,
      `services:\n` +
        `  client:\n` +
        `    build: .\n` +
        `    volumes:\n` +
        `      - owned:/owned\n` +
        `      - external:/external\n` +
        `volumes:\n` +
        `  owned: {}\n` +
        `  external:\n` +
        `    external: true\n` +
        `    name: ${externalVolume}\n`,
      "utf-8",
    );

    let projectName: string | undefined;
    try {
      const collection = await collectComposeBuilds({ file: composePath, mainService: "client" });
      const identity = { provider: "docker", kind: "compose", file: composePath, mainService: "client" } as const;
      const plan = {
        evalId: `docker/abort-cleanup-${suffix}`,
        profile: `docker-abort-cleanup-${suffix}`,
        mainService: "client",
        env: {},
        collection,
        caseKey: computeCaseKey({
          caseKind: "compose",
          materializerRevision: COMPOSE_MATERIALIZER_REVISION,
          composeBytes: collection.composeBytes,
          buildKeys: collection.buildKeys,
          caseParams: identity,
        }),
        identity,
      };
      const attempt = new AbortController();
      const materialized = await materializeDockerComposeProviderCase(plan, {
        ctx: {
          evalId: plan.evalId,
          profile: plan.profile,
          signal: attempt.signal,
          buildLocators: new Map(),
        },
      });
      projectName = (materialized.facts as { projectName: string }).projectName;
      const container = docker.getContainer((await docker.listContainers({
        all: true,
        filters: { label: [`com.docker.compose.project=${projectName}`] },
      }))[0]!.Id);
      const mounts = (await container.inspect()).Mounts ?? [];
      const anonymous = mounts.find((mount) => mount.Destination === "/anonymous")?.Name;
      const owned = mounts.find((mount) => mount.Destination === "/owned")?.Name;
      expect(anonymous).toBeTruthy();
      expect(owned).toBeTruthy();

      attempt.abort(new Error("simulated attempt timeout"));
      await materialized.group.stop();

      const containers = await docker.listContainers({
        all: true,
        filters: { label: [`com.docker.compose.project=${projectName}`] },
      });
      const networks = await docker.listNetworks({
        filters: { label: [`com.docker.compose.project=${projectName}`] },
      });
      expect(containers).toHaveLength(0);
      expect(networks).toHaveLength(0);
      await expect(docker.getVolume(anonymous!).inspect()).rejects.toMatchObject({ statusCode: 404 });
      await expect(docker.getVolume(owned!).inspect()).rejects.toMatchObject({ statusCode: 404 });
      await expect(docker.getVolume(externalVolume).inspect()).resolves.toMatchObject({ Name: externalVolume });
    } finally {
      if (projectName !== undefined) {
        await runDockerCompose(["-p", projectName, "-f", composePath, "down", "--volumes", "--remove-orphans"], {
          cwd: root,
          allowNonZero: true,
        }).catch(() => {});
      }
      await docker.getVolume(externalVolume).remove({ force: true }).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
