// owner: docs/engineering/testing/e2e/runner.md#runner-shared-state-lifecycle
// regression: memory/concurrent-run-publication-recovery-race.md
// rerun: pnpm e2e test --repo runner -- --run test/shared-state-lifecycle.test.ts
// reliability: required takeover on one frozen candidate: 3 isolated + same-copy x2 + repo-default parallel + file/title single + cleanup; no retry.
import { registerSharedStateLifecycleOwner } from "./shared-state-lifecycle.scenarios.ts";

registerSharedStateLifecycleOwner({
  serializedSetup: "相同 sharedState.key 在前一 Experiment teardown 后才允许下一 Experiment 进入 setup",
  reusableCompletion: "复用 Sandbox 的每条 Attempt after 与 Experiment teardown 完成后才交出 sharedState",
  reusableFailure: "复用 Sandbox 的 Attempt after 失败也会保留 sharedState，直到公开显式恢复",
  freshFailure: "fresh Sandbox 的 Attempt after 失败也保留 sharedState，直到公开显式恢复",
});
