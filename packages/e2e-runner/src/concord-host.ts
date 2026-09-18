import type { RepositoryHost } from 'concord-sdlc/repository/host-contract';
import { QUERY_PROTOCOL } from '../../niceeval/src/inspection/protocol-values.js';
import * as inventory from './inventory-api.js';
import { repoRootDir } from './discovery.js';
/** NiceEval owns native collection, candidate injection, and formal evidence. */
export default {
  format: 'concord.repository-host/v1',
  caseIdentity: 'concord.case-contracts/v1',
  repositoryRoot: repoRootDir(),
  QUERY_PROTOCOL,
  OwnedProcessLive: inventory.OwnedProcessLive,
  collectRepoCaseInventory: inventory.collectRepoCaseInventory,
  collectWorkspaceCaseInventory: inventory.collectWorkspaceCaseInventory,
  managedInventoryImplementationDigest: inventory.managedInventoryImplementationDigest,
  readManagedInventoryReceipt: inventory.readManagedInventoryReceipt,
  readManagedRedEvidence: inventory.readManagedRedEvidence,
  readManagedTakeoverEvidence: inventory.readManagedTakeoverEvidence,
} satisfies RepositoryHost;
