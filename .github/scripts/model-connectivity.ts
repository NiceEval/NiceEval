// Probe TLS/routing without sending credentials or invoking a paid model.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const names = ["E2E_MODEL_BASE_URL", "OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "DEEPSEEK_BASE_URL"];
export const unreachableReason = "model-endpoint-unreachable";

// All endpoints share a three-minute budget. The injectable clock/transport are
// for local network simulations; CI always uses the defaults below.
export async function checkConnectivity(env, {
  fetchEndpoint = fetch,
  now = () => performance.now(),
  wait = (ms) => new Promise((done) => setTimeout(done, ms)),
  budgetMs = 180_000,
} = {}) {
  const deadline = now() + budgetMs;
  try {
    const urls = [...new Set(names.map((name) => env[name]).filter(Boolean))].map((base) => {
      const url = new URL(base);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw Error();
      url.pathname = `${url.pathname.replace(/\/$/, "")}/models`;
      return url;
    });
    if (!urls.length) return false;
    const results = await Promise.all(urls.map(async (url) => {
      let delay = 2_000;
      while (now() < deadline) {
        try {
          const response = await fetchEndpoint(url, {
            redirect: "error",
            signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(5_000, deadline - now())))),
          });
          await response.body?.cancel();
          if ([200, 401, 403].includes(response.status)) return true;
        } catch { /* Never print a URL-bearing transport error. */ }
        const remaining = deadline - now();
        if (remaining <= 0) break;
        await wait(Math.min(delay, remaining));
        delay = Math.min(delay * 2, 30_000);
      }
      return false;
    }));
    return results.every(Boolean);
  } catch { return false; }
}

export function writeUnreachableSummary({ artifactRoot, cellId, repoIds }) {
  const root = resolve(artifactRoot);
  const detail = `${unreachableReason}: model endpoint TLS/routing remained unreachable; scenarios were not run.`;
  const results = repoIds.map((id) => {
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(id) || id.split("/").some((part) => part === "." || part === "..")) {
      throw Error("Invalid cell repo id");
    }
    const artifactDir = join(root, id);
    const receiptPath = join(artifactDir, "model-connectivity.json");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(receiptPath, JSON.stringify({
      cellId, repoId: id, category: "infra", reason: unreachableReason, detail,
      stage: "preflight", scenariosRun: false,
    }, null, 2) + "\n");
    return { id, exitCode: null, category: "infra", detail, artifactDir, receiptPath };
  });
  mkdirSync(root, { recursive: true });
  const summaryPath = join(root, "summary.json");
  const summary = {
    artifactRoot: root, summaryPath, results,
    passed: 0, regression: 0, infra: results.length, configuration: 0, cancelled: 0,
    total: results.length, category: "infra", detail,
    runner: { category: "pass", detail: "No scenario process or scratch directory was created.",
      scratchDisposition: { kind: "not-created", ok: true, detail: "Connectivity preflight stopped before scenario execution." } },
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

export async function main(env = process.env, dependencies) {
  if (await checkConnectivity(env, dependencies)) {
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, "reachable=true\n");
    console.log("Model endpoint TLS/routing checks passed (no inference requested).");
    return 0;
  }
  if (env.ARTIFACT_ROOT && env.MANIFESTS_FILE && env.CELL_ID) {
    const manifests = JSON.parse(readFileSync(env.MANIFESTS_FILE, "utf8"));
    writeUnreachableSummary({ artifactRoot: env.ARTIFACT_ROOT, cellId: env.CELL_ID, repoIds: manifests.map(({ id }) => id) });
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `reachable=false\nreason=${unreachableReason}\n`);
  console.error(`${unreachableReason}: model endpoint connectivity failed; raw network diagnostics suppressed.`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.error("Model connectivity preflight failed; raw diagnostics suppressed.");
    process.exitCode = 1;
  });
}
