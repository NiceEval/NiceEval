---
title: 'pr:body check 拒绝没有测试源码变化的 verification'
severity: 'minor'
---

### Actual observation
受管 edit verification 填入 docs-only 验证后，check 报 Tests must contain at least one test file。

### Expected behavior
Repository Tools 正文允许没有测试源码变化时单独录入 verification；校验应接受编辑器生成的正文。

### Impact
纯文档 PR 不能通过 Verification 交付验证。临时通过受管 reset 重建内容，并把真实 lint/typecheck 结果放入 Problem，不伪造测试改动。

### Public entry-point reproduction
在没有测试源码改动的新分支草稿中依次运行：
```sh
pnpm pr:body init --base main
pnpm pr:body edit problem --user-goal docs --current-limitation wording --required-capability clarity --user-outcome docs
pnpm pr:body edit verification --candidate docs-only --green "pnpm lint passed" --repeatability "not applicable" --fixed-conditions docs-only --unit-count 0
pnpm pr:body check
```
最后一步非零退出，诊断为 Tests must contain at least one test file。不需要 GitHub 写入。

### NiceEval identity
fc6f749556e81ab4a2c68e6edc36e30c2b2743d4；本轮仅 docs 修改，PR 工具未改。

### Environment
Linux；Node v24.19.0；pnpm 11.18.0。

### Source provenance
NiceEval/NiceEval 的 fix-gap 文档重构中，通过 pnpm pr:body 直接观察。

### Public data confirmation
- [x] I removed secrets, credentials, private customer data, private repository content, and other sensitive material from this issue.
- [x] This issue does not disclose or describe a suspected security vulnerability.
