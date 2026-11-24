// Local provider double. The concurrent capture/lookup use the production adapter, UserDatabase and lease transactions.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Effect } from "effect";
import { makeDockerBeforeCacheCapability } from "../../packages/niceeval/src/sandbox/docker-before-cache.ts";
import { digestOf } from "../../packages/niceeval/src/sandbox/identity.ts";
const require = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const Docker = require("dockerode");
const dir = await mkdtemp(join(tmpdir(), "before-cache-lease-"));
process.env.NICEEVAL_HOME = dir;
// Each scoped repository request starts a fresh SQLite worker. Reuse its compiled modules.
process.env.NODE_COMPILE_CACHE = join(dir, "compile-cache");
process.env.PATH = dir + ":" + process.env.PATH;
const image = "sha256:" + "a".repeat(64);
const base = "sha256:" + "b".repeat(64);
const writerCloning = Promise.withResolvers();
const readerCloning = Promise.withResolvers();
const resumeReader = Promise.withResolvers();
let exists = false;
let labels;
Docker.prototype.getImage = () => ({
  inspect: async () => {
    if (!exists) throw new Error("no such image");
    return { Id: image, Config: { Labels: labels } };
  },
  remove: async () => {
    exists = false;
  },
});
Docker.prototype.listContainers = async () => [];
Docker.prototype.getContainer = () => ({
  inspect: async () => {
    throw Object.assign(new Error("not found"), { statusCode: 404 });
  },
});
const declarationMetadata = { action: "fixture" };
const digest = digestOf(declarationMetadata);
const step = {
  operationId: "writer",
  knownSensitiveValues: [],
  positions: ["fixture"],
  declaringOwner: "eval:fixture",
  declaration: {
    baseIdentity: base,
    beforeCacheKey: "prefix:" + digest,
    declarationDigest: "sha256:" + digest,
    requiredState: "all",
    cacheFormat: "test",
    changeFrequency: 1,
    declarationMetadata,
  },
};
const common = {
  baseReference: "fixture",
  eligibility: () => ({ _tag: "Eligible", baseIdentity: base, coverage: "all" }),
  destroyCurrentForCacheRecovery: async () => {},
};
let held;
const writer = makeDockerBeforeCacheCapability({
  ...common,
  captureExactImage: async (received) => {
    labels = received;
    exists = true;
    return image;
  },
  rebaseToExactImage: async () => {
    writerCloning.resolve();
    await readerCloning.promise;
    throw new Error("producer private clone unavailable");
  },
});
const reader = makeDockerBeforeCacheCapability({
  ...common,
  adoptBeforeCacheHold: (hold) => {
    held = hold;
  },
  rebaseToExactImage: async () => {
    readerCloning.resolve();
    await resumeReader.promise;
    if (!exists) throw new Error("leased image disappeared");
    return { imageId: image, containerId: "fixture-reader" };
  },
});
try {
  // Only these read-only CLI identity calls are used; no daemon/socket is opened.
  await writeFile(
    join(dir, "docker"),
    '#!/bin/sh\ncase "$1 $2" in "volume inspect") echo fixture;; "info --format") echo fixture;; *) exit 99;; esac\n',
    { mode: 0o755 },
  );
  const producer = Effect.runPromise(Effect.result(writer.capture(step)));
  await Promise.race([
    writerCloning.promise,
    producer.then((r) => {
      throw new Error("capture did not reach clone: " + JSON.stringify(r));
    }),
  ]);
  const consumer = Effect.runPromise(Effect.result(reader.lookupAndRestore({ ...step, operationId: "reader" })));
  await Promise.race([
    readerCloning.promise,
    consumer.then((r) => {
      throw new Error("lookup did not reach clone: " + JSON.stringify(r));
    }),
  ]);
  const result = await producer;
  resumeReader.resolve();
  const read = await consumer;
  assert.equal(result._tag, "Failure");
  assert.equal(exists, true, "a failing producer must not delete a reader's leased image");
  assert.equal(read._tag, "Success", JSON.stringify(read));
  assert.equal(read.success._tag, "Restored");
  await held.release();
} finally {
  resumeReader.resolve();
  await rm(dir, { recursive: true, force: true });
}
