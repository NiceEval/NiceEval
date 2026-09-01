import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

const statePath = process.env.NICEEVAL_E2E_FAKE_INCUS_STATE;
const journalPath = process.env.NICEEVAL_E2E_FAKE_INCUS_JOURNAL;
if (!statePath || !journalPath) throw new Error("fake Incus requires state and journal paths");

const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const imageName = "niceeval/docker-execution-v1";

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(work) {
  const lock = `${statePath}.lock`;
  const staleAfterMs = 5_000;
  let lockToken;
  let fd;
  for (;;) {
    try {
      fd = openSync(lock, "wx", 0o600);
      lockToken = `${process.pid} ${Date.now()}\n`;
      writeFileSync(fd, lockToken);
      break;
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw cause;
      try {
        const observedLock = readFileSync(lock, "utf8");
        const [ownerText, acquiredAtText] = observedLock.trim().split(/\s+/u);
        const owner = Number.parseInt(ownerText, 10);
        const acquiredAt = Number.parseInt(acquiredAtText, 10);
        let stale = Number.isSafeInteger(acquiredAt) && Date.now() - acquiredAt > staleAfterMs;
        if (Number.isSafeInteger(owner) && owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (ownerCause) {
            if (ownerCause?.code === "ESRCH") stale = true;
          }
        }
        // Every locked mutation above is synchronous and contains no external
        // work. An owner that remains visible as a zombie must therefore not
        // keep the fixture locked forever after its command process was killed.
        if (stale) {
          try {
            if (readFileSync(lock, "utf8") === observedLock) unlinkSync(lock);
          } catch (unlinkCause) {
            if (unlinkCause?.code !== "ENOENT") throw unlinkCause;
          }
          continue;
        }
      } catch (readCause) {
        if (readCause?.code !== "ENOENT") throw readCause;
      }
      sleep(5);
    }
  }
  try {
    const state = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf8"))
      : { instances: {}, volumes: {} };
    const result = work(state);
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    renameSync(temporary, statePath);
    return result;
  } finally {
    closeSync(fd);
    try {
      if (readFileSync(lock, "utf8") === lockToken) unlinkSync(lock);
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
  }
}

function journal(event, detail = {}) {
  appendFileSync(journalPath, `${JSON.stringify({ event, detail, pid: process.pid })}\n`);
}

function envelope(metadata) {
  process.stdout.write(`${JSON.stringify({ type: "sync", status: "Success", status_code: 200, metadata })}\n`);
}

function absent() {
  process.stdout.write(`${JSON.stringify({ type: "error", error: "not found", error_code: 404 })}\n`);
}

function splitPath(raw) {
  const url = new URL(raw, "http://incus.invalid");
  return { pathname: url.pathname, project: url.searchParams.get("project") ?? "default" };
}

function volumeKey(project, pool) {
  return `${project}\u0000${pool}`;
}

function projectInstances(state, project) {
  state.instances[project] ??= {};
  return state.instances[project];
}

function projectVolumes(state, project, pool) {
  const key = volumeKey(project, pool);
  state.volumes[key] ??= {};
  return state.volumes[key];
}

function bodyFrom(args) {
  const index = args.indexOf("-d");
  return index < 0 ? undefined : JSON.parse(args[index + 1]);
}

function maybeBlock(label) {
  const block = process.env.NICEEVAL_E2E_FAKE_INCUS_BLOCK_ONCE;
  if (!block || !label.includes(block)) return;
  const claimed = `${statePath}.block-claimed`;
  try {
    const fd = openSync(claimed, "wx", 0o600);
    closeSync(fd);
  } catch (cause) {
    if (cause?.code === "EEXIST") return;
    throw cause;
  }
  journal("blocked", { label });
  for (;;) sleep(10_000);
}

function query(args) {
  const method = args[args.indexOf("-X") + 1];
  const rawPath = args[args.indexOf("-X") + 2];
  const { pathname, project } = splitPath(rawPath);
  const body = bodyFrom(args);
  const label = `${method} ${pathname}?project=${project}`;
  journal("query", { method, path: pathname, project, body });

  if (method === "GET") {
    const result = withLock((state) => {
      if (pathname === "/1.0") return { kind: "value", value: { api_version: "1.0" } };
      if (pathname.startsWith("/1.0/projects/")) return { kind: "value", value: { name: decodeURIComponent(pathname.split("/").at(-1)) } };
      if (pathname.includes("/storage-pools/") && !pathname.includes("/volumes/")) {
        const pool = decodeURIComponent(pathname.split("/").at(-1));
        return { kind: "value", value: { name: pool, driver: "dir", config: { source: "/data/niceeval-sandbox-dev" } } };
      }
      if (pathname === "/1.0/images") {
        return { kind: "value", value: [{
          fingerprint: digest,
          aliases: [{ name: imageName }],
          type: "virtual-machine",
          properties: { "niceeval.guest-init": "block-docker-data/v1" },
        }] };
      }
      if (pathname === "/1.0/instances") {
        return { kind: "value", value: Object.values(projectInstances(state, project)) };
      }
      if (pathname.startsWith("/1.0/instances/")) {
        const name = decodeURIComponent(pathname.split("/").at(-1));
        const value = projectInstances(state, project)[name];
        return value === undefined ? { kind: "absent" } : { kind: "value", value };
      }
      const volumeMatch = /^\/1\.0\/storage-pools\/([^/]+)\/volumes\/custom(?:\/([^/]+))?$/u.exec(pathname);
      if (volumeMatch) {
        const pool = decodeURIComponent(volumeMatch[1]);
        const volumes = projectVolumes(state, project, pool);
        if (volumeMatch[2] === undefined) return { kind: "value", value: Object.values(volumes) };
        const value = volumes[decodeURIComponent(volumeMatch[2])];
        return value === undefined ? { kind: "absent" } : { kind: "value", value };
      }
      return { kind: "absent" };
    });
    maybeBlock(label);
    if (result.kind === "absent") absent(); else envelope(result.value);
    return;
  }

  withLock((state) => {
    const volumeMatch = /^\/1\.0\/storage-pools\/([^/]+)\/volumes\/custom(?:\/([^/]+))?$/u.exec(pathname);
    if (method === "POST" && volumeMatch && volumeMatch[2] === undefined) {
      const pool = decodeURIComponent(volumeMatch[1]);
      const volumes = projectVolumes(state, project, pool);
      volumes[body.name] = {
        name: body.name,
        type: "custom",
        content_type: body.content_type ?? "block",
        config: { ...(body.config ?? {}) },
      };
      return;
    }
    if (method === "PATCH" && volumeMatch && volumeMatch[2] !== undefined) {
      const pool = decodeURIComponent(volumeMatch[1]);
      const name = decodeURIComponent(volumeMatch[2]);
      const volume = projectVolumes(state, project, pool)[name];
      if (volume) volume.config = { ...volume.config, ...(body.config ?? {}) };
      return;
    }
    if (method === "DELETE" && volumeMatch && volumeMatch[2] !== undefined) {
      const pool = decodeURIComponent(volumeMatch[1]);
      delete projectVolumes(state, project, pool)[decodeURIComponent(volumeMatch[2])];
      return;
    }
    if (method === "POST" && pathname === "/1.0/instances") {
      const instances = projectInstances(state, project);
      let baseImage = body.source?.fingerprint;
      let sourceVolume;
      if (body.source?.type === "copy") {
        const sourceProject = body.source.project;
        const sourceName = body.source.source;
        const source = projectInstances(state, sourceProject)[sourceName];
        baseImage = source?.config?.["volatile.base_image"] ?? body.source["base-image"];
        const sourceDevice = source?.expanded_devices?.dockerdata;
        if (sourceDevice) sourceVolume = projectVolumes(state, sourceProject, sourceDevice.pool)[sourceDevice.source];
      }
      const dockerdata = body.devices?.dockerdata;
      if (dockerdata && sourceVolume) {
        projectVolumes(state, project, dockerdata.pool)[dockerdata.source] = {
          ...sourceVolume,
          name: dockerdata.source,
          config: { ...sourceVolume.config },
        };
      }
      instances[body.name] = {
        name: body.name,
        status: "Stopped",
        type: "virtual-machine",
        config: { ...(body.config ?? {}), "volatile.base_image": baseImage ?? digest },
        expanded_devices: { ...(body.devices ?? {}) },
      };
      return;
    }
    const stateMatch = /^\/1\.0\/instances\/([^/]+)\/state$/u.exec(pathname);
    if (method === "PUT" && stateMatch) {
      const instance = projectInstances(state, project)[decodeURIComponent(stateMatch[1])];
      if (instance) instance.status = body.action === "start" ? "Running" : "Stopped";
      return;
    }
    const instanceMatch = /^\/1\.0\/instances\/([^/]+)$/u.exec(pathname);
    if (method === "DELETE" && instanceMatch) {
      delete projectInstances(state, project)[decodeURIComponent(instanceMatch[1])];
    }
  });
  maybeBlock(label);
  envelope({});
}

function execCommand(args) {
  const separator = args.indexOf("--");
  const argv = separator < 0 ? [] : args.slice(separator + 1);
  const joined = argv.join(" ");
  journal("exec", { argv });
  const gateRoot = process.env.NICEEVAL_E2E_FAKE_INCUS_GATE_ROOT;
  const branch = joined.includes("niceeval-e2e-prefix-branch-three")
    ? "three"
    : joined.includes("niceeval-e2e-prefix-branch-four")
      ? "four"
      : undefined;
  if (gateRoot && branch) {
    journal("prefix-gate-reached", { branch });
    const release = `${gateRoot}/release-${branch}`;
    while (!existsSync(release)) sleep(10);
    journal("prefix-gate-released", { branch });
  }
  if (argv[0] === "id" && argv[1] === "-u") {
    process.stdout.write("1000\n");
    return;
  }
  if (joined.includes("docker info") && joined.includes("docker compose version")) {
    process.stdout.write("HOST=\nServer Version: 29.0.0\nDocker Compose version v2.39.0\n");
    return;
  }
  if (joined.includes("node --version")) {
    process.exitCode = 1;
  }
}

const args = process.argv.slice(2);
if (args[0] === "query") query(args.slice(1));
else if (args[0] === "exec") execCommand(args.slice(1));
else if (args[0] === "file") {
  journal("file", { args });
  if (args[1] === "pull") process.stdout.write("");
} else {
  throw new Error(`unsupported fake incus argv: ${JSON.stringify(args)}`);
}
