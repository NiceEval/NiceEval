---
format: niceeval.memory/v1
id: regression-publication-does-not-bind-current-test-source
title: regression publication 未重新核验当前测试源码和 red/green source
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# regression publication 未重新核验当前测试源码和 red/green source

P1；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Sol review，父 agent 独立复核。入口：`packages/repo-tools/src/docs/test-case/cli-runtime.ts:223`。

生成受管 red/takeover evidence 后，保持 case token 与标题不变但修改测试正文或 sidecar，再登记 regression，旧证据可能被用于新的测试语义。目标见 [E2E case relations](../docs/engineering/testing/e2e/case-relations.md)。

validateRegressionEvidence 比较 selector、inventory digest、candidate 与 certificate，却不比较 red/green source，也不把 receipt 的 testFileSha256 与当前文件重新绑定。managed inventory/evidence 的 implementationDigest 只覆盖工具实现文件；takeover certificate 只保证自己七份 receipt 一致，不能证明 red 或当前工作区也一致。

待验证：用真实受管入口取得证据，再只改测试断言而保留 token/title，regression add 必须以 EvidenceMismatch 零写入失败。另验证 sidecar 当前语义变化的拒绝，以及受管 relation history 追加不使既有合法 evidence 失效。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。
