import { randomUUID } from "node:crypto";
import type Docker from "dockerode";
import {
  acquireDockerProfileReservation,
  attestDockerProfile,
  commitDockerProfileReservation,
  createDockerProfileLease,
  loadDockerProfileRegistry,
  releaseDockerProfileReservation,
} from "./runtime.ts";

export interface DockerProfileCliOptions {
  readonly json: boolean;
  readonly smoke: boolean;
}

interface Check {
  readonly name: string;
  readonly status: "PASS" | "FAIL";
  readonly detail: string;
}

async function pull(docker: Docker, image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {}
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => docker.modem.followProgress(stream, (error) => error ? reject(error) : resolve()));
}

async function exec(container: Docker.Container, command: readonly string[]): Promise<{ code: number; output: string }> {
  const process = await container.exec({ Cmd: [...command], AttachStdout: true, AttachStderr: true });
  const stream = await process.start({});
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const inspected = await process.inspect();
  return { code: inspected.ExitCode ?? 1, output: Buffer.concat(chunks).toString().replace(/[\x00-\x08]/g, "") };
}

async function smokeProfile(alias: string): Promise<Check[]> {
  const binding = await attestDockerProfile(alias);
  const lease = await createDockerProfileLease(binding);
  const reservation = await acquireDockerProfileReservation(lease, "container", {
    cpus: 2,
    memoryBytes: 512 * 1024 * 1024,
    pids: 256,
    containers: 1,
  });
  const labels = {
    "niceeval.profile-id": binding.profile.profileId,
    "niceeval.invocation-id": lease.invocationId,
    "niceeval.reservation-id": reservation.reservationId,
    "niceeval.provision-token": reservation.provisionToken,
    "niceeval.attempt-id": "doctor-smoke",
  };
  // doctor 的非 smoke 路径也不应要求安装 optional dockerode peer。
  const { default: DockerClient } = await import("dockerode");
  const docker = new DockerClient({ socketPath: binding.dockerSocketPath });
  let container: Docker.Container | undefined;
  let network: Docker.Network | undefined;
  try {
    await pull(docker, "docker:29-dind");
    network = await docker.createNetwork({
      Name: `niceeval-doctor-${randomUUID()}`,
      Driver: "bridge",
      Options: { "com.docker.network.bridge.enable_icc": "false" },
      Labels: labels,
    });
    container = await docker.createContainer({
      Image: "docker:29-dind",
      Env: ["DOCKER_TLS_CERTDIR="],
      Labels: labels,
      HostConfig: {
        Privileged: true,
        NetworkMode: network.id,
        NanoCpus: 2_000_000_000,
        Memory: 512 * 1024 * 1024,
        MemorySwap: 512 * 1024 * 1024,
        PidsLimit: 256,
        ReadonlyRootfs: true,
        Dns: [...binding.profile.policy.network.dns.servers],
        Tmpfs: {
          "/var/lib/docker": "rw,exec,nosuid,nodev,size=256m",
          "/run": "rw,exec,nosuid,nodev,size=64m",
          "/tmp": "rw,nosuid,nodev,size=64m,mode=1777",
        },
      },
    });
    await commitDockerProfileReservation(lease, reservation.reservationId, {
      containerId: container.id,
      networkId: network.id,
      attemptId: "doctor-smoke",
    });
    await container.start();
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const result = await exec(container, ["docker", "info"]);
      if (result.code === 0) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("inner dockerd did not become ready within 30 seconds");
    const limits = await exec(container, ["sh", "-c", "cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/pids.max"]);
    if (limits.code !== 0) throw new Error(`cgroup probe failed: ${limits.output}`);
    const nested = await exec(container, ["docker", "run", "--rm", "alpine:3.20", "true"]);
    if (nested.code !== 0) throw new Error(`nested Docker failed: ${nested.output}`);
    return [
      { name: "outer hard limits", status: "PASS", detail: limits.output.trim().replace(/\n/g, " · ") },
      { name: "nested Docker", status: "PASS", detail: "docker:29-dind ran alpine:3.20" },
    ];
  } finally {
    await releaseDockerProfileReservation(lease, reservation.reservationId).catch(async () => {
      await container?.remove({ force: true }).catch(() => undefined);
      await network?.remove().catch(() => undefined);
    });
    await lease.stopHeartbeat().catch(() => undefined);
  }
}

export async function runDockerProfileCommand(
  positionals: readonly string[],
  options: DockerProfileCliOptions,
): Promise<number> {
  if (positionals[0] !== "profile") {
    process.stderr.write("Usage: niceeval docker profile list [--json]\n" +
      "       niceeval docker profile doctor <alias> [--smoke] [--json]\n");
    return 1;
  }
  const subcommand = positionals[1];
  if (subcommand === "list" && positionals.length === 2 && !options.smoke) {
    try {
      const registry = await loadDockerProfileRegistry();
      const rows = registry.entries.map((entry) => ({
        alias: entry.alias,
        profileId: entry.profileId,
        securityLevel: entry.profile.securityLevel,
        semanticPolicyRevision: entry.profile.semanticPolicyRevision,
        endpointKind: entry.profile.transport.kind,
        health: "descriptor-valid",
      }));
      if (options.json) process.stdout.write(`${JSON.stringify({ format: "niceeval.docker-profiles", schemaVersion: 1, profiles: rows })}\n`);
      else for (const row of rows) process.stdout.write(
        `${row.alias}\t${row.profileId.slice(0, 12)}\t${row.securityLevel}\tpolicy ${row.semanticPolicyRevision.slice(0, 12)}\t${row.health}\n`,
      );
      return 0;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  if (subcommand === "doctor" && positionals.length === 3) {
    const alias = positionals[2]!;
    const checks: Check[] = [];
    try {
      const binding = await attestDockerProfile(alias);
      checks.push(
        { name: "descriptor and registry", status: "PASS", detail: binding.descriptorDigest },
        { name: "Docker/control attestation", status: "PASS", detail: `generation ${binding.daemonGeneration}` },
        { name: "rootless cgroup backend", status: "PASS", detail: `${binding.platform} · ${binding.profile.backend.cgroup.aggregatePath}` },
        { name: "network policy", status: "PASS", detail: `v${binding.profile.policy.network.version} · IPv6 disabled · pinned DNS` },
      );
      if (options.smoke) checks.push(...await smokeProfile(alias));
    } catch (error) {
      checks.push({ name: "profile", status: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    }
    if (options.json) process.stdout.write(`${JSON.stringify({ format: "niceeval.docker-profile-doctor", schemaVersion: 1, alias, checks })}\n`);
    else for (const check of checks) process.stdout.write(`${check.status}  ${check.name}  ${check.detail}\n`);
    return checks.some((check) => check.status === "FAIL") ? 1 : 0;
  }
  process.stderr.write("Usage: niceeval docker profile list [--json]\n" +
    "       niceeval docker profile doctor <alias> [--smoke] [--json]\n");
  return 1;
}
