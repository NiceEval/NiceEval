// Attempt-time host transfer evidence.  Planning has already recorded every
// statically reproducible upload in EvalModuleFacts; this wrapper snapshots the
// exact bytes before provider I/O and makes dynamic paths conservatively non-carry.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPathWithinEvalOwner,
  materializeOwnedTransferDirectory,
  moduleObservationCursor,
  observedModuleEdgesSince,
  readOwnedTransferFile,
} from "./eval-roots.ts";
import type {
  DiscoveredEval,
  EvalModuleEdge,
  ExecutionInputs,
  JsonValue,
  StaticTransferPlanEntry,
} from "../types.ts";

type TransferStatus = "sent" | "failed" | "plan-mismatch";

interface SnapshotFile {
  readonly path: string;
  readonly sourceId: string;
  readonly digest: string;
  readonly cleanup: () => Promise<void>;
}

interface SnapshotDirectory extends SnapshotFile {
  readonly entries: number;
}

/** One tracker belongs to one Attempt and is never shared across concurrent runs. */
export class ExecutionInputTracker {
  readonly #ownerRoot: string;
  readonly #plan: readonly StaticTransferPlanEntry[];
  readonly #planDigest: string;
  readonly #entries: globalThis.Record<string, JsonValue>[] = [];
  readonly #limitations = new Map<string, string | undefined>();
  readonly #runtimeModuleEdges: EvalModuleEdge[] = [];
  readonly #consumedPlanSequences = new Set<number>();
  #observationCursor: number;

  constructor(private readonly evalDef: DiscoveredEval) {
    this.#ownerRoot = evalDef.ownerRoot ?? process.cwd();
    this.#plan = evalDef.moduleFacts?.transferPlan ?? [];
    this.#planDigest = staticExecutionPlanDigest(evalDef);
    this.#observationCursor = moduleObservationCursor();
    for (const limitation of evalDef.moduleFacts?.limitations ?? []) {
      this.#limitations.set(limitation.code, limitation.detail);
    }
  }

