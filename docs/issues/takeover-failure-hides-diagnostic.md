# E2E takeover 证据失败只输出空错误，无法判断未满足的验收门槛

## 观察

2026-10-23 在 NiceEval 仓库使用正式 `pnpm e2e takeover` 时，给 native args 追加 `--run test/inspection-query.test.ts`，使默认并行观察也仅选择这个只有一个 case 的文件。七次 native 执行全部 passed，所有 cleanup 成功，但最终命令 exit 1，没有 `netake_...`，也没有输出可操作的失败原因，只看到：

```text
E2ECliError:
    at packages/e2e-runner/src/cli.ts:128:32
[ELIFECYCLE] Command failed with exit code 1.
```

本次调用持续约 20 分钟。后续只读核对正式矩阵要求才确认：默认并行观察至少需要两个 case；本次 default-parallel receipt 记录 caseCount=1、parallelism=1。不应把 native case 通过误认作完整验收通过。

## 期望与影响

CLI 应明确输出失败的证据门槛和具体原因，并尽可能在可预检时拒绝无法证明默认并行的选择。当前空错误迫使使用者自行调查验收实现，且无法从命令输出判断是用例失败、资源回收失败、证据校验失败还是工具异常。

## 复现入口与身份

入口为仓库提供的 `pnpm e2e takeover --candidate <candidate.tgz> --repo inspection --selector e2e/inspection/test/inspection-query.test.ts#<managed-case-id> --inventory <fresh-managed-inventory-id> --problem <open-problem-path> --problem-epoch 0 --artifact-root <artifact-directory> -- --run test/inspection-query.test.ts`。candidate、inventory、Problem 和 selector 均使用正式工具生成，不修改或补签收据。

NiceEval checkout HEAD：`8867bd2f7392d33a5e5bdd13abac0bdc1788be14`；运行时仅存在本轮断言来源详情修复及其测试变更，E2E runner 未修改。候选 `niceeval@0.0.0-development`，SHA-256 `21ebcc8e00897576056fe2a723fa08499fe01b2a15684c00826a95a8344f5d38`。Linux，pnpm 11.18.0；确定性本地 CLI 场景，无付费模型。

Provenance：NiceEval-Eval dogfood 暴露断言详情问题后，在 NiceEval 正式修复验收中直接观察。正文已脱敏，不含凭证、私有 URL 或原始用户对话。

建议标签：`bug`、`area:repository`、`needs-triage`。已搜 open/closed 的 `E2ECliError` 与 `takeover diagnostic`，未发现同一观察；后者返回的 #132 是 lease/lock 告警样式问题，与本观察不同。这里只保存本地 draft，不发布或评论远端 Issue。
