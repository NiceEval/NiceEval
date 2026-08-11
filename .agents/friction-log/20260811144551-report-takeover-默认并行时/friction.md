---
title: 'Report takeover 默认并行时 config-reload 不加载自定义配置'
severity: 'major'
---

### Expected Behavior

`pnpm e2e takeover --candidate <candidate> --repo report -- --run test/report-project-current.test.ts` 的 `repo-default-parallel` 阶段应让既有 `report-config-reload` owner 加载刚写入项目副本的自定义 report，并出现 `REPORT_FIRST`、`INDIRECT_FIRST`、`ATTEMPTS_3`。

### Current Behavior

两次独立 takeover 均只有 `repo-default-parallel` 失败：`report-config-reload.test.ts` 取得 HTTP 200，但根 HTML 没有 `REPORT_FIRST`。第二次把首屏改为轮询 15 秒仍超时，说明不是简单监听 readiness 延迟。新 `report-project-current` owner 的 fresh-1/2/3、same-copy 两次和 target-single 均通过。第二次的完整汇总与失败收据见 [`artifacts/takeover-summary.json`](artifacts/takeover-summary.json) 和 [`artifacts/repo-default-parallel-receipt.json`](artifacts/repo-default-parallel-receipt.json)。

### Possible Solution

检查 Report Repo 默认并行时自定义 config/report 的 fresh-import、项目副本 cwd 与缓存身份是否跨测试串扰；不要用增加 timeout 掩盖。

### Minimal Reproducible Example

显式 pack candidate 后运行：

```sh
pnpm e2e takeover --candidate /tmp/candidate.tgz --repo report -- --run test/report-project-current.test.ts
```

观察 `takeover/repo-default-parallel/report/receipt.json` 中 `report-config-reload.test.ts` 的首屏断言失败。

### Context

为 `052b13bb fix(report): exclude stale project results` 新增 project-current Journey 并执行新 owner 接管门时发现。试探性 readiness 修改已撤回，没有把无效修法留在产品 diff。
