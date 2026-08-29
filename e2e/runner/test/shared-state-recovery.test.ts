// rerun: pnpm e2e test --repo runner -- --run test/shared-state-recovery.test.ts
// reliability: required takeover on one frozen candidate: 3 isolated + same-copy x2 + repo-default parallel + file/title single + cleanup; no retry.
import { registerSharedStateRecoveryOwner } from "./shared-state-recovery.scenarios.ts";

registerSharedStateRecoveryOwner();
