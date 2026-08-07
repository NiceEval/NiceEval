// cases: docs/engineering/testing/unit/sandbox.md
// 真机 Docker opt-in：NICEEVAL_DOCKER_TEST=1 pnpm exec vitest run --project unit src/sandbox/docker-access.docker.test.ts

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Docker from "dockerode";
import { describe, expect, it } from "vitest";
import { DockerSandbox, type DockerSandboxOptions as RuntimeDockerSandboxOptions } from "./docker.ts";

const execFileAsync = promisify(execFile);
const runDocker = process.env.NICEEVAL_DOCKER_TEST === "1";
const managedSocket = process.env.NICEEVAL_MANAGED_DOCKER_SOCKET;

async function buildImage(
  dockerfile: string,
  socketPath?: string,
): Promise<{ readonly image: string; readonly remove: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-docker-access-"));
  const image = `niceeval-docker-access:${randomUUID()}`;
  await writeFile(join(root, "Dockerfile"), dockerfile, "utf-8");
  if (dockerfile.includes("niceeval-dind-entrypoint")) {
    await writeFile(join(root, "niceeval-dind-entrypoint.sh"), `#!/bin/sh
set -eu
dockerd-entrypoint.sh --host=unix:///var/run/docker.sock >/tmp/dockerd.log 2>&1 &
pid=$!
attempt=0
until docker info >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if ! kill -0 "$pid" 2>/dev/null || [ "$attempt" -ge 120 ]; then
    cat /tmp/dockerd.log >&2
    exit 1
  fi
  sleep 0.25
done
chown root:node /var/run/docker.sock
chmod 660 /var/run/docker.sock
exec "$@"
`, "utf-8");
  }
  const hostArgs = socketPath === undefined ? [] : ["-H", `unix://${socketPath}`];
  await execFileAsync("docker", [...hostArgs, "build", "-t", image, root]);
  return {
    image,
    remove: async () => {
      await execFileAsync("docker", [...hostArgs, "image", "rm", "-f", image]).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    },
  };
}

const cliDockerfile = `FROM docker:29-cli
RUN apk add --no-cache git nodejs npm python3 && addgroup -g 1000 node && adduser -D -u 1000 -G node node
`;

const dindDockerfile = `FROM docker:29-dind
RUN apk add --no-cache git nodejs npm python3 && addgroup -g 1000 node && adduser -D -u 1000 -G node node
ENV DOCKER_HOST=unix:///var/run/docker.sock
ENV DOCKER_TLS_CERTDIR=""
COPY --chmod=755 niceeval-dind-entrypoint.sh /usr/local/bin/niceeval-dind-entrypoint
ENTRYPOINT ["niceeval-dind-entrypoint"]
`;

async function expectNestedDocker(sandbox: DockerSandbox): Promise<void> {
  const result = await sandbox.runCommand("docker", ["run", "--rm", "alpine:3.20", "true"]);
  expect(result.exitCode).toBe(0);
}

describe.runIf(runDocker)("Docker access real project images", () => {
  it("mounts an explicit host socket and runs a child container through its CLI image", async () => {
    const built = await buildImage(cliDockerfile);
    const sandbox = await DockerSandbox.create({
      image: built.image,
      user: "node",
      dockerAccess: {
        mode: "socket",
        socketPath: process.env.NICEEVAL_DOCKER_SOCKET ?? "/var/run/docker.sock",
      },
      readiness: { command: ["docker", "info"], user: "node", timeoutMs: 30_000 },
    });
    try {
      await expectNestedDocker(sandbox);
    } finally {
      await sandbox.stop();
      await built.remove();
    }
  }, 180_000);

  it("starts a project-owned daemon in a raw privileged outer container", async () => {
    const built = await buildImage(dindDockerfile);
    const sandbox = await DockerSandbox.create({
      image: built.image,
      user: "node",
      privileged: "raw",
      dockerAccess: { mode: "dind", isolation: "raw-privileged" },
      readiness: { command: ["docker", "info"], user: "node", timeoutMs: 30_000 },
    });
    try {
      await expectNestedDocker(sandbox);
    } finally {
      await sandbox.stop();
      await built.remove();
    }
  }, 180_000);
});

describe.runIf(runDocker && managedSocket !== undefined)("Managed rootless DinD real project image", () => {
  it("runs nested Docker and never downgrades a failed attestation to raw privileged", async () => {
    if (managedSocket === undefined) throw new Error("managed Docker socket is missing");
    const socketPath = managedSocket;
    const docker = new Docker({ socketPath });
    const info = await docker.info();
    const built = await buildImage(dindDockerfile, socketPath);
    const common: RuntimeDockerSandboxOptions = {
      image: built.image,
      user: "node",
      privileged: "rootless",
      dockerAccess: {
        mode: "dind",
        isolation: "managed-rootless",
        profile: "e2e",
      },
      dockerSocketPath: socketPath,
      dns: [process.env.NICEEVAL_MANAGED_DOCKER_DNS ?? "1.1.1.1"],
      readiness: { command: ["docker", "info"], user: "node", timeoutMs: 30_000 },
      rootlessAttestation: { daemonId: info.ID, dataRoot: info.DockerRootDir },
    };
    const sandbox = await DockerSandbox.create(common);
    try {
      await expectNestedDocker(sandbox);
    } finally {
      await sandbox.stop();
    }
    await expect(DockerSandbox.create({
      ...common,
      rootlessAttestation: { daemonId: `${info.ID}-wrong`, dataRoot: info.DockerRootDir },
    })).rejects.toThrow(/daemon ID does not match/);
    await built.remove();
  }, 180_000);
});
