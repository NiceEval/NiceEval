// owner: docs/engineering/testing/e2e/runner.md#runner-shared-state-recovery
// regression: public sharedState recovery must not free a live immutable owner for a waiting Experiment.
// rerun: pnpm e2e --repo runner -- --run test/shared-state-recovery.test.ts
// reliability: required takeover on one frozen candidate: 3 isolated + same-copy x2 + repo-default parallel + file/title single + cleanup; no retry.
import { registerSharedStateRecoveryOwner } from "./shared-state-recovery.scenarios.ts";

registerSharedStateRecoveryOwner();
