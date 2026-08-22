/** Control-protocol reply-loss smoke, run by watchdog-smoke. */
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseDockerProfileReservation, type DockerProfileLease } from "../../packages/niceeval/src/sandbox/docker-profile/runtime.ts";

const binding = { profile: { profileId: "profile" }, daemonGeneration: "generation", controlSocketPath: "", dockerSocketPath: "", alias: "a", descriptorDigest: "d", daemonId: "d", platform: "linux/amd64" } as never;
const lease = { binding, invocationId: "lease", leaseToken: "token", stopHeartbeat: async () => {} } as DockerProfileLease;

async function matrix(status: object, success: boolean): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-public-release-"));
  const path = join(root, "control.sock");
  let calls = 0;
  const server = createServer((socket) => socket.once("data", (raw) => {
    calls += 1;
    if (calls === 1) { socket.destroy(); return; } // durable host success, lost reply
    const request = JSON.parse(raw.toString()) as { kind: string };
    socket.end(JSON.stringify({ ok: true, result: request.kind === "status" ? status : {} }) + "\n");
  }));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const current = { ...lease, binding: { ...binding, controlSocketPath: path } };
  const realNow = Date.now;
  const base = realNow();
  let reads = 0;
  Date.now = () => (++reads <= 2 ? base : base + 120_000);
  try {
    const result = await Promise.race([
      releaseDockerProfileReservation(current, "reservation", { slotId: "slot" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("reply-loss proof timeout")), 1_000)),
    ]);
    if (!success || result.cleanupProven !== true) throw new Error("reply-loss proof accepted an invalid status");
  } catch (error) {
    if (success) throw error;
  } finally {
    Date.now = realNow;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const good = { profileId: "profile", generation: "generation", leases: [{ invocationId: "lease", daemonGeneration: "generation" }], reservations: [], slots: [{ slotId: "slot", state: "free" }], degraded: [] };
  await matrix(good, true);
  await matrix({ ...good, profileId: "other" }, false);
  await matrix({ ...good, generation: "other" }, false);
  await matrix({ ...good, leases: [] }, false);
  await matrix({ ...good, reservations: [{ reservationId: "reservation", invocationId: "lease" }] }, false);
  await matrix({ ...good, slots: [{ slotId: "slot", reservationId: "reservation", state: "active" }] }, false);
  await matrix({ ...good, degraded: ["recovery blocked for reservation"] }, false);
  console.log("docker-profile-public-smoke ok");
}
void main();
