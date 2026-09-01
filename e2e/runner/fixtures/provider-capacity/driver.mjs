import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  chown,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import Docker from "dockerode";
import {
  createDockerExecutionProfileV1,
  dockerExecutionProfileV1Digest,
} from "niceeval/sandbox";

const PROFILE_ALIAS = "e2e-provider-capacity";
const PROFILE_EXPERIMENT = "provider-capacity/base/00-profile";
const INDEPENDENT_EXPERIMENT = "provider-capacity/base/10-independent";
const GiB = 1024 ** 3;

function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

const controlRoot = resolve(requiredEnv("NICEEVAL_E2E_PROVIDER_CAPACITY_CONTROL_ROOT"));
const profileImage = requiredEnv("NICEEVAL_E2E_PROVIDER_CAPACITY_IMAGE");
const runId = requiredEnv("NICEEVAL_E2E_PROVIDER_CAPACITY_RUN_ID");
const initialScenario = process.env.NICEEVAL_E2E_PROVIDER_CAPACITY_SCENARIO ?? "base";
const projectRoot = process.cwd();
const hostUid = Number(requiredEnv("NICEEVAL_E2E_HOST_UID"));
const hostGid = Number(requiredEnv("NICEEVAL_E2E_HOST_GID"));
const docker = new Docker({ socketPath: "/run/docker.sock" });
const driverStartedAt = Date.now();

