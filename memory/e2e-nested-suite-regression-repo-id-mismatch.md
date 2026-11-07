# 嵌套 E2E suite 无法登记 regression：runner 回执写 manifest id，Concord 按 suite id 校验

## 现象

对 `e2e/adapter/codex-cli` 的用例执行

```sh
concord repo docs test regression add 'e2e/adapter/codex-cli/test/codex-cli.test.ts#neref_199286d0ccc42d91e90b05585572a138' \
  --memory memory/codex-app-server-usage-takes-only-last-response.md \
  --red nered_1CDK0TW362Z0KYFS --takeover netake_JGT6YPX83TTSFGB2 --inventory neinv_J383DQRENQVS0B9J
```

返回 `NativeEvidenceInvalid: Inventory suite or source policy does not match the current configured suite`。red 与 takeover 都已成功（2026-10-29，候选 `d92deb892`）。

## 根因

- `concord.repository.json` 把嵌套目录登记为短横线 suite id，例如 `{ "id": "adapter-codex-cli", "root": "e2e/adapter/codex-cli" }`；`concord repo docs test inventory --repo` 也只接受这种 id。
- e2e runner 的回执用 E2E manifest id（`packages/e2e-runner/src/workspace-inventory.ts` 的 `repo.manifest.id`，即 `adapter/codex-cli`）；`pnpm e2e evidence red` / `takeover` 的 `--repo` 也必须传这个值，否则报 `inventory repo does not match takeover repo`。
- Concord `src/evidence-policy.ts` 的 `validateNativeEvidence` 要求 `inventory.repo === currentSource.binding.suiteId`。一级目录 suite 两种写法相同（`eval`、`runner`），嵌套 suite 永远不等。

佐证：`e2e/adapter/*` 现有的 `@regression` 注释都来自 4 周前的迁移提交 `8954bf3f1`，此后嵌套 suite 没有再登记成功过。

## 影响

所有 `adapter/*` 场景的 bug 修复都无法完成 regression 登记，对应 Problem 也就无法按 fixed 正式关闭。

## 修复

Concord 的 suite id 只允许 `[a-z0-9]+(?:[-_.][a-z0-9]+)*`，不能改成路径形式；`inventory.repo` 必须等于 suite id 是 Concord 已定的契约，修复落在 NiceEval 的 e2e runner：

- `collectCaseInventory` 拆开两个身份：`repo` 仍是 manifest id，只用来拼 `e2e/<repo>/` 路径；新增 `suiteId` 写进回执和每个 case 的 `repo`。
- workspace inventory 用 Concord engine 的 `suite` 操作按 `e2e/<manifest id>` 解析 suite id。
- `pnpm e2e evidence red` 与 `pnpm e2e takeover` 先按 selector 路径解析 suite，拒绝 `--repo` 与 suite root 不一致的组合，再用 suite id 选取 inventory case；执行副本内的二次收集经 `CaseSelectionExpectation.suiteId` 使用同一身份。

验证：修复后 `concord repo docs test inventory --repo adapter-codex-cli --json` 返回 `repo: adapter-codex-cli`。
在 `a2a4bd745` 上，`e2e/adapter/codex-cli/test/codex-cli.test.ts#neref_199286d0ccc42d91e90b05585572a138` 用 `neinv_J35CR22ERVTPYWB5`、`nered_CNXNX3Z99WFTBW90`、`netake_56V1YGW1MRWK2YB7` 完成 `regression add`，这是迁移后首个成功登记的嵌套 suite。

本 Problem 属于仓库工具，没有可挂的 E2E 用例，Concord 的 fixed 门禁（要求 current regression case）无法满足，因此保持 open；以上登记即修复已生效的证据。

## 排查陷阱

- runner 源码任何改动都会改变 adapter 实现摘要，旧的 `neinv_` / `nered_` / `netake_` 一律变成 stale，必须在最终提交上重新收集与执行。
- Concord CLI 把 adapter 失败折叠成 `RepositoryToolError: Repository command failed`，不显示 adapter stderr。runner 的错误类把原因放在 `detail`、`message` 为空，adapter 现在把 `detail` 写在 stderr 首行，但仍需 Concord 侧呈现才能在 CLI 看到。
