// Deployment build gate. No production transport and no business request.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdir, readFile, mkdtemp, mkdir, cp, lstat, rm } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import * as Sentry from "@sentry/nextjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve("@sentry/profiling-node"));
const nativePath = nativeRequire.resolve("@sentry/node-cpu-profiler");
const { PrivateCpuProfilerBindings } = nativeRequire("@sentry/node-cpu-profiler");
assert.equal(typeof PrivateCpuProfilerBindings?.startProfiling, "function");
assert.equal(typeof PrivateCpuProfilerBindings?.stopProfiling, "function");
if (!process.argv.includes("--runtime-only")) {
  const manifest = JSON.parse(await readFile(".next/server/sentry-profile-assets.json", "utf8"));
  assert.ok(Object.keys(manifest.files).length);
  const traces = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".nft.json")) {
        const trace = JSON.parse(await readFile(path, "utf8"));
        traces.push(...trace.files.map((file) => resolve(dirname(path), file)));
      }
    }
  }
  await walk(".next/server");
  assert.ok(traces.includes(resolve(nativePath)), "Node native loader missing from final server traces");
  assert.ok(
    traces.some((p) => p.endsWith(".node") && p.includes("sentry_cpu_profiler-")),
    "Native binding missing from final server traces",
  );
  assert.ok(
    traces.includes(resolve(".next/server/sentry-profile-assets.json")),
    "Node manifest missing from server traces",
  );
  // Load only files selected by Next for the deploy artifact, outside workspace resolution.
  const snapshot = await mkdtemp(`${tmpdir()}/niceeval-native-final-`);
  const workspace = resolve("../..");
  try {
    for (const source of new Set(traces)) {
      const file = relative(workspace, source);
      assert.ok(!file.startsWith("../"), "Unexpected trace outside the workspace");
      const target = resolve(snapshot, file);
      const stat = await lstat(source);
      if (stat.isDirectory()) continue;
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { verbatimSymlinks: true, force: false, errorOnExist: false });
    }
    execFileSync(
      process.execPath,
      [
        "-e",
        `
      const assert = require('node:assert/strict');
      const binding = require(process.argv[1]).PrivateCpuProfilerBindings;
      assert.equal(typeof binding.startProfiling, 'function');
      assert.equal(typeof binding.stopProfiling, 'function');
      binding.startProfiling('final-artifact');
      const until = performance.now() + 200;
      while (performance.now() < until) Math.sqrt(Math.random());
      const result = binding.stopProfiling('final-artifact', 1, 0, true);
      assert.ok(result && result.samples.length >= 2);
      console.log('PASS native binding and real samples from isolated final server trace');
    `,
        resolve(snapshot, relative(workspace, nativePath)),
      ],
      { stdio: "inherit" },
    );
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}
const envelopes = [];
Sentry.init({
  dsn: "https://public@example.invalid/1",
  defaultIntegrations: false,
  enableOpenTelemetrySetup: false,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1,
  traceLifecycle: "stream",
  profileSessionSampleRate: 1,
  profileLifecycle: "trace",
  transport: () => ({
    send: async (envelope) => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  }),
});
try {
  Sentry.startSpan({ name: "site.page.load", op: "function" }, () => {
    const until = performance.now() + 300;
    while (performance.now() < until) Math.sqrt(Math.random());
  });
  await Sentry.flush(3000);
  const profiles = envelopes.flatMap((e) => e[1]).filter(([h]) => h.type === "profile_chunk");
  assert.ok(profiles.length, "Target native profiler generated no actual chunk");
  assert.ok(profiles.some(([, p]) => p.version === "2" && p.platform === "node" && p.profile.samples.length >= 2));
  console.log(
    `PASS native profile: ${process.platform}/${process.arch} Node${process.versions.node} ABI${process.versions.modules}; chunks=${profiles.length}`,
  );
} finally {
  await Sentry.close(3000);
}
