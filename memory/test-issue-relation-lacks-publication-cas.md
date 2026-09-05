---
format: niceeval.memory/v1
id: test-issue-relation-lacks-publication-cas
title: test issue add 没有 publication 前的远端 identity 复查
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# test issue add 没有 publication 前的远端 identity 复查

P1；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Sol review，父 agent 独立复核。入口：`packages/repo-tools/src/docs/test-case/cli-runtime.ts:355`。

test issue add 首次读取 GitHub Issue 后，远端对象被删除、转移或 provenance 改变，本地 relation 仍可能发布已失效的验证结果。目标 [Issue verification](../docs/engineering/testing/e2e/case-relations.md#issue-verification) 要求 publication 前 ETag/node ID CAS 复查。

verifyIssue 只执行一次 gh api，返回 node ID、titleDigest 与 checkedAt；addCaseIssue 随即进入 planOne/publish，没有第二次远端读取或 CAS。当前结果只能证明首次读取时的状态。

待验证：用只模拟 GitHub 边界的 fixture，让第一次读取有效、publication barrier 后对象身份变化；正式本地命令必须具名失败且零写入。测试不得写远端 GitHub，也不能让 fixture 复制 relation publication 实现。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。

## 2026-09-05 修复验收

父 agent 通过真实 docs test issue add 与外部 gh fixture 对比旧实现和修复：两次读取的 node ID 改变时，旧实现一次读取即发布；修复两次读取后拒绝，sidecar 零写入。稳定 identity/provenance 的对照确实完成 relation publication。未创建或修改远端 Issue。

实现与上述仓库入口验收已完成；当前结构化 fixed 门只接受产品 E2E 凭据，尚无仓库 DX 凭据类型，因此保留 open，不借用无关产品 case 宣称 resolved(fixed)。
