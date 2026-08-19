// owner: docs/engineering/testing/e2e/README.md#process-group-terminal-state
// regression: ProcessHandle must re-scan an owned terminal-zombie group before accepting its process-group terminal state.
// Rerun: pnpm e2e --repo lifecycle -- --run test/process-group-zombie-cleanup.test.ts
// regression: memory/testkit-zombie-only-process-group.md
// regression: memory/testkit-procfs-scan-race.md
// reliability: required takeover on one frozen candidate: 3 isolated + same-copy x2 + repo-default parallel + file/title single + cleanup; no retry.
import { registerProcessGroupZombieCleanupOwner } from "./process-group-zombie-cleanup.scenarios.ts";

registerProcessGroupZombieCleanupOwner();
