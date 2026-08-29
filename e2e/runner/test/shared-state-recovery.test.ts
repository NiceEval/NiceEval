// owner: docs/engineering/testing/e2e/runner.md#runner-shared-state-recovery
// regression: memory/concurrent-run-publication-recovery-race.md
// rerun: pnpm e2e test --repo runner -- --run test/shared-state-recovery.test.ts
// reliability: required takeover on one frozen candidate: 3 isolated + same-copy x2 + repo-default parallel + file/title single + cleanup; no retry.
import { registerSharedStateRecoveryOwner } from "./shared-state-recovery.scenarios.ts";

registerSharedStateRecoveryOwner({
  pausedOwner: "暂停的 owner 不会因 heartbeat 年龄失权，等待者可 SIGINT 取消且恢复后才交接",
  crashedRecovery: "崩溃的 recovery 可由新 actor 显式续接，旧 token 不会删除新 holder",
  teardownFailure: "实际 Experiment teardown 失败会保留 lease，等待者只能取消或走显式恢复",
  missingTeardown: "缺少 teardown 的显式 recovery 不改变 active generation",
  help: "显式 recovery 拒绝 JSON，并在两种帮助入口公开全部参数",
  closedRecovery: "旧 teardown 登记删不掉时 recovery 保持 closed，等待者不能先进入",
  changedKey: "作者改掉 sharedState key 后，旧 key 仍以 immutable evidence 只清理自己的 teardown 登记",
  removedDeclaration: "作者删除 sharedState 声明后仍可按遗留 key 执行一次公开恢复",
  invalidTeardown: "非函数 teardown 被公开 CLI 拒绝，遗留 owner 不会被释放",
});