function markStage(stage) {
  console.error(`[provider-capacity-stage] +${Date.now() - driverStartedAt}ms ${stage}`);
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function tailText(value, limit = 12_000) {
  return value.length <= limit ? value : `… <${value.length - limit} bytes omitted>\n${value.slice(-limit)}`;
}

function terminalText(value) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/gu, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replaceAll("\r", "")
    .replaceAll("\b", "");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function startProcess(argv, options = {}) {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    detached: options.detached === true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  let settled = false;
  const done = new Promise((resolveDone, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      settled = true;
      resolveDone({
        exitCode: code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
  return {
    child,
    done,
    get settled() {
      return settled;
    },
  };
}

async function runProcess(argv, options = {}) {
  const handle = startProcess(argv, options);
  const receipt = await handle.done;
  if (receipt.exitCode !== 0) {
    throw new Error(
      `${argv.join(" ")} exited ${String(receipt.exitCode)} signal=${String(receipt.signal)}\n` +
      `stdout:\n${receipt.stdout}\nstderr:\n${receipt.stderr}`,
    );
  }
  return receipt;
}

async function terminate(handle) {
  if (handle === undefined || handle.settled || handle.child.pid === undefined) return;
  const send = (signal) => {
    try {
      process.kill(-handle.child.pid, signal);
    } catch {
      // The process group already ended.
    }
  };
  send("SIGTERM");
  const outcome = await Promise.race([
    handle.done.then(() => "done"),
    delay(5_000).then(() => "timeout"),
  ]);
  if (outcome === "timeout") {
    send("SIGKILL");
    await handle.done;
  }
}

async function waitForFile(path, label, timeoutMs, processHandle) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await exists(path)) return true;
    if (processHandle?.settled) {
      const receipt = await processHandle.done;
      throw new Error(
        `${label}: invocation exited before readiness\n` +
        `stdout tail:\n${tailText(receipt.stdout)}\nstderr tail:\n${tailText(receipt.stderr)}`,
      );
    }
    if (Date.now() >= deadline) return false;
    await delay(50);
  }
}

function profileOf(document) {
  const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
  const session = sessions.find((candidate) =>
    candidate?.status === "active" &&
    Array.isArray(candidate.experiments) &&
    candidate.experiments.some((experiment) => experiment?.experimentId === PROFILE_EXPERIMENT)
  );
  const profile = session?.experiments?.find((experiment) => experiment?.experimentId === PROFILE_EXPERIMENT);
  return session === undefined || profile === undefined ? undefined : { session, profile };
}

async function readActiveSession(environment, processHandle, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastReceipt;
  for (;;) {
    if (processHandle.settled) {
      const receipt = await processHandle.done;
      throw new Error(
        `invocation exited before public Session became observable\n` +
        `stdout tail:\n${tailText(receipt.stdout)}\nstderr tail:\n${tailText(receipt.stderr)}`,
      );
    }
    const receipt = await runProcess(
      ["node_modules/.bin/niceeval", "session", "list", "--json"],
      { env: environment },
    );
    lastReceipt = receipt;
    const document = JSON.parse(receipt.stdout);
    const active = profileOf(document);
    const total = (active?.profile.running ?? 0) +
      (active?.profile.queued ?? 0) +
      (active?.profile.elsewhere ?? 0);
    if (active !== undefined && total === 2) return { ...active, document, raw: receipt.stdout };
    if (Date.now() >= deadline) {
      throw new Error(`public Session did not expose both profile Attempts; last=${lastReceipt.stdout}`);
    }
    await delay(100);
  }
}

async function waitForProviderCapacityObservation(
  environment,
  processHandle,
  sessionId,
  timeoutMs = 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastReceipt;
  for (;;) {
    if (processHandle.settled) {
      const receipt = await processHandle.done;
      throw new Error(
        `invocation exited before the public provider-capacity observation stabilized\n` +
        `stdout tail:\n${tailText(receipt.stdout)}\nstderr tail:\n${tailText(receipt.stderr)}`,
      );
    }
    const receipt = await runProcess(
      ["node_modules/.bin/niceeval", "session", "show", sessionId, "--json"],
      { env: environment },
    );
    lastReceipt = receipt;
    const document = JSON.parse(receipt.stdout);
    const session = document?.session;
    const experiments = Array.isArray(session?.experiments) ? session.experiments : [];
    const profile = experiments.find(
      (experiment) => experiment?.experimentId === PROFILE_EXPERIMENT,
    );
    const independent = experiments.find(
      (experiment) => experiment?.experimentId === INDEPENDENT_EXPERIMENT,
    );
    if (session?.status === "active" &&
        profile !== undefined &&
        (profile.running ?? 0) === 1 &&
        (profile.queued ?? 0) === 1 &&
        (profile.elsewhere ?? 0) === 0 &&
        independent !== undefined &&
        (independent.running ?? 0) === 0 &&
        (independent.queued ?? 0) === 0 &&
        (independent.elsewhere ?? 0) === 0) return receipt;
    if (Date.now() >= deadline) {
      throw new Error(
        "public Session did not simultaneously show the unrelated Provider Attempt completed " +
        `and the profile waiter queued before profile release; last=${lastReceipt?.stdout ?? "<none>"}`,
      );
    }
    await delay(100);
  }
}

async function waitForHumanPass(transcript, processHandle, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = await readFile(transcript, "utf8").catch(() => "");
    const clean = terminalText(text);
    const status = clean.split("\n").findLast((line) => line.includes("total ·"));
    const waiter = clean.split("\n").find((line) => line.includes("waiting for provider capacity"));
    if (status !== undefined && /3 total.*1 running.*1 queued.*1 passed/u.test(status)
      && waiter !== undefined && !waiter.includes("creating sandbox")) return;
    if (processHandle.settled) {
      const receipt = await processHandle.done;
      throw new Error(
        `invocation exited before the public human frame showed the unrelated pass\n` +
        `stdout tail:\n${tailText(receipt.stdout)}\nstderr tail:\n${tailText(receipt.stderr)}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "public human frame did not show the unrelated Provider Attempt passing before profile release\n" +
        `terminal tail:\n${tailText(clean)}`,
      );
    }
    await delay(100);
  }
}

class ControlledProfileService {
  constructor(profile, descriptorDigest, socketPath) {
    this.profile = profile;
    this.descriptorDigest = descriptorDigest;
    this.socketPath = socketPath;
    this.generation = `generation-${runId}`;
    this.leases = new Map();
    this.reservations = new Map();
    this.queue = [];
    this.server = undefined;
    this.scenario = initialScenario;
    this.cancelArmed = false;
    this.cancelPid = undefined;
    this.events = { containerCreates: 0, reservationReleases: 0, reservationCancels: 0, acquiredStates: [], activeContainers: 0, maxActiveContainers: 0 };
  }

  validateLease(request) {
    const lease = this.leases.get(request.invocationId);
    if (lease === undefined || lease.token !== request.leaseToken) {
      throw new Error("unknown controlled-profile lease");
    }
  }

  usedContainers() {
    return [...this.reservations.values()].filter((reservation) =>
      reservation.kind === "container" && reservation.state !== "queued"
    ).length;
  }

  grantNext() {
    if (this.usedContainers() >= 1) return;
    const nextId = this.queue.shift();
    if (nextId === undefined) return;
    const next = this.reservations.get(nextId);
    if (next !== undefined && next.state === "queued") next.state = "granted";
  }

  publicReservation(reservation) {
    return {
      reservationId: reservation.id,
      invocationId: reservation.invocationId,
      provisionToken: reservation.provisionToken,
      state: reservation.state,
      ...(reservation.containerId === undefined ? {} : { containerId: reservation.containerId }),
      ...(reservation.networkId === undefined ? {} : { networkId: reservation.networkId }),
      ...(reservation.slotId === undefined ? {} : { slotId: reservation.slotId }),
    };
  }

  labels(reservation, attemptId) {
    return {
      "niceeval.e2e.provider-capacity": runId,
      "niceeval.profile-id": this.profile.profileId,
      "niceeval.invocation-id": reservation.invocationId,
      "niceeval.reservation-id": reservation.id,
      "niceeval.provision-token": reservation.provisionToken,
      "niceeval.attempt-id": attemptId,
    };
  }

  async createContainer(reservation, input) {
    const labels = this.labels(reservation, input.attemptId);
    const suffix = reservation.id.replaceAll("-", "").slice(0, 16);
    const networkName = `niceeval-capacity-${suffix}`;
    const volumeName = `niceeval-capacity-${suffix}`;
    const network = await docker.createNetwork({
      Name: networkName,
      Driver: "bridge",
      Internal: true,
      Labels: labels,
    });
    const volume = await docker.createVolume({ Name: volumeName, Labels: labels });
    reservation.networkId = network.id;
    reservation.networkName = networkName;
    reservation.volumeName = volumeName;
    const resources = reservation.resources;
    try {
      const container = await docker.createContainer({
        name: `niceeval-capacity-${suffix}`,
        Image: input.image,
        Cmd: [...(input.command ?? [])],
        ...(input.entrypoint === undefined ? {} : { Entrypoint: [input.entrypoint] }),
        Env: [...(input.environment ?? []), "DOCKER_TLS_CERTDIR="],
        WorkingDir: input.workingDir,
        ...(input.user === undefined ? {} : { User: input.user }),
        Labels: labels,
        HostConfig: {
          Privileged: true,
          Init: true,
          NetworkMode: networkName,
          Tmpfs: { ...(input.tmpfs ?? {}) },
          NanoCpus: Math.trunc((resources.cpus ?? 0) * 1_000_000_000),
          Memory: resources.memoryBytes ?? 0,
          MemorySwap: resources.memoryBytes ?? 0,
          PidsLimit: resources.pids ?? 0,
          Mounts: [{ Type: "volume", Source: volumeName, Target: "/var/lib/docker" }],
        },
      });
      reservation.containerId = container.id;
      reservation.slotId = volumeName;
      reservation.state = "committed";
      this.events.activeContainers += 1;
      this.events.maxActiveContainers = Math.max(this.events.maxActiveContainers, this.events.activeContainers);
      return { containerId: container.id, networkId: network.id, state: "active" };
    } catch (error) {
      reservation.state = "quarantined";
      throw error;
    }
  }

  async cleanupReservation(reservation) {
    const errors = [];
    if (reservation.containerId !== undefined) {
      try {
        await docker.getContainer(reservation.containerId).remove({ force: true, v: true });
      } catch (error) {
        if (error?.statusCode !== 404) errors.push(error);
      }
    }
    if (reservation.networkId !== undefined) {
      try {
        await docker.getNetwork(reservation.networkId).remove();
      } catch (error) {
        if (error?.statusCode !== 404) errors.push(error);
      }
    }
    if (reservation.volumeName !== undefined) {
      try {
        await docker.getVolume(reservation.volumeName).remove({ force: true });
      } catch (error) {
        if (error?.statusCode !== 404) errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "controlled profile cleanup failed");
  }

  async handle(request) {
    switch (request.kind) {
      case "challenge":
        return {
          protocol: this.profile.transport.controlSocket.protocol,
          profileId: this.profile.profileId,
          descriptorDigest: this.descriptorDigest,
          hostMachineIdentity: this.profile.transport.hostMachineIdentity,
          backendMachineIdentity: this.profile.backend.machineIdentity,
          daemonGeneration: this.generation,
          clientNonce: request.clientNonce,
        };
      case "status":
        return {
          profileId: this.profile.profileId,
          generation: this.generation,
          daemonId: (await docker.info()).ID,
          admissionOpen: true,
          used: { containers: this.usedContainers(), builds: 0 },
          leases: [...this.leases.entries()].map(([invocationId, lease]) => ({
            invocationId,
            daemonGeneration: this.generation,
            state: lease.state,
          })),
          reservations: [...this.reservations.values()].map((reservation) =>
            this.publicReservation(reservation)
          ),
          queue: this.queue.flatMap((reservationId) => {
            const reservation = this.reservations.get(reservationId);
            return reservation === undefined
              ? []
              : [{ reservationId, invocationId: reservation.invocationId }];
          }),
          slots: [],
          degraded: [],
          events: this.events,
        };
      case "lease.create": {
        const token = randomUUID();
        this.leases.set(request.invocationId, { token, state: "active" });
        return { leaseToken: token };
      }
      case "lease.heartbeat":
        this.validateLease(request);
        return {};
      case "lease.drain":
        this.validateLease(request);
        this.leases.get(request.invocationId).state = "draining";
        if (![...this.reservations.values()].some((reservation) =>
          reservation.invocationId === request.invocationId
        )) {
          this.leases.delete(request.invocationId);
          return { state: "recovered" };
        }
        return { state: "draining" };
      case "reservation.acquire": {
        this.validateLease(request);
        if (request.reservationKind !== "container") {
          throw new Error("controlled capacity fixture only accepts container reservations");
        }
        const forcedBlocked = this.scenario === "blocked";
        const forcedAbnormal = this.scenario === "provisioning";
        const forcedCancelQueue = this.scenario === "cancel" && this.cancelArmed;
        const queued = !forcedBlocked && !forcedAbnormal && (
          forcedCancelQueue || this.usedContainers() >= 1 || this.queue.length > 0
        );
        const reservation = {
          id: request.reservationId,
          invocationId: request.invocationId,
          kind: request.reservationKind,
          resources: request.resources ?? {},
          provisionToken: randomUUID(),
          state: forcedBlocked ? "blocked" : forcedAbnormal ? "provisioning" : queued ? "queued" : "granted",
        };
        this.reservations.set(reservation.id, reservation);
        this.events.acquiredStates.push(reservation.state);
        if (queued) {
          this.queue.push(reservation.id);
          await writeFile(join(controlRoot, this.scenario === "capacity-one" ? "capacity-reservation-queued" : "reservation-queued"), "");
        }
        return this.publicReservation(reservation);
      }
      case "reservation.get": {
        this.validateLease(request);
        if (this.scenario === "cancel" && this.cancelArmed) {
          const queued = this.reservations.get(request.reservationId);
          if (queued?.state === "queued" && await exists(join(controlRoot, "grant-cancel-waiter"))) {
            queued.state = "granted";
            this.events.acquiredStates.push("granted");
            this.queue = this.queue.filter((id) => id !== queued.id);
            await writeFile(join(controlRoot, "waiter-granted"), "");
            this.cancelArmed = false;
          }
        } else {
          this.grantNext();
        }
        const reservation = this.reservations.get(request.reservationId);
        if (reservation === undefined) throw new Error("unknown controlled-profile reservation");
        return this.publicReservation(reservation);
      }
      case "reservation.cancel": {
        this.validateLease(request);
        const reservation = this.reservations.get(request.reservationId);
        if (reservation !== undefined && (reservation.state === "queued" || reservation.state === "blocked")) {
          this.events.reservationCancels += 1;
          this.queue = this.queue.filter((id) => id !== reservation.id);
          this.reservations.delete(reservation.id);
        }
        return { cancelled: true };
      }
      case "container.create": {
        this.validateLease(request);
        const reservation = this.reservations.get(request.reservationId);
        if (reservation === undefined || reservation.state !== "granted") {
          throw new Error("controlled-profile reservation was not granted");
        }
        const input = request.create?.intent === "workload" ? request.create.create : undefined;
        if (input === undefined) throw new Error("controlled capacity fixture requires a workload create");
        this.events.containerCreates += 1;
        markStage(`container:create:start:${this.scenario}`);
        await writeFile(join(controlRoot, "container-create"), "");
        reservation.state = "provisioning";
        const created = await this.createContainer(reservation, input);
        markStage(`container:create:complete:${this.scenario}`);
        return created;
      }
      case "reservation.release": {
        this.validateLease(request);
        const reservation = this.reservations.get(request.reservationId);
        if (reservation !== undefined) {
          markStage(`reservation:release:start:${this.scenario}`);
          this.events.reservationReleases += 1;
          reservation.state = "releasing";
          const hadContainer = reservation.containerId !== undefined;
          await this.cleanupReservation(reservation);
          if (hadContainer) this.events.activeContainers = Math.max(0, this.events.activeContainers - 1);
          this.reservations.delete(reservation.id);
          this.queue = this.queue.filter((id) => id !== reservation.id);
          if (this.scenario === "cancel") {
            await writeFile(join(controlRoot, "cancel-waiter-released"), "");
          }
          this.grantNext();
          markStage(`reservation:release:complete:${this.scenario}`);
        }
        return { released: true, cleanupProven: true };
      }
      default:
        throw new Error(`unsupported controlled-profile request ${String(request.kind)}`);
    }
  }

  async listen() {
    await rm(this.socketPath, { force: true });
    this.server = createServer({ allowHalfOpen: true }, (socket) => {
      let raw = "";
      socket.on("error", () => {
        // The request owner receives the connection failure; keep the fixture server alive.
      });
      socket.on("data", (chunk) => { raw += chunk.toString("utf8"); });
      socket.on("end", () => {
        void (async () => {
          try {
            const request = JSON.parse(raw.trim());
            const result = await this.handle(request);
            socket.end(`${JSON.stringify({ ok: true, result })}\n`);
          } catch (error) {
            socket.end(`${JSON.stringify({
              ok: false,
              error: { code: "CONTROLLED_PROFILE_ERROR", message: errorText(error) },
            })}\n`);
          }
        })();
      });
    });
    await new Promise((resolveListen, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, resolveListen);
    });
    await chmod(this.socketPath, 0o600);
  }

  async close() {
    const errors = [];
    if (this.server !== undefined) {
      try {
        await new Promise((resolveClose, reject) =>
          this.server.close((error) => error === undefined ? resolveClose() : reject(error))
        );
      } catch (error) {
        errors.push(error);
      }
    }
    for (const reservation of [...this.reservations.values()]) {
      try {
        await this.cleanupReservation(reservation);
      } catch (error) {
        errors.push(error);
      }
    }
    this.reservations.clear();
    await rm(this.socketPath, { force: true }).catch((error) => errors.push(error));
    if (errors.length > 0) throw new AggregateError(errors, "controlled profile service cleanup failed");
  }
}

async function createProfile(socketPath) {
  const [info, socketFacts] = await Promise.all([
    docker.info(),
    stat("/run/docker.sock"),
  ]);
  const machineIdentity = `niceeval-e2e-${runId}`;
  return createDockerExecutionProfileV1({
    schemaVersion: 1,
    profileId: `provider-capacity-${runId}`,
    securityLevel: "raw-dind-storage/v1",
    transport: {
      kind: "unix",
      hostMachineIdentity: machineIdentity,
      dockerSocket: { path: "/run/docker.sock", peerUid: socketFacts.uid },
      controlSocket: {
        path: socketPath,
        peerUid: 0,
        protocol: "niceeval-docker-profile-control/v1",
      },
    },
    backend: {
      kind: "local-systemd",
      machineIdentity,
      owner: { uid: socketFacts.uid, gid: socketFacts.gid },
      filesystem: {
        identity: `controlled-profile-${runId}`,
        mountPath: controlRoot,
        dockerRootDir: info.DockerRootDir,
        limitBytes: GiB,
        dockerDataPool: {
          count: 1,
          bytesPerAllocation: GiB,
          attestation: "linux-project-quota/v1",
        },
      },
      cgroup: {
        aggregatePath: "/sys/fs/cgroup/system.slice/docker.service",
        policyRevision: "raw-dind-storage-cgroup-v1",
        controllers: ["cpu", "memory", "pids"],
      },
    },
    capacity: {
      cpus: 2,
      memoryBytes: 2 * GiB,
      memorySwapBytes: 0,
      pids: 2048,
      maxContainers: 1,
      maxBuilds: 1,
      ephemeralDiskBytes: GiB,
      aggregate: {
        cpus: 4,
        memoryBytes: 4 * GiB,
        memorySwapBytes: 0,
        pids: 4096,
      },
    },
    policy: {
      level: "raw-dind-storage/v1",
      privilegedTranslation: "host-daemon",
      dockerData: "private-project-quota-allocation/v1",
    },
  });
}

async function makeWritableForHost() {
  const targets = [join(projectRoot, ".niceeval"), controlRoot];
  for (const target of targets) {
    if (!(await exists(target))) continue;
    const receipt = await runProcess(["chown", "-R", `${hostUid}:${hostGid}`, target]);
    if (receipt.exitCode !== 0) throw new Error(receipt.stderr);
  }
}

async function latestPublicSession(environment, experimentId) {
  const listed = await runProcess(
    ["node_modules/.bin/niceeval", "session", "list", "--all", "--json"],
    { env: environment },
  );
  const document = JSON.parse(listed.stdout);
  const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
  const candidate = [...sessions].reverse().find((entry) => {
    const session = entry?.session ?? entry;
    return Array.isArray(session?.experiments)
      && session.experiments.some((experiment) => experiment?.experimentId === experimentId);
  });
  const session = candidate?.session ?? candidate;
  if (typeof session?.sessionId !== "string") {
    throw new Error(`public Session for ${experimentId} was not discoverable`);
  }
  const show = await runProcess(
    ["node_modules/.bin/niceeval", "session", "show", session.sessionId, "--json"],
    { env: environment },
  );
  return { sessionShowJson: show.stdout, sessionId: session.sessionId };
}

async function waitForControlClean(service, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await service.handle({ kind: "status" });
    if ((status.reservations ?? []).length === 0
      && (status.leases ?? []).every((lease) => lease.state === "drained")) return status;
    if (Date.now() >= deadline) throw new Error(`provider-capacity control state did not drain: ${JSON.stringify(status)}`);
    await delay(100);
  }
}

async function runEdgeScenario(service, environment, scenario) {
  markStage(`edge:${scenario}:start`);
  service.scenario = scenario;
  service.events = { containerCreates: 0, reservationReleases: 0, reservationCancels: 0, acquiredStates: [], activeContainers: 0, maxActiveContainers: 0 };
  const transcript = join(controlRoot, `edge-${scenario}.typescript`);
  const invocation = startProcess(["script", "-qefc", [
    "stty cols 200 rows 40",
    "exec node_modules/.bin/niceeval exp provider-capacity/20-edge --rerun all --max-concurrency 1",
  ].join("; "), transcript], {
    env: { ...environment, NICEEVAL_E2E_PROVIDER_CAPACITY_SCENARIO: scenario },
    detached: true,
  });
  const result = await invocation.done;
  if (result.signal !== null && result.signal !== undefined) {
    throw new Error(`edge ${scenario} invocation was terminated by ${result.signal}`);
  }
  const publicSession = await latestPublicSession(environment, "provider-capacity/20-edge");
  const control = await waitForControlClean(service);
  const liveHuman = terminalText(await readFile(transcript, "utf8").catch(() => ""));
  if (service.events.containerCreates !== (scenario === "reuse" ? 1 : 0)) {
    throw new Error(`edge ${scenario} unexpectedly created a container: ${JSON.stringify(service.events)}`);
  }
  if (scenario !== "reuse" && /creating sandbox|sandbox\.create|eval:start/u.test(liveHuman)) {
    throw new Error(`edge ${scenario} exposed a start/create before granted admission: ${liveHuman}`);
  }
  markStage(`edge:${scenario}:complete`);
  return { sessionShowJson: publicSession.sessionShowJson, exitCode: result.exitCode, control, liveHuman };
}

async function runCancelScenario(service, environment) {
  markStage("cancel:start");
  service.scenario = "cancel";
  service.cancelArmed = true;
  service.events = { containerCreates: 0, reservationReleases: 0, reservationCancels: 0, acquiredStates: [], activeContainers: 0, maxActiveContainers: 0 };
  const invocation = startProcess([
    "node_modules/.bin/niceeval",
    "exp",
    "provider-capacity/30-cancel",
    "--rerun",
    "all",
    "--max-concurrency",
    "1",
  ], {
    env: { ...environment, NICEEVAL_E2E_PROVIDER_CAPACITY_SCENARIO: "cancel" },
    detached: true,
  });
  await waitForFile(join(controlRoot, "reservation-queued"), "cancel waiter queued", 20_000, invocation);
  await waitForFile(join(controlRoot, "cancel-blocker-entered"), "cancel blocker holds its runner permit", 20_000, invocation);
  await writeFile(join(controlRoot, "grant-cancel-waiter"), "");
  await waitForFile(join(controlRoot, "waiter-granted"), "cancel waiter reservation granted", 20_000, invocation);
  await waitForFile(join(controlRoot, "cancel-waiter-released"), "cancelled waiter releases its granted reservation", 60_000, invocation);
  await writeFile(join(controlRoot, "release-cancel-blocker"), "");
  const cancelResult = await invocation.done;
  const cancelControl = await waitForControlClean(service);
  if (service.events.containerCreates !== 0 || service.events.reservationReleases < 1) {
    throw new Error(`cancel scenario leaked or created before start: ${JSON.stringify(service.events)}`);
  }
  const cancelHuman = terminalText(`${cancelResult.stdout}\n${cancelResult.stderr}`);
  const cancelPublic = await latestPublicSession(environment, "provider-capacity/30-cancel/00-waiter");
  const cancelDocument = JSON.parse(cancelPublic.sessionShowJson);
  const waiterRecord = (cancelDocument?.session?.experiments ?? [])
    .find((experiment) => experiment?.experimentId === "provider-capacity/30-cancel/00-waiter");
  if (waiterRecord === undefined || /sandbox\.create|creating sandbox|"running":1/u.test(JSON.stringify(waiterRecord))) {
    throw new Error(`cancel waiter exposed start/create or remained running: ${JSON.stringify(waiterRecord)}`);
  }

  const reuse = await runEdgeScenario(service, environment, "reuse");
  markStage("cancel:complete");
  return { cancelControl, cancelHuman, cancelPublic, reuse };
}

async function runCapacityOneScenario(service, environment) {
  markStage("capacity-one:start");
  service.scenario = "capacity-one";
  service.events = { containerCreates: 0, reservationReleases: 0, reservationCancels: 0, acquiredStates: [], activeContainers: 0, maxActiveContainers: 0 };
  const transcript = join(controlRoot, "capacity-one.typescript");
  const invocation = startProcess(["script", "-qefc", [
    "stty cols 200 rows 40",
    "exec node_modules/.bin/niceeval exp provider-capacity/40-capacity-one --rerun all --max-concurrency 2",
  ].join("; "), transcript], { env: { ...environment, NICEEVAL_E2E_PROVIDER_CAPACITY_SCENARIO: "capacity-one" }, detached: true });
  await waitForFile(join(controlRoot, "capacity-first-entered"), "capacity-one first sandbox entered", 20_000, invocation);
  await waitForFile(join(controlRoot, "capacity-reservation-queued"), "capacity-one second reservation queued", 20_000, invocation);
  await writeFile(join(controlRoot, "release-capacity-first"), "");
  const result = await invocation.done;
  if (result.exitCode !== 0 || result.signal !== null) throw new Error(`capacity-one invocation failed: ${JSON.stringify(result)}`);
  await waitForFile(join(controlRoot, "capacity-second-entered"), "capacity-one second sandbox entered", 10_000);
  const control = await waitForControlClean(service);
  if (service.events.maxActiveContainers !== 1 || service.events.activeContainers !== 0 || service.events.containerCreates !== 2) {
    throw new Error(`capacity-one lifecycle violated: ${JSON.stringify(service.events)}`);
  }
  const publicSession = await latestPublicSession(environment, "provider-capacity/40-capacity-one");
  markStage("capacity-one:complete");
  return { control, sessionShowJson: publicSession.sessionShowJson, exitCode: result.exitCode, lifecycle: service.events };
}

async function runGroupReuseScenario(service, environment) {
  markStage("group-reuse:start");
  service.scenario = "group-reuse";
  service.events = { containerCreates: 0, reservationReleases: 0, reservationCancels: 0, acquiredStates: [], activeContainers: 0, maxActiveContainers: 0 };
  const result = await runProcess([
    "node_modules/.bin/niceeval", "exp", "provider-capacity/50-group-reuse", "--rerun", "all", "--max-concurrency", "2", "--json",
  ], { env: environment, timeoutMs: 120_000 });
  if (result.exitCode !== 0) throw new Error(`group reuse invocation failed: ${result.stderr || result.stdout}`);
  const control = await waitForControlClean(service);
  const session = await latestPublicSession(environment, "provider-capacity/50-group-reuse");
  markStage("group-reuse:complete");
  return { control, sessionShowJson: session.sessionShowJson, exitCode: result.exitCode, lifecycle: service.events };
}

async function main() {
  await mkdir(controlRoot, { recursive: true });
  const socketPath = join(controlRoot, "profile-control.sock");
  const profile = await createProfile(socketPath);
  const registry = "/etc/niceeval/docker-profiles";
  const descriptorPath = join(registry, `${PROFILE_ALIAS}.json`);
  await mkdir(registry, { recursive: true, mode: 0o755 });
  await writeFile(descriptorPath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  await chmod(descriptorPath, 0o600);
  await chown(descriptorPath, 0, 0);

  const service = new ControlledProfileService(
    profile,
    dockerExecutionProfileV1Digest(profile),
    socketPath,
  );
  let invocation;
  let primaryError;
  const childEnvironment = {
    ...process.env,
    TERM: "xterm-256color",
    NICEEVAL_E2E_PROVIDER_CAPACITY_PROFILE: PROFILE_ALIAS,
    NICEEVAL_E2E_PROVIDER_CAPACITY_IMAGE: profileImage,
    NICEEVAL_E2E_PROVIDER_CAPACITY_CONTROL_ROOT: controlRoot,
    NICEEVAL_E2E_PROVIDER_CAPACITY_SCENARIO: initialScenario,
  };
  try {
    markStage("service:start");
    await service.listen();
    const transcript = join(controlRoot, "exp-human.typescript");
    const commandLine = [
      "stty cols 200 rows 40",
      "exec node_modules/.bin/niceeval exp provider-capacity/base --rerun all --max-concurrency 2",
    ].join("; ");
    invocation = startProcess(["script", "-qefc", commandLine, transcript], {
      env: childEnvironment,
      detached: true,
    });
    markStage("base:invoked");

    const firstEntered = await waitForFile(
      join(controlRoot, "profile-first-entered"),
      "first profile Attempt enters its deterministic gate",
      60_000,
      invocation,
    );
    if (!firstEntered) throw new Error("first profile Attempt did not enter its deterministic gate");
    const queued = await waitForFile(
      join(controlRoot, "reservation-queued"),
      "second profile reservation enters the controlled capacity queue",
      10_000,
      invocation,
    );
    if (!queued) throw new Error("second profile reservation did not enter the controlled capacity queue");

    const active = await readActiveSession(childEnvironment, invocation);
    const sessionId = active.session.sessionId;
    // The observation-ready handshake is owned by one public Session snapshot.
    // Do not let a slow-but-progressing independent Sandbox bypass completion:
    // that made the old fixture publish a mixed state (profile correct, unrelated
    // Attempt still running) after its optional 8-second file wait expired.
    const showJson = await waitForProviderCapacityObservation(
      childEnvironment,
      invocation,
      sessionId,
    );
    await waitForHumanPass(transcript, invocation, 20_000);
    const [listJson, showHuman] = await Promise.all([
      runProcess(
        ["node_modules/.bin/niceeval", "session", "list", "--json"],
        { env: childEnvironment },
      ),
      runProcess(
        ["node_modules/.bin/niceeval", "session", "show", sessionId],
        { env: childEnvironment },
      ),
    ]);
    const liveHuman = await readFile(transcript, "utf8").catch(() => "");
    await writeFile(join(controlRoot, "public-observation.json"), `${JSON.stringify({
      sessionListJson: listJson.stdout,
      sessionShowJson: showJson.stdout,
      sessionShowHuman: showHuman.stdout,
      liveHuman,
    })}\n`, { mode: 0o666 });
    await chmod(join(controlRoot, "public-observation.json"), 0o666);
    markStage("base:observation-captured");
    // Normal provider admission is bounded only by the invocation/Attempt signal
    // (or an explicit user deadline), never by an internal 30-second queue timer.
    // Keep the public queued observation alive beyond the former hidden limit.
    await delay(31_000);
    await writeFile(join(controlRoot, "observation-ready"), "", { mode: 0o666 });
    await chmod(join(controlRoot, "observation-ready"), 0o666);
    markStage("base:long-wait-proven");

    const released = await waitForFile(
      join(controlRoot, "release-profile-first"),
      "test releases the first profile reservation",
      15_000,
      invocation,
    );
    if (!released) throw new Error("test did not release the first profile reservation");
    markStage("base:release-received");
    const result = await invocation.done;
    if (result.exitCode !== 0) {
      throw new Error(
        `public Experiment invocation exited ${String(result.exitCode)} signal=${String(result.signal)}\n` +
        `stdout tail:\n${tailText(result.stdout, 3_000)}\nstderr tail:\n${tailText(result.stderr, 3_000)}`,
      );
    }
    const secondEntered = await waitForFile(
      join(controlRoot, "profile-second-entered"),
      "second profile Attempt enters after a queue wait longer than 30 seconds",
      5_000,
      invocation,
    );
    if (!secondEntered) {
      throw new Error("second profile Attempt did not enter after the long provider-capacity wait");
    }
    markStage("base:complete");
    const edgeBlocked = await runEdgeScenario(service, childEnvironment, "blocked");
    const edgeAbnormal = await runEdgeScenario(service, childEnvironment, "provisioning");
    const cancelled = await runCancelScenario(service, childEnvironment);
    const capacityOne = await runCapacityOneScenario(service, childEnvironment);
    const groupReuse = await runGroupReuseScenario(service, childEnvironment);
    await writeFile(join(controlRoot, "matrix-observation.json"), `${JSON.stringify({
      edgeBlocked,
      edgeAbnormal,
      cancelled,
      capacityOne,
      groupReuse,
    })}\n`, { mode: 0o666 });
    await chmod(join(controlRoot, "matrix-observation.json"), 0o666);
    markStage("matrix:complete");
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    markStage("cleanup:start");
    const cleanupErrors = [];
    try {
      await terminate(invocation);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await service.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await makeWritableForHost();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      if (primaryError !== undefined) {
        console.error(errorText(new AggregateError(cleanupErrors, "provider-capacity driver cleanup also failed")));
      } else {
        throw new AggregateError(cleanupErrors, "provider-capacity driver cleanup failed");
      }
    }
    markStage("cleanup:complete");
  }
}

main().catch((error) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
