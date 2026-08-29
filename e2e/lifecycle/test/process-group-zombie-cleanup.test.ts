// owner: docs/engineering/testing/e2e/README.md#process-group-terminal-state
// Regression note: ProcessHandle must re-scan an owned terminal-zombie group before accepting its process-group terminal state.
// Rerun: pnpm e2e test --repo lifecycle -- --run test/process-group-zombie-cleanup.test.ts
// Regression note: memory/testkit-zombie-only-process-group.md
// Regression note: memory/testkit-procfs-scan-race.md
// reliability: required takeover on one frozen candidate: 3 isolated + same-copy x2 + repo-default parallel + file/title single + cleanup; no retry.
import { registerProcessGroupZombieCleanupOwner } from "./process-group-zombie-cleanup.scenarios.ts";

registerProcessGroupZombieCleanupOwner({
  subreaper: "Lifecycle subreaper returns a child exit observed at its blocking wait boundary",
  terminalZombies: "ProcessHandle cleanup completes when an owned Linux process group contains only terminal zombies",
  postTermScan: "ProcessHandle repeats its post-TERM procfs scan before accepting a terminal owned group",
});
