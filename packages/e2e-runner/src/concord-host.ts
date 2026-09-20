import { NodeServices } from "@effect/platform-node";
import type { RepositoryHost } from "concord-sdlc/repository/host-contract";
import { Effect, Layer } from "effect";

import * as inventory from './inventory-api.js';
import { repoRootDir } from './discovery.js';

/** NiceEval owns native collection, candidate injection, and formal evidence. */
const nativeRuntime = Layer.mergeAll(NodeServices.layer, inventory.OwnedProcessLive);
const runNative = <A, E, R>(program: Effect.Effect<A, E, R>) => program.pipe(
  Effect.provide(nativeRuntime),
  Effect.scoped,
  Effect.mapError((cause) => cause instanceof Error ? cause : new Error(String(cause))),
);
const syncNative = <A>(evaluate: () => A) => Effect.try({
  try: evaluate,
  catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
});

export default {
  format: 'concord.repository-host/v2',
  caseIdentity: 'concord.case-contracts/v1',
  repositoryRoot: repoRootDir(),
  collectRepoCaseInventory: (suiteId, checkout) => runNative(inventory.collectRepoCaseInventory(suiteId, checkout)),
  collectWorkspaceCaseInventory: (checkout) => runNative(inventory.collectWorkspaceCaseInventory(checkout)),
  managedInventoryImplementationDigest: (root) => syncNative(() => inventory.managedInventoryImplementationDigest(root)),
  readManagedInventoryReceipt: (root, inventoryId, selector) => syncNative(() => inventory.readManagedInventoryReceipt(root, inventoryId, selector)),
  readManagedRedEvidence: (root, id) => syncNative(() => inventory.readManagedRedEvidence(root, id)),
  readManagedTakeoverEvidence: (root, id) => syncNative(() => inventory.readManagedTakeoverEvidence(root, id)),
} satisfies RepositoryHost;
