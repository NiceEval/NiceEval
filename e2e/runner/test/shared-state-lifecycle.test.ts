// owner: docs/engineering/testing/e2e/runner.md#runner-shared-state-lifecycle
// regression: same-key public Experiment setup must wait for the prior Experiment teardown to finish.
// rerun: pnpm e2e --repo runner -- --run test/shared-state-lifecycle.test.ts
// reliability: required takeover on one frozen candidate: 3 isolated + same-copy x2 + repo-default parallel + file/title single + cleanup; no retry.
import { registerSharedStateLifecycleOwner } from "./shared-state-lifecycle.scenarios.ts";

registerSharedStateLifecycleOwner();
