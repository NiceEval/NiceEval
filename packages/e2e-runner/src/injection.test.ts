import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { verifyEffectResolution } from "./injection.ts";

const pins = {
  effect: "4.1.4",
  "@effect/platform-node": "4.1.4",
  "@effect/platform-node-shared": "4.1.4",
};
const lockfile = `packages:
  effect@4.1.4: {}
  '@effect/platform-node@4.1.4': {}
  '@effect/platform-node-shared@4.1.4': {}
`;

function writeManifest(root: string, manifest: object): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
}

function fixture(t: TestContext) {
  const consumer = realpathSync(mkdtempSync(join(tmpdir(), "niceeval-injection-test-")));
  t.after(() => rmSync(consumer, { recursive: true, force: true }));
  const virtualStore = join(consumer, "node_modules", ".pnpm");
  const candidateDeps = join(virtualStore, "niceeval@file", "node_modules");
  const candidate = join(candidateDeps, "niceeval");
  writeManifest(consumer, { dependencies: { effect: pins.effect } });
  writeManifest(candidate, { name: "niceeval", dependencies: pins });
  for (const [name, version] of Object.entries(pins))
    writeManifest(join(candidateDeps, name), { name, version, exports: { "./package.json": "./package.json" } });
  return {
    consumer,
    virtualStore,
    candidate,
    effect: join(candidateDeps, "effect"),
    connectEffect(target: string) {
      const link = join(consumer, "node_modules", "effect");
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(target, link, "junction");
    },
    platform: join(candidateDeps, "@effect", "platform-node"),
  };
}

test("accepts Effect beside the installed candidate when the consumer shares its real path", (t) => {
  const repo = fixture(t);
  repo.connectEffect(repo.effect);
  assert.deepEqual(verifyEffectResolution(repo.consumer, repo.candidate, lockfile, repo.virtualStore), { ok: true });
});

test("rejects a second physical Effect package even when both versions match", (t) => {
  const repo = fixture(t);
  const duplicate = join(repo.virtualStore, "duplicate", "node_modules", "effect");
  writeManifest(duplicate, { name: "effect", version: pins.effect });
  repo.connectEffect(duplicate);
  const verdict = verifyEffectResolution(repo.consumer, repo.candidate, lockfile, repo.virtualStore);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /from NiceEval and .* from the consumer/);
});

test("rejects a platform package that resolves a different Effect", (t) => {
  const repo = fixture(t);
  repo.connectEffect(repo.effect);
  writeManifest(join(repo.platform, "node_modules", "effect"), { name: "effect", version: pins.effect });
  const verdict = verifyEffectResolution(repo.consumer, repo.candidate, lockfile, repo.virtualStore);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /from @effect\/platform-node/);
});

test("rejects an installed platform version that differs from the candidate pin", (t) => {
  const repo = fixture(t);
  repo.connectEffect(repo.effect);
  writeManifest(repo.platform, { name: "@effect/platform-node", version: "4.1.5" });
  const verdict = verifyEffectResolution(repo.consumer, repo.candidate, lockfile, repo.virtualStore);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /candidate dependency @effect\/platform-node@4\.1\.4/);
});

test("checks quoted platform package resolutions in the installed lockfile", (t) => {
  const repo = fixture(t);
  repo.connectEffect(repo.effect);
  const mismatched = `${lockfile}  '@effect/platform-node@4.1.5': {}\n`;
  const verdict = verifyEffectResolution(repo.consumer, repo.candidate, mismatched, repo.virtualStore);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /mismatched Effect resolution: @effect\/platform-node@4\.1\.5/);
});