  async uploadFile(
    source: string | URL,
    target: string,
    send: (snapshot: string, target: string) => Promise<void>,
  ): Promise<void> {
    const sourcePath = sourcePathOf(source);
    const snapshot = await snapshotFile(sourcePath, this.#ownerRoot);
    const sourceId = snapshot.sourceId;
    const planned = this.#matchingPlan("file", sourceId, target);
    const entry: globalThis.Record<string, JsonValue> = {
      kind: "file",
      source: sourceId,
      target,
      digest: snapshot.digest,
      status: "sent",
    };
    try {
      this.#assertPlan(planned, snapshot.digest, entry);
      await send(snapshot.path, target);
    } catch (cause) {
      entry.status = planStatus(cause);
      this.#record(entry);
      throw cause;
    } finally {
      await snapshot.cleanup();
    }
    this.#record(entry);
  }

  /** Shared owner guard for host-side paths that do not themselves transfer in. */
  async assertOwnedPath(path: string | URL): Promise<string> {
    return assertPathWithinEvalOwner(sourcePathOf(path), this.#ownerRoot);
  }

  async uploadDirectory(
    source: string | URL,
    target: string | undefined,
    options: { readonly ignore?: readonly string[] } | undefined,
    send: (snapshot: string, target: string | undefined, options: { readonly ignore?: readonly string[] } | undefined) => Promise<void>,
  ): Promise<void> {
    const sourcePath = sourcePathOf(source);
    const ignore = options?.ignore ?? [];
    const snapshot = await snapshotDirectory(sourcePath, this.#ownerRoot, ignore);
    const sourceId = snapshot.sourceId;
    const targetId = target ?? "$WORKDIR";
    const planned = this.#matchingPlan("directory", sourceId, targetId, ignore);
    const entry: globalThis.Record<string, JsonValue> = {
      kind: "directory",
      source: sourceId,
      target: targetId,
      digest: snapshot.digest,
      entries: snapshot.entries,
      status: "sent",
    };
    try {
      this.#assertPlan(planned, snapshot.digest, entry);
      await send(snapshot.path, target, options);
    } catch (cause) {
      entry.status = planStatus(cause);
      this.#record(entry);
      throw cause;
    } finally {
      await snapshot.cleanup();
    }
    this.#record(entry);
  }

  /** Immutable, path-sanitised Attempt payload suitable for schema-15 result.json. */
  snapshot(): ExecutionInputs {
    this.#captureRuntimeModuleEdges();
    const missing = this.#plan.filter((entry) => !this.#consumedPlanSequences.has(entry.sequence));
    if (missing.length > 0 && this.#entries.length > 0) {
      this.#limitations.set("transfer-plan-incomplete", missing.map((entry) => String(entry.sequence)).join(","));
    }
    const limitations = [...this.#limitations.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, detail]) => Object.freeze({ code, ...(detail === undefined ? {} : { detail }) }));
    const transfers = this.#entries.map((entry) => Object.freeze({ ...entry }));
    const runtimeModuleEdges = Object.freeze(this.#runtimeModuleEdges.map((edge) => Object.freeze({ ...edge })));
    const eligible = limitations.length === 0 && !transfers.some((entry) => entry.status !== "sent");
    const value: ExecutionInputs = {
      version: 1,
      digest: digestJson({ planDigest: this.#planDigest, limitations, transfers, runtimeModuleEdges }),
      planDigest: this.#planDigest,
      eligible,
      limitations: Object.freeze(limitations),
      transfers: Object.freeze(transfers),
      runtimeModuleEdges,
    };
    return Object.freeze(value);
  }

  #matchingPlan(
    kind: StaticTransferPlanEntry["kind"],
    source: string,
    target: string,
    ignore: readonly string[] = [],
  ): StaticTransferPlanEntry | undefined {
    const next = this.#plan
      .filter((entry) => !this.#consumedPlanSequences.has(entry.sequence))
      .sort((left, right) => left.sequence - right.sequence)[0];
    const match = next !== undefined &&
      next.kind === kind && next.source === source && next.target === target &&
      JSON.stringify(next.ignore ?? []) === JSON.stringify(ignore)
      ? next
      : undefined;
    if (match === undefined) this.#limitations.set("dynamic-transfer", `${kind}:${source} -> ${target}`);
    else this.#consumedPlanSequences.add(match.sequence);
    return match;
  }

  #record(entry: globalThis.Record<string, JsonValue>): void {
    this.#entries.push(Object.freeze({ sequence: this.#entries.length, ...entry }));
  }

  #assertPlan(
    planned: StaticTransferPlanEntry | undefined,
    actualDigest: string,
    entry: globalThis.Record<string, JsonValue>,
  ): void {
    if (planned === undefined) return;
    if (planned.digest === actualDigest) return;
    entry.expectedDigest = planned.digest;
    throw new TransferPlanMismatchError(`Transfer snapshot differs from its planned digest for ${String(entry.source)}.`);
  }

  #captureRuntimeModuleEdges(): void {
    const owner = this.evalDef.ownerRoot;
    if (owner === undefined || this.evalDef.origin === undefined) return;
    const observed = observedModuleEdgesSince(owner, this.#observationCursor);
    this.#observationCursor = moduleObservationCursor();
    const planned = new Set((this.evalDef.moduleFacts?.edges ?? []).map((edge) => `${edge.parent}\u0000${edge.specifier}`));
    for (const edge of observed) {
      const parent = ownerRelative(owner, edge.parent);
      const key = `${parent}\u0000${edge.specifier}`;
      if (planned.has(key)) continue;
      const runtimeEdge: EvalModuleEdge = Object.freeze({
        parent,
        specifier: edge.specifier,
        ...(edge.target === undefined ? {} : { target: portableRuntimeTarget(owner, edge.target) }),
        ...(edge.conditions === undefined ? {} : { conditions: Object.freeze([...edge.conditions]) }),
        kind: "literal-import",
      });
      if (this.#runtimeModuleEdges.some((existing) => JSON.stringify(existing) === JSON.stringify(runtimeEdge))) continue;
      this.#runtimeModuleEdges.push(runtimeEdge);
      this.#limitations.set("runtime-module-edge", `${runtimeEdge.parent} -> ${runtimeEdge.specifier}`);
    }
  }
}

/** Shared planner/attempt digest; this exact value is the --accept-transfer selector. */
export function staticExecutionPlanDigest(evalDef: DiscoveredEval): string {
  return digestJson(evalDef.moduleFacts?.transferPlan ?? []);
}

class TransferPlanMismatchError extends Error {}

function planStatus(cause: unknown): TransferStatus {
  return cause instanceof TransferPlanMismatchError ? "plan-mismatch" : "failed";
}

function sourcePathOf(value: string | URL): string {
  return value instanceof URL ? fileURLToPath(value) : resolve(value);
}

function ownerRelative(ownerRoot: string, input: string): string {
  const rel = relative(ownerRoot, input).split(sep).join("/");
  if (rel === ".." || rel.startsWith("../") || rel.length === 0 && input !== ownerRoot) {
    throw new Error("Eval transfer source escapes its owner root.");
  }
  return rel || ".";
}

function portableRuntimeTarget(ownerRoot: string, target: string): string {
  const rel = relative(ownerRoot, target).split(sep).join("/");
  if (rel !== ".." && !rel.startsWith("../")) return rel || ".";
  const normalized = target.split(sep).join("/");
  const marker = "/node_modules/";
  const index = normalized.lastIndexOf(marker);
  return index === -1 ? normalized.split("/").at(-1) ?? "(unknown)" : normalized.slice(index + marker.length);
}

async function snapshotFile(source: string, ownerRoot: string): Promise<SnapshotFile> {
  const materialized = await readOwnedTransferFile(source, ownerRoot);
  const dir = await mkdtemp(join(tmpdir(), "niceeval-transfer-"));
  const path = join(dir, "payload");
  try {
    await writeFile(path, materialized.bytes);
    return {
      path,
      sourceId: materialized.sourceId,
      digest: materialized.digest,
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (cause) {
    await rm(dir, { recursive: true, force: true });
    throw cause;
  }
}

async function snapshotDirectory(source: string, ownerRoot: string, ignore: readonly string[]): Promise<SnapshotDirectory> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-transfer-"));
  const payload = join(root, "payload");
  try {
    await mkdir(payload);
    const materialized = await materializeOwnedTransferDirectory(source, ownerRoot, ignore, {
      directory: async (relativePath) => mkdir(join(payload, ...relativePath.split("/"))),
      file: async (relativePath, bytes) => writeFile(join(payload, ...relativePath.split("/")), bytes),
    });
    return {
      path: payload,
      sourceId: materialized.sourceId,
      digest: materialized.digest,
      entries: materialized.entries,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
